//! The sign-in of an external agent, in a terminal of its own.
//!
//! An agent signs in by itself — with the user's own subscription or key.
//! Where its own program wants a terminal for that, the protocol names a few
//! arguments, and the host opens the SAME program it would start as the agent
//! with those arguments added, in a terminal the person can type into, and
//! waits for it to end. That is all this file does. Plainva is not in that
//! conversation: it does not read what is typed or printed there, it holds no
//! credential before or after, and the only thing it learns is the number the
//! program ended with.
//!
//! The program is the registered one. The web view adds arguments and values
//! the agent named; neither can make this start another file: there is no
//! shell between here and the program on Windows, and on the other systems
//! every part is quoted for the one it passes through. And it is opened only
//! for an agent whose start in that folder the user confirmed in the system's
//! dialog since the app started (`process.rs`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, State};

use super::process::{agent_path, start_confirmed, vault_folder};
use super::registry::agent;
use super::AcpState;
use crate::ai_egress::only_main;
use crate::atomic_write::WriteRoots;
use crate::mcp_client::registry::{clean_text, valid_env_name};

const MAX_ARGS: usize = 16;
const MAX_ARG: usize = 1024;
const MAX_ENV: usize = 16;
const MAX_VALUE: usize = 4096;
/// How long a sign-in may take: a browser, a code from a mail.
const LIMIT: Duration = Duration::from_secs(15 * 60);

/// The one sign-in that has a terminal open. Giving it up ends the wait; where the system allows, the terminal too.
pub(crate) struct Login {
    given_up: Arc<AtomicBool>,
}

/// The app is closing, or the user stopped waiting.
pub(crate) fn give_up(state: &AcpState) {
    if let Ok(login) = state.login.lock() {
        if let Some(login) = login.as_ref() {
            login.given_up.store(true, Ordering::Relaxed);
        }
    }
}

/// What the agent named for its sign-in, as it may be added to the registered
/// command: a few arguments and values that can be shown, and no name that
/// changes how a program is found or loaded.
pub(crate) fn check_additions(args: &[String], env: &BTreeMap<String, String>) -> Result<(), String> {
    if args.len() > MAX_ARGS || args.iter().any(|arg| arg.len() > MAX_ARG || !clean_text(arg)) {
        return Err("an argument of the sign-in cannot be used".into());
    }
    if env.len() > MAX_ENV || env.iter().any(|(name, value)| !valid_env_name(name) || value.len() > MAX_VALUE || !clean_text(value)) {
        return Err("a value of the sign-in cannot be used".into());
    }
    Ok(())
}

/// One part of a command for `sh`: in single quotes, with every single quote of its own closed, escaped and reopened.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn sh_quote(part: &str) -> String {
    format!("'{}'", part.replace('\'', r"'\''"))
}

/// The script a terminal runs on macOS and Linux: go to the vault, set the
/// values, start the program, and leave the number it ended with where the
/// app can read it. Every part the script did not write itself is quoted.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn login_script(folder: &Path, path: Option<&str>, program: &str, args: &[String], env: &BTreeMap<String, String>, status_file: &Path) -> String {
    let mut lines = vec!["#!/bin/sh".to_string(), format!("cd {} || exit 1", sh_quote(&folder.to_string_lossy()))];
    if let Some(path) = path {
        lines.push(format!("PATH={}; export PATH", sh_quote(path)));
    }
    for (name, value) in env {
        // The names passed `valid_env_name`: letters, digits and the underscore.
        lines.push(format!("{name}={}; export {name}", sh_quote(value)));
    }
    let mut command = vec![sh_quote(program)];
    command.extend(args.iter().map(|arg| sh_quote(arg)));
    lines.push(command.join(" "));
    lines.push("code=$?".to_string());
    lines.push(format!("printf '%s' \"$code\" > {}", sh_quote(&status_file.to_string_lossy())));
    lines.push("exit \"$code\"".to_string());
    lines.join("\n") + "\n"
}

