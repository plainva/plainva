//! What kind of desktop session this is — asked by the global quick capture
//! (system-wide shortcut, opt-in). A Wayland compositor hands applications no
//! system-wide key: the registration would succeed through XWayland and then
//! never fire while a native window has the focus. The setting says so instead
//! of offering a switch that does nothing.

/// A Wayland session, judged from what the session itself announces.
fn is_wayland(session_type: Option<&str>, wayland_display: bool) -> bool {
    match session_type {
        Some(kind) if kind.eq_ignore_ascii_case("wayland") => true,
        // An explicit X11 (or tty) session wins over a stray WAYLAND_DISPLAY.
        Some(kind) if !kind.is_empty() => false,
        _ => wayland_display,
    }
}

/// `"wayland"` under a Wayland session on Linux, `"other"` everywhere else.
#[tauri::command]
pub fn desktop_session_kind() -> &'static str {
    let wayland = cfg!(target_os = "linux")
        && is_wayland(
            std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
            std::env::var_os("WAYLAND_DISPLAY").is_some(),
        );
    if wayland {
        "wayland"
    } else {
        "other"
    }
}

#[cfg(test)]
mod tests {
    use super::is_wayland;

    #[test]
    fn a_wayland_session_is_recognised_in_any_spelling() {
        assert!(is_wayland(Some("wayland"), false));
        assert!(is_wayland(Some("Wayland"), true));
    }

    #[test]
    fn an_x11_session_stays_x11_even_with_a_wayland_socket_around() {
        assert!(!is_wayland(Some("x11"), true));
        assert!(!is_wayland(Some("tty"), false));
    }

    #[test]
    fn without_a_session_type_the_socket_decides() {
        assert!(is_wayland(None, true));
        assert!(is_wayland(Some(""), true));
        assert!(!is_wayland(None, false));
    }
}
