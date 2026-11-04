//! An external agent as a process.
//!
//! Started only from an entry of the registry — the exact file and arguments
//! the user confirmed —, never through a shell, in a folder that is an open
//! vault, and its whole process tree ends with the app. What it prints to its
//! error stream is kept in a small ring for the session to show and never goes
//! anywhere else.
//!
//! Unlike a program that is an MCP server it is not fenced in: no sandbox, and
//! the environment of the user's session instead of a short list. An agent has
//! to find its own sign-in, its own tools and the network, and it is the
//! user's own choice of a program that acts for them. The surfaces say what
//! that means before every start; this file does not pretend otherwise.

use std::collections::VecDeque;
use std::ffi::OsString;
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use super::registry::{agent, command_text};
use super::AcpState;
use crate::ai_egress::{not_while_local, only_main};
use crate::atomic_write::WriteRoots;
use crate::mcp_client::program::{child_path, keep_tail, read_lines, shown_log, tree, wait_for_exit, McpPipe, EXIT_GRACE};
use crate::mcp_client::registry::{confirmed, search_path, McpConfirmText};

/// One protocol message to an agent: a turn's text, or the text of a note it asked for.
const MAX_WRITE_BYTES: usize = 4 * 1024 * 1024;
/// The user's no in the dialog before a start. Not a failure: nothing started, and the session has nothing to show.
pub(crate) const START_DECLINED: &str = "declined";

static RUNS: AtomicU64 = AtomicU64::new(1);

pub(crate) struct Running {
    run: u64,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    tree: tree::Tree,
    stderr: Arc<Mutex<VecDeque<u8>>>,
}

/// A path without the prefix Windows puts before one it resolved (`\\?\`).
/// Programs — a command interpreter above all — do not take such a path as
/// the folder they work in.
pub(crate) fn plain_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(share) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{share}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest.to_string()),
        _ => path.to_path_buf(),
    }
}

/// The folder an agent is started in: one the app registered as a folder it
/// writes into — the open vault is one —, and never the app's own data, where
/// the registries and the approvals of this device live. This keeps a start
/// from landing somewhere the app has nothing to do with; it is not a wall
/// against the web view, which registers those folders itself.
pub(crate) fn vault_folder(roots: &WriteRoots, root: &str, app_data: Option<&Path>) -> Option<PathBuf> {
    let asked = std::fs::canonicalize(root).ok()?;
    if let Some(own) = app_data.and_then(|folder| std::fs::canonicalize(folder).ok()) {
        if asked.starts_with(&own) {
            return None;
        }
    }
    let known = roots.0.lock().ok()?;
    known.values().any(|folder| *folder == asked).then(|| plain_path(&asked))
}

/// The search path of an agent: the folder its program lies in first — `node`
/// next to a script that needs it —, then the app's own, then the folders a
/// desktop app started from the dock does not have on it.
pub(crate) fn agent_path(file: &Path) -> Option<OsString> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let inherited = std::env::join_paths(search_path(std::env::var_os("PATH").as_deref(), home.as_deref(), cfg!(unix))).ok();
    child_path(file, inherited)
}

/// What the system's dialog shows before a start, written here and not by the
/// web view: the folder the agent will work in, then the file that is started
/// and every argument, each on a line of its own.
pub(crate) fn start_text(folder: &Path, program: &str, args: &[String]) -> String {
    format!("{}\n\n{}", folder.to_string_lossy(), command_text(program, args))
}

/// Whether the user said yes to this agent in this folder since the app started.
pub(crate) fn start_confirmed(state: &AcpState, agent_id: &str, folder: &Path) -> bool {
    state.confirmed.lock().map(|confirmed| confirmed.contains(&(agent_id.to_string(), folder.to_path_buf()))).unwrap_or(false)
}

pub(crate) fn remember_start(state: &AcpState, agent_id: &str, folder: &Path) {
    if let Ok(mut confirmed) = state.confirmed.lock() {
        confirmed.insert((agent_id.to_string(), folder.to_path_buf()));
    }
}

/// An agent's entry changed or went: a yes was for the command that stood there.
pub(crate) fn forget_starts(state: &AcpState, agent_id: &str) {
    if let Ok(mut confirmed) = state.confirmed.lock() {
        confirmed.retain(|(id, _)| id != agent_id);
    }
}

/// Ends an agent: its input is closed — the protocol's own signal to stop —,
/// it gets a moment, then its whole tree is ended.
fn end(running: Running) {
    if let Ok(mut stdin) = running.stdin.lock() {
        stdin.take();
    }
    if wait_for_exit(&running.child, EXIT_GRACE).is_none() {
        if let Ok(mut child) = running.child.lock() {
            running.tree.kill(&mut child);
        }
        let _ = wait_for_exit(&running.child, EXIT_GRACE);
    }
}

