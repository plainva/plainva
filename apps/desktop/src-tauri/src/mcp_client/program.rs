//! A foreign MCP server that is a program on this computer.
//!
//! It is somebody else's code running with the user's rights. So it is
//! started only from an entry of the registry — the exact file and arguments
//! the user confirmed in a native dialog —, never through a shell, with a
//! small environment instead of the app's own, in a sandbox where this
//! computer has one that passed its self-test, and its whole process tree ends
//! with the app. What it prints to its error stream is kept in a small ring
//! for the settings to show, scrubbed of the values it was given, and never
//! goes to a model.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use super::registry::{read_secret, server, Server};
use super::sandbox;
use super::McpClientState;
use crate::ai_egress::{not_while_local, only_main};
use crate::atomic_write::WriteRoots;

/// One protocol message; the web view's protocol code reads no longer one either.
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const MAX_WRITE_BYTES: usize = 1024 * 1024;
const STDERR_KEEP: usize = 16 * 1024;
pub(crate) const EXIT_GRACE: Duration = Duration::from_secs(2);

static RUNS: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum McpPipe {
    /// One line the program wrote to its output.
    Line { text: String },
    /// The program ended; `code` is missing where it was ended by force.
    Exit { code: Option<i32> },
}

pub(crate) struct Running {
    run: u64,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    tree: tree::Tree,
    stderr: Arc<Mutex<VecDeque<u8>>>,
    /// The values the program was given: removed from anything of it that is shown.
    scrub: Vec<String>,
}

/// The variables a program inherits. Everything else the app's own environment
/// holds — tokens of the shell the app was started from, for instance — stays here.
pub(crate) fn inherited_names(windows: bool) -> &'static [&'static str] {
    if windows {
        &[
            "APPDATA", "COMSPEC", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "OS", "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE", "PROGRAMDATA", "PROGRAMFILES",
            "PROGRAMFILES(X86)", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERNAME", "USERPROFILE", "WINDIR",
        ]
    } else {
        &["HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "PATH", "SHELL", "TERM", "TMPDIR", "USER"]
    }
}

/// The search path of the program: the folder it was found in first, so that
/// `npx` finds the `node` next to it wherever the app was started from.
pub(crate) fn child_path(program: &Path, inherited: Option<std::ffi::OsString>) -> Option<std::ffi::OsString> {
    let mut folders: Vec<PathBuf> = program.parent().map(Path::to_path_buf).into_iter().collect();
    if let Some(inherited) = inherited {
        for folder in std::env::split_paths(&inherited) {
            if !folders.contains(&folder) {
                folders.push(folder);
            }
        }
    }
    std::env::join_paths(folders).ok()
}

/// Lines of a stream, one at a time, without ever holding more than one. A
/// line longer than a message can be is skipped to its end, not buffered.
pub(crate) fn read_lines(mut reader: impl BufRead, mut emit: impl FnMut(String)) {
    let mut line: Vec<u8> = Vec::new();
    loop {
        line.clear();
        match (&mut reader).take(MAX_LINE_BYTES as u64 + 1).read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if line.last() != Some(&b'\n') && line.len() > MAX_LINE_BYTES {
            let mut rest: Vec<u8> = Vec::new();
            loop {
                rest.clear();
                match (&mut reader).take(64 * 1024).read_until(b'\n', &mut rest) {
                    Ok(0) | Err(_) => return,
                    Ok(_) if rest.last() == Some(&b'\n') => break,
                    Ok(_) => {}
                }
            }
            continue;
        }
        while matches!(line.last(), Some(b'\n' | b'\r')) {
            line.pop();
        }
        if !line.is_empty() {
            emit(String::from_utf8_lossy(&line).into_owned());
        }
    }
}

/// Keeps the end of what a program wrote to its error stream.
pub(crate) fn keep_tail(mut reader: impl Read, tail: &Mutex<VecDeque<u8>>) {
    let mut buffer = [0u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(read) => {
                if let Ok(mut tail) = tail.lock() {
                    tail.extend(&buffer[..read]);
                    let extra = tail.len().saturating_sub(STDERR_KEEP);
                    tail.drain(..extra);
                }
            }
        }
    }
}

/// What the settings show of a program's own messages: printable text, without the values the program was given.
pub(crate) fn shown_log(tail: &[u8], scrub: &[String]) -> String {
    let mut text: String = String::from_utf8_lossy(tail).chars().filter(|c| !c.is_control() || *c == '\n' || *c == '\t').collect();
    for value in scrub.iter().filter(|value| value.len() >= 4) {
        text = text.replace(value.as_str(), "[value]");
    }
    text
}

