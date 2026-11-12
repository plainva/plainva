//! The folder boundary of the MCP server (plan KI-Harness §17.3, the path
//! cases of §13.4). Every path a client names and every path a result names is
//! checked here, natively: a request outside the client's folders never reaches
//! the web view, and an answer that names a note outside them never reaches the
//! client. The web view checks the same rules again; this is the second wall.

use unicode_normalization::UnicodeNormalization;

/// Whether the web view's `String.prototype.trim` removes this character: ECMAScript's WhiteSpace and
/// LineTerminator (`\t` to `\r`, space, no-break space, U+1680, U+2000–U+200A, the line and paragraph separators,
/// U+202F, U+205F, U+3000, the byte-order mark). Not Rust's `char::is_whitespace`, which differs in U+0085 and
/// U+FEFF. Pinned against the engine by both sides' tests (`mcpPathSpelling.fixture.json`).
pub fn js_trims(c: char) -> bool {
    matches!(c as u32, 0x09..=0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF)
}

/// A vault-relative path as a client may name it, in the ONE spelling that is
/// checked here and then used: the handler forwards exactly this string to the
/// web view in place of what the client wrote (R19 of the stability plan, after
/// the independent review). It is what the web view would make of the argument
/// itself — trimmed as `trim()` trims, without a leading `./` — and in NFC, the
/// form the index keeps every path in (ADR 0016); the web view's own
/// `safeRelPath` leaves such a string as it is, which its test pins on the
/// shared list. `None` when it could leave the vault, reach Plainva's own
/// folders, or mean something other than it says on some file system.
pub fn safe_rel_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim_matches(js_trims);
    let stripped = trimmed.strip_prefix("./").unwrap_or(trimmed);
    // Checked in the form it goes on in: every rule below sees the NFC string the web view gets.
    let nfc: String = stripped.nfc().collect();
    let p = nfc.as_str();
    // Counted as the tools' schema counts it (UTF-16 units, `max(1024)`): one limit on both sides.
    if p.is_empty() || p.encode_utf16().count() > 1024 {
        return None;
    }
    // White space the web view would still trim (behind a `./`): the string would change on its way.
    if p.starts_with(js_trims) || p.ends_with(js_trims) {
        return None;
    }
    // NUL, backslashes (a second separator on Windows), absolute paths, drive
    // letters, UNC and URL-ish names are not vault paths.
    if p.contains('\0') || p.contains('\\') || p.starts_with('/') || p.contains(':') {
        return None;
    }
    let parts: Vec<&str> = p.split('/').collect();
    for part in &parts {
        if part.is_empty() || *part == "." || *part == ".." {
            return None;
        }
        // Windows drops trailing dots and spaces: "Private./x" would open "Private/x".
        if part.ends_with('.') || part.ends_with(' ') {
            return None;
        }
        if part.chars().any(|c| c.is_control()) {
            return None;
        }
    }
    // Plainva's own state and the policy files (ADR 0022), and with them every
    // dot file and dot folder at any depth: hidden on every surface of the app
    // (`isHiddenPath` in the core, decision E8 of 2026-11-02), so never an
    // argument and never a result. A dot has no letter case to fold.
    if parts.iter().any(|part| part.starts_with('.')) {
        return None;
    }
    // The core's internal folders that have no leading dot (`node_modules`, `Thumbs.db`, `$RECYCLE.BIN`, …), folded as
    // the file system folds them: never shown in the app, never a path here (`content_path_refusal`).
    if content_path_refusal(p) == Some(Refusal::Internal) {
        return None;
    }
    Some(p.to_string())
}

/// The internal-path rules of the core (`INTERNAL_PATH_RULES` in `internalPath.ts`), read from the file the core's
/// own test pins to them: a folder the core never shows is no path a client may name here either.
fn internal_rules() -> &'static crate::vault_walk::WalkRules {
    #[derive(serde::Deserialize)]
    struct Pinned {
        rules: crate::vault_walk::WalkRules,
    }
    static RULES: std::sync::OnceLock<crate::vault_walk::WalkRules> = std::sync::OnceLock::new();
    RULES.get_or_init(|| {
        serde_json::from_str::<Pinned>(include_str!("../../../../../packages/core/src/vault/internalPathRules.fixture.json"))
            .map(|pinned| pinned.rules)
            // Compiled in and tested: a file that does not read is a build that is broken, and it refuses every name
            // that starts with a dot through `safe_rel_path` all the same.
            .unwrap_or_default()
    })
}

/// Why a path a client names needs a second look before it is followed to the disk — `contentPathRefusal` of the
/// core, the same verdicts on the same list (`contentPathRefusal.fixture.json`). `Internal` is final; the other three
/// are shapes that are ordinary names on some systems and reach a device, a hidden stream or another folder on
/// Windows: followed only where the vault holds exactly that spelling (`real_inside`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    Internal,
    Device,
    Stream,
    Alias,
}

pub fn content_path_refusal(path: &str) -> Option<Refusal> {
    let normalized = path.replace('\\', "/");
    let segments: Vec<&str> = normalized.split('/').collect();
    let rules = internal_rules();
    if segments.iter().any(|segment| rules.is_internal(&segment.nfc().collect::<String>())) {
        return Some(Refusal::Internal);
    }
    if segments.iter().any(|segment| is_device_segment(segment)) {
        return Some(Refusal::Device);
    }
    if segments.iter().any(|segment| segment.contains(':')) {
        return Some(Refusal::Stream);
    }
    if segments.iter().any(|segment| is_short_name_alias(segment)) {
        return Some(Refusal::Alias);
    }
    None
}

