import { parseMarkdownTree } from "./markdown-parser.js";
import { stripAnchorMarkers } from "./workspace/commentAnchor.js";
import { plainWikiLinkInner, wikiLinkParts } from "./wikiLink.js";
import { SOURCE_LINE_END } from "./sourceLines.js";

interface SourceNode {
  type: string;
  value?: string;
  depth?: number;
  embed?: boolean;
  children?: SourceNode[];
  position?: { start: { offset: number }; end: { offset: number } };
}

const BYTE_ORDER_MARK = 0xfeff;

/**
 * The tree of `text`, every position an offset into `text` — also where the
 * text starts with a byte order mark, which the parser skips and counts from
 * behind. Everything here lays those offsets on the text again; that they
 * fit is the parse's own business now (`parseMarkdownTree`, which tells what
 * a note with a mark looked like while they did not).
 */
const treeFor = (text: string): SourceNode => parseMarkdownTree(text);
const textOf = (node: SourceNode): string => node.value ?? (node.children ?? []).map(textOf).join("");

export interface NoteSourceRange { from: number; to: number; line: number }
export interface NoteHeading extends NoteSourceRange { level: number; text: string; slug: string }
export interface NoteBlock extends NoteSourceRange { id: string; markerFrom: number; markerTo: number }

export function noteSlug(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function noteSlugger(): (text: string) => string {
  const used = new Set<string>();
  return (text) => {
    const base = noteSlug(text);
    let slug = base;
    for (let n = 1; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  };
}

/** Maps a parsed node back to its range in the unmodified note. */
function sourceRanger(raw: string, clean: ReturnType<typeof stripAnchorMarkers>): (node: SourceNode) => NoteSourceRange {
  // A line begins behind a line end as an editor reads one (`sourceLines.ts`),
  // a carriage return of its own included, as the parser reads it. Counted at
  // `\n` alone, every line of a note from a classic Mac was line 1 — the
  // journal found no entry in it, the outline jumped to its top (3.96).
  const lines = [0];
  const ends = new RegExp(SOURCE_LINE_END.source, "g");
  for (let match = ends.exec(raw); match; match = ends.exec(raw)) lines.push(match.index + match[0].length);
  return (node) => {
    const from = clean.toRaw(node.position!.start.offset);
    let lo = 0, hi = lines.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (lines[mid] <= from) lo = mid + 1; else hi = mid; }
    return { from, to: clean.toRaw(node.position!.end.offset, "before"), line: lo };
  };
}

export interface NoteOutlineNode extends NoteSourceRange {
  /** The Markdown block type: `heading`, `list`, `paragraph`, `code`, `yaml`, … */
  type: string;
  /** Level and text of a heading. */
  level?: number;
  text?: string;
  /** The items of a list, each with its own range. */
  items?: NoteSourceRange[];
}

/**
 * The TOP-LEVEL blocks of a note, in order. A heading inside a list item or a
 * quote is not in here, and neither is a line inside a code fence that merely
 * looks like one — which is what a caller needs who wants to know where a
 * section really ends. Ranges are UTF-16 offsets in the unmodified note, `line`
 * is 1-based, as in `analyzeNoteSource`.
 */
export function analyzeNoteOutline(raw: string): NoteOutlineNode[] {
  const clean = stripAnchorMarkers(raw);
  const range = sourceRanger(raw, clean);
  const outline: NoteOutlineNode[] = [];
  for (const node of treeFor(clean.text).children ?? []) {
    if (!node.position) continue;
    const entry: NoteOutlineNode = { ...range(node), type: node.type };
    if (node.type === "heading") { entry.level = node.depth!; entry.text = textOf(node); }
    if (node.type === "list") entry.items = (node.children ?? []).filter((item) => item.position).map(range);
    outline.push(entry);
  }
  return outline;
}

/**
 * A block id where it names its block: ` ^id` at the end of a paragraph,
 * behind a blank or on a line of its own. The id is the first group; the
 * match begins at the blank in front of the `^`.
 */
export const BLOCK_ID_MARKER = /(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9-]*)[ \t]*$/;

