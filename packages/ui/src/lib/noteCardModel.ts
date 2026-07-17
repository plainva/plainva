/**
 * Pure note-card parser for the pinboard view (plan Pinboard P3, decision E6).
 *
 * Keep-style cards render the note BODY, but a full markdown pipeline per card
 * (x200) is too heavy and not shell-portable. This parser covers the "Zettel"
 * subset — paragraphs, (nested) lists, GFM task checkboxes, quotes, images,
 * rulers, inline formatting via the shared inline tokenizer — and degrades
 * everything else (tables, math, embeds) to a labeled placeholder plus a short
 * raw preview for fenced code. Clicking a card opens the full note anyway.
 *
 * Task ORDINALS count exactly like `toggleTaskAtIndex` (same TASK_LINE/FENCE
 * regexes): a rendered checkbox flips precisely its own line, even when other
 * task lines hide inside quotes or code fences.
 */

import * as yaml from "yaml";
import { parseInlineMarkdown, type InlineNode } from "./inlineMarkdown";
import { FENCE_RE, TASK_LINE_RE } from "./taskToggle";

export type NoteCardBlock =
  | { kind: "heading"; depth: number; inline: InlineNode[] }
  | { kind: "para"; inline: InlineNode[] }
  | { kind: "task"; ordinal: number; done: boolean; indent: number; inline: InlineNode[] }
  | { kind: "bullet"; indent: number; ordered: boolean; inline: InlineNode[] }
  | { kind: "quote"; inline: InlineNode[] }
  | { kind: "image"; target: string; alt: string }
  | { kind: "hr" }
  | { kind: "code"; lines: string[]; truncated: boolean }
  | { kind: "placeholder"; label: "table" | "math" | "embed" };

export interface ParsedNoteCard {
  blocks: NoteCardBlock[];
  /** True when maxBlocks cut the tail off. */
  truncated: boolean;
  /** Frontmatter `title` when present (preferred card title). */
  fmTitle: string | null;
  /** Frontmatter `plainva.color` (hex) — the note's header tint doubles as the card tint (E7). */
  color: string | null;
  /** Frontmatter `plainva.icon` (emoji / lucide:<name>). */
  icon: string | null;
  /** Plain text of a leading H1; views promote it to the card title (H1 dedupe, D6). */
  leadingH1: string | null;
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const HR_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const TABLE_ROW_RE = /^\s*\|.*\|?\s*$/;
const IMAGE_WIKI_RE = /^\s*!\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]\s*$/;
const IMAGE_MD_RE = /^\s*!\[([^\]\n]*)\]\(([^)\n]+)\)\s*$/;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const MATH_FENCE_RE = /^\s*\$\$/;

const DEFAULT_MAX_BLOCKS = 12;
const CODE_PREVIEW_LINES = 4;

/** Flatten an inline token tree to plain text (for the leading-H1 title). */
export function inlineToPlain(nodes: InlineNode[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.kind) {
      case "text": out += n.text; break;
      case "code": out += n.text; break;
      case "wikiLink": out += n.display; break;
      case "link": out += n.label; break;
      case "url": out += n.href; break;
      case "br": out += " "; break;
      default: out += inlineToPlain((n as { children: InlineNode[] }).children ?? []); break;
    }
  }
  return out.trim();
}

/** Split "---" frontmatter off; returns body lines and the parsed fm (or null). */
function splitFrontmatter(content: string): { fm: Record<string, unknown> | null; body: string[] } {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return { fm: null, body: lines };
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") {
      let fm: Record<string, unknown> | null = null;
      try {
        const parsed = yaml.parse(lines.slice(1, i).join("\n"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fm = parsed as Record<string, unknown>;
      } catch {
        /* malformed frontmatter — render the body, drop the meta */
      }
      return { fm, body: lines.slice(i + 1) };
    }
  }
  // Unterminated frontmatter: treat everything as body (never hide the note).
  return { fm: null, body: lines };
}

