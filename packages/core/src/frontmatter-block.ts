import { parseDocument, Document, isMap } from "yaml";
import { readTextShape } from "./textFileShape.js";

/**
 * The properties block of a note: where it is, how its YAML is read as a
 * document in which an entry can be found, and how a note gets a block or
 * loses one.
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
 * `frontmatterSpan`, `noteBodyOf` and `noteWithoutProperties` are the public
 * half (re-exported by `frontmatter-surgical.ts`). The rest is shared by the
 * modules that write properties and by the sanitizer for published slices,
 * and is not part of the package API.
 *
 * This module READS a block. It does not write one: a block that is there is
 * changed entry by entry, as text, in `frontmatter-entry.ts`. The function
 * that used to stand here and print the document the library had read —
 * `joinDocument` — wrote every block in the library's form, and with it values
 * nobody had asked to change (finding 2026-10-11).
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
  /**
   * The YAML between the two fences, without the line break that ends it; ""
   * for a block without a line. It is as long as the stretch of the note it
   * stands for, and that stretch itself but for one case: where a line of it
   * ends in a carriage return of its own, a `\n` stands here (`yamlLinesOf`).
   */
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
  return end === content.length || content[end] === "\n" || content[end] === "\r" ? end : -1;
}

/** The offset behind the line break at `at`: `\n`, `\r\n`, or a `\r` of its own. */
function behindLineBreak(content: string, at: number): number {
  return at + (content[at] === "\r" && content[at + 1] === "\n" ? 2 : 1);
}

const LONE_CARRIAGE_RETURN = /\r(?!\n)/g;

/**
 * A block's YAML with its lines as the YAML library reads them: a `\n` where a
 * line ends in a carriage return of its own. The text keeps its length.
 *
 * YAML ends a line at `\n`, at `\r\n` and at a `\r` alone, and so does the
 * Markdown parser that finds the block. The library that reads the YAML knows
 * the first two (measured 2026-10-11): `a: 1\rb: 2` is an error for it, a
 * list below `a:` one string, and in a note with `\r\r\n` line ends every
 * value ends in a `\r`. Handed such a block as it stands, the writers would
 * refuse it or — worse — write back what the library made of it.
 *
 * Both readers of a block's YAML go through here, so they cannot disagree on
 * what it says: `frontmatterSpan`, for everything that asks the definition,
 * and `extractFrontmatter`, for the node the Markdown parser hands the index
 * and the properties panel. They must not. The panel and a database cell
 * write what the index's reader handed them back as the whole block: a value
 * it misread would be written as misread, and a block it could not read
 * takes no write from them at all.
 */
