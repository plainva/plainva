import { getSettingsStore } from "./settingsStore";

/**
 * "Open new notes in a new tab" (issue 135, 2026-10-19): a new note used to
 * replace the note in the active tab (it went into that tab's history). With
 * the switch on it gets a tab of its own and the note before stays open. Off
 * by default, so nothing changes for anyone who did not ask.
 *
 * Device-local like the default view (services/viewModeDefault.ts): the store
 * is async, the places that open a new note need the answer at once, so
 * `initNewNotesInNewTab()` fills a cache at app start. Ctrl+click, the middle
 * button and Ctrl+T open a new tab whatever this says. The phone has no tabs;
 * a new note there is always a screen of its own (parity catalog,
 * `editor-tabs`).
 */
export const DEFAULT_NEW_NOTES_IN_NEW_TAB = false;

const KEY = "newNotesInNewTab";
let cached = DEFAULT_NEW_NOTES_IN_NEW_TAB;

export async function getStoredNewNotesInNewTab(): Promise<boolean> {
  try {
    const store = await getSettingsStore();
    return (await store.get<boolean>(KEY)) === true;
  } catch {
    return DEFAULT_NEW_NOTES_IN_NEW_TAB;
  }
}

export async function setStoredNewNotesInNewTab(on: boolean): Promise<void> {
  cached = on;
  const store = await getSettingsStore();
  await store.set(KEY, on);
  await store.save();
}

/** Fills the cache from the store; call once at app start (main.tsx). */
export function initNewNotesInNewTab(): void {
  getStoredNewNotesInNewTab()
    .then((on) => { cached = on; })
    .catch(() => {});
}

/** Whether a note that was just created opens in a tab of its own; `asked` = the user asked for a new tab anyway. */
export function newNoteOpensInNewTab(asked = false): boolean {
  return asked || cached;
}

/** Test-only. */
export function resetNewNoteTabForTests(on = DEFAULT_NEW_NOTES_IN_NEW_TAB): void {
  cached = on;
}