pub(crate) fn wait_for_exit(child: &Mutex<Child>, limit: Duration) -> Option<Option<i32>> {
    let until = Instant::now() + limit;
    loop {
        if let Ok(mut child) = child.lock() {
            if let Ok(Some(status)) = child.try_wait() {
                return Some(status.code());
            }
        }
        if Instant::now() >= until {
            return None;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Ends a program: its input is closed — the protocol's own signal to stop —,
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

/// Stops the program of a server, if one runs. Used when its entry changes or goes.
pub(crate) fn stop(state: &McpClientState, server_id: &str) {
    let running = state.programs.lock().ok().and_then(|mut programs| programs.remove(server_id));
    if let Some(running) = running {
        end(running);
    }
}

/// Stops every program: the app is closing.
pub(crate) fn stop_all(state: &McpClientState) {
    let all: Vec<Running> = state.programs.lock().map(|mut programs| programs.drain().map(|(_, running)| running).collect()).unwrap_or_default();
    for running in all {
        end(running);
    }
}

#[tauri::command]
pub async fn mcp_client_start(
    window: tauri::Window,
    app: AppHandle,
    state: State<'_, McpClientState>,
    roots: State<'_, WriteRoots>,
    server_id: String,
    on_event: Channel<McpPipe>,
) -> Result<(), String> {
    only_main(&window)?;
    // Fully local (ADR 0030): refused here once more — the web view does not get this far while the switch is on.
    not_while_local()?;
    // The reasons a start fails are a fixed set of words (`MCP_START_PROBLEMS` in packages/core): the
    // settings say each in the user's language, and none of them carries a path or a system message.
    let Some(Server::Program { program, args, env, sandbox: sandboxed }) = server(&app, &state, &server_id)? else {
        return Err("not-registered".into());
    };
    if state.programs.lock().map_err(|_| "lock failed".to_string())?.contains_key(&server_id) {
        return Err("already-running".into());
    }
    // The file that was confirmed, where it was confirmed: a program that moved is confirmed anew.
    let file = PathBuf::from(&program);
    if !file.is_file() {
        return Err("program-moved".into());
    }

    let mut values: Vec<(String, String)> = Vec::new();
    for name in &env {
        if let Some(value) = read_secret(&app, &server_id, Some(name))? {
            values.push((name.clone(), value));
        }
    }

    let mut command = if sandboxed {
        // A program confirmed to run in a sandbox is not started without one.
        let info = sandbox::probe(&state).await;
        if !info.works {
            return Err("sandbox-unavailable".into());
        }
        let vaults: Vec<PathBuf> = roots.0.lock().map(|roots| roots.values().cloned().collect()).unwrap_or_default();
        let denied = sandbox::denied(std::env::var_os("HOME").map(PathBuf::from).as_deref(), app.path().app_data_dir().ok().as_deref(), &vaults);
        let (wrapper, wrapped) = sandbox::wrap(info.kind, &file, &args, &denied);
        let mut command = Command::new(wrapper);
        command.args(wrapped);
        command
    } else {
        let mut command = Command::new(&file);
        command.args(&args);
        command
    };
    command.env_clear();
    for name in inherited_names(cfg!(windows)) {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    if let Some(path) = child_path(&file, std::env::var_os("PATH")) {
        command.env("PATH", path);
    }
    for (name, value) in &values {
        command.env(name, value);
    }
    command.current_dir(std::env::temp_dir()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
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
    state.programs.lock().map_err(|_| "lock failed".to_string())?.insert(
        server_id.clone(),
        Running { run, child: Arc::clone(&child), stdin: Arc::new(Mutex::new(Some(stdin))), tree, stderr: Arc::clone(&tail), scrub: values.into_iter().map(|(_, value)| value).collect() },
    );

    let _ = std::thread::Builder::new().name(format!("mcp-err-{server_id}")).spawn(move || keep_tail(stderr, &tail));
    let reader_app = app.clone();
    let _ = std::thread::Builder::new().name(format!("mcp-out-{server_id}")).spawn(move || {
        read_lines(BufReader::new(stdout), |text| {
            let _ = on_event.send(McpPipe::Line { text });
        });
        // The output ended: the program is gone or going. Its entry goes with it, unless a later start already took its place.
        let code = wait_for_exit(&child, EXIT_GRACE).flatten();
        let state = reader_app.state::<McpClientState>();
        let finished = state.programs.lock().ok().and_then(|mut programs| if programs.get(&server_id).is_some_and(|running| running.run == run) { programs.remove(&server_id) } else { None });
        if let Some(running) = finished {
            end(running);
        }
        let _ = on_event.send(McpPipe::Exit { code });
    });
    Ok(())
}

/// One protocol message to the program. A line break inside it would be two messages: refused.
#[tauri::command]
pub async fn mcp_client_write(window: tauri::Window, state: State<'_, McpClientState>, server_id: String, line: String) -> Result<(), String> {
    only_main(&window)?;
    if line.len() > MAX_WRITE_BYTES || line.contains(['\n', '\r']) {
        return Err("not one message".into());
    }
    let stdin = state.programs.lock().map_err(|_| "lock failed".to_string())?.get(&server_id).map(|running| Arc::clone(&running.stdin)).ok_or("the program is not running")?;
    // A program that does not read blocks the write: off the event loop.
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = stdin.lock().map_err(|_| "lock failed".to_string())?;
        let pipe = guard.as_mut().ok_or("the program's input is closed")?;
        pipe.write_all(line.as_bytes()).and_then(|()| pipe.write_all(b"\n")).and_then(|()| pipe.flush()).map_err(|error| format!("the program does not take input ({:?})", error.kind()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mcp_client_stop(window: tauri::Window, state: State<'_, McpClientState>, server_id: String) -> Result<(), String> {
    only_main(&window)?;
    let running = state.programs.lock().map_err(|_| "lock failed".to_string())?.remove(&server_id);
    if let Some(running) = running {
        tauri::async_runtime::spawn_blocking(move || end(running)).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The end of what the program wrote to its error stream, for the settings: text for a person, never for a model.
#[tauri::command]
pub fn mcp_client_log(window: tauri::Window, state: State<'_, McpClientState>, server_id: String) -> Result<String, String> {
    only_main(&window)?;
    let programs = state.programs.lock().map_err(|_| "lock failed".to_string())?;
    let Some(running) = programs.get(&server_id) else {
        return Ok(String::new());
    };
    let tail: Vec<u8> = running.stderr.lock().map(|tail| tail.iter().copied().collect()).unwrap_or_default();
    Ok(shown_log(&tail, &running.scrub))
}

/// The process tree of a program: everything it starts ends with it, and with the app.
#[cfg(windows)]
pub(crate) mod tree {
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use std::process::{Child, Command};

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    /// A job object: when its last handle closes — this one, with the app — every process in it ends.
    pub(crate) struct Tree(usize);

    pub(crate) fn prepare(command: &mut Command) {
        // A console program must not open a window of its own next to the app.
        command.creation_flags(CREATE_NO_WINDOW);
    }

    impl Tree {
        pub(crate) fn adopt(child: &Child) -> Tree {
            // SAFETY: plain Win32 calls on handles this function owns or borrows for their duration;
            // the structure is zero-initialised as the API documents, and every result is checked.
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Tree(0);
                }
                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let set = SetInformationJobObject(job, JobObjectExtendedLimitInformation, std::ptr::addr_of!(limits).cast(), std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32);
                let assigned = AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE);
                if set == 0 || assigned == 0 {
                    CloseHandle(job);
                    return Tree(0);
                }
                Tree(job as usize)
            }
        }

        pub(crate) fn kill(&self, child: &mut Child) {
            if self.0 != 0 {
                // SAFETY: the handle is the job this value owns.
                unsafe {
                    TerminateJobObject(self.0 as HANDLE, 1);
                }
            }
            let _ = child.kill();
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            if self.0 != 0 {
                // SAFETY: the handle is the job this value owns, closed exactly once.
                unsafe {
                    CloseHandle(self.0 as HANDLE);
                }
            }
        }
    }
}

#[cfg(unix)]
pub(crate) mod tree {
    use std::os::unix::process::CommandExt;
    use std::process::{Child, Command};

    /// A process group of its own, named by the program's process id.
    pub(crate) struct Tree(i32);

    pub(crate) fn prepare(command: &mut Command) {
        command.process_group(0);
    }

    impl Tree {
        pub(crate) fn adopt(child: &Child) -> Tree {
            Tree(i32::try_from(child.id()).unwrap_or(0))
        }

        pub(crate) fn kill(&self, child: &mut Child) {
            if self.0 > 1 {
                // SAFETY: a signal to the process group this value was created for; a group that is gone is an error the call reports and this ignores.
                unsafe {
                    libc::killpg(self.0, libc::SIGTERM);
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
                // SAFETY: as above.
                unsafe {
                    libc::killpg(self.0, libc::SIGKILL);
                }
            }
            let _ = child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn lines(input: &[u8]) -> Vec<String> {
        let mut out = Vec::new();
        read_lines(BufReader::new(Cursor::new(input.to_vec())), |line| out.push(line));
        out
    }

    #[test]
    fn output_is_read_line_by_line() {
        assert_eq!(lines(b"{\"a\":1}\n{\"b\":2}\r\n\n  \nlast"), vec!["{\"a\":1}", "{\"b\":2}", "  ", "last"]);
        assert_eq!(lines(b""), Vec::<String>::new());
        assert_eq!(lines(b"\n\n\n"), Vec::<String>::new());
        // Bytes that are no text become the replacement character: a line is never held back for them.
        assert_eq!(lines(&[b'a', 0xff, b'b', b'\n']), vec!["a\u{fffd}b"]);
    }

    #[test]
    fn a_line_longer_than_a_message_is_skipped_to_its_end() {
        let mut input = vec![b'x'; MAX_LINE_BYTES + 100_000];
        input.push(b'\n');
        input.extend_from_slice(b"{\"ok\":true}\n");
        assert_eq!(lines(&input), vec!["{\"ok\":true}"]);
        // Exactly as long as a message may be: kept.
        let mut exact = vec![b'y'; MAX_LINE_BYTES];
        exact.push(b'\n');
        assert_eq!(lines(&exact).first().map(String::len), Some(MAX_LINE_BYTES));
        // An over-long line that never ends is not kept either.
        assert_eq!(lines(&vec![b'z'; MAX_LINE_BYTES + 5]), Vec::<String>::new());
    }

    #[test]
    fn the_error_stream_keeps_only_its_end() {
        let tail = Mutex::new(VecDeque::new());
        let mut input = vec![b'a'; STDERR_KEEP];
        input.extend_from_slice(b"the end");
        keep_tail(Cursor::new(input), &tail);
        let kept: Vec<u8> = tail.lock().unwrap().iter().copied().collect();
        assert_eq!(kept.len(), STDERR_KEEP);
        assert!(kept.ends_with(b"the end"));
    }

    #[test]
    fn what_is_shown_of_a_program_is_printable_and_without_its_values() {
        let shown = shown_log(b"Starting with token ghp_abcdef123456\x1b[31m\r\nready\x00\n", &["ghp_abcdef123456".to_string(), "abc".to_string()]);
        assert_eq!(shown, "Starting with token [value][31m\nready\n");
    }

    #[test]
    fn a_program_inherits_a_short_list_and_finds_what_lies_next_to_it() {
        for windows in [true, false] {
            let names = inherited_names(windows);
            assert!(names.contains(&"PATH"));
            for secretish in ["GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "OPENAI_API_KEY", "SSH_AUTH_SOCK", "NODE_OPTIONS", "LD_PRELOAD"] {
                assert!(!names.contains(&secretish), "{secretish}");
            }
        }
        let (program, other) = if cfg!(windows) { ("C:\\node\\npx.cmd", "C:\\other") } else { ("/opt/node/bin/npx", "/usr/bin") };
        let inherited = std::env::join_paths([PathBuf::from(other), Path::new(program).parent().unwrap().to_path_buf()]).unwrap();
        let path = child_path(Path::new(program), Some(inherited)).unwrap();
        let folders: Vec<PathBuf> = std::env::split_paths(&path).collect();
        assert_eq!(folders, vec![Path::new(program).parent().unwrap().to_path_buf(), PathBuf::from(other)]);
    }

    /// A real program, on every platform the tests run on: this test binary itself, asked for its help text.
    #[test]
    fn a_program_is_started_read_and_ended() {
        let me = std::env::current_exe().unwrap();
        let mut command = Command::new(&me);
        command.arg("--help").env_clear().stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        for name in inherited_names(cfg!(windows)) {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
        tree::prepare(&mut command);
        let mut child = command.spawn().unwrap();
        let _tree = tree::Tree::adopt(&child);
        let stdout = child.stdout.take().unwrap();
        let mut seen = Vec::new();
        read_lines(BufReader::new(stdout), |line| seen.push(line));
        assert!(seen.iter().any(|line| line.contains("Usage") || line.contains("USAGE") || line.contains("--help")), "{seen:?}");
        // Ended by itself: nothing is left to end, and a group that is gone is not signalled.
        let child = Mutex::new(child);
        assert_eq!(wait_for_exit(&child, Duration::from_secs(10)), Some(Some(0)));
    }
}
