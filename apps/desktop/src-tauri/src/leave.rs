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
//! A termination signal (`kill`, `systemctl stop`, the session ending on
//! Linux) is held as well, but asks nobody: the windows write what they hold
//! and the app goes, within the same deadline. A second signal ends the
//! process at once.
//!
//! When the deadline runs out before the central window answered, or a window
//! was not done in time and the app goes anyway (`leave_ready` with `cut`, the
//! update's restart after its limit, `leave_mark_cut`), the app says so at the
//! next start (`leave_was_cut`). The central window puts the mark down as the
//! hold begins while something of the person's is not on disk yet, and the
//! hold takes it back when everything was done or the app stays: so an end
//! harder than the deadline (the second signal) is said as well. A sync pull
//! that runs on is no cut — the next start pulls again.
//!
//! An exit that arrives while a close is held is not lost: it is what happens
//! once the hold ends. What is not held: a restart (the updater — Tauri ignores
//! `prevent_exit` for it, so the updater writes first, at most 5 s, then
//! installs); and the ways out that never reach Tauri's exit request. On macOS
//! "Quit" in the Dock, logging out and shutting down are the system's
//! `terminate:`; tao 0.37 gives its app delegate no
//! `applicationShouldTerminate:` (the one hook that could defer it) and only
//! reports `applicationWillTerminate:`, after which the process ends. On
//! Windows tao leaves `WM_QUERYENDSESSION` unanswered and calls
//! `std::process::exit` on `WM_ENDSESSION`. Holding those needs a change in
//! tao. There what the journal had not yet written is lost: for a note up to
//! 1 MB at most 400 ms of typing (`packages/ui/src/lib/draftJournal.ts`).

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
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
    /// The answer was "stay", but a termination signal came meanwhile: the
    /// windows are asked again, to write what they hold without a question.
    AskAgain,
}

/// How a hold ended: what it does, and whether the deadline cut it short.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ended {
    pub then: Then,
    pub cut: bool,
}

/// The central window's answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Answer {
    None,
    /// Go on; `cut` when a window was not done in time.
    Go { cut: bool },
    Stay,
}

pub struct LeaveState {
    gate: Mutex<Gate>,
    answer: Mutex<Answer>,
    answered: Condvar,
    armed: AtomicBool,
    /// Termination signals received; from the first on, nobody is asked.
    signals: AtomicU32,
}

