//! The way out of the app: what the windows still hold is written first (A7).
//!
//! An editor saves a second after the last keystroke, and the draft journal
//! snapshots its buffer at most every 400 ms (longer for a large note). Until
//! 2026-11-16 nothing waited for either when the app went: closing the
//! central window, quitting from the tray or the menu right after typing could
//! lose up to that much — in the note and in the journal.
//!
//! So the native side holds these steps: the central window's close (when it
//! is not hidden into the tray, see `tray.rs`), every exit request — the tray's
//! "Quit", the last window closing, a termination signal on Linux and macOS
//! (`watch_termination`) — and, on macOS, the menu's "Quit" with Cmd+Q
//! (`install_quit_menu`), which the default menu would hand straight to the
//! system. It tells the central window (`plainva-leaving`); every window then
//! leaves its field, saves, writes its journal and waits for its writes
//! (`src/services/leaveFlush.ts`), and the central window says it is done
//! (`leave_ready`). The step goes on after that answer, or after `LEAVE_WAIT`
//! without one: a page that hung never keeps the app open.
//!
//! A window with a mail or a remark not sent makes the central window answer
//! "stay": the step does not happen, and that window asks its question, as
//! when it is closed by itself.
//!
//! Nothing is held while the central window has not said it listens
//! (`leave_armed`): the error page of a failed start, a start not finished, a
//! page that is loading again. There the step happens at once, as before.
//!
//! An exit that arrives while a close is held is not lost: it is what happens
//! once the hold ends. What is not held: a restart (the updater — Tauri ignores
//! `prevent_exit` for it, so the updater writes first, then installs); and the
//! ways out that never reach Tauri's exit request — on macOS "Quit" in the
//! Dock, logging out and shutting down (the system's terminate, which tao only
//! reports as the process ending), on Windows logging out and shutting down
//! (tao ends the process on WM_ENDSESSION). There what the journal had not yet
//! written is lost: at most one snapshot interval of typing.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The longest the way out waits for the windows: past the question to a
/// window holding a mail (2 s) and the windows' writes (2.5 s).
pub const LEAVE_WAIT: Duration = Duration::from_millis(5_000);

/// The label of the central window, the one that answers.
const MAIN: &str = "main";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Gate {
    /// Nothing held.
    Open,
    /// A close or an exit is held; `exit` is the code an exit asked for meanwhile.
    Holding { exit: Option<i32> },
    /// The hold ended; what comes now goes through.
    Released,
}

/// What a caller does with the step it was about to let happen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hold {
    /// Let it happen: nothing to wait for.
    LetGo,
    /// Held, and this caller starts the wait.
    Start,
    /// Held; a wait is already running and will carry this step out.
    Joined,
}

/// What the end of a hold does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Then {
    Exit(i32),
    CloseMain,
    /// A window holds a mail or a remark not sent: nothing happens.
    Stay,
}

/// The central window's answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Answer {
    None,
    Go,
    Stay,
}

pub struct LeaveState {
    gate: Mutex<Gate>,
    answer: Mutex<Answer>,
    answered: Condvar,
    armed: AtomicBool,
}

impl Default for LeaveState {
    fn default() -> Self {
        Self {
            gate: Mutex::new(Gate::Open),
            answer: Mutex::new(Answer::None),
            answered: Condvar::new(),
            armed: AtomicBool::new(false),
        }
    }
}

impl LeaveState {
    /// The central window's close is asked for.
    fn hold_close(&self) -> Hold {
        if !self.armed.load(Ordering::SeqCst) {
            return Hold::LetGo;
        }
        let mut gate = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        match *gate {
            Gate::Open => {
                *gate = Gate::Holding { exit: None };
                Hold::Start
            }
            Gate::Holding { .. } => Hold::Joined,
            Gate::Released => Hold::LetGo,
        }
    }

    /// The app is asked to exit with `code`.
    fn hold_exit(&self, code: i32) -> Hold {
        let mut gate = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        match *gate {
            Gate::Open if !self.armed.load(Ordering::SeqCst) => Hold::LetGo,
            Gate::Open => {
                *gate = Gate::Holding { exit: Some(code) };
                Hold::Start
            }
            Gate::Holding { .. } => {
                *gate = Gate::Holding { exit: Some(code) };
                Hold::Joined
            }
            Gate::Released => Hold::LetGo,
        }
    }

