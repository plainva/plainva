//! A sandbox for a foreign program, where this computer has one.
//!
//! A program that is an MCP server gets what it needs through the arguments of
//! a call. It has no business reading the user's vaults, keys, browser
//! profiles or Plainva's own data — and a hostile one would look exactly
//! there. So where the system offers a way to start a program without those
//! folders, Plainva uses it: `sandbox-exec` on macOS, `bwrap` on Linux. The
//! rest of the system stays as it is, because a program fetched by `npx` needs
//! its own files, a cache and the network to work at all. Windows offers
//! nothing comparable for an arbitrary program; there the approval says so.
//!
//! Plainva only says "in a sandbox" where a self-test on THIS computer showed
//! two things with the same wrapper a server gets: a program starts, and it
//! cannot read a file in a closed folder. A sandbox that is installed but does
//! not hold is reported as none.
//!
//! Everything here compiles on every platform (`cfg!`, not `#[cfg]`), so the
//! profile and the argument list are tested wherever the tests run.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

use super::McpClientState;
use crate::ai_egress::only_main;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SandboxKind {
    None,
    /// macOS: `sandbox-exec` with a profile that closes folders.
    Seatbelt,
    /// Linux: `bwrap`, which puts an empty folder over each closed one.
    Bwrap,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxInfo {
    pub(crate) kind: SandboxKind,
    /// The self-test passed on this computer.
    pub(crate) works: bool,
}

const SEATBELT: &str = "/usr/bin/sandbox-exec";

pub(crate) fn platform_kind() -> SandboxKind {
    if cfg!(target_os = "macos") {
        SandboxKind::Seatbelt
    } else if cfg!(target_os = "linux") {
        SandboxKind::Bwrap
    } else {
        SandboxKind::None
    }
}

/// What a foreign program does not get to see.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Denied {
    pub(crate) folders: Vec<PathBuf>,
    pub(crate) files: Vec<PathBuf>,
}

/// Where credentials and private data live under a home folder, on the systems that have a sandbox.
const HOME_FOLDERS: [&str; 26] = [
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    ".docker",
    ".password-store",
    ".config/gcloud",
    ".config/gh",
    ".config/op",
    ".config/google-chrome",
    ".config/chromium",
    ".config/BraveSoftware",
    ".config/microsoft-edge",
    ".local/share/keyrings",
    ".mozilla",
    ".thunderbird",
    "Library/Keychains",
    "Library/Cookies",
    "Library/Mail",
    "Library/Messages",
    "Library/Safari",
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/Firefox",
    "Library/Application Support/BraveSoftware",
    "Library/Application Support/Microsoft Edge",
];
const HOME_FILES: [&str; 3] = [".netrc", ".git-credentials", ".pgpass"];

/// The closed folders of one start: the usual places of credentials, Plainva's
/// own data (the registry of servers lives there), and every vault that is open.
pub(crate) fn denied(home: Option<&Path>, app_data: Option<&Path>, vaults: &[PathBuf]) -> Denied {
    let mut out = Denied::default();
    if let Some(home) = home.filter(|home| home.is_absolute()) {
        out.folders.extend(HOME_FOLDERS.iter().map(|folder| home.join(folder)));
        out.files.extend(HOME_FILES.iter().map(|file| home.join(file)));
    }
    out.folders.extend(app_data.filter(|folder| folder.is_absolute()).map(Path::to_path_buf));
    out.folders.extend(vaults.iter().filter(|vault| vault.is_absolute()).cloned());
    out
}

