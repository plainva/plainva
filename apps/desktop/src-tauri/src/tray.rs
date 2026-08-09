//! Running in the background: the tray icon and the window's close behaviour.
//!
//! Reminders on the desktop only fire while Plainva is running (S11b). This is
//! what lets a person keep it running without keeping a window in the way — and
//! it is the one feature that can strand someone: hide the window with nothing
//! to bring it back, and the app is a process they can only end in a task
//! manager.
//!
//! The plan proposed gating the switch on `TrayIconBuilder::build()` succeeding.
//! Measuring says that is not enough on Linux: `tray-icon` 0.24 builds on
//! `libappindicator`, which registers the item over D-Bus whether or not any
//! host is listening. The build succeeds; nothing appears. So the gate here is
//! not a prediction — the caller turns the icon on, ASKS whether it can be seen,
//! and only then keeps the setting. Proof by observation, on every platform.
//!
//! The safety property that follows: `prevent_close` applies only while a tray
//! icon is actually registered. No icon, no captured close — ever.

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager, Runtime,
};

#[derive(Default)]
pub struct TrayState {
    icon: Mutex<Option<TrayIcon>>,
    /// The "next appointment" entry, kept so its text can be refreshed without
    /// rebuilding the whole menu.
    next_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

/// Brings the main window back and focuses it.
fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Whether a tray icon is registered right now. The window's close handler asks
/// this, so the answer is the single source of truth for "may closing hide?".
pub fn tray_active<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.state::<TrayState>()
        .icon
        .lock()
        .map(|i| i.is_some())
        .unwrap_or(false)
}

/// Builds the tray icon with a localized menu. Labels come from the caller so
/// they follow the app's language rather than a second, untranslated copy here.
#[tauri::command]
pub fn tray_enable(
    app: AppHandle,
    open_label: String,
    next_label: String,
    quit_label: String,
) -> Result<(), String> {
    let state = app.state::<TrayState>();
    {
        let guard = state.icon.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(()); // already up — enabling twice is a no-op, not an error
        }
    }

    let open = MenuItem::with_id(&app, "open", &open_label, true, None::<&str>).map_err(|e| e.to_string())?;
    // Disabled on purpose: it reports, it does not act. Clicking the appointment
    // itself belongs in the calendar, which "open" leads to.
    let next = MenuItem::with_id(&app, "next", &next_label, false, None::<&str>).map_err(|e| e.to_string())?;
    let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(&app, "quit", &quit_label, true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&open, &next, &sep, &quit]).map_err(|e| e.to_string())?;

    let icon = TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().ok_or("no app icon")?)
        .tooltip("Plainva")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            // Ending the app from the tray must really end it — a "quit" that
            // only hides is the trap this whole file exists to avoid.
            "quit" => app.exit(0),
            _ => {}
        })
        .build(&app)
        .map_err(|e| e.to_string())?;

    *state.icon.lock().map_err(|e| e.to_string())? = Some(icon);
    *state.next_item.lock().map_err(|e| e.to_string())? = Some(next);
    Ok(())
}

/// Removes the tray icon. Closing the window quits again from this moment on.
#[tauri::command]
pub fn tray_disable(app: AppHandle) -> Result<(), String> {
    let state = app.state::<TrayState>();
    *state.next_item.lock().map_err(|e| e.to_string())? = None;
    let icon = state.icon.lock().map_err(|e| e.to_string())?.take();
    drop(icon); // dropping the handle removes the icon
    Ok(())
}

/// Updates the "next appointment" line in the tray menu.
#[tauri::command]
pub fn tray_set_next(app: AppHandle, text: String) -> Result<(), String> {
    if let Some(item) = app.state::<TrayState>().next_item.lock().map_err(|e| e.to_string())?.as_ref() {
        item.set_text(text).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hides the window instead of quitting, but ONLY while a tray icon is
/// registered. Returns true when the close was captured.
pub fn hide_instead_of_quit<R: Runtime>(window: &tauri::Window<R>) -> bool {
    let app = window.app_handle();
    if !tray_active(app) {
        return false;
    }
    let _ = window.hide();
    let _ = app.emit("plainva-hidden-to-tray", ());
    true
}

#[cfg(test)]
mod tests {
    //! The close handler asks `tray_active`, and `tray_active` reads the icon —
    //! not a setting, not a remembered flag. That indirection IS the safety
    //! property: a setting can say "run in the background" while no icon exists
    //! (the environment changed between sessions), and in that state closing
    //! must still quit.
    //!
    //! A `TrayIcon` cannot be constructed without a running app, so what is
    //! pinned here is the state machine around it: empty means inactive, and
    //! disabling empties it.

    use super::TrayState;

    #[test]
    fn a_fresh_state_is_inactive() {
        let state = TrayState::default();
        assert!(state.icon.lock().unwrap().is_none(), "no icon before one is built");
    }

    #[test]
    fn taking_the_icon_out_leaves_the_state_inactive() {
        let state = TrayState::default();
        // Stands in for `tray_disable`, which take()s the icon and drops it.
        let taken = state.icon.lock().unwrap().take();
        assert!(taken.is_none());
        assert!(state.icon.lock().unwrap().is_none(), "disabling must leave nothing behind");
    }
}
