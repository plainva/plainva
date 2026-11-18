import { useSyncExternalStore } from "react";
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
 *
 * The checker is one per process, every window shares it, and switching it off
 * clears the red lines in all of them. So a window reports only a state it
 * knows: nothing before it has read the store, nothing when the read failed -
 * a new window, the quick-capture window or a reload never switches the
 * others off on its way to reading "on". Until a window reports, a new page
 * takes over the process's state (src-tauri, on_page_load).
 */
export const DEFAULT_SPELLCHECK = false;

const KEY = "spellcheck";

/** The stored switch, or `undefined` when the store cannot be read. */
async function readStoredSpellcheck(): Promise<boolean | undefined> {
  try {
    const store = await getSettingsStore();
    return (await store.get<boolean>(KEY)) === true;
  } catch {
    return undefined;
  }
}

export async function getStoredSpellcheck(): Promise<boolean> {
  return (await readStoredSpellcheck()) ?? DEFAULT_SPELLCHECK;
}

export async function setStoredSpellcheck(on: boolean): Promise<void> {
  // Apply first: an open editor follows at once, whatever the store does.
  // The person set it here, so this window knows the state from now on.
  known = true;
  setSpellcheckOn(on);
  reportNow();
  const store = await getSettingsStore();
  await store.set(KEY, on);
  await store.save();
  // A second window keeps its own copy of the rule's state; tell it.
  notifyAppearanceChanged();
}

/**
 * What the web view's checker said after it was switched on (Linux only): the
 * dictionaries it loaded, empty when none. `null` while
 * off, on Windows and macOS, and when the host could not say.
 */
export interface WebviewSpellStatus {
  languages: string[];
}

let status: WebviewSpellStatus | null = null;
const statusListeners = new Set<() => void>();

function setStatus(next: WebviewSpellStatus | null): void {
  status = next;
  for (const listener of [...statusListeners]) listener();
}

export function getWebviewSpellStatus(): WebviewSpellStatus | null {
  return status;
}

export function useWebviewSpellStatus(): WebviewSpellStatus | null {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => status,
  );
}

/**
 * The line under the switch, if one is due: only while the switch is on and
 * the checker loaded no dictionary - which only Linux reports, in a package
 * and in the AppImage alike.
 */
export function spellcheckHint(on: boolean, s: WebviewSpellStatus | null): "noDictionary" | null {
  if (!on || !s || s.languages.length > 0) return null;
  return "noDictionary";
}

let reporting = false;
/** Has this window read the stored switch (or set it)? */
let known = false;
let lastReported: boolean | undefined;
let reportSeq = 0;

/** Reports the rule's state, if this window knows it and has not said it yet. */
function reportNow(): void {
  if (!known) return;
  const on = isSpellcheckOn();
  if (on === lastReported) return;
  lastReported = on;
  const mine = ++reportSeq;
  invoke<WebviewSpellStatus | null>("set_webview_spellcheck", { on })
    .then((answer) => {
      if (mine === reportSeq) setStatus(on ? (answer ?? null) : null);
    })
    .catch(() => {
      if (mine === reportSeq) setStatus(null);
    });
}

/**
 * Reports the rule's state to the web view's checker on every change, once
 * this window knows it. Once per window; a failed call (no Tauri host, an
 * older binary) changes nothing for the page, which keeps deciding by the
 * attribute.
 */
export function reportSpellcheckToWebview(): void {
  if (reporting) return;
  reporting = true;
  subscribeSpellcheck(reportNow);
}

/**
 * Reads the stored switch into the shared rule and reports it. Until then the
 * rule is off and nothing is reported; a failed read reports nothing either.
 */
export function initSpellcheck(): void {
  reportSpellcheckToWebview();
  readStoredSpellcheck()
    .then((on) => {
      if (on === undefined) return;
      known = true;
      setSpellcheckOn(on);
      reportNow();
    })
    .catch(() => {});
}
