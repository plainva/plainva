//! Spell checking in WebKitGTK (Linux).
//!
//! WebKitGTK checks nothing until the application switches the checker on at
//! the web view's `WebKitWebContext` and names the languages; wry never does
//! either. So the device switch "Spell checking" had no effect on Linux,
//! however `spellcheck="true"` stood on the editor.
//!
//! What may be checked stays the page's decision: the document root says
//! `spellcheck="false"`, and only a writing field whose device switch is on
//! says `true` (`packages/ui/src/lib/spellcheck.ts`). The context's checker
//! follows the same switch (`set_webview_spellcheck`, called by the desktop's
//! services/spellcheck.ts whenever the switch changes) for one reason that
//! WebKitGTK shows and the attribute alone cannot fix: a word marked while the
//! switch was on keeps its red line when the attribute turns `false`. Only
//! switching the context's checker off makes WebKit remove every marker
//! (checked against WebKitGTK 2.52 on 2026-11-16). Off is also the default
//! until the page reports the switch, as it was before.
//!
//! The languages are the system's: the ones GLib reads from `LANGUAGE`,
//! `LC_ALL`, `LC_MESSAGES` and `LANG`, in that order. WebKit hands them to
//! Enchant, which loads a dictionary for each language it finds one for (from
//! the system: hunspell, aspell, …) and skips the others. A language without a
//! dictionary is therefore no error, and with none at all nothing is
//! underlined; nothing crashes. With no usable name in the environment (`C`,
//! `POSIX`) the list is empty, and WebKit falls back to Enchant's default.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Manager, Runtime};
use webkit2gtk::{WebContextExt, WebViewExt};

/// The spell-checking languages for a list of locale names as GLib gives them
/// (`de_DE.UTF-8`, `de_DE`, `de.UTF-8`, `de`, `C`): encoding and modifier cut
/// off, `C` and `POSIX` dropped, each name once, in the order given. The bare
/// language follows its regional form, so `de_DE` is preferred and a system
/// that has only a `de` dictionary still finds it.
pub fn languages_from_locale_names<S: AsRef<str>>(names: &[S]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for name in names {
        let name = name.as_ref();
        let tag = name.split(['.', '@']).next().unwrap_or("").trim();
        if tag.is_empty() || tag == "C" || tag == "POSIX" {
            continue;
        }
        // A locale name is letters, digits, `_` and `-`; anything else is no
        // language a dictionary could be named after.
        if !tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            continue;
        }
        let tag = tag.replace('-', "_");
        if !out.contains(&tag) {
            out.push(tag);
        }
    }
    out
}

/// The system's languages, as GLib reads them from the environment.
fn system_languages() -> Vec<String> {
    let names: Vec<String> = webkit2gtk::glib::language_names().iter().map(|n| n.to_string()).collect();
    languages_from_locale_names(&names)
}

/// The device switch as the page last reported it; off until it does.
static SWITCH_ON: AtomicBool = AtomicBool::new(false);
/// "No dictionary" is said once per process, not at every page load.
static TOLD_NO_DICTIONARY: AtomicBool = AtomicBool::new(false);

/// Brings the context of `webview` to the switch: on with the system's
/// languages, or off (which removes every marker WebKit has drawn).
/// Idempotent; a second window may sit on a context of its own.
pub fn apply(webview: &webkit2gtk::WebView, on: bool) {
    let Some(context) = webview.context() else {
        return;
    };
    if context.is_spell_checking_enabled() == on {
        return;
    }
    if on {
        let languages = system_languages();
        let refs: Vec<&str> = languages.iter().map(String::as_str).collect();
        context.set_spell_checking_languages(&refs);
    }
    context.set_spell_checking_enabled(on);
    if on && context.spell_checking_languages().is_empty() && !TOLD_NO_DICTIONARY.swap(true, Ordering::Relaxed) {
        eprintln!(
            "plainva: spell checking finds no dictionary for {:?}; install a hunspell dictionary (e.g. hunspell-de-de) to have text checked",
            system_languages()
        );
    }
}

/// A web view whose page starts loading gets the current switch.
pub fn on_page_load(webview: &webkit2gtk::WebView) {
    apply(webview, SWITCH_ON.load(Ordering::Relaxed));
}

/// The switch changed (or a window reports it at start): every web view of
/// the app follows.
pub fn set_switch<R: Runtime>(app: &tauri::AppHandle<R>, on: bool) {
    SWITCH_ON.store(on, Ordering::Relaxed);
    for webview in app.webview_windows().into_values() {
        let _ = webview.with_webview(move |platform| apply(&platform.inner(), on));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glib_names_become_dictionary_languages_once_each() {
        let names = ["de_DE.UTF-8", "de_DE", "de.UTF-8", "de", "C"];
        assert_eq!(languages_from_locale_names(&names), vec!["de_DE", "de"]);
    }

    #[test]
    fn several_languages_keep_their_order() {
        // LANGUAGE=fr_CA:en with LANG=fr_CA.UTF-8 as GLib lists it.
        let names = ["fr_CA", "fr", "en", "C"];
        assert_eq!(languages_from_locale_names(&names), vec!["fr_CA", "fr", "en"]);
    }

    #[test]
    fn modifiers_and_encodings_are_cut_off() {
        let names = ["sr_RS.UTF-8@latin", "sr_RS@latin", "ca_ES@valencia"];
        assert_eq!(languages_from_locale_names(&names), vec!["sr_RS", "ca_ES"]);
    }

    #[test]
    fn a_system_without_a_language_names_none() {
        assert!(languages_from_locale_names(&["C", "POSIX", "C.UTF-8", ""]).is_empty());
        assert!(languages_from_locale_names::<&str>(&[]).is_empty());
    }

    #[test]
    fn a_hyphen_tag_is_named_as_enchant_names_it_and_junk_is_dropped() {
        assert_eq!(languages_from_locale_names(&["pt-BR", "../etc", "de DE"]), vec!["pt_BR"]);
    }
}
