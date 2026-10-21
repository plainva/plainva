//! Spell checking in WKWebView (issue #135).
//!
//! On macOS the web view marks a misspelled word only while the app's
//! "Check Spelling While Typing" is on — one state for the whole process,
//! kept in the app's defaults under `WebContinuousSpellCheckingEnabled`.
//! Safari and Notes switch it on through their Edit menu; Plainva has no
//! such menu item, so the state stayed off and `spellcheck="true"` on the
//! editor drew nothing, however the setting stood.
//!
//! What may be checked is still the page's decision: the document root says
//! `spellcheck="false"`, and only a writing field whose device switch is on
//! says `true` (`packages/ui/src/lib/spellcheck.ts`). Turning the process
//! state on therefore checks nothing the switch has not asked for.

use objc2_foundation::{ns_string, NSUserDefaults};

/// Must run before the first web view is created: WebKit reads the state
/// once, when its text checker starts. A value already stored — set by hand
/// with `defaults write` — is left as it is.
pub fn enable_continuous_spell_checking() {
    let defaults = NSUserDefaults::standardUserDefaults();
    let key = ns_string!("WebContinuousSpellCheckingEnabled");
    if defaults.objectForKey(key).is_none() {
        defaults.setBool_forKey(true, key);
    }
}