/// A path as the sandbox compares it: the real one where it exists (`/tmp` is `/private/tmp` on macOS).
fn real(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// A path inside a profile string: a backslash and a quote cannot end the string.
fn profile_string(path: &Path) -> Option<String> {
    let text = path.to_str()?;
    if text.chars().any(char::is_control) {
        return None;
    }
    Some(text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The profile for `sandbox-exec`: everything as usual, the closed folders and files not at all.
pub(crate) fn seatbelt_profile(denied: &Denied) -> String {
    let mut lines = vec!["(version 1)".to_string(), "(allow default)".to_string()];
    for folder in &denied.folders {
        if let Some(text) = profile_string(&real(folder)) {
            lines.push(format!("(deny file-read* file-write* (subpath \"{text}\"))"));
        }
    }
    for file in &denied.files {
        if let Some(text) = profile_string(&real(file)) {
            lines.push(format!("(deny file-read* file-write* (literal \"{text}\"))"));
        }
    }
    lines.join("\n")
}

/// The arguments for `bwrap`: the system as it is, an empty folder over each
/// closed one and nothing in place of each closed file. Only what exists is
/// named — `bwrap` would otherwise create it on the real file system.
pub(crate) fn bwrap_args(denied: &Denied) -> Vec<OsString> {
    let mut args: Vec<OsString> = ["--dev-bind", "/", "/", "--die-with-parent"].iter().map(OsString::from).collect();
    for folder in denied.folders.iter().filter(|folder| folder.is_dir()) {
        args.push("--tmpfs".into());
        args.push(real(folder).into_os_string());
    }
    for file in denied.files.iter().filter(|file| file.is_file()) {
        args.push("--ro-bind".into());
        args.push("/dev/null".into());
        args.push(real(file).into_os_string());
    }
    args.push("--".into());
    args
}

/// The program and arguments that are really started for a sandboxed server.
pub(crate) fn wrap(kind: SandboxKind, program: &Path, args: &[String], denied: &Denied) -> (PathBuf, Vec<OsString>) {
    let own = std::iter::once(program.as_os_str().to_os_string()).chain(args.iter().map(OsString::from));
    match kind {
        SandboxKind::Seatbelt => (PathBuf::from(SEATBELT), [OsString::from("-p"), OsString::from(seatbelt_profile(denied))].into_iter().chain(own).collect()),
        SandboxKind::Bwrap => (PathBuf::from("bwrap"), bwrap_args(denied).into_iter().chain(own).collect()),
        SandboxKind::None => (program.to_path_buf(), args.iter().map(OsString::from).collect()),
    }
}

/// Runs a program to its end, within a time limit; its output if it ended well.
fn run(program: &Path, args: &[OsString]) -> Option<Vec<u8>> {
    let mut child = Command::new(program).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let until = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = Vec::new();
                if let Some(mut stdout) = child.stdout.take() {
                    let _ = std::io::Read::read_to_end(&mut stdout, &mut out);
                }
                return status.success().then_some(out);
            }
            Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// The self-test: with the wrapper a server gets, `cat` reads a file in an
/// open folder and fails on one in a closed folder. Both, or the sandbox does not count.
pub(crate) fn self_test(kind: SandboxKind) -> bool {
    if kind == SandboxKind::None {
        return false;
    }
    let Ok(root) = tempfile::tempdir() else {
        return false;
    };
    let (open, closed) = (root.path().join("open"), root.path().join("closed"));
    if std::fs::create_dir_all(&open).is_err() || std::fs::create_dir_all(&closed).is_err() {
        return false;
    }
    let (seen, hidden) = (open.join("canary"), closed.join("canary"));
    if std::fs::write(&seen, b"open").is_err() || std::fs::write(&hidden, b"closed").is_err() {
        return false;
    }
    let denied = Denied { folders: vec![closed], files: Vec::new() };
    let cat = Path::new("/bin/cat");
    let read = |file: &Path| {
        let (program, args) = wrap(kind, cat, &[file.to_string_lossy().into_owned()], &denied);
        run(&program, &args)
    };
    read(&seen).as_deref() == Some(b"open".as_slice()) && read(&hidden).is_none()
}

/// What this computer offers, found out once per run of the app.
pub(crate) async fn probe(state: &McpClientState) -> SandboxInfo {
    if let Some(known) = state.sandbox.lock().ok().and_then(|known| *known) {
        return known;
    }
    let kind = platform_kind();
    let works = tauri::async_runtime::spawn_blocking(move || self_test(kind)).await.unwrap_or(false);
    let info = SandboxInfo { kind: if works { kind } else { SandboxKind::None }, works };
    if let Ok(mut known) = state.sandbox.lock() {
        *known = Some(info);
    }
    info
}

#[tauri::command]
pub async fn mcp_client_sandbox(window: tauri::Window, state: State<'_, McpClientState>) -> Result<SandboxInfo, String> {
    only_main(&window)?;
    Ok(probe(&state).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(text: &str) -> PathBuf {
        PathBuf::from(text)
    }

    #[test]
    fn the_closed_folders_are_the_places_of_credentials_plainvas_data_and_the_vaults() {
        let home = if cfg!(windows) { folder("C:\\Users\\me") } else { folder("/home/me") };
        let data = home.join("data");
        let vault = home.join("Notes");
        let list = denied(Some(&home), Some(&data), &[vault.clone(), folder("relative/vault")]);
        for expected in [home.join(".ssh"), home.join(".aws"), home.join("Library/Keychains"), data.clone(), vault.clone()] {
            assert!(list.folders.contains(&expected), "{expected:?}");
        }
        assert!(list.files.contains(&home.join(".netrc")));
        assert!(!list.folders.contains(&folder("relative/vault")));
        // Without a home folder there is still Plainva's data and the vaults.
        let bare = denied(None, Some(&data), std::slice::from_ref(&vault));
        assert_eq!(bare.folders, vec![data, vault]);
        assert!(bare.files.is_empty());
        assert_eq!(denied(Some(Path::new("relative")), None, &[]), Denied::default());
    }

    #[test]
    fn the_profile_closes_each_folder_and_cannot_be_broken_out_of_by_a_name() {
        let profile = seatbelt_profile(&Denied { folders: vec![folder("/nonexistent/va\"ult\\x"), folder("/nonexistent/plain")], files: vec![folder("/nonexistent/.netrc")] });
        let lines: Vec<&str> = profile.lines().collect();
        assert_eq!(lines[0], "(version 1)");
        assert_eq!(lines[1], "(allow default)");
        assert_eq!(lines[2], "(deny file-read* file-write* (subpath \"/nonexistent/va\\\"ult\\\\x\"))");
        assert_eq!(lines[3], "(deny file-read* file-write* (subpath \"/nonexistent/plain\"))");
        assert_eq!(lines[4], "(deny file-read* file-write* (literal \"/nonexistent/.netrc\"))");
        assert_eq!(lines.len(), 5);
        // A name with a line break cannot be written into a profile: it is left out, never half written.
        let odd = seatbelt_profile(&Denied { folders: vec![folder("/nonexistent/a\nb")], files: Vec::new() });
        assert_eq!(odd, "(version 1)\n(allow default)");
    }

    #[test]
    fn bwrap_covers_only_what_exists() {
        let root = tempfile::tempdir().unwrap();
        let there = root.path().join("there");
        let file = root.path().join("file");
        std::fs::create_dir_all(&there).unwrap();
        std::fs::write(&file, b"x").unwrap();
        let args = bwrap_args(&Denied { folders: vec![there.clone(), root.path().join("missing")], files: vec![file.clone(), root.path().join("no-file")] });
        let text: Vec<String> = args.iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert_eq!(&text[..4], ["--dev-bind", "/", "/", "--die-with-parent"]);
        assert_eq!(text.iter().filter(|arg| *arg == "--tmpfs").count(), 1);
        assert_eq!(text.iter().filter(|arg| *arg == "--ro-bind").count(), 1);
        assert!(text.contains(&real(&there).to_string_lossy().into_owned()));
        assert!(text.contains(&real(&file).to_string_lossy().into_owned()));
        assert!(!text.iter().any(|arg| arg.contains("missing") || arg.contains("no-file")));
        assert_eq!(text.last().map(String::as_str), Some("--"));
    }

    #[test]
    fn the_wrapper_keeps_program_and_arguments_as_they_are_behind_its_own() {
        let denied = Denied::default();
        let args = vec!["-y".to_string(), "@scope/server --flag".to_string()];
        let (program, wrapped) = wrap(SandboxKind::None, Path::new("/usr/bin/npx"), &args, &denied);
        assert_eq!(program, PathBuf::from("/usr/bin/npx"));
        assert_eq!(wrapped, vec![OsString::from("-y"), OsString::from("@scope/server --flag")]);

        let (program, wrapped) = wrap(SandboxKind::Seatbelt, Path::new("/usr/bin/npx"), &args, &denied);
        assert_eq!(program, PathBuf::from("/usr/bin/sandbox-exec"));
        assert_eq!(wrapped[0], OsString::from("-p"));
        assert_eq!(&wrapped[2..], [OsString::from("/usr/bin/npx"), OsString::from("-y"), OsString::from("@scope/server --flag")]);

        let (program, wrapped) = wrap(SandboxKind::Bwrap, Path::new("/usr/bin/npx"), &args, &denied);
        assert_eq!(program, PathBuf::from("bwrap"));
        let split = wrapped.iter().position(|arg| arg == "--").unwrap();
        assert_eq!(&wrapped[split + 1..], [OsString::from("/usr/bin/npx"), OsString::from("-y"), OsString::from("@scope/server --flag")]);
    }

    #[test]
    fn no_sandbox_is_claimed_where_the_platform_has_none() {
        assert!(!self_test(SandboxKind::None));
        if platform_kind() == SandboxKind::None {
            // Windows: the wrappers of the other systems do not exist, and trying one is a plain "no".
            assert!(!self_test(SandboxKind::Seatbelt));
            assert!(!self_test(SandboxKind::Bwrap));
        }
    }

    /// Where the system has its sandbox and lets this test use it, it must hold. Where it does not
    /// (no `bwrap` installed, user namespaces switched off), the self-test says so and nothing is claimed.
    #[test]
    fn the_self_test_is_honest_on_this_machine() {
        let kind = platform_kind();
        let works = self_test(kind);
        if works {
            assert_ne!(kind, SandboxKind::None);
        }
        println!("sandbox on this machine: {kind:?}, works: {works}");
    }
}
