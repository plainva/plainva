//! Note links from the operating system (F2, ADR 0037): an address
//! `plainva://open?vault=…&path=…` that a browser, a calendar or another app
//! hands to the system, and the system to Plainva.
//!
//! How it arrives, per platform, with no plugin of its own:
//!
//! - Windows and Linux start the program with the address as an argument —
//!   the installers register the scheme from `plugins.deep-link` in
//!   `tauri.conf.json` (NSIS/MSI registry keys, the `.desktop` file's
//!   `x-scheme-handler`). A first launch finds it in its own arguments; a
//!   launch while Plainva runs is turned into the single-instance callback of
//!   the RUNNING process (src/lib.rs), so the address goes to the window that
//!   is already open, never to a second process.
//! - macOS delivers it to the running process as `RunEvent::Opened`, also on
//!   a launch the address caused (the bundle's `CFBundleURLTypes`, written by
//!   the bundler from the same configuration).
//!
//! Rust does not READ the address: it only picks out the arguments that carry
//! one of Plainva's schemes, keeps them (a cold start delivers before the
//! window listens) and tells the central window, which takes them with
//! `note_links_take` and judges them in `@plainva/core` (`parseNoteLinkUrl`),
//! the one reader of the format. Nothing here opens, runs or writes anything.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The schemes Plainva answers (core `NOTE_LINK_SCHEMES`). The release app
/// registers `plainva`; the isolated dev build and the Labs build register
/// their own, so they never take the release app's links.
const SCHEMES: [&str; 3] = ["plainva", "plainva-dev", "plainva-labs"];

/// Longer than this, an argument is not an address Plainva reads (core
/// `NOTE_LINK_MAX_LENGTH`).
const MAX_LENGTH: usize = 4096;

/// More waiting than this is not a person clicking links; the oldest go.
const MAX_WAITING: usize = 8;

/// The event the central window listens to. It carries nothing: the window
/// takes the waiting addresses itself, so none is handled twice.
pub const ARRIVED_EVENT: &str = "plainva-note-link";

#[derive(Default)]
pub struct NoteLinks {
    waiting: Mutex<Vec<String>>,
}

/// The arguments that are note links. Anything else — the program path, a
/// flag, a file — is not looked at.
pub fn note_link_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .map(|arg| arg.trim().to_string())
        .filter(|arg| is_note_link(arg))
        .collect()
}

fn is_note_link(arg: &str) -> bool {
    if arg.is_empty() || arg.len() > MAX_LENGTH || arg.chars().any(char::is_control) {
        return false;
    }
    let Some((scheme, _)) = arg.split_once(':') else {
        return false;
    };
    SCHEMES.iter().any(|known| scheme.eq_ignore_ascii_case(known))
}

/// Keeps the addresses and tells the central window. An address that is
/// already waiting is not kept twice, and when nothing new was kept nobody is
/// told: a flood of one link is one link. The window is NOT brought forward
/// here — the central window does that itself when it opens a note or asks
/// a question for one, so a link it drops (a question is already open, the
/// address is refused) never takes the focus (F2 review).
pub fn arrive<R: Runtime>(app: &AppHandle<R>, urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }
    let mut added = false;
    if let Some(state) = app.try_state::<NoteLinks>() {
        let mut waiting = state.waiting.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        added = keep(&mut waiting, urls);
    }
    if added {
        let _ = app.emit_to("main", ARRIVED_EVENT, ());
    }
}

/// Adds what is not waiting yet, keeps the newest `MAX_WAITING`; true when something was added.
fn keep(waiting: &mut Vec<String>, urls: Vec<String>) -> bool {
    let mut added = false;
    for url in urls {
        if !waiting.contains(&url) {
            waiting.push(url);
            added = true;
        }
    }
    let excess = waiting.len().saturating_sub(MAX_WAITING);
    waiting.drain(..excess);
    added
}

/// The addresses that arrived since the last call, oldest first.
#[tauri::command]
pub fn note_links_take(state: tauri::State<'_, NoteLinks>) -> Vec<String> {
    let mut waiting = state.waiting.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    std::mem::take(&mut *waiting)
}

/// A note link clicked in an auxiliary window: the central window opens it,
/// as it opens one from the system (it knows the vaults and the tabs).
#[tauri::command]
pub fn note_link_forward<R: Runtime>(app: AppHandle<R>, url: String) {
    arrive(&app, note_link_args([url]));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    #[test]
    fn picks_note_links_out_of_the_arguments() {
        let args = strings(&[
            "C:\\Program Files\\Plainva\\plainva.exe",
            "--flag",
            "plainva://open?path=a.md",
            "PLAINVA-LABS://open?path=b.md",
            "notes.md",
        ]);
        assert_eq!(note_link_args(args), strings(&["plainva://open?path=a.md", "PLAINVA-LABS://open?path=b.md"]));
    }

    #[test]
    fn leaves_other_schemes_and_hostile_values_alone() {
        let long = format!("plainva://open?path={}", "a".repeat(MAX_LENGTH));
        let args = strings(&[
            "https://plainva.com",
            "plainvax://open?path=a.md",
            "javascript:alert(1)",
            "plainva",
            "plainva://open?path=a\n.md",
            "plainva://open?path=a\u{0}.md",
            &long,
            "",
        ]);
        assert!(note_link_args(args).is_empty());
    }

    #[test]
    fn keeps_one_of_each_and_only_the_newest() {
        let mut waiting = Vec::new();
        let burst: Vec<String> = (0..20).map(|_| "plainva://open?path=a.md".to_string()).collect();
        assert!(keep(&mut waiting, burst));
        assert_eq!(waiting, strings(&["plainva://open?path=a.md"]));
        assert!(!keep(&mut waiting, strings(&["plainva://open?path=a.md"])), "nothing new, nobody told");
        let many: Vec<String> = (0..20).map(|i| format!("plainva://open?path={i}.md")).collect();
        assert!(keep(&mut waiting, many));
        assert_eq!(waiting.len(), MAX_WAITING);
        assert_eq!(waiting.last().unwrap(), "plainva://open?path=19.md");
    }

    #[test]
    fn trims_what_a_shell_wraps_around_an_argument() {
        assert_eq!(note_link_args(strings(&["  plainva://open?path=a.md "])), strings(&["plainva://open?path=a.md"]));
    }
}
