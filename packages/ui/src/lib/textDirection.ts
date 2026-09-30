/**
 * Right-to-left text in a note (issue 111, plan Issues und Diskussionen
 * 2026-09-30, Teil R, decision E7).
 *
 * ONE rule for every place that shows note text as a document: the live
 * editor, the source editor, the phone's read mode (the same editor session)
 * and the desktop reading view. They call these functions and never decide on
 * their own, so a paragraph cannot sit on the right in one mode and on the
 * left in the other.
 *
 * The rule is the one the Unicode bidi algorithm uses for a paragraph (P2/P3)
 * and the one browsers, GitHub and messengers apply: a block takes the
 * direction of its FIRST STRONG CHARACTER. What is new is where the search
 * starts - behind the Markdown syntax, read from the source text:
 *
 * - `- [x] مهمة` is a finished task in Arabic. `dir="auto"` on the rendered
 *   line sees the `x` of the revealed syntax first (a strong Latin letter) and
 *   flips the line to the left the moment the caret enters it. Here the list
 *   marker and the task box are skipped, so the line stays right-to-left.
 * - A new, empty list item `- ` has no strong character at all. It keeps the
 *   direction of the line before it, so after Enter the caret stays on the
 *   right edge instead of jumping to the left one.
 *
 * Blocks are paragraphs, list items (with their continuation lines),
 * headings, table rows as one table, and the paragraphs inside a quote or
 * callout. A block without a strong character inherits the direction of the
 * text before it; so does a blank line. Fenced code, math blocks and the
 * frontmatter always run left to right.
 *
 * Pure: no DOM, no editor state - a string (or the lines of one) in,
 * directions out.
 */

export type TextDirection = "ltr" | "rtl";

/**
 * Strong right-to-left characters (bidi classes R and AL): Hebrew, Arabic
 * (Persian and Urdu included), Syriac, Thaana, NKo, Samaritan, Mandaic, the
 * Arabic extensions and presentation forms, and the supplementary RTL
 * blocks. Digits (AN/EN) and combining marks (NSM) in these blocks are weak
 * or neutral and are carved out, so "٤٢" alone decides nothing.
 */
function isRtlStrong(cp: number): boolean {
  if (cp < 0x0590) return false;
  if (cp <= 0x08ff) {
    // Hebrew
    if (cp <= 0x05ff) {
      if (cp >= 0x0591 && cp <= 0x05c7) {
        // Points and accents are NSM; the punctuation among them is R.
        return cp === 0x05be || cp === 0x05c0 || cp === 0x05c3 || cp === 0x05c6;
      }
      return cp >= 0x05d0;
    }
    // Arabic, Syriac, Arabic Supplement, Thaana, NKo, Samaritan, Mandaic,
    // Syriac Supplement, Arabic Extended-B/-A.
    if (cp <= 0x0605) return false; // number signs (AN)
    if (cp === 0x060c) return false; // Arabic comma (CS)
    if (cp >= 0x0610 && cp <= 0x061a) return false; // marks
    if (cp >= 0x064b && cp <= 0x065f) return false; // harakat
    if (cp >= 0x0660 && cp <= 0x066c) return false; // Arabic-Indic digits + separators
    if (cp === 0x0670) return false;
    if (cp >= 0x06d6 && cp <= 0x06ed) return cp === 0x06dd ? false : cp === 0x06e5 || cp === 0x06e6;
    if (cp >= 0x06f0 && cp <= 0x06f9) return false; // Extended Arabic-Indic (Persian) digits
    if (cp === 0x0711) return false;
    if (cp >= 0x0730 && cp <= 0x074a) return false; // Syriac marks
    if (cp >= 0x07a6 && cp <= 0x07b0) return false; // Thaana vowels
    if (cp >= 0x07c0 && cp <= 0x07c9) return false; // NKo digits
    if (cp >= 0x07eb && cp <= 0x07f3) return false; // NKo marks
    return true;
  }
  if (cp >= 0xfb1d && cp <= 0xfdff) return cp !== 0xfb1e && !(cp >= 0xfd3e && cp <= 0xfd3f);
  if (cp >= 0xfe70 && cp <= 0xfefe) return true;
  if (cp >= 0x10800 && cp <= 0x10fff) return true;
  if (cp >= 0x1e800 && cp <= 0x1efff) return true;
  return false;
}

const LETTER = /\p{L}/u;

/** The direction of one character when it is strong, else null. */
function strongDirection(cp: number, ch: string): TextDirection | null {
  if (cp < 0x80) return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) ? "ltr" : null;
  if (isRtlStrong(cp)) return "rtl";
  return LETTER.test(ch) ? "ltr" : null;
}

