import { OpenConflictError } from "./ConflictAwareVaultAdapter.js";
import { TextFileChangedError, type IVaultAdapter, type TextChange, type TextFileUpdate } from "./IVaultAdapter.js";

/** What a read-change-write needs of the files it is handed. */
export type TextUpdateFiles = Pick<IVaultAdapter, "readTextFile" | "writeTextFile"> &
  Partial<Pick<IVaultAdapter, "updateTextFile" | "readTextFileState" | "writeTextFileChange" | "writeEditorText" | "getConflictSession">>;

/**
 * Reads a text file, changes it and writes it back — the ONE call for whoever
 * changes a place of a file that exists (finding 2026-10-12): a property, a
 * task's box, a link a rename rewrites, a line of the journal.
 *
 * Where the files are a vault's chain, this is its entry for exactly that
 * (`ConflictAwareVaultAdapter.updateTextFile`): the chain reads inside its
 * gate, so the change starts from the file as it lies there — no merge, no
 * conflict copy for a file somebody else changed, and a file with an open
 * conflict keeps the user's own version.
 *
 * Where they are a storage with no chain above it — a vault that is not
 * open, the double of a test — nothing knows anything about the file, and
 * reading it and writing it is all there is.
 *
 * And where they hand on a chain without handing on its entry, this throws
 * instead of quietly reading and writing: that wrapper would bring back what
 * the entry was built against, in the real app, while every test still passed.
 */
export async function updateVaultText(files: TextUpdateFiles, path: string, change: TextChange): Promise<TextFileUpdate> {
  if (files.updateTextFile) return files.updateTextFile(path, change);
  if (files.writeEditorText || files.getConflictSession) {
    throw new Error("These files hand on a vault's chain without its entry for a change (updateTextFile)");
  }
  const before = await files.readTextFile(path);
  const next = change(before);
  if (next === null || next === before) return { before, text: before, changed: false, conflict: null };
  await files.writeTextFile(path, next);
  return { before, text: next, changed: true, conflict: null };
}

/** How often a whole file's replacement is prepared again before it gives up. */
const REPLACE_ATTEMPTS = 4;

/**
 * Replaces a file's text by what was made of exactly that text — for a
 * transformation of a whole file that somebody keeps a backup for: an
 * overview prepared as `index.md`, a conversion of the note's header.
 *
 * `prepare` is handed the file's text and may take its time (write the
 * backup, ask the index); it answers the text to put in its place, or `null`
 * to leave the file alone. The file is replaced only if it still is the text
 * `prepare` was handed — so the backup taken there is what was replaced. Where
 * the file changed meanwhile, `prepare` is asked again with what is there
 * now; a file that never holds still is given up on (`TextFileChangedError`).
 *
 * A file with an open conflict is refused (`OpenConflictError`), whichever of
 * its two texts the path names, and nothing is prepared: a file made anew
 * from the other side's text beside a user's version nobody transformed is a
 * state no undo takes back — putting the backup back is a whole text for a
 * file with an open conflict, which does not reach the file (the chain
 * refuses it, or keeps it in a working copy that is such a write's own), and
 * once the conflict is resolved it would go over the version the user decided
 * for. Moving or deleting such a file is refused for the same reason: resolve
 * it first.
 *
 * A chain is asked through the two halves of its entry (the file's state,
 * then the new text for exactly that state): a conflict that opens while the
 * file is prepared is seen there, and nothing is written. Files that carry
 * the entry alone, or no chain at all, compare inside a change.
 */
export async function replaceVaultText(
  files: TextUpdateFiles,
  path: string,
  prepare: (text: string) => Promise<string | null>,
): Promise<TextFileUpdate> {
  const refuseOpenConflict = async (): Promise<void> => {
    const open = await files.getConflictSession?.(path);
    if (open) throw new OpenConflictError(open.workingCopyPath);
  };
  await refuseOpenConflict();
  const left = (text: string): TextFileUpdate => ({ before: text, text, changed: false, conflict: null });
  const stateOf = files.readTextFileState?.bind(files);
  const writeFor = files.writeTextFileChange?.bind(files);
  if (stateOf && writeFor) {
    for (let attempt = 0; attempt < REPLACE_ATTEMPTS; attempt++) {
      const state = await stateOf(path);
      // Opened since it was asked: the same answer, from inside the chain's
      // gate. Resolved again by now: looked at anew.
      if (state.workingCopy !== null) {
        if (!files.getConflictSession) throw new OpenConflictError();
        await refuseOpenConflict();
        continue;
      }
      const next = await prepare(state.text);
      if (next === null) return left(state.text);
      const update = await writeFor(path, state, { text: next, workingCopy: null });
      if (update) return update;
    }
    throw new TextFileChangedError(path);
  }
  let text = await files.readTextFile(path);
  for (let attempt = 0; attempt < REPLACE_ATTEMPTS; attempt++) {
    const read = text;
    const next = await prepare(read);
    if (next === null) return left(read);
    const update = await updateVaultText(files, path, (now) => (now === read ? next : null));
    if (update.before === read) return update;
    text = update.before;
  }
  throw new TextFileChangedError(path);
}