impl Default for LeaveState {
    fn default() -> Self {
        Self {
            gate: Mutex::new(Gate::Open),
            answer: Mutex::new(Answer::None),
            answered: Condvar::new(),
            armed: AtomicBool::new(false),
            signals: AtomicU32::new(0),
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

    /// A termination signal arrived; how many so far, this one included.
    fn note_signal(&self) -> u32 {
        self.signals.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// False once a termination signal arrived: the windows write, nobody is asked.
    fn may_stay(&self) -> bool {
        self.signals.load(Ordering::SeqCst) == 0
    }

    /// The windows did what they had to; `stay` when one holds a mail or a remark
    /// not sent; `cut` when one was not done in time and the app goes anyway.
    fn mark_ready(&self, stay: bool, cut: bool) {
        let mut answer = self.answer.lock().unwrap_or_else(|e| e.into_inner());
        *answer = if stay { Answer::Stay } else { Answer::Go { cut } };
        self.answered.notify_all();
    }

    /// Waits for the answer, at most `limit`, and ends the hold: what it did.
    fn wait_and_release(&self, limit: Duration) -> Ended {
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
            if !self.may_stay() {
                return Ended { then: Then::AskAgain, cut: false };
            }
            *gate = Gate::Open;
            return Ended { then: Then::Stay, cut: false };
        }
        let then = match *gate {
            Gate::Holding { exit: Some(code) } => Then::Exit(code),
            _ => Then::CloseMain,
        };
        *gate = Gate::Released;
        let cut = match answer {
            Answer::None => true,
            Answer::Go { cut } => cut,
            Answer::Stay => false,
        };
        Ended { then, cut }
    }
}

/// The central window answers: every window did what it had to before leaving.
/// `stay`: one holds a mail or a remark not sent, and asks its question.
/// `cut`: one was not done in time (its writes kept coming, or one hung) — the
/// app goes, and says so at the next start.
#[tauri::command]
pub fn leave_ready(state: tauri::State<'_, LeaveState>, stay: Option<bool>, cut: Option<bool>) {
    state.mark_ready(stay.unwrap_or(false), cut.unwrap_or(false));
}

/// The mark goes down: as a hold begins while something of the person's is
/// not on disk yet (taken back when everything was done, see `start`), and
/// before the update's restart after its limit. An end harder than the
/// deadline — a second termination signal — leaves it standing, and the next
/// start says that Plainva went before every window was done.
#[tauri::command]
pub fn leave_mark_cut<R: Runtime>(app: AppHandle<R>) {
    write_cut_mark(&app);
}

/// The mark comes up again: the update's installation failed and the app
/// stays open, its writes go on landing.
#[tauri::command]
pub fn leave_clear_cut<R: Runtime>(app: AppHandle<R>) {
    clear_cut_mark(&app);
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

/// What the central window is told: whether a window may still ask its question.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Leaving {
    may_stay: bool,
}

/// The file that says the last way out was cut short by the deadline.
const CUT_MARK: &str = "leave-cut";

fn cut_mark<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path().app_local_data_dir().ok().map(|dir| dir.join(CUT_MARK))
}

fn write_cut_mark<R: Runtime>(app: &AppHandle<R>) {
    if let Some(mark) = cut_mark(app) {
        if let Some(dir) = mark.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(mark, b"");
    }
}

fn clear_cut_mark<R: Runtime>(app: &AppHandle<R>) {
    if let Some(mark) = cut_mark(app) {
        let _ = std::fs::remove_file(mark);
    }
}

/// What a hold that ended does with the mark: it stands for a cut, and goes
/// for everything else — every window done, or the app stays open. Read at the
/// start (`leave_was_cut`) before any hold, so the mark is always this run's.
fn keeps_mark(ended: &Ended) -> bool {
    ended.cut
}

fn start<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    std::thread::spawn(move || loop {
        let state = handle.state::<LeaveState>();
        let _ = handle.emit_to(MAIN, "plainva-leaving", Leaving { may_stay: state.may_stay() });
        let ended = state.wait_and_release(LEAVE_WAIT);
        if keeps_mark(&ended) {
            write_cut_mark(&handle);
        } else {
            clear_cut_mark(&handle);
        }
        match ended.then {
            Then::Exit(code) => handle.exit(code),
            Then::CloseMain => {
                if let Some(main) = handle.get_webview_window(MAIN) {
                    let _ = main.destroy();
                }
            }
            Then::Stay => {}
            Then::AskAgain => continue,
        }
        break;
    });
}