/** All ranges are UTF-16 offsets in the unmodified note, as in CodeMirror. */
export function analyzeNoteSource(raw: string): { headings: NoteHeading[]; blocks: NoteBlock[] } {
  const clean = stripAnchorMarkers(raw);
  const root = treeFor(clean.text);
  const headings: NoteHeading[] = [];
  const blocks: NoteBlock[] = [];
  const slug = noteSlugger();
  const range = sourceRanger(raw, clean);
  const walk = (parent: SourceNode, ancestors: SourceNode[]) => {
    for (const [index, node] of (parent.children ?? []).entries()) {
      if (!node.position || node.type === "code" || node.type === "yaml" || node.type === "html") continue;
      if (node.type === "heading") {
        const text = textOf(node);
        headings.push({ ...range(node), level: node.depth!, text, slug: slug(text) });
      }
      if (node.type === "paragraph" && node.children?.[node.children.length - 1]?.type === "text") {
        const source = clean.text.slice(node.position.start.offset, node.position.end.offset);
        const marker = BLOCK_ID_MARKER.exec(source);
        if (marker) {
          const own = source.trim() !== `^${marker[1]}`;
          const listItem = [...ancestors, parent].reverse().find((p) => p.type === "listItem");
          const addressed = own ? listItem ?? node : parent.children?.[index - 1];
          if (addressed?.position && addressed.type !== "yaml") {
            const start = node.position.start.offset + marker.index;
            blocks.push({ ...range(addressed), id: marker[1], markerFrom: clean.toRaw(start), markerTo: clean.toRaw(node.position.end.offset, "before") });
          }
        }
      }
      walk(node, [...ancestors, parent]);
    }
  };
  walk(root, []);
  return { headings, blocks };
}

export type NoteFragment =
  | { status: "found"; kind: "note" | "heading" | "block"; text: string; range: NoteSourceRange; slug: string | null }
  | { status: "missing" | "ambiguous" };