/// A Windows device name with or without an extension, in any case (`isWindowsDeviceSegment`).
fn is_device_segment(segment: &str) -> bool {
    // ASCII case only, as the core's `/i` pattern without the `u` flag folds it (the Kelvin sign is no `k` there).
    let base = segment.split('.').next().unwrap_or("").trim_end_matches(' ').to_ascii_lowercase();
    if matches!(base.as_str(), "con" | "prn" | "aux" | "nul" | "conin$" | "conout$") {
        return true;
    }
    let mut chars = base.chars();
    let head: String = chars.by_ref().take(3).collect();
    let rest: Vec<char> = chars.collect();
    (head == "com" || head == "lpt") && rest.len() == 1 && (rest[0].is_ascii_digit() || matches!(rest[0], '\u{b9}' | '\u{b2}' | '\u{b3}'))
}

/// The 8.3 short form Windows can keep beside a long name (`isShortNameAlias`): one to six characters other than a
/// dot or a tilde, a tilde, a number from 1 without a leading zero (at most six digits), and up to three characters
/// of extension. Lengths count UTF-16 code units, as the core's pattern (no `u` flag) does: a character outside the
/// Basic Multilingual Plane counts twice (review of R19: `📝📝📝📝~1.md` is no alias in the core, and is none here).
fn is_short_name_alias(segment: &str) -> bool {
    let units = |text: &str| text.chars().map(char::len_utf16).sum::<usize>();
    let (name, extension) = match segment.split_once('.') {
        Some((name, extension)) => (name, Some(extension)),
        None => (segment, None),
    };
    if extension.is_some_and(|extension| extension.contains('.') || units(extension) > 3) {
        return false;
    }
    let Some((stem, number)) = name.split_once('~') else {
        return false;
    };
    let stem_len = units(stem);
    (1..=6).contains(&stem_len)
        && !stem.contains('~')
        && (1..=6).contains(&number.len())
        && number.chars().all(|c| c.is_ascii_digit())
        && !number.starts_with('0')
}

/// Whether one segment has a shape `content_path_refusal` asks about beside the internal folders.
fn unusual_shape(segment: &str) -> bool {
    is_device_segment(segment) || segment.contains(':') || is_short_name_alias(segment)
}

/// Whether this build folds letter case when it looks for a CANDIDATE: where the file system usually ignores case
/// (Windows, macOS). A candidate is never a decision — `real_inside` decides on the paths the disk returns.
const FOLDS_CASE: bool = !cfg!(target_os = "linux");

/// The spelling two paths are compared in to find a candidate: NFC always (macOS may hand either form), and
/// case-folded where the file system usually ignores case (`FOLDS_CASE`).
fn fold_as(path: &str, fold_case: bool) -> String {
    let nfc: String = path.nfc().collect();
    if fold_case {
        nfc.to_lowercase()
    } else {
        nfc
    }
}

/// True when `path` (already through `safe_rel_path`) may lie inside one of the granted folders — a CANDIDATE.
/// "" grants the whole vault; a folder grants itself and everything below it, never a sibling that merely shares a
/// prefix. Folding finds candidates and never decides: `ẞ` and `ß`, or the Kelvin sign and `K`, fold together, and a
/// case-sensitive directory keeps `Projects` and `projects` apart. Every path that reaches the vault is decided by
/// `real_inside`, real path against real path.
pub fn inside(path: &str, folders: &[String]) -> bool {
    inside_as(path, folders, FOLDS_CASE)
}

fn inside_as(path: &str, folders: &[String], fold_case: bool) -> bool {
    let p = fold_as(path, fold_case);
    folders.iter().any(|folder| {
        let f = fold_as(folder.trim_matches('/'), fold_case);
        f.is_empty() || p == f || p.starts_with(&format!("{f}/"))
    })
}

/// A path argument's candidate in one step: safe, in the spelling that goes on, and possibly inside the client's
/// folders. Decided by `real_inside`.
pub fn allowed(raw: &str, folders: &[String]) -> Option<String> {
    safe_rel_path(raw).filter(|p| inside(p, folders))
}

/// A string that is NOT a client's argument — a folder the user granted, a path an answer names — is used only as it
/// stands: it is the user's (or the vault's) word about one place on disk, and a trim or a normalisation would make it
/// another (review of R19: ` Notes` became `Notes`). `None` where `safe_rel_path` would refuse or change it.
pub fn exact_rel_path(path: &str) -> Option<&str> {
    safe_rel_path(path).is_some_and(|checked| checked == path).then_some(path)
}

/// Whether a folder can be granted as it is: the whole vault (""), or a path `exact_rel_path` keeps.
pub fn grantable(folder: &str) -> bool {
    folder.is_empty() || exact_rel_path(folder).is_some()
}

/// The folders of a grant, each as the user chose it — or the first one that cannot be granted as it stands. Never
/// trimmed, normalised or dropped: the pairing answer and the folders setting both go through here.
pub fn grant_folders(folders: &[String]) -> Result<Vec<String>, String> {
    folders
        .iter()
        .map(|folder| if grantable(folder) { Ok(folder.clone()) } else { Err(format!("This folder cannot be shared with an app as it is named: {folder:?}")) })
        .collect()
}

