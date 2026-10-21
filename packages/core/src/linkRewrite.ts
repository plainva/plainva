import { decodeMarkdownLinkTarget, encodeMarkdownLinkPath } from "./linkEncoding.js";
import { parseMarkdownAst } from "./markdown-parser.js";
import { wikiLinkInner, wikiLinkParts } from "./wikiLink.js";

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
 * A wiki link is a node of its own with its place (`wikiLinkSyntax.ts`,
 * finding 2026-10-11), and the text between its brackets is the text of the
 * note: where the file's name stands in it is read off (`wikiLinkParts`).
 * Until then such a link had to be found a second time — the parser handed
 * out a text's value with its backslashes and character references resolved,
 * and the link's place was looked for in the source —, and a link the two
 * readings spelled differently could not be placed.
 *
 * A Markdown link still has two readings. The parser hands out its
 * destination as it reads — backslash escapes and character references
 * resolved — and the place of the whole link. Where the destination stands is
 * found in the source, with its escapes taken out; where the two are not
 * spelled the same — a character reference in a destination — the link is
 * reported as `unplaced` instead of being guessed at: the caller says that a
 * link could not be updated, and no character of it moves.
 */

export interface NoteLink {
  type: "wikilink" | "embed" | "markdown-link";
  /**
   * The file the link names, as the index lists it (`links.target_path`):
   * without alias and anchor, trimmed; a Markdown link's destination decoded.
   */
  target: string;
  /** A wiki link's text between its brackets, as it stands in the note; "" for a Markdown link. */
  inner: string;
  /** The whole link in the note: `[[…]]`, `![[…]]`, `[label](destination)`. */
  start: number;
  end: number;
  /** The part of it that names the file — all a rename replaces. */
  targetStart: number;
  targetEnd: number;
  /** In a table cell, where a `|` has to be written `\|`. */
  inTable: boolean;
  /**
   * In the label of a link: `[see [[Note]]](other.md)`, `[see [[Note]]][ref]`.
   * No Markdown link can take its place there — links do not nest, and the
   * link around it would be text afterwards.
   */
  inLabel: boolean;
  /** A Markdown link whose destination stands in angle brackets: `[label](<a file.md>)`. */
  angle: boolean;
}

/**
 * A link that could not be rewritten where it stands: the parser reads it, but
 * its place in the text could not be told — or, from `rewriteNoteLinks`, it is
 * a wiki link and its new name is one a wiki link cannot carry.
 */
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

interface TreePoint {
  offset?: number;
}
interface TreeNode {
  type: string;
  value?: unknown;
  url?: unknown;
  embed?: unknown;
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

/**
 * A wiki link or an embed: its node says where it stands, and the text between
 * its brackets where the file's name stands in it.
 */
function wikiLinkOf(node: TreeNode, inTable: boolean, inLabel: boolean, out: NoteLinks): void {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number" || typeof node.value !== "string") return;
  const embed = node.embed === true;
  const type = embed ? "embed" : "wikilink";
  const inner = wikiLinkInner({ value: node.value, embed });
  const parts = wikiLinkParts(inner);
  // The node holds the characters of the note. Were it ever to hold another
  // number of them, its places would not be places in the note.
  if (end - start !== node.value.length) {
    out.unplaced.push({ type, target: parts.target });
    return;
  }
  const innerStart = start + (embed ? 3 : 2);
  out.links.push({
    type,
    target: parts.target,
    inner,
    start,
    end,
    targetStart: innerStart + parts.targetStart,
    targetEnd: innerStart + parts.targetEnd,
    inTable,
    inLabel,
    angle: false,
  });
}

function markdownLinkOf(text: string, node: TreeNode, inTable: boolean, inLabel: boolean, out: NoteLinks): void {
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
    inLabel,
    angle: destination.angle,
  });
}

/**
 * Walks the tree for its links, in the order of the text.
 *
 * What a link shows is its children — the label of an inline link and of a
 * link by reference (`[label][ref]`). A wiki link found below one of them
 * stands in a label, however deep (finding 2026-10-12).
 */
function collect(text: string, node: TreeNode, inTable: boolean, inLabel: boolean, out: NoteLinks): void {
  if (node.type === "link") markdownLinkOf(text, node, inTable, inLabel, out);
  else if (node.type === "wikiLink") wikiLinkOf(node, inTable, inLabel, out);
  const cell = inTable || node.type === "tableCell";
  const label = inLabel || node.type === "link" || node.type === "linkReference";
  for (const child of node.children ?? []) collect(text, child, cell, label, out);
}

