import { invoke } from "@tauri-apps/api/core";
import { isSpellcheckOn, setSpellcheckOn, subscribeSpellcheck } from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";
import { notifyAppearanceChanged } from "./appearanceSync";

/**
 * "Spell checking" (plan Befunde 2026-10-06, E3): the device switch behind the
 * one rule in @plainva/ui's lib/spellcheck.ts. Off by default - as it was
 * before there was a switch. Device-local on purpose and not part of the
 * synced settings profile: the dictionaries and languages are the system's,
 * and a second machine may have neither. Persistence mirrors
 * services/tagColors.ts (Tauri store, global).
 *
 * On the desktop the switch has a second effect, in services/webviewHardening:
 * while it is on, a right-click in a checked text field shows the system's
 * menu, because the correction suggestions exist only there.
 *
 * And a third, for the web view's own checker: WebKitGTK on Linux checks only
 * while the app has switched its checker on, and removes the red lines it drew
 * only when the app switches it off again - turning the attribute to `false`
 * leaves them standing. So every change of the rule is reported to src-tauri
 * (`set_webview_spellcheck`, src/linux_spellcheck.rs); on Windows and macOS
 * the command does nothing.
 */
export const DEFAULT_SPELLCHECK = false;

const KEY = "spellcheck";

export async function getStoredSpellcheck(): Promise<boolean> {
  try {
    const store = await getSettingsStore();
    return (await store.get<boolean>(KEY)) === true;
  } catch {
    return DEFAULT_SPELLCHECK;
  }
}

export async function setStoredSpellcheck(on: boolean): Promise<void> {
  // Apply first: an open editor follows at once, whatever the store does.
  setSpellcheckOn(on);
  const store = await getSettingsStore();
  await store.set(KEY, on);
  await store.save();
  // A second window keeps its own copy of the rule's state; tell it.
  notifyAppearanceChanged();
}

let reporting = false;

/**
 * Reports the rule's state to the web view's checker, now and on every change.
 * Once per window; a failed call (no Tauri host, an older binary) changes
 * nothing for the page, which keeps deciding by the attribute.
 */
export function reportSpellcheckToWebview(): void {
  if (reporting) return;
  reporting = true;
  const report = () => {
    invoke("set_webview_spellcheck", { on: isSpellcheckOn() }).catch(() => {});
  };
  subscribeSpellcheck(report);
  report();
}

/** Reads the stored switch into the shared rule. Until then the rule is off. */
export function initSpellcheck(): void {
  reportSpellcheckToWebview();
  getStoredSpellcheck()
    .then((on) => setSpellcheckOn(on))
    .catch(() => {});
}