/// Checks every path a result names as it stands. One path outside the folders (or not a vault path as written)
/// refuses the whole result: it would mean the web view's gate failed, and a half-filtered answer would hide that.
/// (The web view leaves out, and counts, what this wall would refuse: `mcpNameAccepted`.)
pub fn result_paths_allowed(paths: &[String], folders: &[String]) -> bool {
    paths.iter().all(|p| exact_rel_path(p).is_some_and(|p| inside(p, folders)))
}

/// The file a vault path names, decided on the disk (ADR 0021): resolved through links and junctions and through
/// the vault's stored spellings (ADR 0016: an NFD name on disk is the NFC identity the web view uses, and the base
/// adapters open that very file), it must lie inside the vault and under the real place of one of the client's
/// folders — compared component by component as the file system returned them, never through a case fold (review
/// of R19). A path that does not exist (yet) is judged by the nearest part of it that does, and the rest follows as
/// named: a new note under a link out of the vault or the folders bounces like an existing one. A link that leads
/// nowhere is no "not yet": it would lead out when something is created through it. A segment of unusual shape (a
/// device name, an 8.3 alias, a stream) passes only where its folder's listing holds exactly that name
/// (`contentPathIsReal` in the core) — also for a name that does not exist yet: on Windows a new `aux.md` is the
/// device, and a new `Draft~1` may be another folder's second name.
///
/// `rel` is a path as `safe_rel_path` returned it: the spelling that is used.
pub fn real_inside(root: &std::path::Path, rel: &str, folders: &[String]) -> Inside {
    real_inside_as(root, rel, folders, Shapes::EveryName)
}

/// `real_inside` for a path an ANSWER names. A name of unusual shape that the vault holds no more — the note a
/// confirmed deletion, rename or move took away — passes: nothing is there to reach, and the client and the audit
/// are told what happened (review of R19, minor 3). One that exists in any spelling must be held in exactly this one,
/// as for a request; only "not found" counts as gone.
pub fn real_inside_answer(root: &std::path::Path, rel: &str, folders: &[String]) -> bool {
    real_inside_as(root, rel, folders, Shapes::ExistingNames) == Inside::Yes
}

/// What `real_inside` found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Inside {
    Yes,
    /// Outside the vault or the client's folders, Plainva's own, or not to be judged (an error, a dangling link).
    Outside,
    /// A name of unusual shape the vault does not hold in exactly that spelling.
    Shape,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Shapes {
    /// Every name of unusual shape must be held as written (a request: it may create one).
    EveryName,
    /// Only the names that exist in some spelling (an answer: what is gone reaches nothing).
    ExistingNames,
}

/// The entry of `dir` whose name is `segment` in NFC — the vault's stored spelling of that identity (ADR 0016) — when
/// the name as written does not exist. Exact after NFC: no case fold.
fn stored_spelling(dir: &std::path::Path, segment: &str) -> std::io::Result<Option<std::ffi::OsString>> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_name().to_str().is_some_and(|name| name.nfc().collect::<String>() == segment) {
            return Ok(Some(entry.file_name()));
        }
    }
    Ok(None)
}

/// Whether `dir`'s listing holds exactly `segment` (after NFC).
fn holds(dir: &std::path::Path, segment: &str) -> bool {
    std::fs::read_dir(dir).is_ok_and(|entries| entries.flatten().any(|entry| entry.file_name().to_str().is_some_and(|name| name.nfc().collect::<String>() == segment)))
}

