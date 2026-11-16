//! The way out of the app: what the windows still buffer is written first (A7).
//!
//! An editor saves a second after the last keystroke, and the draft journal
//! snapshots its buffer at most every 400 ms. Until 2026-11-16 the only thing
//! that wrote the last snapshot when the app went was the page's `pagehide`,
//! which nothing waits for: closing the central window, Cmd+Q or "Quit" in the
//! tray right after typing could lose up to an interval of it — in the note and
//! in the journal.
//!
//! So the native side holds the step: the central window's close (when it is not
//! hidden into the tray, see `tray.rs`) and every exit request. It tells the
//! central window (`plainva-leaving`); that writes its own buffer and has every
//! other window write theirs (`src/services/leaveFlush.ts`), then says it is
//! done (`leave_ready`). The step goes on after that answer, or after
//! `LEAVE_WAIT` without one: a page that hung never keeps the app open.
//!
//! An exit that arrives while a close is held is not lost: it is what happens
//! once the hold ends. A restart (the updater) cannot be held — Tauri ignores
//! `prevent_exit` for it — so the updater flushes before it installs.

use std::sync::{Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The longest the way out waits for the windows: a little past their own bound.
pub const LEAVE_WAIT: Duration = Duration::from_millis(3_000);

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
}

pub struct LeaveState {
    gate: Mutex<Gate>,
    ready: Mutex<bool>,
    answered: Condvar,
}

impl Default for LeaveState {
    fn default() -> Self {
        Self {
            gate: Mutex::new(Gate::Open),
            ready: Mutex::new(false),
            answered: Condvar::new(),
        }
    }
}

impl LeaveState {
    /// The central window's close is asked for.
    fn hold_close(&self) -> Hold {
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

    /// The windows wrote what they buffered.
    fn mark_ready(&self) {
        let mut ready = self.ready.lock().unwrap_or_else(|e| e.into_inner());
        *ready = true;
        self.answered.notify_all();
    }

    /// Waits for the answer, at most `limit`, and ends the hold: what it did.
    fn wait_and_release(&self, limit: Duration) -> Then {
        {
            let ready = self.ready.lock().unwrap_or_else(|e| e.into_inner());
            let (mut ready, _) = self
                .answered
                .wait_timeout_while(ready, limit, |ready| !*ready)
                .unwrap_or_else(|e| e.into_inner());
            // Taken: the next hold waits for an answer of its own.
            *ready = false;
        }
        let mut gate = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        let then = match *gate {
            Gate::Holding { exit: Some(code) } => Then::Exit(code),
            _ => Then::CloseMain,
        };
        *gate = Gate::Released;
        then
    }
}

/// The central window answers: its own drafts and the other windows' are written.
#[tauri::command]
pub fn leave_ready(state: tauri::State<'_, LeaveState>) {
    state.mark_ready();
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
/// the windows answered. Nothing is held once the central window is gone:
/// there is nobody left to answer.
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

#[cfg(test)]
mod tests {
    //! The state machine around the hold; the window and the app handle are
    //! Tauri's and need a running app.

    use super::{Hold, LeaveState, Then};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[test]
    fn a_close_is_held_once_and_then_goes_through() {
        let state = LeaveState::default();
        assert_eq!(state.hold_close(), Hold::Start);
        assert_eq!(state.hold_close(), Hold::Joined);
        state.mark_ready();
        assert_eq!(
            state.wait_and_release(Duration::from_secs(5)),
            Then::CloseMain
        );
        assert_eq!(state.hold_close(), Hold::LetGo);
        assert_eq!(state.hold_exit(0), Hold::LetGo);
    }

    #[test]
    fn an_exit_asked_for_during_a_held_close_is_carried_out() {
        let state = LeaveState::default();
        assert_eq!(state.hold_close(), Hold::Start);
        assert_eq!(state.hold_exit(0), Hold::Joined);
        state.mark_ready();
        assert_eq!(
            state.wait_and_release(Duration::from_secs(5)),
            Then::Exit(0)
        );
    }

    #[test]
    fn a_window_that_never_answers_does_not_keep_the_app_open() {
        let state = LeaveState::default();
        assert_eq!(state.hold_exit(3), Hold::Start);
        let started = Instant::now();
        assert_eq!(
            state.wait_and_release(Duration::from_millis(50)),
            Then::Exit(3)
        );
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_eq!(state.hold_exit(3), Hold::LetGo);
    }

    #[test]
    fn the_answer_ends_the_wait_before_the_deadline() {
        let state = Arc::new(LeaveState::default());
        assert_eq!(state.hold_close(), Hold::Start);
        let answering = Arc::clone(&state);
        let answer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            answering.mark_ready();
        });
        let started = Instant::now();
        assert_eq!(
            state.wait_and_release(Duration::from_secs(30)),
            Then::CloseMain
        );
        assert!(started.elapsed() < Duration::from_secs(10));
        answer.join().unwrap();
    }
}
