import { byteOrderMarkOf } from "./frontmatter-block.js";
import { decodeMarkdownLinkTarget, encodeMarkdownLinkPath } from "./linkEncoding.js";
import { wikiLinks, type WikiLinkMatch } from "./linkScan.js";
import { parseMarkdownAst } from "./markdown-parser.js";

/**
 * A link in a note is rewritten where it stands (finding 2026-10-09).
 *
 * A rename used to send every note that links to the renamed one through the
 * Markdown serializer: parse the note, change the link in the tree, write the
 * tree back. The serializer writes in its own style, so the note came back
 * reformatted — `* item` as `- item`, `*emphasis*` as `_emphasis_`, a table
 * rule `|---|---|` as `| - | - |`, a blank line behind the properties block, a
 * line end at the end of the file — and an aliased link in a table cell,
 * `[[Note\|alias]]`, lost the backslash that keeps its `|` out of the table:
 * the row had one cell more afterwards. For a vault kept in Git, renaming one
 * note was a diff across every note that links to it.
 *
 * Here the parser only says WHERE the links are. Which stretches of a note are
 * text and which are code, a properties block or HTML is its decision, as it is
 * for the index (`extractLinksAndTags` reads the same tree) — so the links
 * found here are the links a note's backlinks list. The note itself is never
 * written from the tree: a change replaces the characters of one link in the
 * text as it was read, and every other character, line end and mark stays.
 *
 * Two readings have to be brought together for that. The parser hands out a
 * text node's VALUE — backslash escapes and character references resolved,
 * the markers of a quote or a list taken off its continuation lines — and the
 * place of the whole node in the source. Where a link stands inside the node
 * is found in the source itself: its lines, each with its backslash escapes
 * taken out (`\|` in a table cell is the common one), are scanned by the scan
 * the index runs over the value. The two scans find the same number of links
 * in nearly every text, and then the n-th link read is the n-th link spelled:
 * where the two are spelled the same, that is its place; where they are not —
 * a character reference inside a link, `[[A &amp; B]]` — the link is reported
 * as `unplaced` instead of being guessed at: the caller says that a link
 * could not be updated, and no character of it moves.
 *
 * They find a different number where a character reference spells a bracket
 * (`&#91;[Old]]` is a link for the parser and none in the source). Then a link
 * is tried at the next place that is spelled like it, and the note is read
 * once more with a name of its own at that place (`readNoteLinks`): only a
 * link the parser reads THERE is handed out, so nothing is ever changed at a
 * place that merely looks like the link.
 */

export interface NoteLink {
  type: "wikilink" | "embed" | "markdown-link";
  /**
   * The file the link names, as the index lists it (`links.target_path`):
   * without alias and anchor, trimmed; a Markdown link's destination decoded.
   */
  target: string;
  /** A wiki link's text between its brackets as the parser reads it; "" for a Markdown link. */
  inner: string;
  /** The whole link in the note: `[[…]]`, `![[…]]`, `[label](destination)`. */
  start: number;
  end: number;
  /** The part of it that names the file — all a rename replaces. */
  targetStart: number;
  targetEnd: number;
  /** In a table cell, where a `|` has to be written `\|`. */
  inTable: boolean;
  /** A Markdown link whose destination stands in angle brackets: `[label](<a file.md>)`. */
  angle: boolean;
}

/** A link the parser reads whose place in the text could not be told. */
export interface UnplacedNoteLink {
  type: NoteLink["type"];
  target: string;
}

export interface NoteLinks {
  /** In the order they stand in the note. */
  links: NoteLink[];
  unplaced: UnplacedNoteLink[];
}

/** What becomes of one link: a new file to name, or other text in the link's place. */
export type NoteLinkChange = { target: string } | { replacement: string };

/** The links as they are read in one pass, and those among them whose place still has to be confirmed. */
interface Reading extends NoteLinks {
  tentative: Set<NoteLink>;
}

interface TreePoint {
  offset?: number;
}
interface TreeNode {
  type: string;
  value?: unknown;
  url?: unknown;
  children?: TreeNode[];
  position?: { start?: TreePoint; end?: TreePoint };
}

/** What a backslash escapes in Markdown: ASCII punctuation, nothing else. */
const ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const escapes = (text: string, at: number): boolean => text[at] === "\\" && at + 1 < text.length && ESCAPABLE.includes(text[at + 1]);

