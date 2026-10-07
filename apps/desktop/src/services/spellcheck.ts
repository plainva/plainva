import { setSpellcheckOn } from "@plainva/ui";
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

/** Reads the stored switch into the shared rule. Until then the rule is off. */
export function initSpellcheck(): void {
  getStoredSpellcheck()
    .then((on) => setSpellcheckOn(on))
    .catch(() => {});
}
