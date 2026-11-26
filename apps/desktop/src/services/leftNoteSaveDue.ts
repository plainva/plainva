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
  /**
   * Whether that entry was written to the journal. A journal that could not
   * take it (a full disk takes the vault's write and the journal's at once)
   * holds nothing of this text: then its absence proves nothing, and the
   * retry is the text's only keeper.
   */
  journaled: boolean;
  /** What the editor last knew the file to hold, in the editor's text; null before it loaded one. */
  persisted: string | null;
}

export interface LeftNoteSaveSources {
  /** The journal's newest entry for the note, of any session; rejects when the journal cannot be read. */
  newestDraft: () => Promise<{ sessionId?: string; revision: number } | null>;
  readTextFile: (path: string) => Promise<string>;
}

/**
 * Gives way only on proof: the entry this editor wrote is no longer the
 * journal's newest, or the file holds something else than what it knew, or
 * is gone. A journal that cannot be read, an entry that was never written, a
 * file that cannot be read for another reason, and a note that was never
 * loaded (a new one whose first save failed) prove nothing: the retry goes on.
 */
export async function leftNoteSaveDue(state: LeftNoteSaveState, sources: LeftNoteSaveSources): Promise<boolean> {
  if (state.journaled) {
    const newest = await sources.newestDraft().then((entry) => ({ entry }), () => null);
    if (newest && (!newest.entry || newest.entry.sessionId !== state.sessionId || newest.entry.revision !== state.revision)) return false;
  }
  if (state.persisted === null) return true;
  let raw: string;
  try {
    raw = await sources.readTextFile(state.path);
  } catch (error) {
    // Gone while the vault is there: moved or deleted. Anything else is the retry's to wait out.
    return !isVanishedFileFailure(error);
  }
  return editorTextOf(raw) === state.persisted;
}