/** A stretch of the source with its backslash escapes taken out, and where each character stands. */
interface Unescaped {
  text: string;
  /** Per character: where it begins in the source — at its backslash, if it has one. */
  starts: number[];
  /** Per character: the offset behind it. */
  ends: number[];
}

function unescaped(text: string, from: number, to: number): Unescaped {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (let at = from; at < to; ) {
    const char = escapes(text, at) && at + 1 < to ? at + 1 : at;
    chars.push(text[char]);
    starts.push(at);
    ends.push(char + 1);
    at = char + 1;
  }
  return { text: chars.join(""), starts, ends };
}

/** The lines of the source between two offsets, each without its line break. */
function sourceLines(text: string, from: number, to: number): Array<{ start: number; end: number }> {
  const lines: Array<{ start: number; end: number }> = [];
  let start = from;
  for (let at = from; at < to; at++) {
    if (text[at] !== "\n" && text[at] !== "\r") continue;
    lines.push({ start, end: at });
    if (text[at] === "\r" && text[at + 1] === "\n" && at + 1 < to) at++;
    start = at + 1;
  }
  lines.push({ start, end: to });
  return lines;
}

/** The scan of the index (`remark-obsidian-preserve.ts`): `[[…]]` and `![[…]]` up to the first `]]` of the line. */
const WIKI = { bang: true, anyInLine: true } as const;

/** A wiki link found in a line of the source: where it stands in that line with its escapes taken out. */
interface WrittenLink {
  token: WikiLinkMatch;
  source: Unescaped;
}

function writtenLinks(text: string, line: { start: number; end: number }): WrittenLink[] {
  const source = unescaped(text, line.start, line.end);
  if (!source.text.includes("[[")) return [];
  const found: WrittenLink[] = [];
  for (const token of wikiLinks(source.text, WIKI)) found.push({ token, source });
  return found;
}

/**
 * A wiki link's target the way the index cuts it (`parseLinkTarget` in
 * ast-scanner.ts): the text in front of the first `|`, trimmed, up to the
 * first `#` or `^`. `at` is where it begins in `inner`.
 */
function wikiTarget(inner: string): { target: string; at: number } {
  const pipe = inner.indexOf("|");
  const raw = pipe < 0 ? inner : inner.slice(0, pipe);
  const trimmed = raw.trim();
  const hash = trimmed.indexOf("#");
  const caret = trimmed.indexOf("^");
  const anchor = hash < 0 ? caret : caret < 0 ? hash : Math.min(hash, caret);
  return { target: (anchor < 0 ? trimmed : trimmed.slice(0, anchor)).trim(), at: raw.length - raw.trimStart().length };
}

/**
 * The file a Markdown link's destination names: what stands in front of the
 * first `#` — the anchor marker of a destination —, decoded and trimmed. A
 * `#` that belongs to a file's name arrives encoded (`%23`) and is part of the
 * name. `from` and `to` are where that part stands in `url`, blanks aside.
 */
function markdownTarget(url: string): { target: string; from: number; to: number } {
  const hash = url.indexOf("#");
  const path = hash < 0 ? url : url.slice(0, hash);
  return { target: decodeMarkdownLinkTarget(path).trim(), from: path.length - path.trimStart().length, to: path.trimEnd().length };
}

/**
 * The destination of an inline link whose label ends in front of `from - 2`:
 * behind `](`, in angle brackets or bare. The parser has accepted the link, so
 * this only has to find where the destination ends.
 */
function destinationAt(text: string, from: number, limit: number): { start: number; end: number; angle: boolean } | null {
  let at = from;
  while (at < limit && (text[at] === " " || text[at] === "\t" || text[at] === "\n" || text[at] === "\r")) at++;
  if (text[at] === "<") {
    for (let end = at + 1; end < limit; end++) {
      if (escapes(text, end)) end++;
      else if (text[end] === ">") return { start: at + 1, end, angle: true };
      else if (text[end] === "<" || text[end] === "\n" || text[end] === "\r") return null;
    }
    return null;
  }
  let depth = 0;
  let end = at;
  for (; end < limit; end++) {
    const char = text[end];
    if (escapes(text, end)) end++;
    // A blank or a control character ends a bare destination.
    else if (char <= " " || char === "\x7f") break;
    else if (char === "(") depth++;
    else if (char === ")") {
      if (depth === 0) break;
      depth--;
    }
  }
  return { start: at, end: Math.min(end, limit), angle: false };
}

