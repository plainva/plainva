import { parseMarkdownTree } from "./markdown-parser.js";
import { stripAnchorMarkers } from "./workspace/commentAnchor.js";
import { readerWikiLink, type ReaderEmbedKind } from "./readerWikiLink.js";
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
        const marker = /(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9-]*)[ \t]*$/.exec(source);
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
  toRendered(offset: number, edge?: "start" | "end"): number;
  toOriginal(offset: number, edge?: "start" | "end"): number;
}

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

/**
 * One source map for frontmatter, markers, CRLF, wiki syntax and relative dates.
 * Only prose is transformed — its text nodes and its wiki links; code, HTML
 * and link destinations stay literal. The original bytes are never rewritten
 * in the vault.
 */
export type { ReaderEmbedKind } from "./readerWikiLink.js";

export function prepareReaderSource(raw: string, options: { formatDate?: (iso: string) => string; embedKind?: (target: string) => ReaderEmbedKind } = {}): ReaderSource {
  const clean = stripAnchorMarkers(raw);
  const edits: ReaderEdit[] = [];
  const walk = (node: SourceNode, inLink = false) => {
    if (node.position && node.type === "yaml") edits.push({ from: node.position.start.offset, to: node.position.end.offset, text: "" });
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
      const innerFrom = from + (node.embed ? 3 : 2);
      const inner = clean.text.slice(innerFrom, to - 2);
      if (inner.length === 0) {
        // `[[]]` names nothing and is shown as it is written.
      } else {
        // What the reading view writes for the link (`readerWikiLink.ts`, which
        // the table budget weighs a wiki link by as well): a place in the label,
        // wherever it is not spelled out, is a place in the rendered label.
        const link = readerWikiLink(inner, !!node.embed, options.embedKind);
        const labelFrom = innerFrom + link.labelStart;
        edits.push({ from, to, text: link.text, embed: link.embed, visible: node.embed ? undefined : link.visible.map((v) => ({ ...v, from: labelFrom + v.from, to: labelFrom + v.to })) });
      }
    }
    if (node.type !== "code" && node.type !== "inlineCode" && node.type !== "html") {
      const linked = inLink || node.type === "link" || node.type === "linkReference" || node.type === "image";
      for (const child of node.children ?? []) walk(child, linked);
    }
  };
  walk(treeFor(clean.text));
  // What is read is the text: a byte order mark is the file's, like its `\r`.
  // None is left at the start, however many stand there: the renderer parses
  // this text with a parser of its own, which would skip one and count from
  // behind it.
  let marks = 0;
  while (clean.text.charCodeAt(marks) === BYTE_ORDER_MARK) marks++;
  if (marks > 0) edits.push({ from: 0, to: marks, text: "" });
  for (const block of analyzeNoteSource(raw).blocks) edits.push({ from: clean.toClean(block.markerFrom), to: clean.toClean(block.markerTo), text: "" });
  for (const match of clean.text.matchAll(/\r\n/g)) if (!edits.some((e) => e.from <= match.index && e.to > match.index)) edits.push({ from: match.index, to: match.index + 2, text: "\n" });
  edits.sort((a, b) => a.from - b.from || b.to - a.to);
  const spans: ReaderSpan[] = [];
  const visible: ReaderSpan[] = [];
  const embeds: ReaderSource["embeds"] = [];
  const parts: string[] = [];
  let cursor = 0, length = 0;
  const add = (from: number, to: number, text: string, exact: boolean) => {
    spans.push({ from, to, start: length, end: length + text.length, exact });
    parts.push(text); length += text.length;
  };
  for (const edit of edits) {
    if (edit.from < cursor) continue;
    if (edit.from > cursor) add(cursor, edit.from, clean.text.slice(cursor, edit.from), true);
    for (const stretch of edit.visible ?? []) visible.push({ from: stretch.from, to: stretch.to, start: length + stretch.start, end: length + stretch.end, exact: true });
    if (edit.embed) embeds.push({ from: length, to: length + edit.text.length, target: edit.embed });
    add(edit.from, edit.to, edit.text, false);
    cursor = edit.to;
  }
  add(cursor, clean.text.length, clean.text.slice(cursor), true);
  // The spans lie in order and do not overlap, in the original and in the
  // rendered text alike: the one an offset falls in is found by halving, not
  // by walking all of them — the reading view asks for every character of
  // every text (`rehypeReaderSource`), and a walk made that the square of the
  // note (2 000 lines: 2.5 s).
  const choose = (list: ReaderSpan[], offset: number, original: boolean, edge: "start" | "end") => {
    const startOf = (span: ReaderSpan) => (original ? span.from : span.start);
    let lo = 0;
    let hi = list.length;
    // The last span that starts at or before the offset (strictly before, for an end edge).
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (edge === "start" ? startOf(list[mid]) <= offset : startOf(list[mid]) < offset) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo - 1; k >= 0; k--) {
      const span = list[k];
      const a = startOf(span), b = original ? span.to : span.end;
      if (edge === "start" ? a <= offset && offset < b : a < offset && offset <= b) return span;
      // An empty span before it cannot hold the offset either; a span that ends before it ends the search.
      if (b < offset) return undefined;
    }
    return undefined;
  };
  return {
    text: parts.join(""),
    embeds,
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
