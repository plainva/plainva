//! The folder boundary of the MCP server (plan KI-Harness §17.3, the path
//! cases of §13.4). Every path a client names and every path a result names is
//! checked here, natively: a request outside the client's folders never reaches
//! the web view, and an answer that names a note outside them never reaches the
//! client. The web view checks the same rules again; this is the second wall.

use unicode_normalization::UnicodeNormalization;

/// A vault-relative path as a client may name it, in the one spelling this
/// module compares; `None` when it could leave the vault, reach Plainva's own
/// folders, or mean something other than it says on some file system.
pub fn safe_rel_path(raw: &str) -> Option<String> {
    // Not trimmed: the argument goes on to the web view as the client wrote it, so what is checked here is that
    // very spelling. A trimmed copy let `Icon\r` (the internal folder icon file of macOS) and `a.md ` through as
    // `Icon` and `a.md` (R19 of the stability plan); white space at either end now stays part of the name, and a
    // control character or a trailing space or dot refuses it below.
    let p = raw.strip_prefix("./").unwrap_or(raw);
    if p.is_empty() || p.len() > 1024 {
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
    Some(parts.join("/").nfc().collect())
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
    let base = segment.split('.').next().unwrap_or("").trim_end_matches(' ').to_lowercase();
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
/// of extension.
fn is_short_name_alias(segment: &str) -> bool {
    let (name, extension) = match segment.split_once('.') {
        Some((name, extension)) => (name, Some(extension)),
        None => (segment, None),
    };
    if extension.is_some_and(|extension| extension.contains('.') || extension.chars().count() > 3) {
        return false;
    }
    let Some((stem, number)) = name.split_once('~') else {
        return false;
    };
    let stem_len = stem.chars().count();
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

/// The spelling two paths are compared in: NFC always (macOS may hand either
/// form), and case-folded where the file system ignores case (Windows, macOS).
pub fn fold(path: &str) -> String {
    let nfc: String = path.nfc().collect();
    if cfg!(target_os = "linux") {
        nfc
    } else {
        nfc.to_lowercase()
    }
}

/// True when `path` (already through `safe_rel_path`) lies inside one of the
/// granted folders. "" grants the whole vault; a folder grants itself and
/// everything below it, never a sibling that merely shares a prefix.
pub fn inside(path: &str, folders: &[String]) -> bool {
    let p = fold(path);
    folders.iter().any(|folder| {
        let f = fold(folder.trim_matches('/'));
        f.is_empty() || p == f || p.starts_with(&format!("{f}/"))
    })
}

/// A path argument checked in one step: safe, and inside the client's folders.
pub fn allowed(raw: &str, folders: &[String]) -> Option<String> {
    safe_rel_path(raw).filter(|p| inside(p, folders))
}

/// Checks every path a result names. One path outside the folders (or unsafe)
/// refuses the whole result: it would mean the web view's gate failed, and a
/// half-filtered answer would hide that.
pub fn result_paths_allowed(paths: &[String], folders: &[String]) -> bool {
    paths.iter().all(|p| allowed(p, folders).is_some())
}

/// The file a vault path names, with symlinks and junctions resolved (ADR
/// 0021): it must still lie inside the vault and inside the client's folders.
/// A path that does not exist (yet) is judged by the nearest part of it that
/// does: a new note under a link that leads out of the vault or the folders
/// bounces like an existing one, and a missing one inside them passes — the
/// web view then answers "not found". A segment of an unusual shape (a
/// device name, an 8.3 alias, a stream) passes only where the listing of its
/// folder holds exactly that name: the vault's own spelling, never another one
/// the file system resolves (`contentPathIsReal` in the core).
pub fn real_inside(root: &std::path::Path, rel: &str, folders: &[String]) -> bool {
    let Ok(real_root) = std::fs::canonicalize(root) else {
        return false;
    };
    let segments: Vec<&str> = rel.split('/').filter(|segment| !segment.is_empty()).collect();
    if content_path_refusal(rel) == Some(Refusal::Internal) {
        return false;
    }
    for (i, segment) in segments.iter().enumerate() {
        if !unusual_shape(segment) {
            continue;
        }
        let folder = segments[..i].iter().fold(root.to_path_buf(), |path, part| path.join(part));
        let Ok(entries) = std::fs::read_dir(&folder) else {
            return false;
        };
        let wanted: String = segment.nfc().collect();
        let held = entries.flatten().any(|entry| entry.file_name().to_str().is_some_and(|name| name.nfc().collect::<String>() == wanted));
        if !held {
            return false;
        }
    }
    // The nearest part of the path that exists, resolved; what does not exist yet follows it as it was named.
    let mut existing = segments.len();
    let real = loop {
        let probe = segments[..existing].iter().fold(root.to_path_buf(), |path, part| path.join(part));
        match std::fs::canonicalize(&probe) {
            Ok(real) => break real,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && existing > 0 => existing -= 1,
            Err(_) => return false,
        }
    };
    let Ok(inner) = real.strip_prefix(&real_root) else {
        return false;
    };
    let mut parts: Vec<String> = inner.components().map(|part| part.as_os_str().to_string_lossy().to_string()).collect();
    parts.extend(segments[existing..].iter().map(|segment| segment.to_string()));
    if parts.is_empty() {
        // The vault itself: a place only for a client that was given all of it.
        return folders.iter().any(|folder| folder.trim_matches('/').is_empty());
    }
    allowed(&parts.join("/"), folders).is_some()
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
mod tests {
    use super::*;

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
        assert!(real_inside(vault.path(), "Projects/a.md", &granted));
        assert!(real_inside(vault.path(), "Projects/missing.md", &granted), "not found is the web view's answer");
        assert!(!real_inside(vault.path(), "Projects/escape.md", &granted), "out of the vault");
        assert!(!real_inside(vault.path(), "Projects/private/s.md", &granted), "into a folder not granted");
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
        for bad in ["node_modules/x.md", "Notes/__pycache__/x.md", "Thumbs.db", "Notes/desktop.ini", "$RECYCLE.BIN/x.md", "System Volume Information/x.md", "Icon\r"] {
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
            assert!(!real_inside(vault.path(), bad, &all), "{bad:?} must bounce");
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
        assert!(!real_inside(vault.path(), "Projects/out/new.md", &granted), "a new note out of the vault");
        assert!(!real_inside(vault.path(), "Projects/out/deeper/new.md", &granted), "deeper still");
        assert!(!real_inside(vault.path(), "Projects/private/new.md", &granted), "a new note in a folder not granted");
        assert!(real_inside(vault.path(), "Projects/new/deeper.md", &granted), "a new folder in a granted one");
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
    fn short_name(path: &std::path::Path) -> Option<String> {
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
            assert!(!real_inside(vault.path(), &rel, &all), "{rel} must bounce");
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