/** A link of a stretch read in one piece, and the link the index lists at that place, if it lists one. */
interface ReadLink {
  raw: string;
  own: WikiLinkMatch | undefined;
}

/**
 * The links of a stretch the parser cut up after reading it, read in one
 * piece — the way the source still spells it. In one piece it can hold a link
 * that is none for the index: `[[` at the end of an address and `]]` behind it
 * lie in two values. Such a link stands in the source all the same and takes
 * its place in the order there, so that the link behind it is not looked for
 * in the address.
 */
function readInOnePiece(values: readonly string[], listed: readonly WikiLinkMatch[][]): ReadLink[] {
  const begins: number[] = [];
  let length = 0;
  for (const value of values) {
    begins.push(length);
    length += value.length;
  }
  const read: ReadLink[] = [];
  let k = 0;
  // The next link of value `k` that has not been passed yet.
  let at = 0;
  for (const token of wikiLinks(values.join(""), WIKI)) {
    while (k + 1 < values.length && begins[k + 1] <= token.index) {
      k++;
      at = 0;
    }
    const own = listed[k];
    const index = token.index - begins[k];
    while (at < own.length && own[at].index < index) at++;
    read.push({ raw: token.raw, own: at < own.length && own[at].index === index && own[at].raw === token.raw ? own[at] : undefined });
  }
  return read;
}

/**
 * The wiki links of one stretch of text: the VALUES the parser read there, in
 * their order, and where that stretch stands in the source. Usually that is
 * one text node and its own place; `from` and `to` are undefined where the
 * place could not be told.
 */
function wikiLinksOf(text: string, values: readonly string[], from: number | undefined, to: number | undefined, inTable: boolean, out: Reading): void {
  if (!values.some((value) => value.includes("[["))) return;
  // The links as the source spells them, in their order.
  const written = from !== undefined && to !== undefined ? sourceLines(text, from, to).flatMap((line) => writtenLinks(text, line)) : [];
  // What the index lists for this text: the links of each value, read by itself.
  const listed = values.map((value) => (value.includes("[[") ? [...wikiLinks(value, WIKI)] : []));
  const read: ReadLink[] = values.length === 1 ? listed[0].map((token) => ({ raw: token.raw, own: token })) : readInOnePiece(values, listed);

  const placedAt = new Map<WikiLinkMatch, number>();
  // As many links read as spelled: the n-th is the n-th. A character reference
  // BESIDE a link, or one that puts a line break into the value (`&#10;`),
  // stands in nobody's way, and one INSIDE a link gives it another spelling
  // and leaves it unplaced.
  const oneForOne = read.length === written.length;
  if (oneForOne) {
    read.forEach((link, n) => {
      if (link.own && written[n].token.raw === link.raw) placedAt.set(link.own, n);
    });
  } else {
    // A reference has made a link the source does not spell, or unmade one it
    // spells. Each link is tried at the next place that is spelled like it;
    // whether the parser reads it there is asked before it is handed out.
    const bySpelling = new Map<string, { places: number[]; head: number }>();
    written.forEach((link, i) => {
      const same = bySpelling.get(link.token.raw);
      if (same) same.places.push(i);
      else bySpelling.set(link.token.raw, { places: [i], head: 0 });
    });
    let next = 0;
    for (const link of read) {
      const same = bySpelling.get(link.raw);
      while (same && same.head < same.places.length && same.places[same.head] < next) same.head++;
      if (!same || same.head >= same.places.length) continue;
      const found = same.places[same.head++];
      next = found + 1;
      if (link.own) placedAt.set(link.own, found);
    }
  }

  for (const tokens of listed) {
    for (const token of tokens) {
      const type = token.bang ? "embed" : "wikilink";
      const { target, at } = wikiTarget(token.inner);
      const found = placedAt.get(token);
      if (found === undefined) {
        out.unplaced.push({ type, target });
        continue;
      }
      const place = written[found];
      const { starts, ends } = place.source;
      const base = place.token.index + token.bang.length + 2 + at;
      const targetStart = starts[base];
      const link: NoteLink = {
        type,
        target,
        inner: token.inner,
        start: starts[place.token.index],
        end: ends[place.token.end - 1],
        targetStart,
        targetEnd: target.length > 0 ? ends[base + target.length - 1] : targetStart,
        inTable,
        angle: false,
      };
      out.links.push(link);
      if (!oneForOne) out.tentative.add(link);
    }
  }
}