/** An embed never falls back to the entire note when its fragment is absent. */
export function selectNoteFragment(raw: string, anchor?: string | null, allowFirstHeading = false): NoteFragment {
  if (!anchor?.trim()) return { status: "found", kind: "note", text: raw, range: { from: 0, to: raw.length, line: 1 }, slug: null };
  let wanted = anchor.trim().replace(/^#/, "");
  try { wanted = decodeURIComponent(wanted); } catch { /* A literal percent sign. */ }
  const { headings, blocks } = analyzeNoteSource(raw);
  if (wanted.startsWith("^")) {
    const hits = blocks.filter((b) => b.id.toLowerCase() === wanted.slice(1).toLowerCase());
    if (hits.length !== 1) return { status: hits.length ? "ambiguous" : "missing" };
    const block = hits[0];
    return { status: "found", kind: "block", text: raw.slice(block.from, block.to), range: block, slug: null };
  }
  const chain = wanted.split("#").filter(Boolean).map((s) => s.trim().toLowerCase());
  wanted = chain[chain.length - 1] ?? "";
  let hits = headings.filter((h) => h.text.toLowerCase() === wanted);
  if (hits.length === 0) hits = headings.filter((h) => h.slug === noteSlug(wanted));
  if (chain.length > 1) hits = hits.filter((hit) => {
    const parents: NoteHeading[] = [];
    for (const h of headings) {
      while (parents.length && parents[parents.length - 1].level >= h.level) parents.pop();
      parents.push(h);
      if (h === hit) break;
    }
    return chain.every((part, i) => {
      const parent = parents[parents.length - chain.length + i];
      return parent && (parent.text.toLowerCase() === part || parent.slug === noteSlug(part));
    });
  });
  if (!hits.length) return { status: "missing" };
  if (hits.length > 1 && !allowFirstHeading) return { status: "ambiguous" };
  const heading = hits[0];
  const next = headings.find((h) => h.from > heading.from && h.level <= heading.level);
  const range = { from: heading.from, to: next?.from ?? raw.length, line: heading.line };
  return { status: "found", kind: "heading", text: raw.slice(range.from, range.to), range, slug: heading.slug };
}

interface ReaderEdit {
  from: number;
  to: number;
  text: string;
  embed?: string;
  /** Stretches of the source that stand in `text` as they are written (`start`/`end` within it): a place in them maps exactly. */
  visible?: Array<{ from: number; to: number; start: number; end: number }>;
}
interface ReaderSpan { from: number; to: number; start: number; end: number; exact: boolean }
export interface ReaderSource {
  text: string;
  embeds: { from: number; to: number; target: string }[];
  /** The wiki links and embeds as they stand in `text` (`[start, end)`, in order). */
  wikiLinks: ReadonlyArray<readonly [number, number]>;
  toRendered(offset: number, edge?: "start" | "end"): number;
  toOriginal(offset: number, edge?: "start" | "end"): number;
}
const encodeTarget = (text: string) => encodeURIComponent(text).replace(/[()!'*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** `@2026-09-24`, not glued to a word or an escape — tried where an `@` stands. */
const RELATIVE_DATE_AT = /(?<![\w\\])@(\d{4}-\d{2}-\d{2})\b/y;

/** The `@dates` of one text node, left to right. A wiki link is no text node, so a date in a link's name is none. */
function* relativeDates(source: string): Generator<{ index: number; raw: string; date: string }> {
  for (let at = source.indexOf("@"); at >= 0; at = source.indexOf("@", at + 1)) {
    RELATIVE_DATE_AT.lastIndex = at;
    const date = RELATIVE_DATE_AT.exec(source);
    if (date) yield { index: at, raw: date[0], date: date[1] };
  }
}

/** An alias longer than this is not looked through for its code spans; it is shown as it is written. */
const LONGEST_LABEL_READ = 2000;

/**
 * Whether a wiki link's alias can stand as the text of a Markdown link the way
 * it is written — the renderer then shows it as it shows the text around it:
 * `*the* alias` with its emphasis, a code span as one. It can where it keeps
 * to itself: no bracket in it (one would end the link text, or open a link of
 * its own), no `<`, no bare `|` (a table counts the cells of a line by them),
 * no `$` anywhere — once a note's math is read, a `$` pairs with one outside
 * the link, behind a backslash and in a code span too, for math reads
 * neither —, no backslash left over at its end, no `^` at its start (a
 * footnote's sign there), and every code span it opens closed again.
 */
function labelKeepsToItself(label: string): boolean {
  if (label.length > LONGEST_LABEL_READ || label.startsWith("^") || label.includes("$")) return false;
  // A table splits its line at every bar a backslash does not stand in front
  // of, in a code span too: it does so before anything else is read.
  for (let at = 0; at < label.length; at++) {
    if (label[at] === "\\") at++;
    else if (label[at] === "|") return false;
  }
  for (let at = 0; at < label.length; at++) {
    const char = label[at];
    if (char === "[" || char === "]" || char === "<") return false;
    if (char === "\\") {
      // The backslash and what it stands in front of are one piece — a `\|` the bar it spells.
      if (++at === label.length) return false;
    } else if (char === "`") {
      let run = 1;
      while (label[at + run] === "`") run++;
      // A code span ends at the next run of as many backticks.
      let close = at + run;
      for (;;) {
        close = label.indexOf("`", close);
        if (close < 0) return false;
        let length = 1;
        while (label[close + length] === "`") length++;
        if (length === run) break;
        close += length;
      }
      at = close + run - 1;
    }
  }
  return true;
}

/** CommonMark's ASCII punctuation: what a backslash in front of it escapes. */
const ASCII_PUNCTUATION = /[!-/:-@[-\x60{-~]/;
/** A letter or a digit: a run of `_` between two of them opens and closes nothing. */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;
/** An `&` that begins a character reference; one in front of anything else stays an `&`. */
const CHARACTER_REFERENCE = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{0,31});/y;

/**
 * What has to be spelled out in a label, so that the text of a Markdown link
 * shows it character for character as it is written: each such character with
 * its place in the label and its spelling. Only what Markdown would read
 * something into is spelled out — `my_note` and `Tom & Jerry` stand as they
 * are written, and a place in them stays a place in the rendered text.
 *
 * A backtick and a `$` are spelled as character references, not escaped:
 * inside a code span or math a backslash is a character like any other, so
 * `` \` `` would still close a code span opened before the link
 * (`Don`t [[Note|a `` b]]`), and `\$` the math of a `$` before it. A bare `|`
 * is escaped, for a table counts the cells of a line by them; a `\|` stays
 * the bar it spells (`wikiLink.ts`). (A `==…==` the reader marks wherever it
 * stands: it reads the text, not how it is written.)
 */
function* labelSpellings(label: string): Generator<{ at: number; text: string }> {
  for (let at = 0; at < label.length; at++) {
    const char = label[at];
    if (char === "\\") {
      const next = label[at + 1];
      if (next === "|") at++;
      // It escapes what follows it where that is punctuation — at the label's
      // end, the bracket that closes the link text.
      else if (next === undefined || ASCII_PUNCTUATION.test(next)) yield { at, text: "\\\\" };
    } else if (char === "_") {
      let end = at;
      while (label[end + 1] === "_") end++;
      const inert = at > 0 && end + 1 < label.length && WORD_CHARACTER.test(label[at - 1]) && WORD_CHARACTER.test(label[end + 1]);
      if (!inert) for (let mark = at; mark <= end; mark++) yield { at: mark, text: "\\_" };
      at = end;
    } else if (char === "&") {
      CHARACTER_REFERENCE.lastIndex = at;
      if (CHARACTER_REFERENCE.test(label)) yield { at, text: "\\&" };
    } else if (char === "`") yield { at, text: "&#96;" };
    else if (char === "$") yield { at, text: "&#36;" };
    else if (char === "^") {
      // A footnote's sign only where it opens the link text.
      if (at === 0) yield { at, text: "\\^" };
    } else if ("*~[]<>|".includes(char)) yield { at, text: `\\${char}` };
  }
}

/**
 * One source map for frontmatter, markers, CRLF, wiki syntax and relative dates.
 * Only prose is transformed — its text nodes and its wiki links; code, HTML
 * and link destinations stay literal. The original bytes are never rewritten
 * in the vault.
 */
/**
 * What an `![[...]]` embed points at. `note` is the fallback: everything that
 * is neither a picture nor a sound is another note, which the reader expands.
 */
export type ReaderEmbedKind = "image" | "audio" | "note";

export function prepareReaderSource(raw: string, options: { formatDate?: (iso: string) => string; embedKind?: (target: string) => ReaderEmbedKind; tables?: boolean } = {}): ReaderSource {
  const clean = stripAnchorMarkers(raw);
  const edits: ReaderEdit[] = [];
  const tree = treeFor(clean.text);
  const paragraphs: SourceNode[] = [];
  const links: Array<[number, number]> = [];
  const linkEdits: ReaderEdit[] = [];
  const literals: Array<[number, number]> = [];
  const walk = (node: SourceNode, inLink = false) => {
    if (node.position && node.type === "yaml") edits.push({ from: node.position.start.offset, to: node.position.end.offset, text: "" });
    // A setext heading is a paragraph with a line under it: its lines read as a paragraph's.
    if (node.type === "paragraph" || (node.type === "heading" && node.position && clean.text.slice(node.position.start.offset, node.position.end.offset).includes("\n"))) paragraphs.push(node);
    if (node.position && (node.type === "inlineCode" || node.type === "html")) literals.push([node.position.start.offset, node.position.end.offset]);
    if (node.position && node.type === "text" && !inLink && options.formatDate) {
      const start = node.position.start.offset;
      const source = clean.text.slice(start, node.position.end.offset);
      for (const m of relativeDates(source)) edits.push({ from: start + m.index, to: start + m.index + m.raw.length, text: options.formatDate(m.date) });
    }
    // A wiki link is the parser's node (`wikiLinkSyntax.ts`): what Markdown
    // would read into its name or alias does not unmake it (finding
    // 2026-10-11). Inside the text of another link it stays as it is written —
    // a link cannot hold a link.
    if (node.position && node.type === "wikiLink" && !inLink) {
      const from = node.position.start.offset, to = node.position.end.offset;
      links.push([from, to]);
      const innerFrom = from + (node.embed ? 3 : 2);
      const inner = clean.text.slice(innerFrom, to - 2);
      const parts = wikiLinkParts(inner);
      if (inner.length === 0) {
        // `[[]]` names nothing and is shown as it is written.
      } else if (node.embed) {
        // The renderer cuts the target at `|` itself.
        const target = plainWikiLinkInner(inner);
        // Three kinds, one scheme each, so the renderer branches on the URL
        // rather than sniffing the extension a second time (plan
        // Journal-Erweiterungen, X3). The fallback pattern stands for a host
        // that passes no port - it used to be the only answer.
        const kind = options.embedKind?.(target)
          ?? (/\.(?:png|jpe?g|gif|svg|webp|bmp|avif)(?:\||$)/i.test(target) ? "image" : "note");
        const scheme = kind === "note" ? "embed" : kind;
        const alt = kind === "image" ? "img" : kind === "audio" ? "audio" : "embed";
        { const edit: ReaderEdit = { from, to, text: `![${alt}](wiki-${scheme}://${encodeTarget(target)})`, embed: kind === "note" ? target : undefined }; edits.push(edit); linkEdits.push(edit); }
      } else {
        const target = inner.slice(0, parts.headEnd);
        const labelFrom = innerFrom + (parts.aliasStart < 0 ? 0 : parts.aliasStart);
        const label = clean.text.slice(labelFrom, to - 2);
        // A name is a file's name, shown as it is written — `[[__init__]]` is
        // no bold "init", `[[Tom &amp; Jerry]]` no "Tom & Jerry" —, the name
        // the link opens: what Markdown would read something into is spelled
        // out. An alias is the text the link shows, shown as the text around
        // it is where it keeps to itself.
        const spellings = parts.aliasStart < 0 || !labelKeepsToItself(label) ? [...labelSpellings(label)] : [];
        // One edit for the link, so that a place in what it hides (`[[`, a
        // target before an alias) stands for the whole link; a place in the
        // label, wherever it is not spelled out, is a place in the rendered
        // label.
        // Behind a `]` the link's text would read as the label of a reference
        // (`[x][[a]]` with `[a]: …` became `[x][a]` and a `(wiki://a)`, Sammelplan
        // § 3.133 Nr. 3): an empty comment, which the renderer drops, stands
        // between them. Not on a line that may be code — four blanks before
        // the `]`, which a block a formula closes leaves as code: nothing
        // written in is ever seen.
        let text = clean.text[from - 1] === "]" && !mayBeCode(clean.text, from - 1) ? "<!---->[" : "[";
        const visible: NonNullable<ReaderEdit["visible"]> = [];
        let at = 0;
        for (const spelled of [...spellings, { at: label.length, text: "" }]) {
          if (spelled.at > at) {
            visible.push({ from: labelFrom + at, to: labelFrom + spelled.at, start: text.length, end: text.length + spelled.at - at });
            text += label.slice(at, spelled.at);
          }
          text += spelled.text;
          at = spelled.at + 1;
        }
        { const edit: ReaderEdit = { from, to, text: `${text}](wiki://${encodeTarget(target)})`, visible }; edits.push(edit); linkEdits.push(edit); }
      }
    }
    if (node.type !== "code" && node.type !== "inlineCode" && node.type !== "html") {
      const linked = inLink || node.type === "link" || node.type === "linkReference" || node.type === "image";
      for (const child of node.children ?? []) walk(child, linked);
    }
  };
  walk(tree);
  const linkWithBarIn = (from: number, to: number) => {
    for (let n = lastStartingBefore(links, to); n >= 0 && links[n][1] > from; n--) {
      if (links[n][0] >= from && clean.text.slice(links[n][0], links[n][1]).includes("|")) return true;
    }
    return false;
  };
  // A line as the renderer is handed it, as far as its bars go: a wiki link's bars are gone.
  const readLine = (from: number, to: number) => {
    let text = "";
    let at = from;
    for (let n = lastStartingBefore(links, from); n < links.length; n++) {
      if (n < 0 || links[n][1] <= at) continue;
      if (links[n][0] >= to) break;
      text += clean.text.slice(at, links[n][0]) + "x";
      at = links[n][1];
    }
    return text + clean.text.slice(at, to);
  };
  // A line under a line of a paragraph that a table would read as its
  // delimiter row stays a line of the paragraph: a link that hides the bar of
  // its alias (`[[a|b]] | c` over `|---|---|`) takes one cell from the line
  // above, and the renderer, counting again, found a table where the note has
  // none (Fehlerliste 0.9.0, B5). Only under a line with such a link — every
  // other line reads in the note as it reads here —, and never in code: an
  // empty comment, which the renderer drops, stands behind the line's first
  // `-`. Only for a renderer that reads tables (`tables`): the plain text of a
  // card reads the line as it is written.
  for (const paragraph of options.tables ? paragraphs : []) {
    if (!paragraph.position) continue;
    // A heading's underline is its own: the row it would be is never one.
    const end = paragraph.type === "heading" ? clean.text.lastIndexOf("\n", paragraph.position.end.offset - 1) : paragraph.position.end.offset;
    let lineFrom = paragraph.position.start.offset;
    for (let brk = clean.text.indexOf("\n", lineFrom); brk !== -1 && brk < end; ) {
      const next = clean.text.indexOf("\n", brk + 1);
      const line = clean.text.slice(brk + 1, Math.min(end, next === -1 ? clean.text.length : next)).replace(/\r$/, "");
      const dash = delimiterRowDash(line);
      if (dash >= 0 && linkWithBarIn(lineFrom, brk) && !inLiteral(literals, brk + 1 + dash) && cellsOf(readLine(lineFrom, brk)) === cellsOf(line)) {
        edits.push({ from: brk + 2 + dash, to: brk + 2 + dash, text: "<!---->" });
      }
      lineFrom = brk + 1;
      brk = next;
    }
  }
  // What is read is the text: a byte order mark is the file's, like its `\r`.
  // None is left at the start, however many stand there: the renderer parses
  // this text with a parser of its own, which would skip one and count from
  // behind it.
  let marks = 0;
  while (clean.text.charCodeAt(marks) === BYTE_ORDER_MARK) marks++;
  if (marks > 0) edits.push({ from: 0, to: marks, text: "" });
  for (const block of analyzeNoteSource(raw).blocks) edits.push({ from: clean.toClean(block.markerFrom), to: clean.toClean(block.markerTo), text: "" });
  for (const match of clean.text.matchAll(/\r\n/g)) if (!edits.some((e) => e.from <= match.index && e.to > match.index)) edits.push({ from: match.index, to: match.index + 2, text: "\n" });
  const compose = (list: ReaderEdit[]) => {
    list.sort((a, b) => a.from - b.from || b.to - a.to);
    const spans: ReaderSpan[] = [];
    const visible: ReaderSpan[] = [];
    const embeds: ReaderSource["embeds"] = [];
    const placed = new Map<ReaderEdit, readonly [number, number]>();
    const parts: string[] = [];
    let cursor = 0, length = 0;
    const add = (from: number, to: number, text: string, exact: boolean) => {
      spans.push({ from, to, start: length, end: length + text.length, exact });
      parts.push(text); length += text.length;
    };
    for (const edit of list) {
      if (edit.from < cursor) continue;
      if (edit.from > cursor) add(cursor, edit.from, clean.text.slice(cursor, edit.from), true);
      for (const stretch of edit.visible ?? []) visible.push({ from: stretch.from, to: stretch.to, start: length + stretch.start, end: length + stretch.end, exact: true });
      if (edit.embed) embeds.push({ from: length, to: length + edit.text.length, target: edit.embed });
      placed.set(edit, [length, length + edit.text.length]);
      add(edit.from, edit.to, edit.text, false);
      cursor = edit.to;
    }
    add(cursor, clean.text.length, clean.text.slice(cursor), true);
    return { text: parts.join(""), spans, visible, embeds, placed, length };
  };
  const composed = compose(edits);
  // Where the wiki links stand in the text the renderer is handed: a formula
  // over one gives way to it (`remarkFormulasYieldToLinks`, Fehlerliste 0.9.0, B4).
  const wikiLinks = linkEdits.map((edit) => composed.placed.get(edit)).filter((range): range is readonly [number, number] => range !== undefined).sort((x, y) => x[0] - y[0]);
  const { spans, visible, embeds, length } = composed;
  // The span an offset stands in. The spans follow each other in both texts,
  // so it is found by halving; a list that does not is searched through, as
  // it always was. A search through every span for every element made a long
  // note with many elements quadratic in its reading view.
  const holds = (span: ReaderSpan, offset: number, original: boolean, edge: "start" | "end") => {
    const a = original ? span.from : span.start, b = original ? span.to : span.end;
    return edge === "start" ? a <= offset && offset < b : a < offset && offset <= b;
  };
  const inOrder = (list: ReaderSpan[], original: boolean) => list.every((span, k) => k === 0 || (original ? list[k - 1].to <= span.from : list[k - 1].end <= span.start));
  const ordered = new Map<ReaderSpan[], [boolean, boolean]>([[spans, [inOrder(spans, true), inOrder(spans, false)]], [visible, [inOrder(visible, true), inOrder(visible, false)]]]);
  const choose = (list: ReaderSpan[], offset: number, original: boolean, edge: "start" | "end") => {
    if (!ordered.get(list)?.[original ? 0 : 1]) return list.find((span) => holds(span, offset, original, edge));
    let low = 0, high = list.length - 1, found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const a = original ? list[mid].from : list[mid].start;
      if (edge === "start" ? a <= offset : a < offset) {
        found = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    return found >= 0 && holds(list[found], offset, original, edge) ? list[found] : undefined;
  };
  return {
    text: composed.text,
    embeds,
    wikiLinks,
    toRendered(offset, edge = "start") {
      const at = clean.toClean(Math.max(0, Math.min(raw.length, offset)));
      const span = choose(visible, at, true, edge) ?? choose(spans, at, true, edge);
      if (!span) return at === 0 ? 0 : length;
      return span.exact ? span.start + at - span.from : edge === "start" ? span.start : span.end;
    },
    toOriginal(offset, edge = "start") {
      const span = choose(visible, offset, false, edge) ?? choose(spans, offset, false, edge);
      if (!span) return offset === 0 ? 0 : raw.length;
      return clean.toRaw(span.exact ? span.from + offset - span.start : edge === "start" ? span.from : span.to, edge === "start" ? "after" : "before");
    },
  };
}

/** Whether `at` stands behind nothing but blanks (and quote marks) on its line, four of them or more: code, where a formula closed the block above. */
function mayBeCode(text: string, at: number): boolean {
  let blanks = 0;
  for (let i = at - 1; i >= 0 && text[i] !== "\n"; i--) {
    if (text[i] === " ") blanks++;
    else if (text[i] === "\t") blanks += 4;
    else if (text[i] !== ">" && text[i] !== "\r") return false;
  }
  return blanks >= 4;
}

/**
 * How many cells a table reads in `line` — behind the marks of a quote and
 * the blanks of a list, split at every bar a backslash does not stand in
 * front of, the empty cell before a leading and behind a trailing bar not
 * counted. A table is only one where its first line has as many as its
 * delimiter row.
 */
function cellsOf(line: string): number {
  let at = 0;
  for (;;) {
    while (line[at] === " " || line[at] === "\t") at++;
    if (line[at] !== ">") break;
    at++;
  }
  const cells: string[] = [""];
  for (let i = at; i < line.length; i++) {
    if (line[i] === "\\" && i + 1 < line.length) {
      cells[cells.length - 1] += line[i] + line[i + 1];
      i++;
    } else if (line[i] === "|") cells.push("");
    else cells[cells.length - 1] += line[i];
  }
  if (cells.length > 1 && cells[0].trim() === "") cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.length;
}

/**
 * Where the first `-` of a table's delimiter row stands in `line` — behind the
 * marks of a quote and the blanks of a list: `|---|:-:|`, `-- | --` —, or -1
 * where the line is none.
 */
function delimiterRowDash(line: string): number {
  let at = 0;
  for (;;) {
    while (line[at] === " " || line[at] === "\t") at++;
    if (line[at] !== ">") break;
    at++;
  }
  const cells = line.slice(at).split("|");
  if (cells.length > 1 && cells[0].trim() === "") cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop();
  if (cells.length === 0 || !cells.every((cell) => /^:?-+:?$/.test(cell.trim()))) return -1;
  return line.indexOf("-", at);
}

/** Whether `at` stands in one of `stretches` (in order, without overlap). */
function inLiteral(stretches: ReadonlyArray<readonly [number, number]>, at: number): boolean {
  const n = lastStartingBefore(stretches, at + 1);
  return n >= 0 && at < stretches[n][1];
}

/** In stretches that follow each other without overlap: the last one that starts before `at`, or -1. */
function lastStartingBefore(stretches: ReadonlyArray<readonly [number, number]>, at: number): number {
  let low = 0, high = stretches.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (stretches[mid][0] < at) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/**
 * What "Copy link" and "Copy block link" do at one line of a note (ADR 0037):
 * link to the heading the line is, or to the block the line belongs to — by
 * the id the block already carries, or by a new one written where the block
 * reader (`analyzeNoteSource`) and Obsidian look for it:
 *
 *   paragraph, quote line   ` ^id` at the end of the paragraph
 *   list item               ` ^id` at the end of the item's paragraph
 *   table                   `^id` on a line of its own behind the table,
 *                           with a blank line around it
 *
 * Nothing is written into frontmatter, a code fence, an HTML block, a `$$`
 * formula or an Obsidian comment — an id there would be text of that block,
 * not a name for it — nor onto an empty line; a table inside a list or a
 * quote is refused too, its own line would need the container's prefix.
 * Every new id is checked: the plan is only made when the note, with the id
 * written, leads `[[Note#^id]]` to that block and to nothing else.
 */
export type BlockLinkPlan =
  | { kind: "heading"; text: string }
  | { kind: "block"; id: string; insert: { at: number; text: string } | null }
  | { kind: "refused"; reason: "empty" | "code" | "frontmatter" | "unsupported" };

const STOP_TYPES = new Set(["heading", "paragraph", "table", "code", "html", "yaml", "toml", "thematicBreak", "definition", "math"]);

/** A new block id: six lower-case letters and digits, as Obsidian makes them, unused in this note. */
export function newBlockId(taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set([...taken].map((id) => id.toLowerCase()));
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let id = "";
    for (let i = 0; i < 6; i += 1) id += alphabet[Math.min(alphabet.length - 1, Math.floor(random() * alphabet.length))];
    if (!used.has(id)) return id;
  }
  throw new Error("no free block id");
}

export function planBlockLink(raw: string, offset: number, random: () => number = Math.random): BlockLinkPlan {
  const at = Math.max(0, Math.min(raw.length, Math.floor(Number(offset) || 0)));
  const lineFrom = Math.max(raw.lastIndexOf("\n", at - 1) + 1, raw.lastIndexOf("\r", at - 1) + 1);
  const lineEndMatch = /\r\n|\r|\n/.exec(raw.slice(at));
  const lineTo = lineEndMatch ? at + lineEndMatch.index : raw.length;
  if (raw.slice(lineFrom, lineTo).trim() === "") return { kind: "refused", reason: "empty" };
  const clean = stripAnchorMarkers(raw);
  const range = sourceRanger(raw, clean);
  const root = treeFor(clean.text);
  // The chain of nodes from the top down to the block-level node on this line.
  const chain: SourceNode[] = [];
  let parent: SourceNode = root;
  for (;;) {
    const child: SourceNode | undefined = (parent.children ?? []).find((node) => {
      if (!node.position) return false;
      const r = range(node);
      return r.from <= lineTo && r.to >= lineFrom;
    });
    if (!child) break;
    chain.push(child);
    if (STOP_TYPES.has(child.type)) break;
    parent = child;
  }
  const leaf = chain[chain.length - 1];
  if (!leaf) return { kind: "refused", reason: "empty" };
  if (leaf.type === "yaml" || leaf.type === "toml") return { kind: "refused", reason: "frontmatter" };
  if (leaf.type === "code" || leaf.type === "math") return { kind: "refused", reason: "code" };
  if (leaf.type === "heading") return { kind: "heading", text: textOf(leaf) };
  if (leaf.type !== "paragraph" && leaf.type !== "table") return { kind: "refused", reason: "unsupported" };
  const leafRange = range(leaf);
  const source = raw.slice(leafRange.from, leafRange.to);
  if (leaf.type === "paragraph" && /^\s*(\$\$|%%)/.test(source)) return { kind: "refused", reason: "unsupported" };
  const { blocks } = analyzeNoteSource(raw);
  // A line that is only `^id` names the block in front of it.
  const standalone = leaf.type === "paragraph" ? /^\s*\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/.exec(source) : null;
  if (standalone) {
    const named = blocks.find((block) => block.markerFrom >= leafRange.from && block.markerFrom < leafRange.to);
    return named ? { kind: "block", id: named.id, insert: null } : { kind: "refused", reason: "unsupported" };
  }
  // A table, a quote and a callout are one block each: their id stands on a
  // line of its own behind them (Obsidian's rule for structured blocks). In
  // the title line of a callout it would be shown as part of the title.
  const quote = chain.find((node) => node.type === "blockquote");
  const structured = quote ?? (leaf.type === "table" ? leaf : undefined);
  if (structured && chain[0] !== structured) return { kind: "refused", reason: "unsupported" };
  const listItem = !structured && leaf.type === "paragraph" ? [...chain].reverse().find((node) => node.type === "listItem") : undefined;
  const addressed = range(structured ?? listItem ?? leaf);
  // An id the block already carries, in either place: on a line of its own
  // behind it, or — as Obsidian also writes it for a quote — at the end of
  // the paragraph the line belongs to.
  const existing =
    blocks.find((block) => block.from === addressed.from && block.to === addressed.to) ??
    (structured && leaf.type === "paragraph" ? blocks.find((block) => block.markerFrom >= leafRange.from && block.markerFrom <= leafRange.to) : undefined);
  if (existing) return { kind: "block", id: existing.id, insert: null };
  const id = newBlockId(blocks.map((block) => block.id), random);
  const eol = /\r\n/.test(raw) ? "\r\n" : /\r/.test(raw) && !/\n/.test(raw) ? "\r" : "\n";
  let insert: { at: number; text: string };
  if (structured) {
    const after = raw.slice(addressed.to);
    const nextLine = /^(?:\r\n|\r|\n)([^\r\n]*)/.exec(after);
    const trailing = nextLine && nextLine[1].trim() !== "" ? eol : "";
    insert = { at: addressed.to, text: `${eol}${eol}^${id}${trailing}` };
  } else {
    insert = { at: leafRange.to, text: ` ^${id}` };
  }
  const written = raw.slice(0, insert.at) + insert.text + raw.slice(insert.at);
  const check = selectNoteFragment(written, `^${id}`);
  if (check.status !== "found" || check.range.from !== addressed.from) return { kind: "refused", reason: "unsupported" };
  return { kind: "block", id, insert };
}
