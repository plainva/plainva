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
//! A locale with a script modifier (`sr_RS@latin`) names only the dictionary of
//! that script, and only if Enchant loads exactly that one; see
//! `checkable_languages`. When the system names languages and none can be
//! checked, the checker stays off and the settings page says why.
//!
//! The command answers with what loaded (`crate::WebviewSpellStatus`), so the
//! page can show a line under the switch instead of a switch that silently
//! checks nothing - also in the AppImage, whose bundled Enchant finds dictionary
//! providers only where a Debian-like host keeps them (Sammelplan § 3.183 Nr. 1).

use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;

use tauri::{Manager, Runtime};
use webkit2gtk::{WebContextExt, WebViewExt};

/// A locale modifier that names a script: the dictionary is the language in
/// that script (`sr_Latn_RS`), and the language's other script is never the
/// one to check against - Latin Serbian against the Cyrillic dictionary is red
/// from the first word.
fn script_of(modifier: &str) -> Option<&'static str> {
    match modifier {
        "latin" => Some("Latn"),
        "cyrillic" => Some("Cyrl"),
        "devanagari" => Some("Deva"),
        _ => None,
    }
}

/// A locale modifier that names a variant of the language's dictionary in the
/// same script (`ca_ES-valencia`); the plain dictionary may follow it.
fn is_variant(modifier: &str) -> bool {
    modifier == "valencia"
}

fn split_locale(name: &str) -> Option<(String, Option<String>, Option<&str>)> {
    let (rest, modifier) = match name.split_once('@') {
        Some((rest, m)) => (rest, Some(m.split('.').next().unwrap_or("").trim())),
        None => (name, None),
    };
    let tag = rest.split('.').next().unwrap_or("").trim();
    if tag.is_empty() || tag == "C" || tag == "POSIX" {
        return None;
    }
    // A locale name is letters, digits, `_` and `-`; anything else is no
    // language a dictionary could be named after.
    if !tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return None;
    }
    let tag = tag.replace('-', "_");
    let (language, territory) = match tag.split_once('_') {
        Some((l, t)) => (l.to_string(), Some(t.to_string())),
        None => (tag.clone(), None),
    };
    Some((language, territory, modifier.filter(|m| !m.is_empty())))
}

/// The spell-checking languages for a list of locale names as GLib gives them
/// (`de_DE.UTF-8`, `de_DE`, `de.UTF-8`, `de`, `C`): encoding cut off, `C` and
/// `POSIX` dropped, each name once, in the order given. The bare language
/// follows its regional form, so `de_DE` is preferred and a system that has
/// only a `de` dictionary still finds it.
///
/// Modifiers, named as the hunspell packages name their files (Debian's
/// hunspell-sr ships `sr_RS` and `sr_Latn_RS`, hunspell-ca `ca`, `ca_ES` and
/// `ca_ES-valencia`): a script modifier names the dictionary of that script
/// (`sr_RS@latin` -> `sr_Latn_RS`), and the language's names without the
/// modifier, which GLib lists after it, are dropped - they mean the other
/// script. A variant modifier names its dictionary first and keeps the plain
/// ones after it (`ca_ES@valencia` -> `ca_ES-valencia`, `ca_ES`). Any other
/// modifier (`@euro`) is cut off.
pub fn languages_from_locale_names<S: AsRef<str>>(names: &[S]) -> Vec<String> {
    let parsed: Vec<_> = names.iter().filter_map(|n| split_locale(n.as_ref())).collect();
    let scripted: Vec<&str> = parsed
        .iter()
        .filter(|(_, _, m)| m.is_some_and(|m| script_of(m).is_some()))
        .map(|(l, _, _)| l.as_str())
        .collect();
    let mut out: Vec<String> = Vec::new();
    for (language, territory, modifier) in &parsed {
        let script = modifier.and_then(script_of);
        let tag = match (script, *modifier) {
            (Some(script), _) => match territory {
                Some(t) => format!("{language}_{script}_{t}"),
                None => format!("{language}_{script}"),
            },
            (None, Some(m)) if is_variant(m) => match territory {
                Some(t) => format!("{language}_{t}-{m}"),
                None => format!("{language}-{m}"),
            },
            _ => {
                if scripted.contains(&language.as_str()) {
                    continue;
                }
                match territory {
                    Some(t) => format!("{language}_{t}"),
                    None => language.clone(),
                }
            }
        };
        if !out.contains(&tag) {
            out.push(tag);
        }
    }
    out
}

/// Does a tag name a script or a variant (a dictionary Enchant may not reach
/// under that name)?
fn is_marked(tag: &str) -> bool {
    tag.contains('-') || tag.split('_').nth(1).is_some_and(|part| part.len() == 4)
}

/// Enchant compares tags case-insensitively for this purpose, and spells a
/// variant with `_` or `-`.
fn same_tag(a: &str, b: &str) -> bool {
    a.replace('-', "_").eq_ignore_ascii_case(&b.replace('-', "_"))
}

/// The system's languages, as GLib reads them from the environment.
fn system_languages() -> Vec<String> {
    let names: Vec<String> = webkit2gtk::glib::language_names().iter().map(|n| n.to_string()).collect();
    languages_from_locale_names(&names)
}

/// The languages to hand WebKit: a script or variant dictionary only if Enchant
/// loads exactly that one. Enchant 2.3 upper-cases everything after the first
/// `_` of a tag, so it never finds `sr_Latn_RS.dic` or `ca_ES-valencia.dic`
/// and falls back to the bare language - for `sr` the Cyrillic dictionary,
/// which would mark every word of Latin Serbian (checked 2026-11-16 against
/// the files of hunspell-sr and hunspell-ca). Each such tag is tried alone and
/// kept only if what loaded is that dictionary.
fn checkable_languages(context: &webkit2gtk::WebContext) -> Vec<String> {
    system_languages()
        .into_iter()
        .filter(|tag| {
            if !is_marked(tag) {
                return true;
            }
            context.set_spell_checking_languages(&[tag.as_str()]);
            let loaded = context.spell_checking_languages();
            loaded.len() == 1 && same_tag(loaded[0].as_str(), tag)
        })
        .collect()
}