function markdownLinkOf(text: string, node: TreeNode, inTable: boolean, out: NoteLinks): void {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  const url = node.url;
  if (typeof start !== "number" || typeof end !== "number" || typeof url !== "string") return;
  // `<https://…>` and a bare address are links without a destination to rewrite, and they name no file.
  if (text[start] !== "[") return;
  const { target, from, to } = markdownTarget(url);
  const children = node.children ?? [];
  const labelEnd = children.length > 0 ? children[children.length - 1].position?.end?.offset : start + 1;
  const destination = typeof labelEnd === "number" && text[labelEnd] === "]" && text[labelEnd + 1] === "(" ? destinationAt(text, labelEnd + 2, end) : null;
  const source = destination ? unescaped(text, destination.start, destination.end) : null;
  // The parser's `url` is the destination with its escapes and its character
  // references resolved. Only the escapes are followed here: a reference in a
  // destination leaves the link unplaced.
  if (!destination || !source || source.text !== url) {
    out.unplaced.push({ type: "markdown-link", target });
    return;
  }
  const targetStart = from < to ? source.starts[from] : (source.starts[from] ?? destination.end);
  out.links.push({
    type: "markdown-link",
    target,
    inner: "",
    start,
    end,
    targetStart,
    targetEnd: from < to ? source.ends[to - 1] : targetStart,
    inTable,
    angle: destination.angle,
  });
}

const startOf = (node: TreeNode): number | undefined => node.position?.start?.offset;
const endOf = (node: TreeNode): number | undefined => node.position?.end?.offset;
const placed = (node: TreeNode): boolean => typeof startOf(node) === "number" && typeof endOf(node) === "number";

/** The value of every text node in these nodes, in the order of the text. */
function textValues(nodes: readonly TreeNode[], into: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "text" && typeof node.value === "string") into.push(node.value);
    else if (node.children) textValues(node.children, into);
  }
  return into;
}

/**
 * Walks the tree for its links. A text node usually says where it stands.
 *
 * It does not where the parser has split it AFTER reading: an address the
 * tokenizer did not take for a link — `[www.example.com]`, one right behind an
 * HTML tag — is cut out of its text node afterwards, and the pieces carry no
 * place (`mdast-util-gfm-autolink-literal`). Such a run of pieces stands
 * between its neighbours, or between the edges of the node that holds it; the
 * markers a holder adds at its edges (`# `, `*`, a cell's `|`) hold no link.
 */
function collect(text: string, node: TreeNode, inTable: boolean, out: Reading): void {
  if (node.type === "link") markdownLinkOf(text, node, inTable, out);
  const children = node.children ?? [];
  const cell = inTable || node.type === "tableCell";
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (placed(child)) {
      if (child.type === "text") wikiLinksOf(text, textValues([child]), startOf(child), endOf(child), cell, out);
      else collect(text, child, cell, out);
      continue;
    }
    let last = i;
    while (last + 1 < children.length && !placed(children[last + 1])) last++;
    const from = i > 0 ? endOf(children[i - 1]) : startOf(node);
    const to = last + 1 < children.length ? startOf(children[last + 1]) : endOf(node);
    wikiLinksOf(text, textValues(children.slice(i, last + 1)), from, to, cell, out);
    i = last;
  }
}

/**
 * What holds the place of a second byte order mark while the note is parsed:
 * a no-break space. Like the mark it is no blank that Markdown takes off a
 * line and no punctuation, and like the mark it counts as white space where
 * emphasis and addresses are told — the parser reads the line the same.
 */
const SECOND_MARK = String.fromCharCode(0xa0);

