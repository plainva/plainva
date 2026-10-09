/**
 * The shape a text file has on disk, and the text an editor holds for it (C15).
 *
 * An editor works on `\n` text without a byte order mark — CodeMirror
 * normalises line ends anyway, so pretending otherwise would only move the
 * problem. What the file looked like before that is its SHAPE: taken when the
 * file is read, put back when it is written. An `.ini` written on Windows, a
 * `.csv` exported with a BOM for Excel, a `.bat` that a shell reads line by
 * line — opening one and saving it as it is held would rewrite every line
 * ending in the file, produce a diff of "the whole file" in the user's version
 * control, and in the `.bat` case change what the file DOES.
 *
 * Two rules follow from that split. Both shells broke the first, the phone the
 * second as well (finding 2026-10-08):
 *
 * - There is ONE text space. Whatever is compared with what an editor holds —
 *   the file before a save, a file another program rewrote, the note a comment
 *   operation is about to change — is read through `editorTextOf` first. The
 *   phone compared the raw file with its editor's text: a note with `\r\n`
 *   counted as edited the moment it was opened, a pull that rewrote it ended in
 *   a conflict copy, and no suggestion on it could be accepted. The desktop's
 *   editor kept a note's mark in its buffer while its comment operation read
 *   the note without one — the same refusal, for a note that starts with a mark.
 * - Every write of an editor's text says which shape it leaves in. The
 *   editor's own save takes it from where the file was opened (`openEditorText`
 *   in the UI package, which also holds the house rule for notes); a write
 *   that changes one passage takes it from the file as it lies there
 *   (`editorTextFiles`); a merge takes it from the text it was asked to write
 *   (`inShapeOf`). The phone named none: it wrote every text file back the way
 *   its editor held it, `\n` throughout.
 *
 * Note that this is not an encoding guess: we only remember what we found.
 *
 * Pure, and in the core rather than beside the editors: the adapter that merges
 * an editor's text into a changed file needs the same functions as the shells
 * that open one.
 */
export interface TextFileShape {
  /** The line ending the file used. Mixed endings collapse to the majority. */
  eol: "\n" | "\r\n";
  /** Whether the file started with a UTF-8 byte order mark. */
  bom: boolean;
}

export const DEFAULT_TEXT_SHAPE: TextFileShape = { eol: "\n", bom: false };

/** The byte order mark as text. Built here, so that no source file has to carry the character itself. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/**
 * Splits a freshly read file into the text an editor works with and the shape
 * the file had. The editor always holds LF internally.
 */
export function readTextShape(raw: string): { text: string; shape: TextFileShape } {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  // Count rather than sniff the first one: a file that is mostly CRLF with one
  // stray LF is a CRLF file, and the reverse is a file someone edited on the
  // other platform. The majority is the one that keeps the diff small.
  const crlf = (body.match(/\r\n/g) ?? []).length;
  const lf = (body.match(/(^|[^\r])\n/g) ?? []).length;
  return { text: body.replace(/\r\n/g, "\n"), shape: { eol: crlf > lf ? "\r\n" : "\n", bom } };
}

/** Puts a shape back around an editor's LF text. */
export function applyTextShape(text: string, shape: TextFileShape): string {
  const body = shape.eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
  return shape.bom ? BYTE_ORDER_MARK + body : body;
}

/** What an editor holds for these bytes: `\n` line ends, no byte order mark. */
export function editorTextOf(raw: string): string {
  return readTextShape(raw).text;
}

/**
 * `text` in the shape `model` has. A merge works line by line and joins its
 * result with `\n`; this is what brings the result back to the shape of the
 * text that was to be written, so that merging a change into a `\r\n` file
 * does not rewrite every other line of it.
 */
export function inShapeOf(model: string, text: string): string {
  return applyTextShape(readTextShape(text).text, readTextShape(model).shape);
}

/**
 * File access for an operation that is PLANNED on an editor's text and changes
 * one passage of the file — accepting a suggestion, placing or removing a
 * comment's marker.
 *
 * It reads what an editor holds, because that is the text the plan was made
 * on. And it writes back in the shape the file has at that moment: the
 * operation was asked to change a passage, so every other byte stays, line
 * ends and mark included. Both shells wire their comment operation through
 * this one function; a wiring that hands over the raw file instead answers
 * "the note changed" for every note that does not happen to lie there the way
 * an editor holds it.
 */
export function editorTextFiles(files: {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}): { readText(path: string): Promise<string>; writeText(path: string, text: string): Promise<void> } {
  return {
    readText: async (path) => editorTextOf(await files.read(path)),
    writeText: async (path, text) => files.write(path, applyTextShape(text, readTextShape(await files.read(path)).shape)),
  };
}
