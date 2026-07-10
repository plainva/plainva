/**
 * Copy-as-plain-text (WP1, 2026-07-08).
 *
 * CodeMirror copies the raw document slice, so copying out of the live preview
 * yields Markdown source (`**bold**`, `# Heading`, `[[Wiki Link]]`, …) even
 * though those markers are hidden on screen. This pure helper reconstructs
 * readable plain text from a copied Markdown fragment: a line pass strips block
 * markers (ATX headings, blockquotes, list markers, thematic breaks, table
 * pipes, fenced-code fences) and the inline subset is handled by the shared
 * `parseInlineMarkdown` tokenizer (bold/italic/strike/inline-code/==highlight==,
 * wiki + markdown links -> display text, bare URLs, <br>, backslash escapes).
 *
 * Wired into the editor via `EditorView.clipboardOutputFilter` in LIVE mode
 * only — source mode copies raw by design. Fenced code content is emitted
 * verbatim (never inline-stripped). Pure and unit-testable.
 */

import { parseInlineMarkdown, type InlineNode } from "./inlineMarkdown";

/** Flatten parsed inline nodes to plain text, dropping every formatting mark. */
export function inlineNodesToPlainText(nodes: InlineNode[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.kind) {
      case "text":
        out += n.text;
        break;
      case "br":
        out += "\n";
        break;
      case "code":
        out += n.text;
        break;
      case "strong":
      case "em":
      case "strongEm":
      case "strike":
      case "highlight":
        out += inlineNodesToPlainText(n.children);
        break;
      case "wikiLink":
        out += n.display;
        break;
      case "link":
        out += n.label;
        break;
      case "url":
        out += n.href;
        break;
    }
  }
  return out;
}

function inlineToPlainText(line: string): string {
  return inlineNodesToPlainText(parseInlineMarkdown(line));
}

const OPEN_FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const ATX_RE = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
// Thematic break (---, ***, ___) and setext underlines (===) — a whole line of
// one repeated mark. Dropped from the plain-text output.
const THEMATIC_BREAK_RE = /^\s{0,3}([-*_=])(?:[ \t]*\1){2,}[ \t]*$/;
const BLOCKQUOTE_RE = /^\s{0,3}((?:>[ \t]?)+)(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TASK_RE = /^\[([ xX])\][ \t]+(.*)$/;

function isTableSeparatorRow(line: string): boolean {
  const s = line.trim();
  if (!s.includes("|") || !s.includes("-")) return false;
  return /^[|\s:-]+$/.test(s);
}

function isTableRow(line: string): boolean {
  const s = line.trim();
  return s.startsWith("|") || s.endsWith("|");
}

function stripTableRow(line: string): string {
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return s
    .split("|")
    .map((c) => inlineToPlainText(c.trim()))
    .join("\t");
}

function stripBlockLine(line: string): string | null {
  if (THEMATIC_BREAK_RE.test(line)) return null; // rule / setext underline — drop
  if (isTableSeparatorRow(line)) return null; // table header separator — drop

  const atx = ATX_RE.exec(line);
  if (atx) return inlineToPlainText(atx[2]);

  const bq = BLOCKQUOTE_RE.exec(line);
  if (bq) {
    // Drop the '>' markers; the quoted content may itself be a heading/list.
    const inner = stripBlockLine(bq[2]);
    return inner == null ? "" : inner;
  }

  const li = LIST_RE.exec(line);
  if (li) {
    const [, indent, marker, rest] = li;
    const task = TASK_RE.exec(rest);
    if (task) {
      const box = task[1].toLowerCase() === "x" ? "☑" : "☐"; // checked / unchecked box
      return `${indent}${marker} ${box} ${inlineToPlainText(task[2])}`;
    }
    return `${indent}${marker} ${inlineToPlainText(rest)}`;
  }

  if (isTableRow(line)) return stripTableRow(line);

  return inlineToPlainText(line);
}

/** Convert a copied Markdown fragment to readable plain text. */
export function markdownToPlainText(md: string): string {
  if (!md) return md;
  const lines = md.split("\n");
  const out: string[] = [];
  let fence: string | null = null; // the opening fence run (``` / ~~~), or null

  for (const raw of lines) {
    if (fence !== null) {
      // Inside a fenced code block: emit content verbatim; a matching (or
      // longer) fence of the same kind closes it. The fence lines are dropped.
      const closeRe = new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}\\s*$`);
      if (closeRe.test(raw)) fence = null;
      else out.push(raw);
      continue;
    }
    const open = OPEN_FENCE_RE.exec(raw);
    if (open) {
      fence = open[1];
      continue; // drop the opening fence line
    }
    const stripped = stripBlockLine(raw);
    if (stripped !== null) out.push(stripped);
  }

  return out.join("\n");
}