const UNKNOWN: u8 = 0;
const OFF: u8 = 1;
const ON: u8 = 2;

/// The device switch as a window last reported it; unknown until one has read
/// it. A page that loads while it is unknown leaves the checker as it is.
static SWITCH: AtomicU8 = AtomicU8::new(UNKNOWN);

/// Brings the context of `webview` to the switch: on with the system's
/// languages, or off (which removes every marker WebKit has drawn). Returns
/// the loaded dictionaries while on (none: the checker stays off). Idempotent; every window of the app sits
/// on the same context, a second one would follow the same way.
pub fn apply(webview: &webkit2gtk::WebView, on: bool) -> Option<Vec<String>> {
    let context = webview.context()?;
    if !on {
        if context.is_spell_checking_enabled() {
            context.set_spell_checking_enabled(false);
        }
        return None;
    }
    if !context.is_spell_checking_enabled() {
        let named = !system_languages().is_empty();
        let languages = checkable_languages(&context);
        // The system named languages and none of them can be checked: an empty
        // list would make WebKit fall back to Enchant's default (en_US), and
        // Latin Serbian against English is as red as against Cyrillic. Stay
        // off; the page says that no dictionary loaded.
        if named && languages.is_empty() {
            return Some(Vec::new());
        }
        let refs: Vec<&str> = languages.iter().map(String::as_str).collect();
        context.set_spell_checking_languages(&refs);
        context.set_spell_checking_enabled(true);
    }
    Some(context.spell_checking_languages().iter().map(|l| l.to_string()).collect())
}

/// A web view whose page starts loading takes over the process's switch; it
/// never changes it. Before any window has read the switch: nothing.
pub fn on_page_load(webview: &webkit2gtk::WebView) {
    match SWITCH.load(Ordering::Relaxed) {
        ON => drop(apply(webview, true)),
        OFF => drop(apply(webview, false)),
        _ => {}
    }
}

/// A window read the switch, or it changed: every web view of the app
/// follows. While on, says what WebKit loaded.
pub async fn set_switch<R: Runtime>(app: &tauri::AppHandle<R>, on: bool) -> Option<crate::WebviewSpellStatus> {
    SWITCH.store(if on { ON } else { OFF }, Ordering::Relaxed);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    for webview in app.webview_windows().into_values() {
        let tx = tx.clone();
        let _ = webview.with_webview(move |platform| {
            let _ = tx.send(apply(&platform.inner(), on));
        });
    }
    drop(tx);
    // The closures run on the main thread; the first answer tells it all,
    // because the windows share one context.
    let languages = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.ok()??;
    let languages = languages?;
    // One line per switch-on, read by the AppImage distribution probe
    // (scripts/appimage-distro-probe.sh) and useful in any bug report.
    if on && languages.is_empty() {
        eprintln!(
            "plainva: spell checking finds no dictionary for {:?}; install a hunspell dictionary (e.g. hunspell-de-de) to have text checked",
            system_languages()
        );
    } else if on {
        eprintln!("plainva: spell checking loaded {languages:?}");
    }
    Some(crate::WebviewSpellStatus { languages })
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
    fn encodings_and_other_modifiers_are_cut_off() {
        assert_eq!(languages_from_locale_names(&["de_DE.UTF-8@euro", "de_DE@euro", "de"]), vec!["de_DE", "de"]);
    }

    #[test]
    fn a_script_modifier_names_that_script_only() {
        // GLib's list for LANG=sr_RS.UTF-8@latin.
        let names = ["sr_RS.UTF-8@latin", "sr_RS@latin", "sr.UTF-8@latin", "sr@latin", "sr_RS.UTF-8", "sr_RS", "sr.UTF-8", "sr", "C"];
        assert_eq!(languages_from_locale_names(&names), vec!["sr_Latn_RS", "sr_Latn"]);
        assert_eq!(languages_from_locale_names(&["uz_UZ@cyrillic", "uz_UZ", "uz"]), vec!["uz_Cyrl_UZ"]);
        // Another language beside it keeps its plain names.
        assert_eq!(languages_from_locale_names(&["sr_RS@latin", "sr_RS", "en_US", "en"]), vec!["sr_Latn_RS", "en_US", "en"]);
    }

    #[test]
    fn a_variant_modifier_comes_first_and_the_plain_dictionary_follows() {
        // GLib's list for LANG=ca_ES.UTF-8@valencia.
        let names = ["ca_ES.UTF-8@valencia", "ca_ES@valencia", "ca.UTF-8@valencia", "ca@valencia", "ca_ES.UTF-8", "ca_ES", "ca.UTF-8", "ca", "C"];
        assert_eq!(languages_from_locale_names(&names), vec!["ca_ES-valencia", "ca-valencia", "ca_ES", "ca"]);
    }

    #[test]
    fn script_and_variant_tags_are_marked_and_compared_as_enchant_does() {
        assert!(is_marked("sr_Latn_RS") && is_marked("sr_Latn") && is_marked("ca_ES-valencia"));
        assert!(!is_marked("de_DE") && !is_marked("de") && !is_marked("pt_BR"));
        assert!(same_tag("sr_LATN_RS", "sr_Latn_RS") && same_tag("ca_ES_VALENCIA", "ca_ES-valencia"));
        assert!(!same_tag("sr", "sr_Latn_RS") && !same_tag("ca", "ca_ES-valencia"));
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
