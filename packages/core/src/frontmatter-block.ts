import { parseDocument, Document, YAMLMap, isMap } from "yaml";
import { readTextShape } from "./textFileShape.js";

/**
 * The properties block of a note: where it is, how its YAML becomes a document
 * that can be edited, and how the note is put together again afterwards.
 *
 * There is ONE answer to each of the three, and it lives here (finding
 * 2026-10-07). Before, some thirty places carried a pattern of their own for
 * "the note starts with `---`, the block ends at the next `---`", and nearly
 * all of them wanted a line between the two fences. The writers, though, wrote
 * a block that had lost its last entry as `---` directly on `---`: a block no
 * reader recognised afterwards. The next write put a second block on top and
 * the two old fences became rules in the note; and with a rule further down in
 * the text, the readers took everything up to that rule for YAML.
 *
 * `frontmatterSpan` and `noteBodyOf` are the public half (re-exported by
 * `frontmatter-surgical.ts`). The rest is shared by the two modules that write
 * properties and is not part of the package API.
 */

/** Raised when a document cannot be edited safely (caller should skip the file). */
export class FrontmatterSurgicalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterSurgicalError";
  }
}

/** The properties block at the top of a note, by its offsets. */
export interface FrontmatterSpan {
  /** The YAML between the two fences, without the line break that ends it; "" for a block without a line. */
  yaml: string;
  /** Where the YAML begins: behind the opening fence. */
  yamlStart: number;
  /** Where the line that closes the block begins. */
  closeAt: number;
  /** Where the note's text begins: behind the closing fence. */
  end: number;
}

const BYTE_ORDER_MARK = 0xfeff;

/** A byte order mark the note starts with, or "". It stays where it is: at the very start of the file. */
export function byteOrderMarkOf(content: string): string {
  return content.charCodeAt(0) === BYTE_ORDER_MARK ? content[0] : "";
}

/**
 * Where a fence that starts at `at` ends — in front of its line break, or at
 * the end of the text —, or -1 when the line is no fence. A fence is `---`
 * with nothing behind it but blanks.
 */
function fenceEnd(content: string, at: number): number {
  if (!content.startsWith("---", at)) return -1;
  let end = at + 3;
  while (content[end] === " " || content[end] === "\t") end++;
  if (end === content.length || content[end] === "\n") return end;
  return content[end] === "\r" && content[end + 1] === "\n" ? end : -1;
}

/** The offset behind the line break at `at` (`\n` or `\r\n`). */
function behindLineBreak(content: string, at: number): number {
  return at + (content[at] === "\r" ? 2 : 1);
}

/**
 * Where the properties block of a note is, or null where the note has none.
 * Everything that has to say "this is the block" or "the text starts here"
 * asks here, so there is one answer to what a properties block is:
 *
 *  - it opens on the note's first line, and that line is `---`;
 *  - it closes on the next line that is `---`;
 *  - that may be the very next line: `---` directly on `---` is a block without
 *    entries, not two rules. A closing fence is therefore never looked for
 *    behind one that already stands there — a rule further down in the text
 *    belongs to the text;
 *  - without a closing fence there is no block: a single `---` is a rule.
 *
 * This is what the Markdown parser reads (`remark-frontmatter`, which feeds the
 * index and the properties panel), including what it tolerates: blanks behind
 * a fence, and a byte order mark in front of the first one. A test holds the
 * two together. Line breaks are `\n` and `\r\n`.
 */
export function frontmatterSpan(content: string): FrontmatterSpan | null {
  const open = fenceEnd(content, byteOrderMarkOf(content).length);
  if (open < 0 || open === content.length) return null;
  const yamlStart = behindLineBreak(content, open);
  let yamlEnd = yamlStart;
  for (let line = yamlStart; ; ) {
    const close = fenceEnd(content, line);
    if (close >= 0) {
      return {
        yaml: content.slice(yamlStart, yamlEnd),
        yamlStart,
        closeAt: line,
        end: close === content.length ? close : behindLineBreak(content, close),
      };
    }
    const lineFeed = content.indexOf("\n", line);
    if (lineFeed < 0) return null;
    yamlEnd = lineFeed > line && content[lineFeed - 1] === "\r" ? lineFeed - 1 : lineFeed;
    line = lineFeed + 1;
  }
}

