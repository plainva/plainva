import { readTextShape, type TextFileShape } from "@plainva/core";
import { looksBinary, resolveOpenAction } from "./openTarget";

/**
 * How a file is opened for an editor — one function for both shells.
 *
 * The shape itself (line ends, byte order mark) and the one text space every
 * editor works in are defined in the core (`textFileShape.ts` there, which
 * also tells why). They are passed on from here because this package is where
 * the shells take them from.
 */
export { DEFAULT_TEXT_SHAPE, applyTextShape, editorTextFiles, editorTextOf, inShapeOf, readTextShape, type TextFileShape } from "@plainva/core";

/** A freshly read file, split for an editor. */
export interface OpenedEditorText {
  /** What the editor holds: `\n` line ends, no byte order mark. */
  text: string;
  /** What the editor's own save puts back around that text. */
  shape: TextFileShape;
}

/**
 * Splits a freshly read file into the text an editor works on and the shape
 * its save puts back. `null` when the name says text and the bytes say
 * otherwise: nothing of such a file may be shown, because what an editor would
 * hold is a lossy decode, and its first save would destroy the file.
 *
 * One function, so that no shell can take the text without the veto or the
 * veto without the shape. The phone had neither (finding 2026-10-08): it
 * showed whatever decoded, and it wrote every text file back with `\n`.
 *
 * The save shape is also where the house rule for notes lives. A foreign text
 * file leaves exactly as it arrived — it is the user's, not ours. A note is
 * saved with `\n`, as the editor always wrote it and as every merge writes it,
 * and keeps only its mark. (A write that changes one passage of a note —
 * `editorTextFiles` — leaves the note's line ends as they are.)
 */
export function openEditorText(path: string, raw: string): OpenedEditorText | null {
  const foreign = resolveOpenAction(path) === "text";
  if (foreign && looksBinary(raw)) return null;
  const { text, shape } = readTextShape(raw);
  return { text, shape: foreign ? shape : { eol: "\n", bom: shape.bom } };
}
