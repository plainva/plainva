//! The main window comes back where it was (wish from issue #135, 2026-10-19).
//!
//! The window opened at 1280 x 832 in the middle of the primary screen on every
//! start, whatever its size and place had been. Now its last place, its size
//! and whether it was maximized are kept in `window-state.json` in the app's
//! config directory (each identity - release, dev, Labs - has its own) and set
//! again in `setup`. The window exists by then and may show for a moment at
//! its configured place before it moves.
//!
//! What is kept is the window's NORMAL place: while it is maximized only the
//! flag changes, so un-maximizing after a restart lands where it was before
//! maximizing. A minimized window reports nonsense coordinates (-32000 on
//! Windows) and is not recorded. A place that lies on no screen any more - a
//! second monitor unplugged - is not restored; the window opens centred as
//! before. Only the main window: the auxiliary windows keep their bounds in
//! their own record (services/windowManager.ts) and are reopened from there.
//!
//! Writing: every move or resize updates the bounds in memory; a writer thread
//! puts the newest of them on disk at most every half second, and a close
//! request writes at once. All in physical pixels, which is what the monitors
//! report and what `set_position` and `set_size` take.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, Window, WindowEvent};

pub const MAIN_LABEL: &str = "main";
const FILE_NAME: &str = "window-state.json";
const WRITE_DELAY: Duration = Duration::from_millis(500);
/// How much of the window's top strip has to lie on a screen to restore it.
const MIN_VISIBLE_WIDTH: i64 = 100;
const TITLE_STRIP: i64 = 40;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

/// A screen's rectangle in physical pixels.
#[derive(Clone, Copy, Debug)]
pub struct ScreenRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
pub struct WindowStateStore {
    latest: Mutex<Option<Bounds>>,
    writer_pending: Mutex<bool>,
    /// One writer at a time: the delayed writer and a close request share the
    /// temp file.
    writing: Mutex<()>,
}

/// Whether a window with these bounds can be grabbed on these screens: a
/// stretch of its top strip, where the title bar is, lies on one of them.
pub fn reachable(bounds: &Bounds, screens: &[ScreenRect]) -> bool {
    if bounds.width == 0 || bounds.height == 0 {
        return false;
    }
    let left = bounds.x as i64;
    let right = left + bounds.width as i64;
    let top = bounds.y as i64;
    screens.iter().any(|s| {
        let s_left = s.x as i64;
        let s_right = s_left + s.width as i64;
        let s_top = s.y as i64;
        let s_bottom = s_top + s.height as i64;
        let overlap = right.min(s_right) - left.max(s_left);
        // A maximized window on Windows reaches a few pixels past the edge.
        overlap >= MIN_VISIBLE_WIDTH && top >= s_top - 16 && top + TITLE_STRIP <= s_bottom
    })
}

/// The next record after a move or resize: the normal place while the window
/// is normal, only the flag while it is maximized.
pub fn next_bounds(previous: Option<Bounds>, current: Bounds) -> Bounds {
    match (previous, current.maximized) {
        (Some(prev), true) => Bounds { maximized: true, ..prev },
        _ => current,
    }
}

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE_NAME))
}

fn read_bounds<R: Runtime>(app: &AppHandle<R>) -> Option<Bounds> {
    let text = std::fs::read_to_string(state_path(app)?).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_bounds<R: Runtime>(app: &AppHandle<R>, bounds: &Bounds) {
    let Some(path) = state_path(app) else { return };
    let Some(store) = app.try_state::<WindowStateStore>() else { return };
    let _one_writer = store.writing.lock().unwrap();
    let Ok(text) = serde_json::to_string(bounds) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // Written beside and renamed over, so a crash mid-write leaves the old file.
    let temp = path.with_extension("json.tmp");
    if std::fs::write(&temp, text).is_ok() {
        let _ = std::fs::rename(&temp, &path);
    }
}

/// Puts the main window where it was. Called once from `setup`.
pub fn restore<R: Runtime>(app: &AppHandle<R>) {
    let Some(win) = app.get_webview_window(MAIN_LABEL) else { return };
    let Some(bounds) = read_bounds(app) else { return };
    let screens: Vec<ScreenRect> = win
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| ScreenRect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect();
    if !reachable(&bounds, &screens) {
        return;
    }
    // Place first, then size: moving onto a screen with another scale makes
    // the system rescale the window, which would distort a size set before.
    let _ = win.set_position(PhysicalPosition::new(bounds.x, bounds.y));
    let _ = win.set_size(PhysicalSize::new(bounds.width, bounds.height));
    if bounds.maximized {
        let _ = win.maximize();
    }
    if let Some(store) = app.try_state::<WindowStateStore>() {
        *store.latest.lock().unwrap() = Some(bounds);
    }
}

fn current_bounds<R: Runtime>(window: &Window<R>) -> Option<Bounds> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let pos = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(Bounds { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized })
}