/// Stops an agent, if it runs. Used when its entry changes or goes.
pub(crate) fn stop(state: &AcpState, agent_id: &str) {
    let running = state.running.lock().ok().and_then(|mut running| running.remove(agent_id));
    if let Some(running) = running {
        end(running);
    }
}

/// Stops every agent: the app is closing.
pub(crate) fn stop_all(state: &AcpState) {
    let all: Vec<Running> = state.running.lock().map(|mut running| running.drain().map(|(_, entry)| entry).collect()).unwrap_or_default();
    for running in all {
        end(running);
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn acp_start(
    window: tauri::Window,
    app: AppHandle,
    state: State<'_, AcpState>,
    roots: State<'_, WriteRoots>,
    agent_id: String,
    root: String,
    text: McpConfirmText,
    on_event: Channel<McpPipe>,
) -> Result<(), String> {
    only_main(&window)?;
    // Fully local (ADR 0030): refused here once more — the web view does not get this far while the switch is on.
    not_while_local()?;
    // The reasons a start fails are a fixed set of words (`ACP_START_PROBLEMS` in packages/core): the
    // surfaces say each in the user's language, and none of them carries a path or a system message.
    let Some(entry) = agent(&app, &state, &agent_id)? else {
        return Err("not-registered".into());
    };
    // The file that was confirmed, where it was confirmed: a program that moved is confirmed anew.
    let file = PathBuf::from(&entry.program);
    if !file.is_file() {
        return Err("program-moved".into());
    }
    let Some(folder) = vault_folder(&roots, &root, app.path().app_data_dir().ok().as_deref()) else {
        return Err("not-a-vault".into());
    };
    // The first start in a folder since the app started is the user's yes in the system's own dialog,
    // which shows the folder and the whole command. The web view speaks the protocol, so it could name a
    // registered agent by itself; what it cannot do is answer this dialog.
    if !start_confirmed(&state, &agent_id, &folder) {
        if !confirmed(&app, text, start_text(&folder, &entry.program, &entry.args)).await? {
            return Err(START_DECLINED.into());
        }
        // The dialog was open for as long as the user liked: the yes is for the command it showed.
        if agent(&app, &state, &agent_id)?.as_ref() != Some(&entry) {
            return Err("not-registered".into());
        }
        remember_start(&state, &agent_id, &folder);
    }
    if state.running.lock().map_err(|_| "lock failed".to_string())?.contains_key(&agent_id) {
        return Err("already-running".into());
    }

    let mut command = Command::new(&file);
    command.args(&entry.args);
    if let Some(path) = agent_path(&file) {
        command.env("PATH", path);
    }
    command.current_dir(&folder).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    tree::prepare(&mut command);

    let mut child = command.spawn().map_err(|_| "start-failed".to_string())?;
    let tree = tree::Tree::adopt(&child);
    let (Some(stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
        tree.kill(&mut child);
        return Err("start-failed".into());
    };
    let run = RUNS.fetch_add(1, Ordering::Relaxed);
    let child = Arc::new(Mutex::new(child));
    let tail = Arc::new(Mutex::new(VecDeque::new()));
    if let Ok(mut last) = state.last_words.lock() {
        last.remove(&agent_id);
    }
    state
        .running
        .lock()
        .map_err(|_| "lock failed".to_string())?
        .insert(agent_id.clone(), Running { run, child: Arc::clone(&child), stdin: Arc::new(Mutex::new(Some(stdin))), tree, stderr: Arc::clone(&tail) });

    let error_tail = Arc::clone(&tail);
    let _ = std::thread::Builder::new().name(format!("acp-err-{agent_id}")).spawn(move || keep_tail(stderr, &error_tail));
    let reader_app = app.clone();
    let _ = std::thread::Builder::new().name(format!("acp-out-{agent_id}")).spawn(move || {
        read_lines(BufReader::new(stdout), |text| {
            let _ = on_event.send(McpPipe::Line { text });
        });
        // The output ended: the program is gone or going. Its entry goes with it, unless a later start already took its place.
        let code = wait_for_exit(&child, EXIT_GRACE).flatten();
        let state = reader_app.state::<AcpState>();
        let finished = state.running.lock().ok().and_then(|mut running| if running.get(&agent_id).is_some_and(|entry| entry.run == run) { running.remove(&agent_id) } else { None });
        let ours = finished.is_some();
        if let Some(running) = finished {
            end(running);
        }
        // Its last words stay to be read: what a program that gave up wrote is usually why. The reader of
        // its error stream gets a moment to take in the rest — it is not waited for, because something the
        // program started may hold that stream open for as long as it likes.
        if ours {
            std::thread::sleep(std::time::Duration::from_millis(150));
            let said: Vec<u8> = tail.lock().map(|tail| tail.iter().copied().collect()).unwrap_or_default();
            if let Ok(mut last) = state.last_words.lock() {
                last.insert(agent_id.clone(), shown_log(&said, &[]));
            }
        }
        let _ = on_event.send(McpPipe::Exit { code });
    });
    Ok(())
}

/// One protocol message to the agent. A line break inside it would be two messages: refused.
#[tauri::command]
pub async fn acp_write(window: tauri::Window, state: State<'_, AcpState>, agent_id: String, line: String) -> Result<(), String> {
    only_main(&window)?;
    if line.len() > MAX_WRITE_BYTES || line.contains(['\n', '\r']) {
        return Err("not one message".into());
    }
    let stdin = state.running.lock().map_err(|_| "lock failed".to_string())?.get(&agent_id).map(|running| Arc::clone(&running.stdin)).ok_or("the agent is not running")?;
    // A program that does not read blocks the write: off the event loop.
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = stdin.lock().map_err(|_| "lock failed".to_string())?;
        let pipe = guard.as_mut().ok_or("the agent's input is closed")?;
        pipe.write_all(line.as_bytes()).and_then(|()| pipe.write_all(b"\n")).and_then(|()| pipe.flush()).map_err(|error| format!("the agent does not take input ({:?})", error.kind()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn acp_stop(window: tauri::Window, state: State<'_, AcpState>, agent_id: String) -> Result<(), String> {
    only_main(&window)?;
    let running = state.running.lock().map_err(|_| "lock failed".to_string())?.remove(&agent_id);
    if let Some(running) = running {
        tauri::async_runtime::spawn_blocking(move || end(running)).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The end of what the agent wrote to its error stream, for the session to show: text for a person.
#[tauri::command]
pub fn acp_log(window: tauri::Window, state: State<'_, AcpState>, agent_id: String) -> Result<String, String> {
    only_main(&window)?;
    let running = state.running.lock().map_err(|_| "lock failed".to_string())?;
    let Some(entry) = running.get(&agent_id) else {
        // Not running: what it wrote before it ended, where it ended since the app started.
        return Ok(state.last_words.lock().ok().and_then(|last| last.get(&agent_id).cloned()).unwrap_or_default());
    };
    let tail: Vec<u8> = entry.stderr.lock().map(|tail| tail.iter().copied().collect()).unwrap_or_default();
    Ok(shown_log(&tail, &[]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn a_resolved_windows_path_loses_only_its_prefix() {
        assert_eq!(plain_path(Path::new(r"\\?\C:\Users\mara\Vault")), PathBuf::from(r"C:\Users\mara\Vault"));
        assert_eq!(plain_path(Path::new(r"\\?\UNC\nas\share\Vault")), PathBuf::from(r"\\nas\share\Vault"));
        assert_eq!(plain_path(Path::new(r"C:\Users\mara\Vault")), PathBuf::from(r"C:\Users\mara\Vault"));
        assert_eq!(plain_path(Path::new("/home/mara/Vault")), PathBuf::from("/home/mara/Vault"));
        // A prefix before something that is no drive stays what it is.
        assert_eq!(plain_path(Path::new(r"\\?\Volume{1234}\Vault")), PathBuf::from(r"\\?\Volume{1234}\Vault"));
    }

    #[test]
    fn an_agent_starts_only_in_a_folder_that_is_an_open_vault() {
        let vault = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let inside = vault.path().join("Projects");
        std::fs::create_dir(&inside).unwrap();
        let roots = WriteRoots(Mutex::new(HashMap::from([("root-1".to_string(), std::fs::canonicalize(vault.path()).unwrap())])));

        let found = vault_folder(&roots, &vault.path().to_string_lossy(), Some(other.path())).expect("the vault itself");
        assert_eq!(std::fs::canonicalize(&found).unwrap(), std::fs::canonicalize(vault.path()).unwrap());
        // The folder the process gets is one a program takes: without the resolved-path prefix.
        assert!(!found.to_string_lossy().starts_with(r"\\?\"));
        // Not a folder inside the vault, not another folder, not one that does not exist, not nothing.
        assert!(vault_folder(&roots, &inside.to_string_lossy(), None).is_none());
        assert!(vault_folder(&roots, &other.path().to_string_lossy(), None).is_none());
        assert!(vault_folder(&roots, &vault.path().join("missing").to_string_lossy(), None).is_none());
        assert!(vault_folder(&roots, "", None).is_none());
        // A path that only leads back to the vault is the vault.
        let around = inside.join("..");
        assert!(vault_folder(&roots, &around.to_string_lossy(), None).is_some());
        assert!(vault_folder(&WriteRoots::default(), &vault.path().to_string_lossy(), None).is_none());
    }

    #[test]
    fn an_agent_never_starts_in_the_apps_own_data() {
        let data = tempfile::tempdir().unwrap();
        let ai = data.path().join("ai");
        std::fs::create_dir(&ai).unwrap();
        // The app registers folders of its own as ones it writes into; an agent is started in none of them.
        let roots = WriteRoots(Mutex::new(HashMap::from([
            ("ai".to_string(), std::fs::canonicalize(&ai).unwrap()),
            ("data".to_string(), std::fs::canonicalize(data.path()).unwrap()),
        ])));
        assert!(vault_folder(&roots, &ai.to_string_lossy(), Some(data.path())).is_none());
        assert!(vault_folder(&roots, &data.path().to_string_lossy(), Some(data.path())).is_none());
        // Where the app's data cannot be named, the registration alone decides.
        assert!(vault_folder(&roots, &ai.to_string_lossy(), None).is_some());
    }

    #[test]
    fn the_dialog_before_a_start_shows_the_folder_and_the_whole_command() {
        let folder = if cfg!(windows) { r"C:\Users\mara\Vault" } else { "/home/mara/Vault" };
        assert_eq!(start_text(Path::new(folder), "/usr/bin/gemini", &["--acp".into(), "two words".into()]), format!("{folder}\n\n/usr/bin/gemini\n--acp\ntwo words"));
        assert_eq!(start_text(Path::new(folder), "/usr/bin/codex-acp", &[]), format!("{folder}\n\n/usr/bin/codex-acp"));
    }

    #[test]
    fn a_yes_holds_for_one_agent_in_one_folder_until_its_entry_changes() {
        let state = AcpState::default();
        let (vault, other) = (Path::new("/home/mara/Vault"), Path::new("/home/mara/Work"));
        assert!(!start_confirmed(&state, "gemini", vault));
        remember_start(&state, "gemini", vault);
        assert!(start_confirmed(&state, "gemini", vault));
        // Another folder, another agent: each is asked for on its own.
        assert!(!start_confirmed(&state, "gemini", other));
        assert!(!start_confirmed(&state, "codex", vault));
        remember_start(&state, "codex", vault);
        remember_start(&state, "gemini", other);
        // Another command under the id, or none: the yes was for what stood there.
        forget_starts(&state, "gemini");
        assert!(!start_confirmed(&state, "gemini", vault));
        assert!(!start_confirmed(&state, "gemini", other));
        assert!(start_confirmed(&state, "codex", vault));
    }

    #[test]
    fn an_agent_finds_what_lies_next_to_it_first() {
        let program = if cfg!(windows) { r"C:\agents\bin\agent.cmd" } else { "/opt/agents/bin/agent" };
        let path = agent_path(Path::new(program)).unwrap();
        let folders: Vec<PathBuf> = std::env::split_paths(&path).collect();
        assert_eq!(folders.first(), Path::new(program).parent().map(Path::to_path_buf).as_ref());
        // The app's own search path follows, each folder once.
        let mut seen = std::collections::HashSet::new();
        assert!(folders.iter().all(|folder| seen.insert(folder.clone())));
    }

    /// A real program, on every platform the tests run on: this test binary itself, asked for its help
    /// text, started the way an agent is — in a vault's folder, with the session's environment.
    #[test]
    fn an_agent_is_started_in_the_vault_read_and_ended() {
        let vault = tempfile::tempdir().unwrap();
        let me = std::env::current_exe().unwrap();
        let mut command = Command::new(&me);
        command.arg("--help");
        if let Some(path) = agent_path(&me) {
            command.env("PATH", path);
        }
        command.current_dir(plain_path(&std::fs::canonicalize(vault.path()).unwrap())).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        tree::prepare(&mut command);
        let mut child = command.spawn().unwrap();
        let _tree = tree::Tree::adopt(&child);
        let stdout = child.stdout.take().unwrap();
        let mut seen = Vec::new();
        read_lines(BufReader::new(stdout), |line| seen.push(line));
        assert!(seen.iter().any(|line| line.contains("Usage") || line.contains("USAGE") || line.contains("--help")), "{seen:?}");
        let child = Mutex::new(child);
        assert_eq!(wait_for_exit(&child, std::time::Duration::from_secs(10)), Some(Some(0)));
    }
}