/**
 * The links of a note with their places in it: wiki links and embeds in its
 * text, and inline Markdown links. Offsets count in `content` as it was read,
 * a byte order mark included — the parse counts every place in the text it is
 * given (`markdown-parser.ts`).
 *
 * Every link handed out is one the parser reads at that place, and the index
 * lists the same ones from the same tree.
 */
export function readNoteLinks(content: string): NoteLinks {
  const out: NoteLinks = { links: [], unplaced: [] };
  collect(content, parseMarkdownAst(content) as unknown as TreeNode, false, false, out);
  out.links.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Whether a wiki link can name this file as the name is written: `[[name]]`
 * reads back as one link, all of it, to that very name (finding 2026-10-21).
 * Between the brackets a name ends at the first `#`, `^` or `|`, its blanks at
 * either end are not part of it, and the first `]]` ends the link —
 * `[[C# Notes/index]]` names `C`. Asked of the reader itself, not of a list of
 * characters: `[[Meeting [draft] notes]]` is a link to that name. A backslash
 * at the end is no part of a name a link can carry: in front of an alias it
 * takes the bar for its own — `[[name\|alias]]` names `name`, and in a table
 * cell `\\|` ends the cell.
 */
export function wikiLinkCanName(target: string): boolean {
  if (target === "" || target.endsWith("\\")) return false;
  const written = `[[${target}]]`;
  const { links } = readNoteLinks(written);
  return links.length === 1 && links[0].type === "wikilink" && links[0].start === 0 && links[0].end === written.length && links[0].target === target;
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
 * A written destination, character by character as it is read: its backslash
 * escapes and its percent-encoding taken out — with the place each character
 * is written at. Null where that is not how the destination reads (a `%` that
 * encodes nothing).
 */
function spelling(written: string): Unescaped | null {
  const plain = unescaped(written, 0, written.length);
  if (!plain.text.includes("%")) return plain;
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
 * The part of a written destination that changes when it comes to name `to`
 * instead of `from`: what stands between the characters the two names begin
 * with and the characters they end with. Those stay as they are spelled — a
 * folder in another tool's encoding (`Projects%20(old)/`), an escaped
 * character (`My\_`), the extension —, and only `text` is written anew
 * between `start` and `end` of `written`.
 */
function changedPart(written: string, from: string, to: string): { start: number; end: number; text: string } {
  const read = spelling(written);
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
  const part = changedPart(written, link.target, target);
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
 * A wiki link's new target is written as the name it is: what stands between
 * the brackets is a file's name and is read as it is written (`wikiLink.ts`).
 * A name it cannot carry (`wikiLinkCanName`) is not written: that link stays
 * as it is and is counted with `unplaced` — it still names the file it named.
 * A Markdown link's destination is written so that it reads as the new target
 * (`destinationChange`).
 *
 * `rewritten` counts the links whose characters changed; a note in which none
 * did comes back as the very string that was handed in.
 */
export function rewriteNoteLinks(
  content: string,
  decide: (link: NoteLink) => NoteLinkChange | null | undefined
): { content: string; rewritten: number; unplaced: UnplacedNoteLink[] } {
  const { links, unplaced } = readNoteLinks(content);
  const left = [...unplaced];
  const edits: Edit[] = [];
  const seen = new Map<string, string | null>();
  const carried = new Map<string, boolean>();
  const canName = (target: string): boolean => {
    const known = carried.get(target);
    if (known !== undefined) return known;
    const answer = wikiLinkCanName(target);
    carried.set(target, answer);
    return answer;
  };
  for (const link of links) {
    const change = decide(link);
    if (!change) continue;
    if ("replacement" in change) {
      if (change.replacement !== content.slice(link.start, link.end)) edits.push({ from: link.start, to: link.end, text: change.replacement });
      continue;
    }
    if (link.type !== "markdown-link" && !canName(change.target)) {
      left.push({ type: link.type, target: link.target });
      continue;
    }
    const written = content.slice(link.targetStart, link.targetEnd);
    const part = link.type === "markdown-link" ? destinationChange(written, link, change.target, seen) : { start: 0, end: written.length, text: change.target };
    if (part.text !== written.slice(part.start, part.end)) edits.push({ from: link.targetStart + part.start, to: link.targetStart + part.end, text: part.text });
  }
  const { text, made } = withEdits(content, edits);
  return { content: text, rewritten: made, unplaced: left };
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