/// Follows the main window's moves, resizes and close requests.
pub fn track<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != MAIN_LABEL {
        return;
    }
    let app = window.app_handle();
    let Some(store) = app.try_state::<WindowStateStore>() else { return };
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let Some(current) = current_bounds(window) else { return };
            {
                let mut latest = store.latest.lock().unwrap();
                *latest = Some(next_bounds(*latest, current));
            }
            let mut pending = store.writer_pending.lock().unwrap();
            if *pending {
                return;
            }
            *pending = true;
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(WRITE_DELAY);
                let Some(store) = app.try_state::<WindowStateStore>() else { return };
                *store.writer_pending.lock().unwrap() = false;
                let latest = *store.latest.lock().unwrap();
                if let Some(bounds) = latest {
                    write_bounds(&app, &bounds);
                }
            });
        }
        WindowEvent::CloseRequested { .. } => {
            let latest = *store.latest.lock().unwrap();
            if let Some(bounds) = latest {
                write_bounds(app, &bounds);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL_HD: ScreenRect = ScreenRect { x: 0, y: 0, width: 1920, height: 1080 };
    const RIGHT: ScreenRect = ScreenRect { x: 1920, y: 0, width: 2560, height: 1440 };

    fn at(x: i32, y: i32) -> Bounds {
        Bounds { x, y, width: 1200, height: 800, maximized: false }
    }

    #[test]
    fn a_place_on_a_screen_is_restored() {
        assert!(reachable(&at(100, 80), &[FULL_HD]));
        assert!(reachable(&at(2200, 100), &[FULL_HD, RIGHT]));
    }

    #[test]
    fn a_place_on_an_unplugged_screen_is_not() {
        assert!(!reachable(&at(2200, 100), &[FULL_HD]));
    }

    #[test]
    fn the_title_strip_has_to_be_on_the_screen() {
        // Pushed up past the top edge: the title bar cannot be grabbed.
        assert!(!reachable(&at(100, -200), &[FULL_HD]));
        // Pushed down so far that only the title strip's top would show.
        assert!(!reachable(&at(100, 1060), &[FULL_HD]));
        // Mostly off to the left, but 150 px still on the screen.
        assert!(reachable(&at(-1050, 100), &[FULL_HD]));
        assert!(!reachable(&at(-1150, 100), &[FULL_HD]));
    }

    #[test]
    fn an_empty_record_is_not_restored() {
        let empty = Bounds { width: 0, ..at(10, 10) };
        assert!(!reachable(&empty, &[FULL_HD]));
        assert!(!reachable(&at(10, 10), &[]));
    }

    #[test]
    fn maximizing_keeps_the_normal_place() {
        let normal = at(300, 200);
        let maximized = Bounds { x: -8, y: -8, width: 1936, height: 1048, maximized: true };
        assert_eq!(next_bounds(Some(normal), maximized), Bounds { maximized: true, ..normal });
        // Restored to normal: the new place is taken as it is.
        let back = at(320, 210);
        assert_eq!(next_bounds(Some(Bounds { maximized: true, ..normal }), back), back);
        // Maximized with nothing recorded yet: the maximized place is all there is.
        assert_eq!(next_bounds(None, maximized), maximized);
    }

    #[test]
    fn the_record_reads_back() {
        let b = Bounds { x: -5, y: 12, width: 1400, height: 900, maximized: true };
        let text = serde_json::to_string(&b).unwrap();
        assert_eq!(serde_json::from_str::<Bounds>(&text).unwrap(), b);
    }
}
