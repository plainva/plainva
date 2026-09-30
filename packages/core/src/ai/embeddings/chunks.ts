/**
 * Notes as the pieces a local embedding model reads (plan KI-Harness §10.2,
 * P2a). The rule is the one the embedding spike measured (2026-09-30): the
 * note's ATX sections — outside fenced code, as the outline sees them
 * (`context/sections.ts`) — packed paragraph by paragraph up to a budget, each
 * piece led by the note's title and its heading chain, so "2026" under
 * "Costs" still reads as costs.
 *
 * Two changes against the spike, both so no text is lost:
 * - A paragraph heavier than the budget is split at a sentence end or a
 *   space, never cut off (the spike truncated it at 2,400 characters).
 * - Characters of scripts without spaces weigh three: the catalog's
 *   tokenizers spend 0.5–0.8 tokens on a Chinese or Japanese character and
 *   0.22–0.32 on a letter of the Latin-script languages (user guide, all ten
 *   languages), and a model reads at most 512 tokens — 1,200 Japanese
 *   characters would lose their second half.
 *
 * A chunk's hash is its text's: equal text, equal vector. An edit re-embeds
 * only the pieces it touched; a rename (new title, so new text) all of them.
 */
import { isSpacelessChar } from "../../vault/spacelessText.js";
import { sha256Hex, utf8Encode } from "../../workspace/encoding.js";
import { atxHeading, noteBody } from "../context/sections.js";

/** The weight a chunk's body may reach; its title and heading chain come on top. */
export const CHUNK_BUDGET = 1200;
/** The weight of one character of a script without spaces (see above). */
export const SPACELESS_WEIGHT = 3;

export interface NoteChunk {
  /** Position in the note, from 0. */
  ordinal: number;
  /** What the model reads: title and heading chain, a blank line, the text. */
  text: string;
  /** First 32 hex digits of the SHA-256 of `text`. */
  hash: string;
  /** The section handle (`sectionOf`): the heading chain, "" before the first heading. */
  chain: string;
  /** Where the chunk's text lies in the note content, frontmatter included. */
  from: number;
  to: number;
}

interface Span {
  from: number;
  to: number;
}

interface Section {
  chain: string[];
  paragraphs: Span[];
}

const HEAD_SEPARATOR = " › ";
const PARAGRAPH_JOIN = "\n\n";
/** Where a sentence may end: Latin and full-width stops, question and exclamation marks. */
const SENTENCE_END = /[.!?。！？｡]/;
const WHITESPACE = /\s/;
const MARK = /\p{M}/u;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const BLANK = /^\s*$/;

function charWeight(char: string): number {
  return char.codePointAt(0)! >= 0x0e00 && isSpacelessChar(char) ? SPACELESS_WEIGHT : 1;
}

/** The budget weight of a text: one per character, three per character of a script without spaces. */
export function chunkTextWeight(text: string): number {
  let weight = 0;
  for (const char of text) weight += charWeight(char);
  return weight;
}

/** A note's sections with their paragraphs (runs of non-blank lines), as offsets into `content`. */
function sectionsOf(content: string): Section[] {
  const body = noteBody(content);
  const base = content.length - body.length;
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let current: Section = { chain: [], paragraphs: [] };
  let open: Span | null = null;
  let fence: string | null = null;
  let offset = 0;
  const closeParagraph = () => {
    if (open) current.paragraphs.push({ from: base + open.from, to: base + open.to });
    open = null;
  };
  for (const line of body.split("\n")) {
    const from = offset;
    const to = offset + line.length;
    offset = to + 1;
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
    } else if (!fence) {
      const heading = atxHeading(line.replace(/\r$/, ""));
      if (heading) {
        closeParagraph();
        sections.push(current);
        while (stack.length && stack[stack.length - 1]!.level >= heading.level) stack.pop();
        stack.push(heading);
        current = { chain: stack.map((h) => h.text), paragraphs: [] };
        continue;
      }
    }
    if (BLANK.test(line)) closeParagraph();
    else if (open) open.to = to;
    else open = { from, to };
  }
  closeParagraph();
  sections.push(current);
  return sections.filter((section) => section.paragraphs.length > 0);
}