    /// The central window listens (true), or its page is gone (false).
    fn arm(&self, armed: bool) {
        self.armed.store(armed, Ordering::SeqCst);
    }

    /// The windows did what they had to; `stay` when one holds a mail or a remark not sent.
    fn mark_ready(&self, stay: bool) {
        let mut answer = self.answer.lock().unwrap_or_else(|e| e.into_inner());
        *answer = if stay { Answer::Stay } else { Answer::Go };
        self.answered.notify_all();
    }

    /// Waits for the answer, at most `limit`, and ends the hold: what it did.
    fn wait_and_release(&self, limit: Duration) -> Then {
        let answer = {
            let answer = self.answer.lock().unwrap_or_else(|e| e.into_inner());
            let (mut answer, _) = self
                .answered
                .wait_timeout_while(answer, limit, |answer| *answer == Answer::None)
                .unwrap_or_else(|e| e.into_inner());
            // Taken: the next hold waits for an answer of its own.
            std::mem::replace(&mut *answer, Answer::None)
        };
        let mut gate = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        if answer == Answer::Stay {
            *gate = Gate::Open;
            return Then::Stay;
        }
        let then = match *gate {
            Gate::Holding { exit: Some(code) } => Then::Exit(code),
            _ => Then::CloseMain,
        };
        *gate = Gate::Released;
        then
    }
}

/// The central window answers: every window did what it had to before leaving.
/// `stay`: one holds a mail or a remark not sent, and asks its question.
#[tauri::command]
pub fn leave_ready(state: tauri::State<'_, LeaveState>, stay: Option<bool>) {
    state.mark_ready(stay.unwrap_or(false));
}

/// The central window listens for `plainva-leaving` (true) — or no more.
#[tauri::command]
pub fn leave_armed<R: Runtime>(window: tauri::WebviewWindow<R>, state: tauri::State<'_, LeaveState>, armed: bool) {
    if window.label() == MAIN {
        state.arm(armed);
    }
}

/// A page starts loading in the central window: its listener is gone with the old one.
pub fn page_loading<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if label == MAIN {
        app.state::<LeaveState>().arm(false);
    }
}

fn start<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit_to(MAIN, "plainva-leaving", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        let then = handle.state::<LeaveState>().wait_and_release(LEAVE_WAIT);
        match then {
            Then::Exit(code) => handle.exit(code),
            Then::CloseMain => {
                if let Some(main) = handle.get_webview_window(MAIN) {
                    let _ = main.destroy();
                }
            }
            Then::Stay => {}
        }
    });
}

/// The central window's close is asked for (and not hidden into the tray).
/// True when the close is held; it then happens once the windows answered.
pub fn hold_main_close<R: Runtime>(window: &tauri::Window<R>) -> bool {
    if window.label() != MAIN {
        return false;
    }
    let app = window.app_handle();
    match app.state::<LeaveState>().hold_close() {
        Hold::LetGo => false,
        Hold::Joined => true,
        Hold::Start => {
            start(app);
            true
        }
    }
}

/// The app is asked to exit. True when the exit is held; it then happens once
/// the windows answered. Nothing is held once the central window is gone, or
/// while it does not listen: there is nobody to answer.
pub fn hold_exit<R: Runtime>(app: &AppHandle<R>, code: Option<i32>) -> bool {
    if app.get_webview_window(MAIN).is_none() {
        return false;
    }
    match app.state::<LeaveState>().hold_exit(code.unwrap_or(0)) {
        Hold::LetGo => false,
        Hold::Joined => true,
        Hold::Start => {
            start(app);
            true
        }
    }
}

/// The id of the macOS menu's "Quit".
#[cfg(target_os = "macos")]
const QUIT_ID: &str = "plainva-quit";

