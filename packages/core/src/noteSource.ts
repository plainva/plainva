import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { stripAnchorMarkers } from "./workspace/commentAnchor.js";

interface SourceNode {
  type: string;
  value?: string;
  depth?: number;
  children?: SourceNode[];
  position?: { start: { offset: number }; end: { offset: number } };
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);
const treeFor = (text: string) => parser.parse(text) as unknown as SourceNode;
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
  const lines = [0];
  for (let i = 0; i < raw.length; i++) if (raw[i] === "\n") lines.push(i + 1);
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
  /** Exact visible spelling within a generated Markdown destination. */
  visible?: { from: number; to: number; start: number; end: number };
}
interface ReaderSpan { from: number; to: number; start: number; end: number; exact: boolean }
export interface ReaderSource {
  text: string;
  embeds: { from: number; to: number; target: string }[];
  toRendered(offset: number, edge?: "start" | "end"): number;
  toOriginal(offset: number, edge?: "start" | "end"): number;
}
const encodeTarget = (text: string) => encodeURIComponent(text).replace(/[()!'*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * One source map for frontmatter, markers, CRLF, wiki syntax and relative dates.
 * Only prose text nodes are transformed; code, HTML and link destinations stay
 * literal. The original bytes are never rewritten in the vault.
 */
/**
 * What an `![[...]]` embed points at. `note` is the fallback: everything that
 * is neither a picture nor a sound is another note, which the reader expands.
 */
export type ReaderEmbedKind = "image" | "audio" | "note";

export function prepareReaderSource(raw: string, options: { formatDate?: (iso: string) => string; embedKind?: (target: string) => ReaderEmbedKind } = {}): ReaderSource {
  const clean = stripAnchorMarkers(raw);
  const edits: ReaderEdit[] = [];
  const walk = (node: SourceNode, inLink = false) => {
    if (node.position && node.type === "yaml") edits.push({ from: node.position.start.offset, to: node.position.end.offset, text: "" });
    if (node.position && node.type === "text" && !inLink) {
      const start = node.position.start.offset;
      const source = clean.text.slice(start, node.position.end.offset);
      const token = /!?\[\[([^\]\r\n]+)\]\]|(?<![\w\\])@(\d{4}-\d{2}-\d{2})\b/g;
      for (const m of source.matchAll(token)) {
        if (m.index > 0 && source[m.index - 1] === "\\") continue;
        const from = start + m.index, to = from + m[0].length;
        if (m[2]) {
          if (options.formatDate) edits.push({ from, to, text: options.formatDate(m[2]) });
        } else if (m[0].startsWith("!")) {
          // Three kinds, one scheme each, so the renderer branches on the URL
          // rather than sniffing the extension a second time (plan
          // Journal-Erweiterungen, X3). The fallback pattern stands for a host
          // that passes no port - it used to be the only answer.
          const kind = options.embedKind?.(m[1])
            ?? (/\.(?:png|jpe?g|gif|svg|webp|bmp|avif)(?:\||$)/i.test(m[1]) ? "image" : "note");
          const scheme = kind === "note" ? "embed" : kind;
          const alt = kind === "image" ? "img" : kind === "audio" ? "audio" : "embed";
          edits.push({ from, to, text: `![${alt}](wiki-${scheme}://${encodeTarget(m[1])})`, embed: kind === "note" ? m[1] : undefined });
        } else {
          const pipe = m[1].indexOf("|");
          const target = pipe < 0 ? m[1] : m[1].slice(0, pipe);
          const label = pipe < 0 ? target : m[1].slice(pipe + 1);
          const labelFrom = from + 2 + (pipe < 0 ? 0 : pipe + 1);
          // The label was already Markdown prose; preserve its spelling and offsets.
          edits.push({ from, to, text: `[${label}](wiki://${encodeTarget(target)})`, visible: { from: labelFrom, to: labelFrom + label.length, start: 1, end: label.length + 1 } });
        }
      }
    }
    if (node.type !== "code" && node.type !== "inlineCode" && node.type !== "html") for (const child of node.children ?? []) walk(child, inLink || node.type === "link" || node.type === "image");
  };
  walk(treeFor(clean.text));
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
    if (edit.visible) visible.push({ from: edit.visible.from, to: edit.visible.to, start: length + edit.visible.start, end: length + edit.visible.end, exact: true });
    if (edit.embed) embeds.push({ from: length, to: length + edit.text.length, target: edit.embed });
    add(edit.from, edit.to, edit.text, false);
    cursor = edit.to;
  }
  add(cursor, clean.text.length, clean.text.slice(cursor), true);
  const choose = (list: ReaderSpan[], offset: number, original: boolean, edge: "start" | "end") => list.find((span) => {
    const a = original ? span.from : span.start, b = original ? span.to : span.end;
    return edge === "start" ? a <= offset && offset < b : a < offset && offset <= b;
  });
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
