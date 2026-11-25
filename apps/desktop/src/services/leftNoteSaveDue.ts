import { editorTextOf, isVanishedFileFailure } from "@plainva/ui";

/**
 * Whether the text of a note an editor left is still owed to its file
 * (`leftNoteSaves.ts`), asked before every try. The left editor knows only
 * its own window; the note may have moved on everywhere else:
 *
 *  - another editor — in this window or another — took the note over: the
 *    journal's newest entry for it is no longer this editor's text (typed
 *    on there, or "Discard draft" there cleared it);
 *  - the file is not what this editor last knew: saved from another window,
 *    changed by another program, moved or deleted. Writing now would bring
 *    the left text over the newer one, or make the moved or deleted note
 *    again at its old place.
 *
 * In each case the try gives way, and the text stays where the journal has
 * it. A file that cannot be read for another reason — the vault's folder on
 * a drive that dropped — decides nothing: that is what the retry waits out.
 */
export interface LeftNoteSaveState {
  path: string;
  /** The editor's journal session and the revision its text was journaled under. */
  sessionId: string;
  revision: number;
  /** What the editor last knew the file to hold, in the editor's text; null before it loaded. */
  persisted: string | null;
}

export interface LeftNoteSaveSources {
  /** The journal's newest entry for the note, of any session. */
  newestDraft: () => Promise<{ sessionId?: string; revision: number } | null>;
  readTextFile: (path: string) => Promise<string>;
}

export async function leftNoteSaveDue(state: LeftNoteSaveState, sources: LeftNoteSaveSources): Promise<boolean> {
  if (state.persisted === null) return false;
  const newest = await sources.newestDraft();
  if (!newest || newest.sessionId !== state.sessionId || newest.revision !== state.revision) return false;
  let raw: string;
  try {
    raw = await sources.readTextFile(state.path);
  } catch (error) {
    // Gone while the vault is there: moved or deleted. Anything else is the retry's to wait out.
    return !isVanishedFileFailure(error);
  }
  return editorTextOf(raw) === state.persisted;
}