/// The central window asks once at its start: did the last way out run past
/// its deadline? The answer is given once.
#[tauri::command]
pub fn leave_was_cut<R: Runtime>(app: AppHandle<R>) -> bool {
    match cut_mark(&app) {
        Some(mark) if mark.exists() => {
            let _ = std::fs::remove_file(mark);
            true
        }
        _ => false,
    }
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

/// Linux and macOS: a termination signal (the session ending on Linux, `kill`,
/// `systemctl stop`) asks for the exit the hold sees, instead of ending the
/// process on the spot. Nobody is asked a question then, and the deadline
/// holds; a second signal ends the process at once.
#[cfg(unix)]
pub fn watch_termination<R: Runtime>(app: &AppHandle<R>) {
    use tokio::signal::unix::{signal, SignalKind};
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(mut term) = signal(SignalKind::terminate()) else {
            return;
        };
        while term.recv().await.is_some() {
            if handle.state::<LeaveState>().note_signal() == 1 {
                handle.exit(0);
            } else {
                handle.cleanup_before_exit();
                std::process::exit(0);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    //! The state machine around the hold; the window and the app handle are
    //! Tauri's and need a running app.

    use super::{keeps_mark, Ended, Hold, LeaveState, Then};
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
        state.mark_ready(false, false);
        assert_eq!(state.wait_and_release(Duration::from_secs(5)).then, Then::CloseMain);
        assert_eq!(state.hold_close(), Hold::LetGo);
        assert_eq!(state.hold_exit(0), Hold::LetGo);
    }

    #[test]
    fn an_exit_asked_for_during_a_held_close_is_carried_out() {
        let state = armed();
        assert_eq!(state.hold_close(), Hold::Start);
        assert_eq!(state.hold_exit(0), Hold::Joined);
        state.mark_ready(false, false);
        assert_eq!(state.wait_and_release(Duration::from_secs(5)).then, Then::Exit(0));
    }

    #[test]
    fn a_window_that_never_answers_does_not_keep_the_app_open() {
        let state = armed();
        assert_eq!(state.hold_exit(3), Hold::Start);
        let started = Instant::now();
        let ended = state.wait_and_release(Duration::from_millis(50));
        assert_eq!(ended.then, Then::Exit(3));
        assert!(ended.cut, "a deadline that ran out is said at the next start");
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
            answering.mark_ready(false, false);
        });
        let started = Instant::now();
        assert_eq!(state.wait_and_release(Duration::from_secs(30)).then, Then::CloseMain);
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
        state.mark_ready(true, false);
        assert_eq!(state.wait_and_release(Duration::from_secs(5)).then, Then::Stay);
        assert_eq!(state.hold_exit(0), Hold::Start);
        state.mark_ready(false, false);
        assert_eq!(state.wait_and_release(Duration::from_secs(5)).then, Then::Exit(0));
    }

    #[test]
    fn a_window_that_was_not_done_in_time_is_a_cut_although_it_answered() {
        let state = armed();
        assert_eq!(state.hold_exit(0), Hold::Start);
        state.mark_ready(false, true);
        let ended = state.wait_and_release(Duration::from_secs(5));
        assert_eq!(ended.then, Then::Exit(0));
        assert!(ended.cut);
    }

    #[test]
    fn the_mark_stands_for_a_cut_and_goes_when_everything_was_done_or_the_app_stays() {
        assert!(keeps_mark(&Ended { then: Then::CloseMain, cut: true }));
        assert!(!keeps_mark(&Ended { then: Then::CloseMain, cut: false }));
        assert!(!keeps_mark(&Ended { then: Then::Exit(0), cut: false }));
        assert!(!keeps_mark(&Ended { then: Then::Stay, cut: false }));
        assert!(!keeps_mark(&Ended { then: Then::AskAgain, cut: false }));
    }

    #[test]
    fn an_answer_in_time_is_no_cut() {
        let state = armed();
        assert_eq!(state.hold_exit(0), Hold::Start);
        state.mark_ready(false, false);
        assert!(!state.wait_and_release(Duration::from_secs(5)).cut);
    }

    #[test]
    fn after_a_termination_signal_nobody_keeps_the_app_open() {
        let state = armed();
        assert_eq!(state.note_signal(), 1);
        assert!(!state.may_stay());
        assert_eq!(state.hold_exit(0), Hold::Start);
        // A window answered "stay" before it heard of the signal: asked again, without a question.
        state.mark_ready(true, false);
        assert_eq!(state.wait_and_release(Duration::from_secs(5)).then, Then::AskAgain);
        state.mark_ready(false, false);
        assert_eq!(state.wait_and_release(Duration::from_secs(5)).then, Then::Exit(0));
        assert_eq!(state.note_signal(), 2, "the second signal is counted, and ends the process at once");
    }

    #[test]
    fn after_a_termination_signal_a_window_that_never_answers_still_lets_the_app_go() {
        let state = armed();
        state.note_signal();
        assert_eq!(state.hold_exit(0), Hold::Start);
        let ended = state.wait_and_release(Duration::from_millis(50));
        assert_eq!(ended.then, Then::Exit(0));
        assert!(ended.cut);
    }
}
