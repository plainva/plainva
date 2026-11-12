import {
  applyTextShape,
  containsTextChanges,
  editorTextOf,
  isNotTextFileError,
  mergeEditorText,
  type ConflictEditSession,
  type IVaultAdapter,
  type TextFileShape,
} from "@plainva/core";
import { keepTextBeside, type KeptText } from "./conflictFiles";

/**
 * One editor save, once for both shells (stability plan R6, finding S4): what
 * the desktop's editor and the phone's note saver do with a text between "it
 * is time to save" and "the file holds it". What is the shell's own stays
 * there — when to save (the scheduling), and what the screen says afterwards.
 *
 * The rules, each of which both shells had in their own words:
 *
 * - **No write of an unchanged text** (finding 2026-10-08): the editor holds
 *   what the file last said — the suggestion mode put its base back, an edit
 *   was taken back before the save came. Writing it anyway cost a version and
 *   an upload for nothing, and a note that arrived with `\r\n` every one of its
 *   line ends. A file that changed elsewhere meanwhile is the external
 *   update's business.
 * - **The text leaves in the shape its file was read in** (C15, S13) — line
 *   ends and byte order mark —, and what the disk answers is read back into
 *   the editor's text, so everything an editor remembers and compares stays in
 *   one text space (`textFileShape.ts`).
 * - **Through the chain's editor write** (`writeEditorText`): a three-way merge
 *   against the base the editor started from, and a working copy while a
 *   conflict is open. A storage without it (none of the app's) is merged here
 *   and the result read back and confirmed.
 * - **A file that turned into no text** while the editor held changes —
 *   another program saved it in another encoding, a pull brought such a
 *   version (finding 2026-10-11) — is never written over: the text is kept
 *   beside it as a conflict copy, into the same copy as the editor's earlier
 *   keep while that copy still holds what was kept there.
 */

export interface EditorSaveInput {
  /** The top of the vault's chain. */
  files: Pick<IVaultAdapter, "readTextFile" | "writeTextFile" | "writeEditorText" | "exists" | "updateTextFile" | "readTextFileState" | "writeTextFileChange">;
  path: string;
  /** The editor's text. */
  text: string;
  /** What editor and file last agreed on — the base of the merge; null before the first load. */
  base: string | null;
  /** What the file held after the editor's last confirmed save or load. */
  persisted: string | null;
  /** The shape the file was read in; null for the default (`\n`, no mark). */
  shape: TextFileShape | null;
  /** What this editor kept beside the file before (`keepTextBeside`). */
  kept: KeptText | null;
  /** How a text is kept beside a file that is no text; `keepTextBeside` unless a caller holds it (a test that holds a keep under way). */
  keep?: typeof keepTextBeside;
}

export type EditorSaveOutcome =
  /** Nothing to write: the editor holds what the file last said. */
  | { kind: "unchanged" }
  /** The file (or the working copy of its open conflict) took the text; `stored` is what it holds now, as editor text. */
  | { kind: "written"; stored: string; session: ConflictEditSession | null }
  /** The file is no text: the editor's text lies beside it now. */
  | { kind: "kept-beside"; kept: KeptText; earlier: KeptText | null };

/**
 * The file turned into no text, and not even a copy beside it could be
 * written: the text stays in the editor and its journal. `notText` is the
 * refusal of the file, `cause` why the copy failed.
 */
export class KeepBesideFailedError extends Error {
  readonly code = "KEEP_BESIDE_FAILED";
  constructor(readonly notText: unknown, readonly cause: unknown) {
    super(`The unsaved text could not be kept beside the file that is no text: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "KeepBesideFailedError";
  }
}

export async function writeEditorSave(input: EditorSaveInput): Promise<EditorSaveOutcome> {
  const { files, path, text, base, persisted, shape, kept } = input;
  const keep = input.keep ?? keepTextBeside;
  if (base !== null && text === base && text === persisted) return { kind: "unchanged" };
  const shaped = (value: string) => (shape ? applyTextShape(value, shape) : value);

  const keepBeside = async (error: unknown): Promise<EditorSaveOutcome> => {
    if (!isNotTextFileError(error)) throw error;
    try {
      return { kind: "kept-beside", kept: await keep(files, path, shaped(text), kept), earlier: kept };
    } catch (keepError) {
      throw new KeepBesideFailedError(error, keepError);
    }
  };

  if (files.writeEditorText) {
    try {
      const result = await files.writeEditorText(path, shaped(text), base === null ? null : shaped(base));
      return { kind: "written", stored: editorTextOf(result.stored), session: result.session };
    } catch (error) {
      return keepBeside(error);
    }
  }

  let disk: string;
  try {
    disk = editorTextOf(await files.readTextFile(path));
  } catch (error) {
    return keepBeside(error);
  }
  let candidate = text;
  // A pull can advance the sync index while the editor still holds its old
  // base. Its ancestry is kept through delayed saves and further typing.
  if (base !== null && disk !== base && disk !== text) {
    const merged = mergeEditorText(base, text, disk);
    if (merged.hasConflicts) throw new Error("Conflict-safe editing is unavailable; the pending draft has been retained");
    candidate = merged.mergedText;
  }
  try {
    await files.writeTextFile(path, shaped(candidate));
  } catch (error) {
    return keepBeside(error);
  }
  const stored = editorTextOf(await files.readTextFile(path));
  if (!containsTextChanges(disk, candidate, stored)) throw new Error("The saved note could not be confirmed");
  return { kind: "written", stored, session: null };
}
