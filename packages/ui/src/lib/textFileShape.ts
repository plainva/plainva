/**
 * The bytes a foreign text file arrived in, so it can leave in the same shape
 * (C15).
 *
 * Plainva's own notes are UTF-8 with LF — a house rule with its own ratchet,
 * and the editor has always normalised on load and written LF back. That is
 * right for a note and wrong for everything else: an `.ini` written on Windows,
 * a `.csv` exported with a BOM for Excel, a `.bat` that a shell reads line by
 * line — none of them are ours. Opening one and saving it would rewrite every
 * line ending in the file, produce a diff of "the whole file" in the user's
 * version control, and in the `.bat` case change what the file DOES.
 *
 * So a text file's shape is read once when it loads and restored when it saves.
 * Note that this is not an encoding guess: we only remember what we found.
 */
export interface TextFileShape {
  /** The line ending the file used. Mixed endings collapse to the majority. */
  eol: "\n" | "\r\n";
  /** Whether the file started with a UTF-8 byte order mark. */
  bom: boolean;
}

export const DEFAULT_TEXT_SHAPE: TextFileShape = { eol: "\n", bom: false };

/**
 * Splits a freshly read file into the text the editor works with and the shape
 * to put back. The editor always holds LF internally — CodeMirror normalises
 * anyway, so pretending otherwise would only move the problem.
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

/** Puts the remembered shape back around the editor's LF text. */
export function applyTextShape(text: string, shape: TextFileShape): string {
  const body = shape.eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
  return shape.bom ? `\uFEFF${body}` : body;
}