export function parseNoteCard(
  content: string,
  opts?: { maxBlocks?: number; dropLeadingH1?: boolean },
): ParsedNoteCard {
  const maxBlocks = opts?.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  const { fm, body } = splitFrontmatter(content ?? "");

  const pv = fm && typeof fm.plainva === "object" && fm.plainva && !Array.isArray(fm.plainva)
    ? (fm.plainva as Record<string, unknown>)
    : null;
  const fmTitle = fm && typeof fm.title === "string" && fm.title.trim() ? String(fm.title).trim() : null;
  // The note's header stripe key is `plainva.header_color` (ADR 0009) — the
  // card tint mirrors exactly that field (decision E7).
  const rawColor = pv && typeof pv.header_color === "string" ? pv.header_color.trim() : null;
  const color = rawColor && HEX_COLOR_RE.test(rawColor) ? rawColor : null;
  const icon = pv && typeof pv.icon === "string" && pv.icon.trim() ? String(pv.icon).trim() : null;

  const blocks: NoteCardBlock[] = [];
  let truncated = false;
  let leadingH1: string | null = null;
  let sawContent = false;

  // Task ordinals: count EXACTLY like toggleTaskAtIndex (fence-aware, whole doc).
  let taskOrdinal = 0;
  let inFence = false;
  let inMath = false;
  let fenceLines: string[] = [];
  let paraLines: string[] = [];
  let tableOpen = false;

  const push = (b: NoteCardBlock) => {
    if (blocks.length >= maxBlocks) {
      truncated = true;
      return;
    }
    blocks.push(b);
  };
  const flushPara = () => {
    if (paraLines.length === 0) return;
    push({ kind: "para", inline: parseInlineMarkdown(paraLines.join(" ")) });
    paraLines = [];
  };

  for (const line of body) {
    // Fence toggling mirrors taskToggle (the fence line itself never counts).
    if (FENCE_RE.test(line)) {
      if (!inFence) {
        flushPara();
        tableOpen = false;
        inFence = true;
        fenceLines = [];
      } else {
        inFence = false;
        push({ kind: "code", lines: fenceLines.slice(0, CODE_PREVIEW_LINES), truncated: fenceLines.length > CODE_PREVIEW_LINES });
      }
      continue;
    }
    if (inFence) {
      fenceLines.push(line);
      continue;
    }

    const taskMatch = line.match(TASK_LINE_RE);
    if (taskMatch) {
      const ordinal = taskOrdinal++;
      // Inside a quote or a $$ block the line renders differently, but it
      // still consumed its ordinal above (toggleTaskAtIndex knows no math
      // blocks) so rendered checkboxes stay aligned with the file.
      if (!inMath && !/^\s*>/.test(line)) {
        flushPara();
        tableOpen = false;
        const indent = Math.floor((line.match(/^\s*/)?.[0].length ?? 0) / 2);
        push({
          kind: "task",
          ordinal,
          done: taskMatch[2].toLowerCase() === "x",
          indent,
          inline: parseInlineMarkdown(line.slice(taskMatch[0].length)),
        });
        sawContent = true;
        continue;
      }
    }

    // Inside a $$ block: swallow lines until the closing $$ (ordinals above
    // keep counting so checkbox targets never drift).
    if (inMath) {
      if (/\$\$/.test(line)) inMath = false;
      continue;
    }

    const t = line.trim();
    if (t === "") {
      flushPara();
      tableOpen = false;
      continue;
    }

    if (TABLE_ROW_RE.test(line)) {
      flushPara();
      if (!tableOpen) {
        tableOpen = true;
        push({ kind: "placeholder", label: "table" });
      }
      sawContent = true;
      continue;
    }
    tableOpen = false;

    if (MATH_FENCE_RE.test(line)) {
      flushPara();
      push({ kind: "placeholder", label: "math" });
      sawContent = true;
      // A single-line "$$x^2$$" closes itself; otherwise swallow until "$$".
      if (!/\$\$/.test(line.replace(MATH_FENCE_RE, ""))) inMath = true;
      continue;
    }

    const imgWiki = line.match(IMAGE_WIKI_RE);
    if (imgWiki) {
      flushPara();
      const target = imgWiki[1].trim();
      if (IMAGE_EXT_RE.test(target)) push({ kind: "image", target, alt: target.split("/").pop() ?? target });
      else push({ kind: "placeholder", label: "embed" });
      sawContent = true;
      continue;
    }
    const imgMd = line.match(IMAGE_MD_RE);
    if (imgMd && IMAGE_EXT_RE.test(imgMd[2].split("#")[0].trim())) {
      flushPara();
      push({ kind: "image", target: imgMd[2].split("#")[0].trim(), alt: imgMd[1] });
      sawContent = true;
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushPara();
      const inline = parseInlineMarkdown(heading[2]);
      if (!sawContent && heading[1].length === 1 && leadingH1 === null) {
        leadingH1 = inlineToPlain(inline);
        sawContent = true;
        if (opts?.dropLeadingH1) continue;
      }
      push({ kind: "heading", depth: heading[1].length, inline });
      sawContent = true;
      continue;
    }

    if (HR_RE.test(line)) {
      flushPara();
      push({ kind: "hr" });
      sawContent = true;
      continue;
    }

    const quote = line.match(QUOTE_RE);
    if (quote && /^\s*>/.test(line)) {
      flushPara();
      push({ kind: "quote", inline: parseInlineMarkdown(quote[1]) });
      sawContent = true;
      continue;
    }

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      flushPara();
      push({
        kind: "bullet",
        indent: Math.floor(bullet[1].length / 2),
        ordered: /\d/.test(bullet[2]),
        inline: parseInlineMarkdown(bullet[3]),
      });
      sawContent = true;
      continue;
    }

    paraLines.push(t);
    sawContent = true;
  }
  // An unterminated fence still shows its preview (never swallow text).
  if (inFence && fenceLines.length > 0) {
    push({ kind: "code", lines: fenceLines.slice(0, CODE_PREVIEW_LINES), truncated: fenceLines.length > CODE_PREVIEW_LINES });
  }
  flushPara();

  return { blocks, truncated, fmTitle, color, icon, leadingH1 };
}
