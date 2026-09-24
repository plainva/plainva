//! Which installation is this? The release app, the isolated dev build and the
//! Labs build of a feature branch run side by side on one machine, each with
//! its own Tauri identifier (`tauri.conf.json`, `tauri.dev.conf.json`,
//! `tauri.labs.conf.json`). The identifier already separates app data, the
//! WebView profile and the single-instance lock. Two things did NOT follow it
//! and are derived here instead:
//!
//! - the OS keychain service: it was a fixed `"plainva"`, so every installation
//!   opening the same vault read and rotated the same sync and OAuth tokens
//!   without a cross-process lock — against ADR 0015 (installation-local OAuth);
//! - the window title, so the three are never confused on screen.

/// The identifier of the published desktop app (`tauri.conf.json`).
pub const RELEASE_IDENTIFIER: &str = "com.plainva.desktop";

/// The keychain service name for an installation. The release app keeps the
/// historic `"plainva"`, so no existing entry is lost on update; every other
/// identity gets its own namespace and therefore signs in on its own — exactly
/// like a second device.
pub fn keychain_service_for(identifier: &str) -> String {
    if identifier == RELEASE_IDENTIFIER {
        "plainva".to_string()
    } else {
        format!("plainva:{identifier}")
    }
}

/// The window title of a non-release installation, `None` for the release app.
pub fn window_title_for(identifier: &str) -> Option<&'static str> {
    if identifier.ends_with(".dev") {
        Some("Plainva (Dev)")
    } else if identifier.ends_with(".labs") {
        Some("Plainva Labs")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_release_app_keeps_its_keychain_entries() {
        assert_eq!(keychain_service_for("com.plainva.desktop"), "plainva");
    }

    #[test]
    fn every_other_installation_gets_its_own_keychain_namespace() {
        assert_eq!(keychain_service_for("com.plainva.desktop.dev"), "plainva:com.plainva.desktop.dev");
        assert_eq!(keychain_service_for("com.plainva.desktop.labs"), "plainva:com.plainva.desktop.labs");
        assert_ne!(
            keychain_service_for("com.plainva.desktop.dev"),
            keychain_service_for("com.plainva.desktop.labs")
        );
    }

    #[test]
    fn only_dev_and_labs_windows_are_relabelled() {
        assert_eq!(window_title_for("com.plainva.desktop"), None);
        assert_eq!(window_title_for("com.plainva.desktop.dev"), Some("Plainva (Dev)"));
        assert_eq!(window_title_for("com.plainva.desktop.labs"), Some("Plainva Labs"));
    }
}