/// The number a sign-in's script left behind; nothing while it still runs, or where the file says something else.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn read_status(text: &str) -> Option<i32> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.len() > 4 || !trimmed.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    trimmed.parse().ok()
}

/// Terminals as Linux desktops have them, each with what it wants before the command it runs.
#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub(crate) const LINUX_TERMINALS: &[(&str, &[&str])] = &[
    ("x-terminal-emulator", &["-e"]),
    ("gnome-terminal", &["--wait", "--"]),
    ("konsole", &["-e"]),
    ("xfce4-terminal", &["--disable-server", "-x"]),
    ("mate-terminal", &["--disable-factory", "-x"]),
    ("tilix", &["-e"]),
    ("kitty", &[]),
    ("alacritty", &["-e"]),
    ("foot", &[]),
    ("wezterm", &["start", "--always-new-process", "--"]),
    ("xterm", &["-e"]),
];

/// What a sign-in ended as: the program's number, or one of the module's own words.
type Outcome = Result<i32, &'static str>;

#[cfg(windows)]
fn run(file: &Path, args: &[String], env: &BTreeMap<String, String>, folder: &Path, given_up: &AtomicBool) -> Outcome {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::Console::{GetStdHandle, SetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};

    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    /// The streams of this process, and one start at a time that looks at them.
    static STREAMS: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Puts the streams back, whatever the start did.
    struct Restore([(u32, HANDLE); 3]);
    impl Drop for Restore {
        fn drop(&mut self) {
            for (which, handle) in self.0 {
                // SAFETY: gives this process back the stream handles it had a moment ago.
                unsafe {
                    SetStdHandle(which, handle);
                }
            }
        }
    }

    let mut command = Command::new(file);
    command.args(args).envs(env).current_dir(folder).creation_flags(CREATE_NEW_CONSOLE);
    if let Some(path) = agent_path(file) {
        command.env("PATH", path);
    }
    let spawned = {
        let _one = STREAMS.lock().map_err(|_| "start-failed")?;
        // A program started with a console of its own takes that console's streams — unless the one
        // that starts it hands over its own. A build of this app that was itself started from a
        // terminal has some, and the sign-in would then talk in THAT terminal while its own window
        // stays empty. So for the moment of the start this process has none; the installed app,
        // which has no console, never had any.
        // SAFETY: reads and sets this process's own standard handles; they are restored when
        // `_back` goes out of scope, and the lock keeps a second start from seeing the gap.
        let _back = unsafe {
            let saved = [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE].map(|which| (which, GetStdHandle(which)));
            for (which, _) in saved {
                SetStdHandle(which, std::ptr::null_mut());
            }
            Restore(saved)
        };
        command.spawn()
    };
    let mut child = spawned.map_err(|_| "start-failed")?;
    let until = Instant::now() + LIMIT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status.code().unwrap_or(1)),
            Ok(None) => {}
            Err(_) => return Err("start-failed"),
        }
        if given_up.load(Ordering::Relaxed) || Instant::now() >= until {
            let _ = child.kill();
            let _ = child.wait();
            return Err("cancelled");
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Waits for the script's number. Whether the terminal's window is still open
/// cannot be told from the process that was started — many terminals hand
/// their window to a server of their own and end at once —, so the wait ends
/// with the number, with the person who stops it, or with the limit.
#[cfg(unix)]
fn wait_for_status(status_file: &Path, mut terminal: Option<std::process::Child>, given_up: &AtomicBool) -> Outcome {
    let until = Instant::now() + LIMIT;
    loop {
        if let Some(code) = std::fs::read_to_string(status_file).ok().as_deref().and_then(read_status) {
            return Ok(code);
        }
        if given_up.load(Ordering::Relaxed) || Instant::now() >= until {
            if let Some(terminal) = terminal.as_mut() {
                let _ = terminal.kill();
                let _ = terminal.wait();
            }
            return Err("cancelled");
        }
        // A terminal that ended is collected, so that it does not linger as a process without a parent's notice.
        if let Some(child) = terminal.as_mut() {
            let _ = child.try_wait();
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

#[cfg(unix)]
fn write_script(dir: &Path, text: &str) -> Result<PathBuf, &'static str> {
    use std::os::unix::fs::PermissionsExt;
    // `.command` is what the Finder opens in a terminal; a shell runs it under any name.
    let script = dir.join("sign-in.command");
    std::fs::write(&script, text).map_err(|_| "start-failed")?;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).map_err(|_| "start-failed")?;
    Ok(script)
}

#[cfg(target_os = "macos")]
fn run(file: &Path, args: &[String], env: &BTreeMap<String, String>, folder: &Path, given_up: &AtomicBool) -> Outcome {
    // A folder only this user can read: the script names the values the agent asked for.
    let dir = tempfile::Builder::new().prefix("plainva-sign-in-").tempdir().map_err(|_| "start-failed")?;
    let status_file = dir.path().join("status");
    let path = agent_path(file).map(|path| path.to_string_lossy().into_owned());
    let script = write_script(dir.path(), &login_script(folder, path.as_deref(), &file.to_string_lossy(), args, env, &status_file))?;
    // The system's own way to open a script in a terminal; it needs no leave to steer another app.
    let opened = Command::new("/usr/bin/open").arg(&script).status().map_err(|_| "no-terminal")?;
    if !opened.success() {
        return Err("no-terminal");
    }
    wait_for_status(&status_file, None, given_up)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn run(file: &Path, args: &[String], env: &BTreeMap<String, String>, folder: &Path, given_up: &AtomicBool) -> Outcome {
    use crate::mcp_client::registry::locate;

    let dir = tempfile::Builder::new().prefix("plainva-sign-in-").tempdir().map_err(|_| "start-failed")?;
    let status_file = dir.path().join("status");
    let path = agent_path(file).map(|path| path.to_string_lossy().into_owned());
    let script = write_script(dir.path(), &login_script(folder, path.as_deref(), &file.to_string_lossy(), args, env, &status_file))?;
    // The terminal the user chose for the system first, then the ones desktops bring.
    let chosen = std::env::var("TERMINAL").ok().filter(|name| !name.is_empty() && clean_text(name));
    let candidates = chosen.iter().map(|name| (name.as_str(), &["-e"][..])).chain(LINUX_TERMINALS.iter().copied());
    for (name, before) in candidates {
        let Some(terminal) = locate(name) else { continue };
        let mut command = Command::new(terminal);
        command.args(before).arg("/bin/sh").arg(&script);
        if let Ok(child) = command.spawn() {
            return wait_for_status(&status_file, Some(child), given_up);
        }
    }
    Err("no-terminal")
}

/// Opens the agent's own program in a terminal for its sign-in and waits for
/// it to end. Answers with the number the program ended with — 0 is the
/// protocol's word for "signed in" — or with why no terminal was there to end.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn acp_login(
    window: tauri::Window,
    app: AppHandle,
    state: State<'_, AcpState>,
    roots: State<'_, WriteRoots>,
    agent_id: String,
    root: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
) -> Result<i32, String> {
    only_main(&window)?;
    let Some(entry) = agent(&app, &state, &agent_id)? else {
        return Err("not-registered".into());
    };
    let file = PathBuf::from(&entry.program);
    if !file.is_file() {
        return Err("program-moved".into());
    }
    let Some(folder) = vault_folder(&roots, &root, app.path().app_data_dir().ok().as_deref()) else {
        return Err("not-a-vault".into());
    };
    // A sign-in follows a start that asked for one. Without the user's yes to that start, the program is
    // not opened in a terminal either — with arguments the web view could have chosen.
    if !start_confirmed(&state, &agent_id, &folder) {
        return Err("start-failed".into());
    }
    check_additions(&args, &env)?;
    // The registered arguments first, the sign-in's after them: the same program, asked to do one more thing.
    let all: Vec<String> = entry.args.iter().cloned().chain(args).collect();

    let given_up = Arc::new(AtomicBool::new(false));
    {
        let mut login = state.login.lock().map_err(|_| "lock failed".to_string())?;
        if login.is_some() {
            return Err("busy".into());
        }
        *login = Some(Login { given_up: Arc::clone(&given_up) });
    }
    let outcome = tauri::async_runtime::spawn_blocking(move || run(&file, &all, &env, &folder, &given_up)).await;
    if let Ok(mut login) = state.login.lock() {
        *login = None;
    }
    match outcome {
        Ok(Ok(code)) => Ok(code),
        Ok(Err(word)) => Err(word.into()),
        Err(_) => Err("start-failed".into()),
    }
}

/// Stops waiting for a sign-in.
#[tauri::command]
pub fn acp_login_cancel(window: tauri::Window, state: State<'_, AcpState>) -> Result<(), String> {
    only_main(&window)?;
    give_up(&state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(name, value)| (name.to_string(), value.to_string())).collect()
    }

    #[test]
    fn a_sign_in_adds_a_few_arguments_and_values_that_can_be_shown() {
        assert!(check_additions(&["login".into()], &env(&[("AGENT_INTERACTIVE", "1")])).is_ok());
        assert!(check_additions(&[], &BTreeMap::new()).is_ok());
        assert!(check_additions(&vec!["x".to_string(); MAX_ARGS + 1], &BTreeMap::new()).is_err());
        assert!(check_additions(&["x".repeat(MAX_ARG + 1)], &BTreeMap::new()).is_err());
        assert!(check_additions(&["line\nbreak".into()], &BTreeMap::new()).is_err());
        assert!(check_additions(&[], &env(&[("OK", "line\nbreak")])).is_err());
        assert!(check_additions(&[], &env(&[("OK", &"x".repeat(MAX_VALUE + 1))])).is_err());
        // No name that changes which program is found, or what is loaded into it.
        for name in ["PATH", "Path", "PATHEXT", "COMSPEC", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "BAD NAME", "1X", ""] {
            assert!(check_additions(&[], &env(&[(name, "1")])).is_err(), "{name}");
        }
        let many: BTreeMap<String, String> = (0..=MAX_ENV).map(|i| (format!("V{i}"), "1".to_string())).collect();
        assert!(check_additions(&[], &many).is_err());
    }

    #[test]
    fn a_part_of_a_command_is_one_word_for_the_shell_whatever_it_holds() {
        assert_eq!(sh_quote("login"), "'login'");
        assert_eq!(sh_quote(""), "''");
        assert_eq!(sh_quote("two words"), "'two words'");
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
        assert_eq!(sh_quote("$(rm -rf ~); `id` && echo \"x\" | cat > /tmp/y"), "'$(rm -rf ~); `id` && echo \"x\" | cat > /tmp/y'");
        assert_eq!(sh_quote("'; rm -rf ~; '"), r"''\''; rm -rf ~; '\'''");
    }

    #[test]
    fn the_script_starts_the_registered_program_and_leaves_its_number() {
        let script = login_script(
            Path::new("/home/mara/My Vault"),
            Some("/opt/agents/bin:/usr/bin"),
            "/opt/agents/bin/agent",
            &["acp".into(), "login".into(), "it's; rm -rf ~".into()],
            &env(&[("AGENT_INTERACTIVE", "1"), ("NOTE", "a 'quoted' $HOME")]),
            Path::new("/tmp/plainva-sign-in-x/status"),
        );
        assert_eq!(
            script,
            [
                "#!/bin/sh",
                "cd '/home/mara/My Vault' || exit 1",
                "PATH='/opt/agents/bin:/usr/bin'; export PATH",
                "AGENT_INTERACTIVE='1'; export AGENT_INTERACTIVE",
                r"NOTE='a '\''quoted'\'' $HOME'; export NOTE",
                r"'/opt/agents/bin/agent' 'acp' 'login' 'it'\''s; rm -rf ~'",
                "code=$?",
                "printf '%s' \"$code\" > '/tmp/plainva-sign-in-x/status'",
                "exit \"$code\"",
                "",
            ]
            .join("\n")
        );
    }

    /// The script, run by a real shell: the program gets exactly the arguments, and its number comes back.
    #[cfg(unix)]
    #[test]
    fn a_shell_runs_the_script_as_it_reads() {
        let dir = tempfile::tempdir().unwrap();
        let seen = dir.path().join("seen");
        let status_file = dir.path().join("status");
        // A stand-in for an agent: writes its arguments and one value, one per line, and ends with 7.
        let program = dir.path().join("agent's program");
        std::fs::write(&program, format!("#!/bin/sh\nfor part in \"$@\"; do printf '%s\\n' \"$part\"; done > {}\nprintf '%s\\n' \"$NOTE\" >> {}\nexit 7\n", sh_quote(&seen.to_string_lossy()), sh_quote(&seen.to_string_lossy()))).unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let text = login_script(dir.path(), None, &program.to_string_lossy(), &["login".into(), "it's; echo hacked".into(), "$(echo no)".into()], &env(&[("NOTE", "a 'quoted' $HOME")]), &status_file);
        let script = write_script(dir.path(), &text).unwrap();
        let status = Command::new("/bin/sh").arg(&script).status().unwrap();
        assert_eq!(status.code(), Some(7));
        assert_eq!(std::fs::read_to_string(&seen).unwrap(), "login\nit's; echo hacked\n$(echo no)\na 'quoted' $HOME\n");
        assert_eq!(read_status(&std::fs::read_to_string(&status_file).unwrap()), Some(7));
        let given_up = AtomicBool::new(false);
        assert_eq!(wait_for_status(&status_file, None, &given_up), Ok(7));
        // Nothing wrote a number, and the person stopped waiting.
        let never = dir.path().join("never");
        given_up.store(true, Ordering::Relaxed);
        assert_eq!(wait_for_status(&never, None, &given_up), Err("cancelled"));
    }

    #[test]
    fn the_number_a_script_left_is_read_only_where_it_is_one() {
        assert_eq!(read_status("0"), Some(0));
        assert_eq!(read_status("1\n"), Some(1));
        assert_eq!(read_status(" 130 "), Some(130));
        for none in ["", " ", "-1", "0x10", "12345", "ok", "1 2"] {
            assert_eq!(read_status(none), None, "{none:?}");
        }
    }

    #[test]
    fn every_terminal_has_a_bare_name_and_plain_arguments() {
        for (name, before) in LINUX_TERMINALS {
            assert!(crate::acp::registry::bare_name(name), "{name}");
            assert!(before.iter().all(|arg| arg.starts_with('-') || arg.chars().all(|c| c.is_ascii_lowercase())), "{name}");
        }
    }

    /// The real thing on Windows: the test binary itself, in a console of its own, ended and its number read.
    #[cfg(windows)]
    #[test]
    fn a_program_in_its_own_console_is_waited_for_and_its_number_read() {
        let vault = tempfile::tempdir().unwrap();
        let me = std::env::current_exe().unwrap();
        let given_up = AtomicBool::new(false);
        // `--list` prints the tests and ends with 0; an option that does not exist ends with another number.
        assert_eq!(run(&me, &["--list".into()], &BTreeMap::new(), vault.path(), &given_up), Ok(0));
        let failed = run(&me, &["--no-such-option".into()], &BTreeMap::new(), vault.path(), &given_up);
        assert!(matches!(failed, Ok(code) if code != 0), "{failed:?}");
        // A program that is no program.
        assert_eq!(run(&vault.path().join("missing.exe"), &[], &BTreeMap::new(), vault.path(), &given_up), Err("start-failed"));
        // The person stopped waiting before it began.
        given_up.store(true, Ordering::Relaxed);
        let stopped = run(&me, &["--list".into()], &BTreeMap::new(), vault.path(), &given_up);
        assert!(matches!(stopped, Err("cancelled") | Ok(0)), "{stopped:?}");
    }
}