/** A quick, deliberately generous test: can this text hold RTL at all? */
const MAY_BE_RTL = /[֐-ࣿיִ-﷿ﹰ-﻾]|[\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u;

/**
 * Whether the text contains a character from a right-to-left script. False
 * means every line of it is left-to-right and a caller can skip the rest -
 * which is the case for almost every note, and keeps their layout untouched.
 */
export function mayContainRtl(text: string): boolean {
  return MAY_BE_RTL.test(text);
}

/**
 * The first strong direction in a run of INLINE Markdown, or null. Syntax the
 * reader never shows as text is skipped: HTML tags and comments (comment
 * anchors are comments), entities, footnote references, image and embed
 * targets, link destinations, and the target of a wiki link that shows an
 * alias.
 */
export function firstStrongDirection(text: string): TextDirection | null {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 0x5c /* \ */) {
      // An escaped character is literal, and an escaped ASCII char is never a letter that matters.
      i += 2;
      continue;
    }
    if (c === 0x3c /* < */) {
      if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i + 4);
        i = end < 0 ? n : end + 3;
        continue;
      }
      const tag = /^<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>])[^>]*>/.exec(text.slice(i, i + 512));
      if (tag) {
        i += tag[0].length;
        continue;
      }
    }
    if (c === 0x26 /* & */) {
      const entity = /^&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.exec(text.slice(i, i + 40));
      if (entity) {
        i += entity[0].length;
        continue;
      }
    }
    if (c === 0x21 /* ! */ && text.charCodeAt(i + 1) === 0x5b /* [ */) {
      // ![[embed]] and ![alt](src): a widget, not text.
      if (text.charCodeAt(i + 2) === 0x5b) {
        const end = text.indexOf("]]", i + 3);
        i = end < 0 ? n : end + 2;
        continue;
      }
      const close = text.indexOf("]", i + 2);
      if (close >= 0 && text.charCodeAt(close + 1) === 0x28 /* ( */) {
        const paren = text.indexOf(")", close + 2);
        i = paren < 0 ? n : paren + 1;
        continue;
      }
    }
    if (c === 0x5b /* [ */) {
      if (text.charCodeAt(i + 1) === 0x5b) {
        // [[target]] shows the target, [[target|alias]] the alias.
        const end = text.indexOf("]]", i + 2);
        if (end >= 0) {
          const inner = text.slice(i + 2, end);
          const pipe = inner.indexOf("|");
          const shown = pipe < 0 ? inner.replace(/#\^?/, " ") : inner.slice(pipe + 1);
          const dir = firstStrongDirection(shown);
          if (dir) return dir;
          i = end + 2;
          continue;
        }
      }
      if (text.charCodeAt(i + 1) === 0x5e /* ^ */) {
        const end = text.indexOf("]", i + 2);
        if (end >= 0) {
          i = end + 1;
          continue;
        }
      }
    }
    if (c === 0x5d /* ] */ && text.charCodeAt(i + 1) === 0x28 /* ( */) {
      // The destination of [label](url) is never shown.
      const paren = text.indexOf(")", i + 2);
      i = paren < 0 ? n : paren + 1;
      continue;
    }
    const cp = text.codePointAt(i)!;
    const ch = cp > 0xffff ? text.slice(i, i + 2) : text[i];
    const dir = strongDirection(cp, ch);
    if (dir) return dir;
    i += ch.length;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Line structure

const QUOTE_PREFIX = /^[ \t]{0,3}>[ \t]?/;
const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})/;
const HEADING = /^[ \t]{0,3}(#{1,6})(?=[ \t]|$)[ \t]*/;
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const TASK_BOX = /^\[[ xX/-]\](?:[ \t]+|$)/;
const CALLOUT = /^[ \t]*\[![\w-]+\][+-]?[ \t]*/;
const TABLE_ROW = /^[ \t]*\|/;
const MATH_FENCE = /^[ \t]*\$\$/;

type LineKind = "blank" | "code" | "heading" | "item" | "callout" | "table" | "text";

interface ClassifiedLine {
  kind: LineKind;
  /** The text behind the container and block syntax. */
  content: string;
  /** How many `>` stand in front of it. */
  quoteDepth: number;
}

interface ScanState {
  fence: { char: string; length: number } | null;
  math: boolean;
  frontmatter: boolean;
}

function stripQuotes(line: string): { rest: string; depth: number } {
  let rest = line;
  let depth = 0;
  for (let m = QUOTE_PREFIX.exec(rest); m; m = QUOTE_PREFIX.exec(rest)) {
    rest = rest.slice(m[0].length);
    depth++;
  }
  return { rest, depth };
}

function classify(raw: string, index: number, state: ScanState): ClassifiedLine {
  const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  if (state.frontmatter) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) state.frontmatter = false;
    return { kind: "code", content: "", quoteDepth: 0 };
  }
  if (index === 0 && /^---[ \t]*$/.test(line)) {
    state.frontmatter = true;
    return { kind: "code", content: "", quoteDepth: 0 };
  }
  const { rest, depth } = stripQuotes(line);
  if (state.fence) {
    const close = FENCE_OPEN.exec(rest);
    if (close && close[1][0] === state.fence.char && close[1].length >= state.fence.length && rest.slice(close[0].length).trim() === "") {
      state.fence = null;
    }
    return { kind: "code", content: "", quoteDepth: depth };
  }
  if (state.math) {
    if (rest.includes("$$")) state.math = false;
    return { kind: "code", content: "", quoteDepth: depth };
  }
  // A fence may open inside a list item, behind its marker.
  const behindMarker = rest.replace(LIST_MARKER, "");
  const fence = FENCE_OPEN.exec(behindMarker);
  if (fence && !(fence[1][0] === "`" && behindMarker.slice(fence[0].length).includes("`"))) {
    state.fence = { char: fence[1][0], length: fence[1].length };
    return { kind: "code", content: "", quoteDepth: depth };
  }
  if (MATH_FENCE.test(rest)) {
    const after = rest.slice(rest.indexOf("$$") + 2);
    if (!after.includes("$$")) state.math = true;
    return { kind: "code", content: "", quoteDepth: depth };
  }
  if (rest.trim() === "") return { kind: "blank", content: "", quoteDepth: depth };
  const heading = HEADING.exec(rest);
  if (heading) return { kind: "heading", content: rest.slice(heading[0].length), quoteDepth: depth };
  const callout = depth > 0 ? CALLOUT.exec(rest) : null;
  if (callout) return { kind: "callout", content: rest.slice(callout[0].length), quoteDepth: depth };
  const marker = LIST_MARKER.exec(rest);
  if (marker) {
    let content = rest.slice(marker[0].length);
    const box = TASK_BOX.exec(content);
    if (box) content = content.slice(box[0].length);
    return { kind: "item", content, quoteDepth: depth };
  }
  if (TABLE_ROW.test(rest)) return { kind: "table", content: rest, quoteDepth: depth };
  return { kind: "text", content: rest, quoteDepth: depth };
}

