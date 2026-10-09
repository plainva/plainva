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
export { DEFAULT_TEXT_SHAPE, applyTextShape, editorTextFiles, editorTextOf, inShapeOf, readTextShape, textOfFileBytes, type TextFileShape } from "@plainva/core";

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
 * The save shape is the file's own, for a note as for any other text file
 * (maintainer, 2026-10-09). A note used to be the exception — saved with `\n`
 * whatever it had arrived with, its mark alone kept — and so the first edit of
 * a note in a vault that came from Windows changed every line of it for
 * whoever keeps that vault in Git. An edit changes what was edited.
 */
export function openEditorText(path: string, raw: string): OpenedEditorText | null {
  if (resolveOpenAction(path) === "text" && looksBinary(raw)) return null;
  return readTextShape(raw);
}