/** One pass over the note: its links, and those whose place is only tried. */
function readOnce(content: string): Reading {
  // The parser skips a mark and counts from behind it; so it is handed the
  // text behind the mark, and the places are moved back afterwards.
  const mark = byteOrderMarkOf(content).length;
  const text = mark > 0 ? content.slice(mark) : content;
  // A second mark is a character of the text — for the index as well, which
  // hands the parser the file as it is. At the very start of what the parser
  // is handed HERE it would be taken for the mark and skipped too: the note
  // would be read without it, a properties block behind it would be one, and
  // every place would be one short.
  const parsed = byteOrderMarkOf(text) ? SECOND_MARK + text.slice(1) : text;
  const out: Reading = { links: [], unplaced: [], tentative: new Set() };
  collect(text, parseMarkdownAst(parsed) as unknown as TreeNode, false, out);
  if (mark > 0) {
    for (const link of out.links) {
      link.start += mark;
      link.end += mark;
      link.targetStart += mark;
      link.targetEnd += mark;
    }
  }
  out.links.sort((a, b) => a.start - b.start);
  return out;
}

/** A name no note holds and Markdown reads nothing into. */
const PROBE_NAME = "Zq7PlainvaLinkProbe";

/**
 * The links of a note with their places in it: wiki links and embeds in its
 * text, and inline Markdown links. Offsets count in `content` as it was read,
 * a byte order mark included.
 *
 * Every link handed out is one the parser reads at that place. Where its place
 * could only be tried (`wikiLinksOf`), the note is read once more with a name
 * of its own in each such link: a link that is read there under that name
 * stands there, and one that is not is `unplaced`.
 */
export function readNoteLinks(content: string): NoteLinks {
  const reading = readOnce(content);
  if (reading.tentative.size === 0) return { links: reading.links, unplaced: reading.unplaced };

  const tried = reading.links.filter((link) => reading.tentative.has(link));
  const probe = withEdits(
    content,
    tried.map((link, n) => ({ from: link.targetStart, to: link.targetEnd, text: `${PROBE_NAME}${n}` }))
  );
  const readThere = new Map<string, NoteLink>();
  for (const link of readOnce(probe.text).links) readThere.set(`${link.start} ${link.type}`, link);

  const links: NoteLink[] = [];
  const unplaced = [...reading.unplaced];
  // How far the names written in front of a link have moved it. Wiki links do
  // not lie in one another, so each name stands behind the start of its link
  // and in front of the next.
  let moved = 0;
  let n = 0;
  for (const link of reading.links) {
    if (!reading.tentative.has(link)) {
      links.push(link);
      continue;
    }
    const name = `${PROBE_NAME}${n++}`;
    const there = readThere.get(`${link.start + moved} ${link.type}`);
    if (there && there.target === name) links.push(link);
    else unplaced.push({ type: link.type, target: link.target });
    moved += name.length - (link.targetEnd - link.targetStart);
  }
  return { links, unplaced };
}

