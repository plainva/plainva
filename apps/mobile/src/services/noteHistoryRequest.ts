/**
 * "Show this note's version history" from outside the note's screen (plan "KI direkt schreiben": "Compare" after an
 * "Undo" of the assistant). The screen of the note may not be there yet when it is asked — the note is opened in the
 * same step —, so the request waits here until the screen of that note takes it, once; a screen that is open already
 * hears it at once.
 */

export const NOTE_HISTORY_EVENT = "m-show-note-history";

let pending: { vaultId: string; path: string } | null = null;

export function requestNoteHistory(vaultId: string, path: string): void {
  pending = { vaultId, path };
  window.dispatchEvent(new CustomEvent(NOTE_HISTORY_EVENT, { detail: { vaultId, path } }));
}

/** True once for the note a request names: the screen of that note opens its history then. */
export function takeNoteHistoryRequest(vaultId: string, path: string): boolean {
  if (!pending || pending.vaultId !== vaultId || pending.path !== path) return false;
  pending = null;
  return true;
}