/** Where the code point before `index` starts (a surrogate pair is one). */
function previousCodePoint(content: string, index: number): number {
  const low = content.charCodeAt(index - 1);
  const high = content.charCodeAt(index - 2);
  return low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? index - 2 : index - 1;
}

/** A span without its surrounding whitespace, or null when nothing is left. */
function trimmed(content: string, span: Span): Span | null {
  let { from, to } = span;
  while (from < to && WHITESPACE.test(content[from]!)) from++;
  while (to > from && WHITESPACE.test(content[to - 1]!)) to--;
  return from < to ? { from, to } : null;
}

/**
 * A paragraph as parts within the budget: cut after the last sentence end in
 * the window's second half, else at its last space, else between two
 * characters (never between a character and its combining mark).
 */
function fitted(content: string, span: Span): Span[] {
  const parts: Span[] = [];
  let start = span.from;
  while (start < span.to) {
    let weight = 0;
    let at = start;
    let sentence = -1;
    let space = -1;
    while (at < span.to) {
      const char = String.fromCodePoint(content.codePointAt(at)!);
      const w = charWeight(char);
      if (weight + w > CHUNK_BUDGET) break;
      weight += w;
      at += char.length;
      if (SENTENCE_END.test(char)) sentence = at;
      else if (WHITESPACE.test(char)) space = at;
    }
    let cut = at;
    if (at < span.to) {
      if (sentence > start + (at - start) / 2) cut = sentence;
      else if (space > start) cut = space;
      else {
        while (MARK.test(String.fromCodePoint(content.codePointAt(cut)!))) {
          const previous = previousCodePoint(content, cut);
          if (previous <= start) break;
          cut = previous;
        }
      }
    }
    const part = trimmed(content, { from: start, to: cut });
    if (part) parts.push(part);
    start = cut;
  }
  return parts;
}

function chunkHash(text: string): string {
  return sha256Hex(utf8Encode(text)).slice(0, 32);
}

/** Line breaks as the model should read them, whatever the note was saved with. */
function plain(content: string, span: Span): string {
  return content.slice(span.from, span.to).replace(/\r\n?/g, "\n");
}

/**
 * The chunks of a note. `title` is the note's title (frontmatter `title` or
 * the file name); a note without any text becomes one chunk of its title, so
 * it can still be found by what it is called.
 */
export function chunkNote(title: string, content: string): NoteChunk[] {
  const chunks: NoteChunk[] = [];
  const push = (chain: string[], spans: Span[]) => {
    const head = [title, ...chain.filter((heading) => heading !== title)].join(HEAD_SEPARATOR);
    const text = `${head}${PARAGRAPH_JOIN}${spans.map((span) => plain(content, span)).join(PARAGRAPH_JOIN)}`;
    chunks.push({
      ordinal: chunks.length,
      text,
      hash: chunkHash(text),
      chain: chain.join(" > "),
      from: spans[0]!.from,
      to: spans[spans.length - 1]!.to,
    });
  };
  for (const section of sectionsOf(content)) {
    let piece: Span[] = [];
    let weight = 0;
    for (const paragraph of section.paragraphs) {
      const span = trimmed(content, paragraph);
      if (!span) continue;
      for (const part of fitted(content, span)) {
        const w = chunkTextWeight(content.slice(part.from, part.to));
        if (piece.length && weight + PARAGRAPH_JOIN.length + w > CHUNK_BUDGET) {
          push(section.chain, piece);
          piece = [];
          weight = 0;
        }
        weight += piece.length ? PARAGRAPH_JOIN.length + w : w;
        piece.push(part);
      }
    }
    if (piece.length) push(section.chain, piece);
  }
  if (!chunks.length && title.trim()) {
    chunks.push({ ordinal: 0, text: title, hash: chunkHash(title), chain: "", from: 0, to: 0 });
  }
  return chunks;
}