/** The note's text: what follows its properties block, or all of it where it has none. */
export function noteBodyOf(content: string): string {
  const span = frontmatterSpan(content);
  return span ? content.slice(span.end) : content;
}

/**
 * A note from its properties and its text. `yaml` is the block's content, ""
 * for none.
 *
 * Without properties there is no block: the text IS the note, byte for byte.
 * An empty pair of fences is left only where the text itself opens with a
 * `---` line — at the top of the file that line would open a block of its own,
 * and what the user wrote below it would turn into properties.
 */
export function composeNote(parts: { byteOrderMark: string; yaml: string; body: string; eol: string }): string {
  const { byteOrderMark, yaml, body, eol } = parts;
  if (yaml) return `${byteOrderMark}---${eol}${yaml}${eol}---${eol}${body}`;
  return fenceEnd(body, 0) >= 0 ? `${byteOrderMark}---${eol}---${eol}${body}` : `${byteOrderMark}${body}`;
}

export interface SplitDocument {
  doc: Document;
  /** The note's text behind the block. */
  body: string;
  hadFrontmatter: boolean;
  /** Whether the block carried an entry when it was read. */
  hadEntries: boolean;
  eol: string;
  byteOrderMark: string;
  /** The note as it was read. */
  content: string;
}

export function splitDocument(content: string): SplitDocument {
  // The note's line end, by the one definition of it (`readTextShape`: what
  // most of its lines have). A single `\r\n` anywhere used to decide here, and
  // the block of a note with one stray line end was written in that one.
  const eol = readTextShape(content).shape.eol;
  const byteOrderMark = byteOrderMarkOf(content);
  const span = frontmatterSpan(content);

  if (!span) {
    const doc = new Document({});
    return { doc, body: content.slice(byteOrderMark.length), hadFrontmatter: false, hadEntries: false, eol, byteOrderMark, content };
  }

  const doc = parseDocument(span.yaml);
  if (doc.errors.length > 0) {
    throw new FrontmatterSurgicalError(
      `Frontmatter is not parseable YAML: ${doc.errors[0].message}`
    );
  }
  if (doc.contents !== null && !isMap(doc.contents)) {
    throw new FrontmatterSurgicalError("Frontmatter is not a YAML map");
  }
  const hadEntries = isMap(doc.contents) && doc.contents.items.length > 0;
  return { doc, body: content.slice(span.end), hadFrontmatter: true, hadEntries, eol, byteOrderMark, content };
}

export function ensureMapContents(doc: Document): YAMLMap {
  if (doc.contents === null || doc.contents === undefined) {
    doc.contents = doc.createNode({}) as unknown as Document["contents"];
  }
  if (!isMap(doc.contents)) {
    throw new FrontmatterSurgicalError("Frontmatter is not a YAML map");
  }
  return doc.contents;
}

/**
 * The note after an edit of its properties.
 *
 * A block that still has entries is written between its fences. One that lost
 * its last entry goes, fences included (`composeNote`) — set and removed again,
 * a property leaves the note as it was. And where nothing was there and nothing
 * is, the note comes back untouched: no block is made for no entry, and an
 * empty block a note already carries is not tidied away in passing.
 */
export function joinDocument(split: SplitDocument): string {
  const { doc, eol, byteOrderMark } = split;
  const yaml = doc.toString().trim().replace(/\r?\n/g, eol);

  if (yaml !== "{}" && yaml !== "") {
    return composeNote({ byteOrderMark, yaml, body: split.body || eol, eol });
  }
  if (!split.hadEntries) return split.content;
  return composeNote({ byteOrderMark, yaml: "", body: split.body, eol });
}