/// macOS: the default menu, with its "Quit" asking for the exit the hold sees.
///
/// The default menu's "Quit" (and so Cmd+Q) is the system's `terminate:`,
/// which never reaches Tauri's exit request. Everything else of that menu
/// stays; "Quit" keeps its words, its place and its shortcut.
#[cfg(target_os = "macos")]
pub fn install_quit_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        let items = app_menu.items()?;
        let quit_at = items.iter().rposition(|item| match item {
            MenuItemKind::Predefined(p) => p.text().map(|t| t.starts_with("Quit")).unwrap_or(false),
            _ => false,
        });
        if let Some(at) = quit_at {
            let text = match &items[at] {
                MenuItemKind::Predefined(p) => p.text()?,
                _ => unreachable!(),
            };
            app_menu.remove_at(at)?;
            let quit = MenuItem::with_id(app, QUIT_ID, text, true, Some("CmdOrCtrl+Q"))?;
            app_menu.insert(&quit, at)?;
        }
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == QUIT_ID {
            app.exit(0);
        }
    });
    Ok(())
}

/// Linux and macOS: a termination signal (the session ending on Linux, `kill`)
/// asks for the exit the hold sees, instead of ending the process on the spot.
#[cfg(unix)]
pub fn watch_termination<R: Runtime>(app: &AppHandle<R>) {
    use tokio::signal::unix::{signal, SignalKind};
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(mut term) = signal(SignalKind::terminate()) else {
            return;
        };
        if term.recv().await.is_some() {
            handle.exit(0);
        }
    });
}

#[cfg(test)]
mod tests {
    //! The state machine around the hold; the window and the app handle are
    //! Tauri's and need a running app.

    use super::{Hold, LeaveState, Then};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    fn armed() -> LeaveState {
        let state = LeaveState::default();
        state.arm(true);
        state
    }

    #[test]
    fn a_close_is_held_once_and_then_goes_through() {
        let state = armed();
        assert_eq!(state.hold_close(), Hold::Start);
        assert_eq!(state.hold_close(), Hold::Joined);
        state.mark_ready(false);
        assert_eq!(state.wait_and_release(Duration::from_secs(5)), Then::CloseMain);
        assert_eq!(state.hold_close(), Hold::LetGo);
        assert_eq!(state.hold_exit(0), Hold::LetGo);
    }

    #[test]
    fn an_exit_asked_for_during_a_held_close_is_carried_out() {
        let state = armed();
        assert_eq!(state.hold_close(), Hold::Start);
        assert_eq!(state.hold_exit(0), Hold::Joined);
        state.mark_ready(false);
        assert_eq!(state.wait_and_release(Duration::from_secs(5)), Then::Exit(0));
    }

    #[test]
    fn a_window_that_never_answers_does_not_keep_the_app_open() {
        let state = armed();
        assert_eq!(state.hold_exit(3), Hold::Start);
        let started = Instant::now();
        assert_eq!(state.wait_and_release(Duration::from_millis(50)), Then::Exit(3));
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_eq!(state.hold_exit(3), Hold::LetGo);
    }

    #[test]
    fn the_answer_ends_the_wait_before_the_deadline() {
        let state = Arc::new(armed());
        assert_eq!(state.hold_close(), Hold::Start);
        let answering = Arc::clone(&state);
        let answer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            answering.mark_ready(false);
        });
        let started = Instant::now();
        assert_eq!(state.wait_and_release(Duration::from_secs(30)), Then::CloseMain);
        assert!(started.elapsed() < Duration::from_secs(10));
        answer.join().unwrap();
    }

    #[test]
    fn nothing_is_held_while_the_central_window_does_not_listen() {
        let state = LeaveState::default();
        assert_eq!(state.hold_close(), Hold::LetGo);
        assert_eq!(state.hold_exit(0), Hold::LetGo);
        state.arm(true);
        state.arm(false);
        assert_eq!(state.hold_close(), Hold::LetGo);
    }

    #[test]
    fn a_window_holding_a_mail_keeps_the_app_open_and_the_next_quit_is_held_again() {
        let state = armed();
        assert_eq!(state.hold_exit(0), Hold::Start);
        state.mark_ready(true);
        assert_eq!(state.wait_and_release(Duration::from_secs(5)), Then::Stay);
        assert_eq!(state.hold_exit(0), Hold::Start);
        state.mark_ready(false);
        assert_eq!(state.wait_and_release(Duration::from_secs(5)), Then::Exit(0));
    }
}
