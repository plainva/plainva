/**
 * The shape a text file has on disk, and the text an editor holds for it (C15).
 *
 * An editor works on `\n` text without a byte order mark — CodeMirror
 * normalises line ends anyway, so pretending otherwise would only move the
 * problem. What the file looked like before that is its SHAPE: taken when the
 * file is read, put back when it is written. An `.ini` written on Windows, a
 * `.csv` exported with a BOM for Excel, a `.bat` that a shell reads line by
 * line, a note in a vault that came from Windows and is kept in Git — opening
 * one and saving it as it is held would rewrite every line ending in the file,
 * produce a diff of "the whole file" in the user's version control, and in the
 * `.bat` case change what the file DOES.
 *
 * That holds for every text file, notes included (maintainer, 2026-10-09).
 * Until then a note was the exception: it left an editor with `\n`, whatever
 * it had arrived with, and so did every file a merge had touched. What Plainva
 * creates itself still starts with `\n` and without a mark; what it finds, it
 * leaves as it is.
 *
 * Three rules follow from that split:
 *
 * - There is ONE text space. Whatever is compared with what an editor holds —
 *   the file before a save, a file another program rewrote, the note a comment
 *   operation is about to change — is read through `editorTextOf` first. The
 *   phone compared the raw file with its editor's text (finding 2026-10-08): a
 *   note with `\r\n` counted as edited the moment it was opened, a pull that
 *   rewrote it ended in a conflict copy, and no suggestion on it could be
 *   accepted. The desktop's editor kept a note's mark in its buffer while its
 *   comment operation read the note without one — the same refusal, for a note
 *   that starts with a mark.
 * - Every write of an editor's text says which shape it leaves in. The
 *   editor's own save takes it from where the file was opened (`openEditorText`
 *   in the UI package); a write that changes one passage takes it from the
 *   file as it lies there (`editorTextFiles`).
 * - A merge works on lines and decides the shape itself (`mergedTextShape`,
 *   used by every merge in `conflict-resolver.ts`): no caller has to put it
 *   back, so none can forget to. It used to join its lines with `\n`, and a
 *   file two devices had changed between two syncs came back with every line
 *   end turned.
 *
 * And one about bytes: a file's text is its bytes decoded WITH the mark
 * (`textOfFileBytes`). A plain `new TextDecoder()` swallows it, and whatever
 * was written back from such a text had lost it — a pulled file on the second
 * device, a version restored from the history, every file in a folder the
 * phone reaches through the system's document provider.
 *
 * Note that this is not an encoding guess: we only remember what we found.
 *
 * Pure, and in the core rather than beside the editors: the merges and the
 * sync need the same functions as the shells that open a file.
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

const hasMark = (raw: string): boolean => raw.charCodeAt(0) === 0xfeff;

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

/**
 * The line end a text uses, or null where it has none — a text of one line
 * says nothing about line ends.
 *
 * Counted rather than sniffed from the first one: a file that is mostly CRLF
 * with one stray LF is a CRLF file, and the reverse is a file someone edited
 * on the other platform. The majority is the one that keeps the diff small.
 * Every line end counts, the empty lines between two paragraphs included.
 */
function lineEndOf(raw: string): TextFileShape["eol"] | null {
  const all = count(raw, /\n/g);
  if (all === 0) return null;
  const crlf = count(raw, /\r\n/g);
  return crlf > all - crlf ? "\r\n" : "\n";
}

/**
 * Splits a freshly read file into the text an editor works with and the shape
 * the file had. The editor always holds LF internally.
 */
export function readTextShape(raw: string): { text: string; shape: TextFileShape } {
  const bom = hasMark(raw);
  const body = bom ? raw.slice(1) : raw;
  return { text: body.replace(/\r\n/g, "\n"), shape: { eol: lineEndOf(body) ?? "\n", bom } };
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
 * An editor's `text` in the shape the file `model` has — for a text that takes
 * a file's place: the side of a comparison the reader worked on and adopts, a
 * listing Plainva writes anew over the one that is there.
 */
export function inShapeOf(model: string, text: string): string {
  return applyTextShape(editorTextOf(text), readTextShape(model).shape);
}

/**
 * Runs an edit that thinks in `\n` on a file's text and hands the result back
 * in the file's shape — for the writers outside an editor that add or replace
 * a line of a note: a link appended from the graph, a checkbox added on a
 * card, a checkbox that became a task.
 *
 * Each of them built its line with `\n` and wrote the note back. In a note
 * that lies there with `\r\n` that was one line of the other kind per write —
 * and in a short note enough of them to tip the count, after which the next
 * save from an editor turned every line end of it. An edit that changes
 * nothing gives the file back byte for byte, whatever its line ends are.
 */
export function editInShape(raw: string, edit: (text: string) => string): string {
  const { text, shape } = readTextShape(raw);
  const next = edit(text);
  return next === text ? raw : applyTextShape(next, shape);
}

const fileTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true });
const strictFileTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });

/**
 * The bytes of a text file as its text — what every vault adapter hands out
 * for a file: UTF-8, with a byte order mark as the first character where the
 * file has one. The decoder is told to leave the mark alone; left to itself it
 * drops it, and the text no longer says what the file looks like.
 *
 * `strict` throws on bytes that are not UTF-8 instead of replacing them — for
 * a caller that is about to write the text back as the file.
 */
export function textOfFileBytes(bytes: Uint8Array, options: { strict?: boolean } = {}): string {
  return (options.strict ? strictFileTextDecoder : fileTextDecoder).decode(bytes);
}

/**
 * The shape a merge leaves.
 *
 * A merge works on lines. What stands between them and in front of the first
 * one is no line of anybody's — but it is something either side may have
 * changed: a tool that turned the line ends, a program that wrote the file
 * back without its mark. So it is merged the way a line is. Where one side
 * changed it and the other did not, the change stands; where neither did,
 * nothing moves. The two sides cannot have changed it in two directions —
 * there are two line ends, and a mark is there or it is not — so there is no
 * conflict to have.
 *
 * A text without a line end says nothing about line ends. And where the
 * ancestor says nothing — there is none (`base` null), or it had one line —
 * nobody can be said to have changed anything. Then `theirs` decides: in every
 * merge of this code that is the version that is ALREADY THERE — the file on
 * disk for a save, the server's version for a sync —, while `yours` may carry
 * nothing but an editor's default. A device that joins a sync with the same
 * notes in other line ends takes the ones the others hold; it does not push
 * its own to all of them.
 */
export function mergedTextShape(base: string | null, yours: string, theirs: string): TextFileShape {
  // Yours stands where the ancestor agrees with theirs (yours changed it), theirs everywhere else.
  const merged = <T>(b: T | null, y: T | null, t: T | null): T | null =>
    y === null ? t ?? b : t === null || t === y ? y : b === t ? y : t;
  const body = (raw: string) => (hasMark(raw) ? raw.slice(1) : raw);
  return {
    eol: merged(base === null ? null : lineEndOf(body(base)), lineEndOf(body(yours)), lineEndOf(body(theirs))) ?? "\n",
    bom: merged(base === null ? null : hasMark(base), hasMark(yours), hasMark(theirs)) ?? false,
  };
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
