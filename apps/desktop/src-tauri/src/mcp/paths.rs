//! The folder boundary of the MCP server (plan KI-Harness §17.3, the path
//! cases of §13.4). Every path a client names and every path a result names is
//! checked here, natively: a request outside the client's folders never reaches
//! the web view, and an answer that names a note outside them never reaches the
//! client. The web view checks the same rules again; this is the second wall.

use unicode_normalization::UnicodeNormalization;

/// Plainva's own state and the policy files: never an argument, never a result (ADR 0021).
const HIDDEN_ROOTS: [&str; 5] = [".plainva", ".agent", ".git", ".obsidian", ".trash"];

/// A vault-relative path as a client may name it, in the one spelling this
/// module compares; `None` when it could leave the vault, reach Plainva's own
/// folders, or mean something other than it says on some file system.
pub fn safe_rel_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let p = trimmed.strip_prefix("./").unwrap_or(trimmed);
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
    // Case-blind on every system: on Linux `.PLAINVA` is another folder, but it
    // syncs onto `.plainva` the moment the vault reaches a Windows or Mac device.
    if HIDDEN_ROOTS.contains(&fold(parts[0]).to_lowercase().as_str()) {
        return None;
    }
    Some(parts.join("/").nfc().collect())
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
/// A path that does not exist passes — the web view then answers "not found".
pub fn real_inside(root: &std::path::Path, rel: &str, folders: &[String]) -> bool {
    let Ok(real_root) = std::fs::canonicalize(root) else {
        return false;
    };
    let real = match std::fs::canonicalize(root.join(rel)) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return true,
        Err(_) => return false,
    };
    let Ok(inner) = real.strip_prefix(&real_root) else {
        return false;
    };
    let inner = inner.to_string_lossy().replace('\\', "/");
    allowed(&inner, folders).is_some()
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

    #[test]
    fn local_addresses_do_not_leave_in_an_answer() {
        let text = "see file:///C:/secret.txt\nkeep this\nand http://127.0.0.1:8080/admin";
        assert_eq!(strip_local_urls(text), "[address withheld]\nkeep this\n[address withheld]");
    }
}