export function yamlLinesOf(yaml: string): string {
  return yaml.includes("\r") ? yaml.replace(LONE_CARRIAGE_RETURN, "\n") : yaml;
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
 * two together.
 *
 * A line ends where that parser ends one: at `\n`, at `\r\n`, and at a `\r` of
 * its own — the line end of a file from a classic Mac, the first of the two in
 * `\r\r\n` (a file from Windows whose line ends were converted twice), or a
 * stray one in any file. The last was missing here until 2026-10-11: such a
 * note had properties for the index and the panel and none for the writers,
 * and a write put a second block on top of the first.
 */
export function frontmatterSpan(content: string): FrontmatterSpan | null {
  const open = fenceEnd(content, byteOrderMarkOf(content).length);
  if (open < 0 || open === content.length) return null;
  const yamlStart = behindLineBreak(content, open);
  let yamlEnd = yamlStart;
  // The next `\n` and the next `\r`, each looked for again only once the walk
  // has passed it (-2: not looked for yet, -1: there is none). A note that has
  // only one of the two is searched for the other once, not once per line.
  let lineFeed = -2;
  let carriageReturn = -2;
  for (let line = yamlStart; ; ) {
    const close = fenceEnd(content, line);
    if (close >= 0) {
      return {
        yaml: yamlLinesOf(content.slice(yamlStart, yamlEnd)),
        yamlStart,
        closeAt: line,
        end: close === content.length ? close : behindLineBreak(content, close),
      };
    }
    if (lineFeed !== -1 && lineFeed < line) lineFeed = content.indexOf("\n", line);
    if (carriageReturn !== -1 && carriageReturn < line) carriageReturn = content.indexOf("\r", line);
    const lineEnd = lineFeed < 0 ? carriageReturn : carriageReturn < 0 ? lineFeed : Math.min(lineFeed, carriageReturn);
    if (lineEnd < 0) return null;
    yamlEnd = lineEnd;
    line = behindLineBreak(content, lineEnd);
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

/**
 * The note without its properties block: its mark, then its text, byte for
 * byte — by the rule every writer follows when a block goes (`composeNote`).
 * A note without a block comes back as it is.
 */
export function noteWithoutProperties(content: string): string {
  const span = frontmatterSpan(content);
  if (!span) return content;
  return composeNote({ byteOrderMark: byteOrderMarkOf(content), yaml: "", body: content.slice(span.end), eol: readTextShape(content).shape.eol });
}

/**
 * The YAML between a block's fences as a document, or the one refusal for a
 * block the app cannot take for properties.
 *
 * Properties are a YAML map. A block without content — no line, blank lines,
 * comments only — is a block without entries. Anything else is an anomaly that
 * is refused and never repaired (ADR 0009, decision point 2): YAML that does
 * not parse, and YAML that is no map — text between two rules, a list, a
 * number, a `null` that is spelt out. The writers ask here, and so does the
 * sanitizer for published slices: a block that cannot be written by its
 * property names cannot be filtered by them either.
 *
 * `sourceTokens` keeps, on every node, the token it was read from (see
 * `splitDocument`).
 */
export function parseBlockYaml(yaml: string, options: { sourceTokens?: boolean } = {}): Document {
  const doc = options.sourceTokens ? parseDocument(yaml, { keepSourceTokens: true }) : parseDocument(yaml);
  if (doc.errors.length > 0) {
    throw new FrontmatterSurgicalError(
      `Frontmatter is not parseable YAML: ${doc.errors[0].message}`
    );
  }
  if (doc.contents !== null && !isMap(doc.contents)) {
    throw new FrontmatterSurgicalError("Frontmatter is not a YAML map");
  }
  return doc;
}

export interface SplitDocument {
  /** The block as the YAML library reads it; an empty document for a note without a block. */
  doc: Document;
  /** Where the block is in the note; null for a note without one. */
  span: FrontmatterSpan | null;
  /** The note's text behind the block. */
  body: string;
  hadFrontmatter: boolean;
  /** Whether the block carried an entry when it was read. */
  hadEntries: boolean;
  /** The line end a line gets that is new to the note. */
  eol: string;
  byteOrderMark: string;
  /** The note as it was read. */
  content: string;
}

/**
 * A note's block, read as a YAML document. Throws `FrontmatterSurgicalError`
 * for a block that is not parseable YAML or that is no map: such a note is
 * left alone, never written around.
 *
 * `sourceTokens` keeps, on every node, the token it was read from — for the
 * writers, which change an entry where it stands and need to know where that
 * is (`frontmatter-entry.ts`, `renameFrontmatterWikiLinks`).
 */
export function splitDocument(content: string, options: { sourceTokens?: boolean } = {}): SplitDocument {
  // The note's line end, by the one definition of it (`readTextShape`: what
  // most of its lines have). A single `\r\n` anywhere used to decide here, and
  // the block of a note with one stray line end was written in that one.
  //
  // That definition knows two line ends. A note whose lines end in a carriage
  // return of its own has neither, so a line that is new to it is written with
  // `\n` — the line end a new file gets. No writer sets a lone `\r`: this code
  // reads a block written with one (`yamlLinesOf`), a reader that takes the
  // YAML library's word does not. The lines that are there keep the line end
  // they have, whatever it is.
  const eol = readTextShape(content).shape.eol;
  const byteOrderMark = byteOrderMarkOf(content);
  const span = frontmatterSpan(content);

  if (!span) {
    const doc = new Document({});
    return { doc, span, body: content.slice(byteOrderMark.length), hadFrontmatter: false, hadEntries: false, eol, byteOrderMark, content };
  }

  const doc = parseBlockYaml(span.yaml, options);
  const hadEntries = isMap(doc.contents) && doc.contents.items.length > 0;
  return { doc, span, body: content.slice(span.end), hadFrontmatter: true, hadEntries, eol, byteOrderMark, content };
}