/// Where a path lies, as the disk spells it: the real path of the nearest existing part, with the rest as named.
/// `Err` with the verdict where it cannot be judged.
fn real_place(root: &std::path::Path, segments: &[&str], shapes: Shapes) -> Result<std::path::PathBuf, Inside> {
    let mut existing = root.to_path_buf();
    let mut tail: Vec<&str> = Vec::new();
    for segment in segments {
        if !tail.is_empty() {
            // Below a part that does not exist nothing exists: a shape there is a name to be created.
            if shapes == Shapes::EveryName && unusual_shape(segment) {
                return Err(Inside::Shape);
            }
            tail.push(segment);
            continue;
        }
        let named = existing.join(segment);
        let found = match std::fs::symlink_metadata(&named) {
            Ok(_) => Some(std::ffi::OsString::from(*segment)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => stored_spelling(&existing, segment).map_err(|_| Inside::Outside)?,
            Err(_) => return Err(Inside::Outside),
        };
        match found {
            Some(name) => {
                // It exists in some spelling: one of unusual shape only in exactly this one.
                if unusual_shape(segment) && !holds(&existing, segment) {
                    return Err(Inside::Shape);
                }
                existing.push(name);
            }
            None => {
                if shapes == Shapes::EveryName && unusual_shape(segment) {
                    return Err(Inside::Shape);
                }
                tail.push(segment);
            }
        }
    }
    // The existing part resolved through every link and junction. A link that leads nowhere fails here: no "not yet".
    let mut real = std::fs::canonicalize(&existing).map_err(|_| Inside::Outside)?;
    for segment in tail {
        real.push(segment);
    }
    Ok(real)
}

/// The real place of a granted folder: resolved as a request's path is, or — where it does not exist — under the
/// real vault as named.
fn real_grant(root: &std::path::Path, real_root: &std::path::Path, folder: &str) -> Option<std::path::PathBuf> {
    let folder = folder.trim_matches('/');
    if folder.is_empty() {
        return Some(real_root.to_path_buf());
    }
    let segments: Vec<&str> = folder.split('/').collect();
    let real = real_place(root, &segments, Shapes::ExistingNames).ok()?;
    // A granted folder that is itself a link out of the vault grants nothing outside it.
    real.starts_with(real_root).then_some(real)
}

fn real_inside_as(root: &std::path::Path, rel: &str, folders: &[String], shapes: Shapes) -> Inside {
    let Ok(real_root) = std::fs::canonicalize(root) else {
        return Inside::Outside;
    };
    if content_path_refusal(rel) == Some(Refusal::Internal) {
        return Inside::Outside;
    }
    let segments: Vec<&str> = rel.split('/').filter(|segment| !segment.is_empty()).collect();
    let real = match real_place(root, &segments, shapes) {
        Ok(real) => real,
        Err(verdict) => return verdict,
    };
    let Ok(inner) = real.strip_prefix(&real_root) else {
        return Inside::Outside;
    };
    // Where the path really lies, as the disk spells it: judged as it stands — a real folder ` Notes` is not `Notes`
    // because a trim would make it so — and never one of Plainva's own or a hidden one.
    let real_rel = inner.components().map(|part| part.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/");
    if real_rel.is_empty() {
        // The vault itself: a place only for a client that was given all of it.
        return if folders.iter().any(|folder| folder.trim_matches('/').is_empty()) { Inside::Yes } else { Inside::Outside };
    }
    let as_named: String = real_rel.nfc().collect();
    if safe_rel_path(&real_rel).is_none_or(|checked| checked != as_named) {
        return Inside::Outside;
    }
    // The decision: under the real place of a granted folder, component by component — no case fold, no NFC.
    // The name's candidate check stays as a further limit (it never widens): a granted folder that is a link to
    // another folder of the vault does not open that one by its own name.
    let granted = inside(&as_named, folders) && folders.iter().any(|folder| real_grant(root, &real_root, folder).is_some_and(|grant| real.starts_with(&grant)));
    if granted {
        Inside::Yes
    } else {
        Inside::Outside
    }
}

/// Addresses no answer may carry to a client: local files and the loopback.
pub fn strip_local_urls(text: &str) -> String {
    const MARKERS: [&str; 5] = ["file://", "http://localhost", "http://127.", "https://localhost", "https://127."];
    let mut out = String::with_capacity(text.len());
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let lower = line.to_lowercase();
        if MARKERS.iter().any(|m| lower.contains(m)) {
            out.push_str("[address withheld]");
        } else {
            out.push_str(line);
        }
    }
    out
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A request's path passes the wall at the disk.
    fn real(root: &std::path::Path, rel: &str, folders: &[String]) -> bool {
        real_inside(root, rel, folders) == Inside::Yes
    }

    fn folders(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_path_cases_bounce() {
        for bad in [
            "",
            "../x.md",
            "a/../x.md",
            "./../x",
            "/etc/passwd",
            "C:/Windows/win.ini",
            "C:x.md",
            "\\\\server\\share\\x.md",
            "a\\b.md",
            "a//b.md",
            "a/./b.md",
            "file:///etc/passwd",
            "Private./Salaries.md",
            "Private /Salaries.md",
            ".plainva/state.db",
            ".PLAINVA/state.db",
            ".agent/policy.yml",
            ".git/config",
            ".obsidian/workspace.json",
            ".trash/old.md",
            ".private/diary.md",
            "Notes/.agent/a.md",
            "Projects/.draft.md",
            "x\0.md",
            "a/\u{0007}b.md",
        ] {
            assert_eq!(safe_rel_path(bad), None, "{bad:?} must bounce");
        }
        assert_eq!(safe_rel_path("./Projects/Offer.md").as_deref(), Some("Projects/Offer.md"));
        assert_eq!(safe_rel_path("Projects/v1.2 notes.md").as_deref(), Some("Projects/v1.2 notes.md"));
    }

    #[test]
    fn a_folder_grants_itself_and_below_never_a_prefix_sibling() {
        let granted = folders(&["Projects"]);
        assert!(allowed("Projects/Offer.md", &granted).is_some());
        assert!(allowed("Projects/2026/Plan.md", &granted).is_some());
        assert!(allowed("Projects", &granted).is_some());
        assert!(allowed("ProjectsSecret/x.md", &granted).is_none());
        assert!(allowed("Private/Salaries.md", &granted).is_none());
        assert!(allowed("Notes.md", &granted).is_none());
        assert!(allowed("Notes.md", &folders(&[""])).is_some());
        assert!(allowed(".plainva/x", &folders(&[""])).is_none());
        assert!(allowed("x.md", &[]).is_none(), "deny by default");
    }

    #[test]
    fn unicode_forms_compare_as_one() {
        // "Café" in NFD reaches the same folder as the NFC grant.
        let granted = folders(&["Caf\u{e9}"]);
        assert!(allowed("Cafe\u{301}/x.md", &granted).is_some());
        let other = folders(&["Other"]);
        assert!(allowed("Cafe\u{301}/x.md", &other).is_none());
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn case_does_not_open_another_folder_where_the_file_system_ignores_it() {
        let granted = folders(&["Private"]);
        assert!(allowed("private/x.md", &granted).is_some());
        let projects = folders(&["Projects"]);
        assert!(allowed("PRIVATE/x.md", &projects).is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn case_is_a_different_folder_on_linux() {
        let granted = folders(&["Projects"]);
        assert!(allowed("projects/x.md", &granted).is_none());
    }

    #[test]
    fn one_foreign_path_refuses_the_whole_result() {
        let granted = folders(&["Projects"]);
        assert!(result_paths_allowed(&folders(&["Projects/a.md", "Projects/b.md"]), &granted));
        assert!(!result_paths_allowed(&folders(&["Projects/a.md", "Private/b.md"]), &granted));
        assert!(!result_paths_allowed(&folders(&["Projects/../Private/b.md"]), &granted));
        assert!(result_paths_allowed(&[], &granted));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_that_leads_out_of_the_folders_or_the_vault_bounces() {
        let vault = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(vault.path().join("Projects")).unwrap();
        std::fs::create_dir_all(vault.path().join("Private")).unwrap();
        std::fs::write(vault.path().join("Projects/a.md"), "a").unwrap();
        std::fs::write(vault.path().join("Private/s.md"), "s").unwrap();
        std::fs::write(outside.path().join("key"), "k").unwrap();
        std::os::unix::fs::symlink(outside.path().join("key"), vault.path().join("Projects/escape.md")).unwrap();
        std::os::unix::fs::symlink(vault.path().join("Private"), vault.path().join("Projects/private")).unwrap();
        let granted = folders(&["Projects"]);
        assert!(real(vault.path(), "Projects/a.md", &granted));
        assert!(real(vault.path(), "Projects/missing.md", &granted), "not found is the web view's answer");
        assert!(!real(vault.path(), "Projects/escape.md", &granted), "out of the vault");
        assert!(!real(vault.path(), "Projects/private/s.md", &granted), "into a folder not granted");
    }

    /// A vault for the shape tests: a granted folder, Plainva's own folder beside it.
    fn shaped_vault() -> tempfile::TempDir {
        let vault = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(vault.path().join("Projects")).unwrap();
        std::fs::create_dir_all(vault.path().join(".plainva/sync")).unwrap();
        std::fs::write(vault.path().join(".plainva/sync/keyfile.json"), "k").unwrap();
        vault
    }

    #[test]
    fn internal_folders_without_a_leading_dot_bounce_as_in_the_core() {
        for bad in ["node_modules/x.md", "Notes/__pycache__/x.md", "Thumbs.db", "Notes/desktop.ini", "$RECYCLE.BIN/x.md", "System Volume Information/x.md", "Icon\r/x.md"] {
            assert_eq!(safe_rel_path(bad), None, "{bad:?} must bounce");
        }
        for good in ["node_modules_archive/x.md", "Thumbs.db.md", "Build/x.md", "plainva/x.md"] {
            assert!(safe_rel_path(good).is_some(), "{good:?} stays the user's");
        }
    }

    #[test]
    fn a_name_of_an_unusual_shape_passes_only_where_the_vault_holds_that_spelling() {
        let vault = shaped_vault();
        let all = folders(&[""]);
        // Not held by the vault: an 8.3 alias of Plainva's own folder, a device name.
        for bad in ["PLAINV~1/sync/keyfile.json", "PLAINV~1/sync/new.md", "Projects/aux.md", "Projects/NUL", "Projects/com1.txt", "CON/x.md"] {
            assert!(!real(vault.path(), bad, &all), "{bad:?} must bounce");
        }
    }

    #[test]
    fn a_missing_note_under_a_link_out_of_the_folders_bounces() {
        let vault = shaped_vault();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(vault.path().join("Private")).unwrap();
        // Joined part by part: `mklink` reads a forward slash as the start of an option.
        link_dir(outside.path(), &vault.path().join("Projects").join("out"));
        link_dir(&vault.path().join("Private"), &vault.path().join("Projects").join("private"));
        let granted = folders(&["Projects"]);
        assert!(!real(vault.path(), "Projects/out/new.md", &granted), "a new note out of the vault");
        assert!(!real(vault.path(), "Projects/out/deeper/new.md", &granted), "deeper still");
        assert!(!real(vault.path(), "Projects/private/new.md", &granted), "a new note in a folder not granted");
        assert!(real(vault.path(), "Projects/new/deeper.md", &granted), "a new folder in a granted one");
    }

    /// A folder link as the platform makes one without rights: a symlink on Unix, a junction on Windows.
    fn link_dir(target: &std::path::Path, link: &std::path::Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        {
            let status = std::process::Command::new("cmd").arg("/C").arg("mklink").arg("/J").arg(link).arg(target).output().unwrap();
            assert!(status.status.success(), "{}", String::from_utf8_lossy(&status.stderr));
        }
    }

    /// The short name Windows keeps for a long one, where the volume makes them.
    #[cfg(windows)]
    pub(crate) fn short_name(path: &std::path::Path) -> Option<String> {
        use std::os::windows::ffi::{OsStrExt, OsStringExt};
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut buffer = vec![0u16; 1024];
        let n = unsafe { windows_sys::Win32::Storage::FileSystem::GetShortPathNameW(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
        if n == 0 || n > buffer.len() {
            return None;
        }
        let short = std::path::PathBuf::from(std::ffi::OsString::from_wide(&buffer[..n]));
        let name = short.file_name()?.to_string_lossy().to_string();
        (name != path.file_name()?.to_string_lossy()).then_some(name)
    }

    #[cfg(windows)]
    #[test]
    fn the_real_short_name_of_plainvas_folder_bounces_on_windows() {
        let vault = shaped_vault();
        let all = folders(&[""]);
        // Where the volume keeps 8.3 names (the system drive does by default), the real one; the shape alone otherwise.
        let alias = short_name(&vault.path().join(".plainva")).unwrap_or_else(|| "PLAINV~1".to_string());
        for rel in [format!("{alias}/sync/keyfile.json"), format!("{alias}/sync/new.md"), format!("{alias}/new.md")] {
            assert!(safe_rel_path(&rel).is_some(), "the shape alone passes the first look: {rel}");
            assert!(!real(vault.path(), &rel, &all), "{rel} must bounce");
        }
    }

    /// The verdicts of the core's `contentPathRefusal`, from the one list both sides read
    /// (`packages/core/src/vault/contentPathRefusal.fixture.json`; the core's test reads it as well).
    #[test]
    fn the_verdicts_are_the_cores_on_the_shared_list() {
        let fixture: std::collections::BTreeMap<String, serde_json::Value> =
            serde_json::from_str(include_str!("../../../../../packages/core/src/vault/contentPathRefusal.fixture.json")).unwrap();
        let verdicts = [("internal", Some(Refusal::Internal)), ("device", Some(Refusal::Device)), ("stream", Some(Refusal::Stream)), ("alias", Some(Refusal::Alias)), ("none", None)];
        let mut keys: Vec<&str> = fixture.keys().map(String::as_str).filter(|key| *key != "about").collect();
        keys.sort_unstable();
        let mut named: Vec<&str> = verdicts.iter().map(|(key, _)| *key).collect();
        named.sort_unstable();
        assert_eq!(keys, named, "the list names no other verdict");
        for (key, verdict) in verdicts {
            let paths = fixture[key].as_array().unwrap();
            assert!(!paths.is_empty(), "the list names {key} paths");
            for path in paths {
                let path = path.as_str().unwrap();
                assert_eq!(content_path_refusal(path), verdict, "{path:?}");
            }
        }
    }

    /// The one spelling: what the wall checks is what it forwards, on the list the web view's test reads too
    /// (`packages/core/src/vault/mcpPathSpelling.fixture.json`) — every character the engine's `trim` removes, at
    /// either end, NFD input, `./`, and Plainva's own folders behind white space.
    #[test]
    fn the_wall_checks_the_spelling_it_forwards_on_the_shared_list() {
        #[derive(serde::Deserialize)]
        struct Case {
            input: String,
            checked: Option<String>,
            why: String,
        }
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Fixture {
            trim_set: Vec<u32>,
            cases: Vec<Case>,
        }
        let fixture: Fixture = serde_json::from_str(include_str!("../../../../../packages/core/src/vault/mcpPathSpelling.fixture.json")).unwrap();
        // The engine's trim set, read off the engine by the generator and by the ui test: exactly this rule's.
        let ours: Vec<u32> = (0..=0x10FFFFu32).filter_map(char::from_u32).filter(|c| js_trims(*c)).map(|c| c as u32).collect();
        assert_eq!(ours, fixture.trim_set);
        assert!(fixture.cases.len() > 50);
        for case in &fixture.cases {
            assert_eq!(safe_rel_path(&case.input), case.checked, "{}: {:?}", case.why, case.input);
            // Checking the checked spelling again changes nothing: the wall is one step, not a chain.
            if let Some(checked) = &case.checked {
                assert_eq!(safe_rel_path(checked).as_deref(), Some(checked.as_str()), "{}", case.why);
            }
        }
    }

    /// The review's sequence: `Projects/private` is a link to `Private`, which the client was not given. With white
    /// space the web view trims, the old wall's spelling did not exist, it walked up to `Projects`, and the web view
    /// used the link.
    #[test]
    fn a_link_named_with_white_space_the_web_view_trims_is_judged_as_the_link() {
        let vault = shaped_vault();
        std::fs::create_dir_all(vault.path().join("Private")).unwrap();
        link_dir(&vault.path().join("Private"), &vault.path().join("Projects").join("private"));
        let granted = folders(&["Projects"]);
        for raw in ["Projects/private\u{a0}", "Projects/private\u{3000}", "\u{feff}Projects/private", "Projects/private/new.md\u{2028}", " Projects/private"] {
            let checked = allowed(raw, &granted).expect("inside the folders by name");
            assert_eq!(checked.trim(), checked, "{raw:?}");
            assert!(!real(vault.path(), &checked, &granted), "{raw:?} names the link");
        }
    }

    /// An NFD name is checked, and used, as NFC: a link the disk spells in NFD is not followed by a spelling nobody
    /// checked.
    #[test]
    fn a_name_in_nfd_is_checked_and_used_as_nfc() {
        let vault = shaped_vault();
        std::fs::create_dir_all(vault.path().join("Private")).unwrap();
        link_dir(&vault.path().join("Private"), &vault.path().join("Projects").join("Cafe\u{301}"));
        let granted = folders(&["Projects"]);
        let checked = allowed("Projects/Cafe\u{301}/new.md", &granted).unwrap();
        assert_eq!(checked, "Projects/Caf\u{e9}/new.md");
        // The base adapters open the stored spelling of an NFC identity (ADR 0016), so the wall resolves it too: the
        // NFD link is the place the web view would reach, and it leads into `Private` (review of R19, minor 2).
        assert!(!real(vault.path(), &checked, &granted));
        // An NFD folder that is no link is the granted place it looks like, by its stored spelling.
        std::fs::create_dir_all(vault.path().join("Projects").join("Nai\u{308}ve")).unwrap();
        std::fs::write(vault.path().join("Projects").join("Nai\u{308}ve").join("a.md"), "a").unwrap();
        let nfc = allowed("Projects/Nai\u{308}ve/a.md", &granted).unwrap();
        assert_eq!(nfc, "Projects/Na\u{ef}ve/a.md");
        assert!(real(vault.path(), &nfc, &granted));
    }

    /// The real place of a path is judged as the disk spells it: a folder ` Notes` is not `Notes` because a trim
    /// would make it so.
    #[cfg(unix)]
    #[test]
    fn a_real_folder_whose_name_a_trim_would_change_is_no_granted_one() {
        let vault = shaped_vault();
        std::fs::create_dir_all(vault.path().join(" Notes")).unwrap();
        std::fs::create_dir_all(vault.path().join("Notes")).unwrap();
        link_dir(&vault.path().join(" Notes"), &vault.path().join("Notes").join("side"));
        let granted = folders(&["Notes"]);
        assert!(real(vault.path(), "Notes/new.md", &granted));
        assert!(!real(vault.path(), "Notes/side/new.md", &granted), "the link leads into ` Notes`");
    }

    /// After a confirmed deletion, rename or move, the answer names a note that is gone: a name of unusual shape the
    /// vault holds no more reaches nothing, and the answer goes out. One that exists in another spelling does not.
    #[test]
    fn an_answer_may_name_a_note_of_unusual_shape_that_is_gone() {
        let vault = shaped_vault();
        let all = folders(&[""]);
        // A device name is never a gone file on Windows (it is the device there): only elsewhere.
        let mut gone_names = vec!["Projects/a~1.md", "Projects/IMG~1.JPG", "Projects/Draft~1/x.md"];
        if cfg!(not(windows)) {
            gone_names.push("Projects/aux.md");
        }
        for gone in gone_names {
            assert!(real_inside_answer(vault.path(), gone, &all), "{gone}");
            assert_eq!(real_inside(vault.path(), gone, &all), Inside::Shape, "a request for {gone} is refused for its shape");
        }
        assert!(!real_inside_answer(vault.path(), ".plainva/sync/keyfile.json", &all));
        #[cfg(unix)]
        {
            // The vault holds exactly that name: an answer and a request both pass.
            std::fs::write(vault.path().join("Projects/IMG~1.JPG"), "jpg").unwrap();
            assert!(real_inside_answer(vault.path(), "Projects/IMG~1.JPG", &all));
            assert!(real(vault.path(), "Projects/IMG~1.JPG", &all));
        }
    }

    #[cfg(windows)]
    #[test]
    fn an_answer_that_names_plainvas_folder_by_its_short_name_is_withheld_on_windows() {
        let vault = shaped_vault();
        let all = folders(&[""]);
        match short_name(&vault.path().join(".plainva")) {
            Some(alias) => {
                assert!(!real_inside_answer(vault.path(), &format!("{alias}/sync/keyfile.json"), &all));
                assert!(!real_inside_answer(vault.path(), &format!("{alias}/gone.md"), &all), "the folder exists by that name");
            }
            None => eprintln!("skipped: the volume of the temporary folder keeps no short names"),
        }
    }

    /// Makes `name` beside `existing` in `dir`, or says that this file system takes the two for one name.
    fn beside(dir: &std::path::Path, existing: &str, name: &str) -> bool {
        std::fs::create_dir_all(dir.join(existing)).unwrap();
        match std::fs::create_dir(dir.join(name)) {
            Ok(()) => true,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                eprintln!("skipped: this file system takes {existing:?} and {name:?} for one name");
                false
            }
            Err(error) => panic!("{error}"),
        }
    }

    /// Folding finds a candidate and never decides (review of R19, blocker 2). Where the file system keeps apart what
    /// `to_lowercase` folds together — a case-sensitive directory, `ẞ` and `ß`, the Kelvin sign and `K` — the folded
    /// candidate is another real folder, and the wall refuses it. The candidate check is run with the fold of the
    /// builds that fold (Windows, macOS) on whatever runner this is.
    #[test]
    fn a_folder_the_case_fold_takes_for_a_granted_one_is_refused_on_the_disk() {
        let vault = shaped_vault();
        for (granted_name, other) in [("Projects", "projects"), ("Stra\u{df}e", "STRA\u{1e9e}E"), ("Kelvin", "\u{212a}ELVIN")] {
            if !beside(vault.path(), granted_name, other) {
                continue;
            }
            std::fs::write(vault.path().join(other).join("secret.md"), "s").unwrap();
            std::fs::write(vault.path().join(granted_name).join("open.md"), "o").unwrap();
            let granted = folders(&[granted_name]);
            let path = format!("{other}/secret.md");
            assert!(inside_as(&path, &granted, true), "{other}: the folding builds take it for a candidate");
            assert_eq!(real_inside(vault.path(), &path, &granted), Inside::Outside, "{other}");
            assert_eq!(real_inside(vault.path(), &format!("{other}/new.md"), &granted), Inside::Outside, "{other}: nor a new note there");
            assert!(!real_inside_answer(vault.path(), &path, &granted), "{other}: nor in an answer");
            assert!(real(vault.path(), &format!("{granted_name}/open.md"), &granted), "{granted_name}");
        }
    }

    /// A link that leads nowhere is no "not yet": a note created through it would land where it points (minor 3).
    #[test]
    fn a_link_that_leads_nowhere_is_no_place_to_create_in() {
        let vault = shaped_vault();
        let gone = tempfile::tempdir().unwrap();
        let target = gone.path().join("missing");
        std::fs::create_dir_all(&target).unwrap();
        link_dir(&target, &vault.path().join("Projects").join("escape"));
        std::fs::remove_dir(&target).unwrap();
        let granted = folders(&["Projects"]);
        assert!(!real(vault.path(), "Projects/escape/new.md", &granted));
        assert!(!real(vault.path(), "Projects/escape", &granted));
        assert!(!real_inside_answer(vault.path(), "Projects/escape/new.md", &granted));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(gone.path().join("nowhere.md"), vault.path().join("Projects/dangling.md")).unwrap();
            assert!(!real(vault.path(), "Projects/dangling.md", &granted));
        }
    }

    /// Only "not found" makes a name of unusual shape count as gone in an answer (minor 4): a folder that cannot be
    /// listed is no proof that nothing is there.
    #[cfg(unix)]
    #[test]
    fn a_name_that_cannot_be_looked_at_is_not_gone() {
        use std::os::unix::fs::PermissionsExt;
        if unsafe { libc::geteuid() } == 0 {
            eprintln!("skipped: running as root, every folder can be read");
            return;
        }
        let vault = shaped_vault();
        let locked = vault.path().join("Projects/locked");
        std::fs::create_dir_all(&locked).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        let all = folders(&[""]);
        let verdict = real_inside_answer(vault.path(), "Projects/locked/a~1.md", &all);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(!verdict);
    }

    /// A grant is the user's word about one folder on disk: kept as it stands, or refused — never trimmed into
    /// another folder, never dropped (review of R19, blocker 1).
    #[test]
    fn a_grant_is_kept_as_it_stands_or_refused() {
        for bad in [" Notes", "Notes ", "Notes\u{a0}", "\u{feff}Notes", "Cafe\u{301}", "./Notes", "Notes/", "Notes//a", ".plainva", "node_modules", "a:b", "../x"] {
            assert!(!grantable(bad), "{bad:?}");
            assert!(grant_folders(&[String::from("Projects"), bad.to_string()]).is_err(), "{bad:?}");
        }
        for good in ["", "Notes", "Projects/2026", "Caf\u{e9}", "v1.2 notes"] {
            assert!(grantable(good), "{good:?}");
        }
        assert_eq!(grant_folders(&[String::new(), "Notes".into()]).unwrap(), vec![String::new(), "Notes".to_string()]);
    }

    /// A path an answer names is judged as it stands: the vault's own spelling, which a trim cannot make another.
    #[test]
    fn a_result_path_is_judged_as_it_stands() {
        let granted = folders(&["Notes"]);
        assert!(result_paths_allowed(&["Notes/a.md".to_string()], &granted));
        for bad in [" Notes/a.md", "Notes/a.md ", "Notes/Cafe\u{301}.md", "./Notes/a.md"] {
            assert!(!result_paths_allowed(&[bad.to_string()], &granted), "{bad:?}");
        }
    }

    /// One limit on both sides: UTF-16 units, as the tools' schema counts (`max(1024)`).
    #[test]
    fn the_length_limit_counts_as_the_schema_counts() {
        assert!(safe_rel_path(&"\u{4e2d}".repeat(400)).is_some(), "400 CJK characters are 1200 bytes and 400 units");
        assert!(safe_rel_path(&"\u{4e2d}".repeat(1024)).is_some());
        assert!(safe_rel_path(&"\u{4e2d}".repeat(1025)).is_none());
        assert!(safe_rel_path(&"\u{1f4dd}".repeat(512)).is_some(), "512 astral characters are 1024 units");
        assert!(safe_rel_path(&"\u{1f4dd}".repeat(513)).is_none());
    }

    /// A path the core refuses as internal is never one a client may name here; one of an unusual shape passes the
    /// first look and is decided at the disk (`real_inside`).
    #[test]
    fn the_first_look_refuses_what_the_core_calls_internal() {
        let fixture: std::collections::BTreeMap<String, serde_json::Value> =
            serde_json::from_str(include_str!("../../../../../packages/core/src/vault/contentPathRefusal.fixture.json")).unwrap();
        for path in fixture["internal"].as_array().unwrap() {
            let path = path.as_str().unwrap();
            assert_eq!(safe_rel_path(path), None, "{path:?}");
        }
    }

    #[test]
    fn local_addresses_do_not_leave_in_an_answer() {
        let text = "see file:///C:/secret.txt\nkeep this\nand http://127.0.0.1:8080/admin";
        assert_eq!(strip_local_urls(text), "[address withheld]\nkeep this\n[address withheld]");
    }
}