interface Block {
  first: number;
  last: number;
  kind: LineKind;
  quoteDepth: number;
  dir: TextDirection | null;
}

/**
 * The direction of every line of a Markdown document, index = line number - 1.
 * Accepts the whole text or its lines (a CodeMirror `doc.iterLines()` works).
 */
export function lineDirections(source: string | Iterable<string>): TextDirection[] {
  const lines = typeof source === "string" ? source.split("\n") : source;
  const state: ScanState = { fence: null, math: false, frontmatter: false };
  const kinds: LineKind[] = [];
  const depths: number[] = [];
  const blocks: Block[] = [];
  const blockOf: number[] = [];
  let open: Block | null = null;
  let index = 0;
  for (const raw of lines) {
    const line = classify(raw, index, state);
    kinds.push(line.kind);
    depths.push(line.quoteDepth);
    if (line.kind === "blank" || line.kind === "code") {
      open = null;
      blockOf.push(-1);
      index++;
      continue;
    }
    const continues =
      open !== null &&
      open.quoteDepth === line.quoteDepth &&
      ((line.kind === "text" && (open.kind === "text" || open.kind === "item")) ||
        (line.kind === "table" && open.kind === "table"));
    if (!continues) {
      open = { first: index, last: index, kind: line.kind, quoteDepth: line.quoteDepth, dir: null };
      blocks.push(open);
    }
    const block: Block = open!;
    block.last = index;
    if (block.dir === null) block.dir = firstStrongDirection(line.content);
    blockOf.push(blocks.length - 1);
    // A heading and a callout header are blocks of one line.
    if (line.kind === "heading" || line.kind === "callout") open = null;
    index++;
  }
  // A callout header without a strong title takes its body's direction: the
  // icon belongs on the side the callout's text starts from.
  for (const header of blocks) {
    if (header.kind !== "callout" || header.dir !== null) continue;
    for (let j = header.last + 1; j < kinds.length && depths[j] >= header.quoteDepth; j++) {
      if (blockOf[j] < 0) continue;
      const body = blocks[blockOf[j]];
      if (body.kind === "callout") break;
      if (body.dir) {
        header.dir = body.dir;
        break;
      }
    }
  }
  const out: TextDirection[] = new Array(kinds.length);
  let previous: TextDirection = "ltr";
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === "code") {
      out[i] = "ltr";
      continue;
    }
    if (kinds[i] === "blank") {
      out[i] = previous;
      continue;
    }
    const block = blocks[blockOf[i]];
    const dir: TextDirection = block.dir ?? previous;
    out[i] = dir;
    previous = dir;
  }
  return out;
}

/**
 * The direction of one block of Markdown (a paragraph, a list item, a
 * heading, a table cell): its first strong character behind the syntax, by
 * the same line reading `lineDirections` uses, and `fallback` when it holds
 * no strong character at all (the block then keeps the direction around it).
 */
export function textDirectionOf(source: string, fallback: TextDirection = "ltr"): TextDirection {
  const lines = source.split("\n");
  const state: ScanState = { fence: null, math: false, frontmatter: false };
  for (let i = 0; i < lines.length; i++) {
    const line = classify(lines[i], i, state);
    if (line.kind === "code" || line.kind === "blank") continue;
    const dir = firstStrongDirection(line.content);
    if (dir) return dir;
  }
  return fallback;
}