const beyondAscii = (text: string): boolean => {
  for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) > 0x7f) return true;
  return false;
};
const PERCENT_ESCAPE = /%[0-9a-fA-F]{2}/;
/** What cannot stand as it is between angle brackets, or would be read as something else there. */
const NOT_LITERAL = /[<>\\&%#\r\n]/;
/** Blanks and control characters, also those beyond ASCII: never left as they are in a destination. */
const BLANK_OR_CONTROL = /[\p{Z}\p{C}]/u;

/**
 * A new target as a Markdown link's destination, written the way the old one
 * was. Plainva's own form is the percent-encoding of `encodeMarkdownLinkPath`.
 * Two other forms are found in vaults and are kept, because the form of a
 * destination is not the file it names:
 *
 *  - between angle brackets a path may stand as it is (`<a file.md>`);
 *  - other tools encode a blank and leave letters beyond ASCII alone
 *    (`Über%20uns.md`), where Plainva's own form writes `%C3%9Cber%20uns.md`.
 */
function destinationFor(target: string, written: string, link: NoteLink): string {
  if (link.angle && !PERCENT_ESCAPE.test(written) && !NOT_LITERAL.test(target) && !(link.inTable && target.includes("|"))) return target;
  if (!beyondAscii(written)) return encodeMarkdownLinkPath(target);
  let out = "";
  for (const char of target) out += beyondAscii(char) && !BLANK_OR_CONTROL.test(char) ? char : encodeMarkdownLinkPath(char);
  return out;
}

const isHex = (char: string | undefined): boolean => char !== undefined && char.length === 1 && "0123456789abcdefABCDEF".includes(char);

/**
 * A written target, character by character as it is read: its backslash
 * escapes taken out and, in a Markdown link's destination, its
 * percent-encoding too — with the place each character is written at. Null
 * where that is not how the destination reads (a `%` that encodes nothing).
 */
function spelling(written: string, markdown: boolean): Unescaped | null {
  const plain = unescaped(written, 0, written.length);
  if (!markdown || !plain.text.includes("%")) return plain;
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (let at = 0; at < plain.text.length; ) {
    let read = plain.text[at];
    let length = 1;
    // One character is up to four encoded bytes.
    for (let bytes = 1; bytes <= 4 && plain.text[at + 3 * (bytes - 1)] === "%" && isHex(plain.text[at + 3 * bytes - 2]) && isHex(plain.text[at + 3 * bytes - 1]); bytes++) {
      try {
        read = decodeURIComponent(plain.text.slice(at, at + 3 * bytes));
        length = 3 * bytes;
        break;
      } catch {
        // Not a whole character yet: the next byte may complete it.
      }
    }
    for (let unit = 0; unit < read.length; unit++) {
      chars.push(read[unit]);
      starts.push(plain.starts[at]);
      ends.push(plain.ends[at + length - 1]);
    }
    at += length;
  }
  const text = chars.join("");
  return text === decodeMarkdownLinkTarget(plain.text) ? { text, starts, ends } : null;
}

const isHighSurrogate = (char: string | undefined): boolean => char !== undefined && char >= "\ud800" && char <= "\udbff";

/**
 * The part of a written target that changes when it comes to name `to`
 * instead of `from`: what stands between the characters the two names begin
 * with and the characters they end with. Those stay as they are spelled — a
 * folder in another tool's encoding (`Projects%20(old)/`), an escaped
 * character (`My\_`), the extension —, and only `text` is written anew
 * between `start` and `end` of `written`.
 */
function changedPart(written: string, from: string, to: string, markdown: boolean): { start: number; end: number; text: string } {
  const read = spelling(written, markdown);
  // Not spelled the way it reads: all of it is written anew.
  if (!read || read.text !== from) return { start: 0, end: written.length, text: to };
  const shorter = Math.min(from.length, to.length);
  let head = 0;
  while (head < shorter && from[head] === to[head]) head++;
  let tail = 0;
  while (tail < shorter - head && from[from.length - 1 - tail] === to[to.length - 1 - tail]) tail++;
  // Never through a character: one that is written as a single piece (an
  // encoded letter), or the two halves of one beyond the basic plane.
  while (head > 0 && ((head < from.length && read.starts[head] === read.starts[head - 1]) || isHighSurrogate(from[head - 1]))) head--;
  while (tail > 0 && (read.starts[from.length - tail] === read.starts[from.length - tail - 1] || isHighSurrogate(from[from.length - tail - 1]))) tail--;
  return {
    start: head < from.length ? read.starts[head] : written.length,
    end: tail > 0 ? read.starts[from.length - tail] : written.length,
    text: to.slice(head, to.length - tail),
  };
}

/**
 * A wiki target written the way the old one was: a character the note escapes
 * in the old name (`My\_Note`) is escaped in the new one. Whoever wrote the
 * backslash had a reason — a `_` or a `*` left bare can pair up with another
 * one further on, and the brackets around it are no link any more.
 */
function escapedLike(written: string, target: string): string {
  let escaped = "";
  for (let at = 0; at < written.length; at++) {
    if (!escapes(written, at)) continue;
    escaped += written[++at];
  }
  if (!escaped) return target;
  let out = "";
  for (const char of target) out += escaped.includes(char) ? `\\${char}` : char;
  return out;
}

/**
 * The file a destination names once the note is parsed, or null where it is
 * no destination. Asked of the parser itself, with the destination in a link
 * of its own: what a destination reads as does not depend on what stands
 * around the link. `seen` keeps the answers of one note.
 */
function destinationReadsAs(destination: string, angle: boolean, seen: Map<string, string | null>): string | null {
  const source = angle ? `[x](<${destination}>)` : `[x](${destination})`;
  let reads = seen.get(source);
  if (reads === undefined) {
    const paragraph = (parseMarkdownAst(source) as unknown as TreeNode).children?.[0];
    const link = paragraph?.children?.[0];
    // The link has to be all there is: a destination that ends early leaves text behind it.
    reads = paragraph?.children?.length === 1 && link?.type === "link" && typeof link.url === "string" ? markdownTarget(link.url).target : null;
    seen.set(source, reads);
  }
  return reads;
}

/**
 * What changes in a written destination for it to name `target`. First the
 * part of the name that changes, in the form the old destination has. A name
 * can be read as something else there: `&amp;` in it is a character reference,
 * `41` behind a `%` the note left bare is an encoded letter. So the new
 * destination is read back, and where it does not name the target, all of it
 * is written anew in Plainva's own encoding — with `&` encoded as well, which
 * that encoding leaves bare. (The rewrite in the tree had this from its
 * serializer, which put a backslash in front of such an `&`.)
 */
function destinationChange(written: string, link: NoteLink, target: string, seen: Map<string, string | null>): { start: number; end: number; text: string } {
  const part = changedPart(written, link.target, target, true);
  const text = destinationFor(part.text, written, link);
  if (destinationReadsAs(written.slice(0, part.start) + text + written.slice(part.end), link.angle, seen) === target) return { ...part, text };
  return { start: 0, end: written.length, text: encodeMarkdownLinkPath(target).replace(/&/g, "%26") };
}

/** A change to the text: the stretch from `from` to `to` becomes `text`. */
interface Edit {
  from: number;
  to: number;
  text: string;
}

/**
 * The text with these changes made, and the changes that were — one that lies
 * in a link which is replaced as a whole is not. A text nothing changes in
 * comes back as the very string that was handed in.
 */
function withEdits(content: string, edits: readonly Edit[]): { text: string; made: number } {
  // By the place of the change, not of the link: a wiki link in the label of
  // a Markdown link stands in front of that link's destination.
  const sorted = [...edits].sort((a, b) => a.from - b.from);
  const pieces: string[] = [];
  let cursor = 0;
  let made = 0;
  for (const edit of sorted) {
    if (edit.from < cursor) continue;
    pieces.push(content.slice(cursor, edit.from), edit.text);
    cursor = edit.to;
    made++;
  }
  if (made === 0) return { text: content, made };
  pieces.push(content.slice(cursor));
  return { text: pieces.join(""), made };
}

/**
 * Rewrites links of a note where they stand. `decide` sees every link and
 * answers what becomes of it: a new file for it to name — anchor, alias, label
 * and title stay as they are —, other text in its place, or nothing.
 *
 * A wiki link's new target is written as the name it is, the way the rewrite
 * in the tree wrote it; a Markdown link's destination is written so that it
 * reads as the new target (`destinationChange`).
 *
 * `rewritten` counts the links whose characters changed; a note in which none
 * did comes back as the very string that was handed in.
 */
export function rewriteNoteLinks(
  content: string,
  decide: (link: NoteLink) => NoteLinkChange | null | undefined
): { content: string; rewritten: number; unplaced: UnplacedNoteLink[] } {
  const { links, unplaced } = readNoteLinks(content);
  const edits: Edit[] = [];
  const seen = new Map<string, string | null>();
  for (const link of links) {
    const change = decide(link);
    if (!change) continue;
    if ("replacement" in change) {
      if (change.replacement !== content.slice(link.start, link.end)) edits.push({ from: link.start, to: link.end, text: change.replacement });
      continue;
    }
    const written = content.slice(link.targetStart, link.targetEnd);
    let part: { start: number; end: number; text: string };
    if (link.type === "markdown-link") {
      part = destinationChange(written, link, change.target, seen);
    } else {
      const changed = changedPart(written, link.target, change.target, false);
      part = { ...changed, text: escapedLike(written, changed.text) };
    }
    if (part.text !== written.slice(part.start, part.end)) edits.push({ from: link.targetStart + part.start, to: link.targetStart + part.end, text: part.text });
  }
  const { text, made } = withEdits(content, edits);
  return { content: text, rewritten: made, unplaced };
}

/**
 * Lets the links of a note name other files: `renames` maps a target as the
 * index lists it (`links.target_path`) to the target that takes its place.
 * Nothing but the part of a link that names the file changes.
 *
 * `unplaced` counts links that name one of these targets and could not be
 * rewritten — they still name the old file.
 */
export function renameNoteLinks(content: string, renames: ReadonlyMap<string, string>): { content: string; renamed: number; unplaced: number } {
  const wanted = (target: string) => target !== "" && renames.has(target);
  const result = rewriteNoteLinks(content, (link) => (wanted(link.target) ? { target: renames.get(link.target)! } : null));
  return { content: result.content, renamed: result.rewritten, unplaced: result.unplaced.filter((link) => wanted(link.target)).length };
}
