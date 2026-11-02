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

import { createFenceTracker, peelBlockquotes, readAtxHeading, readMarkdownListItem, readQuoteDepth, stripQuoteMarkers } from "@plainva/core";
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

// Thematic break (---, ***, ___) and setext underlines (===) — a whole line of
// one repeated mark. Dropped from the plain-text output.
const THEMATIC_BREAK_RE = /^\s{0,3}([-*_=])(?:[ \t]*\1){2,}[ \t]*$/;

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
  // Drop the '>' markers; the quoted content may itself be a heading/list, or
  // another quote. All levels come off in one pass (plan Befunde 24.09., E6):
  // `>  >  > …` nests once per marker, and reading them one level at a time
  // overflowed the stack on a long line of them. A line that starts as a quote
  // is never a rule, a table separator or a heading, so peeling first changes
  // nothing. A dropped line inside a quote reads as "".
  const { depth, text } = peelBlockquotes(line);
  const inner = stripQuotedLine(text);
  return inner === null && depth > 0 ? "" : inner;
}

/** One block line that is no quote (any quote markers are already off). */
function stripQuotedLine(line: string): string | null {
  if (THEMATIC_BREAK_RE.test(line)) return null; // rule / setext underline — drop
  if (isTableSeparatorRow(line)) return null; // table header separator — drop

  // Heading lines come from the shared reader (plan Befunde 24.09., E6): the
  // same grammar as the HTML copy, in one pass.
  const atx = readAtxHeading(line);
  if (atx) return inlineToPlainText(atx.text);

  // The shared list reader (plan Befunde 24.09., E6): the same grammar as the
  // HTML copy and the editor, one pass instead of three patterns.
  const li = readMarkdownListItem(line);
  if (li) {
    const { indent, marker, box: state, text } = li;
    if (state !== null) {
      // done, in progress, cancelled, open — four shapes, as in the app (E12).
      const box = state.toLowerCase() === "x" ? "☑" : state === "/" ? "◪" : state === "-" ? "☒" : "☐";
      return `${indent}${marker} ${box} ${inlineToPlainText(text)}`;
    }
    return `${indent}${marker} ${inlineToPlainText(text)}`;
  }

  if (isTableRow(line)) return stripTableRow(line);

  return inlineToPlainText(line);
}

/** Convert a copied Markdown fragment to readable plain text. */
export function markdownToPlainText(md: string): string {
  if (!md) return md;
  const lines = md.split("\n");
  const out: string[] = [];
  // Fenced code by the one rule every scanner reads (core `markdownFence.ts`;
  // open-items plan 3.159 no. 4, decision E16), a fence in a quote or a
  // callout included: its lines verbatim, without the quote's markers; the
  // fence lines are dropped.
  const fence = createFenceTracker();
  let depth = 0;

  for (const raw of lines) {
    const kind = fence.step(raw);
    if (kind === "open") {
      depth = readQuoteDepth(raw).depth;
      continue;
    }
    if (kind === "close") continue;
    if (kind === "code") {
      out.push(stripQuoteMarkers(raw, depth));
      continue;
    }
    const stripped = stripBlockLine(raw);
    if (stripped !== null) out.push(stripped);
  }

  return out.join("\n");
}
