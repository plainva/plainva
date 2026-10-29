import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { stripQuoteMarkers } from "@plainva/core";
import { calloutColorKey, calloutLineClass, parseCalloutMarker } from "./callouts";

/**
 * Fenced code blocks a live widget replaces — ```mermaid diagrams and
 * ```tasks queries (plan Tasks-Abfragen, T4) — found once, the same way for
 * both: through the syntax tree, at the top level, in a list item, and in a
 * quote or callout, where every line of the fence starts with the quote's `>`
 * (finding 2026-10-25: a fence in a callout stayed source).
 *
 * A block is offered only when its closing fence exists: an unterminated fence
 * swallows the rest of the note, and replacing that would hide the note.
 */

/** A node of the syntax tree (its type, without a dependency on Lezer itself). */
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

export interface FencedBlock {
  /** Start of the opening line and end of the closing line. */
  from: number;
  to: number;
  /** 1-based numbers of the opening and closing line. */
  firstLine: number;
  lastLine: number;
  /** The text between the fences as a renderer reads it: no quote markers, no fence indentation. */
  code: string;
  /** How many quotes the fence stands in. */
  quoteDepth: number;
  /**
   * The line class of the quote or callout the fence stands in ("" at the top
   * level): a widget replaces those lines, so it carries their card.
   */
  quoteClass: string;
}

/**
 * The block quotes a fence stands in: how many, and the line class of the
 * innermost one — the class `LivePreviewPlugin` gives its lines, so a widget
 * that replaces them keeps the quote's bar or the callout's card.
 */
function quoteContext(state: EditorState, node: SyntaxNode, firstLine: number, lastLine: number): { depth: number; lineClass: string } {
  let depth = 0;
  let inner: SyntaxNode | null = null;
  for (let up = node.parent; up; up = up.parent) {
    if (up.name !== "Blockquote") continue;
    depth++;
    if (!inner) inner = up;
  }
  if (!inner) return { depth, lineClass: "" };
  const doc = state.doc;
  const start = doc.lineAt(inner.from).number;
  const end = doc.lineAt(Math.min(inner.to, doc.length)).number;
  const callout = parseCalloutMarker(doc.line(start).text.replace(/^\s*>+\s?/, ""));
  if (!callout) return { depth, lineClass: "cm-blockquote-line" };
  const key = calloutColorKey(callout.type);
  let lineClass = calloutLineClass(key, firstLine, start, end);
  if (lastLine === end && firstLine !== end) lineClass += " cm-callout--last";
  return { depth, lineClass };
}

const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

/** An opening line `language` names: ```mermaid, ~~~tasks — any case, blanks around. */
export function fenceOpenerFor(language: string): RegExp {
  return new RegExp(`^\\s*(\`{3,}|~{3,})\\s*${language}\\s*$`, "i");
}

/** Every closed fenced block whose opening line passes `opener`, in document order. */
export function findFencedBlocks(state: EditorState, opener: RegExp): FencedBlock[] {
  const doc = state.doc;
  const out: FencedBlock[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return;
      const first = doc.lineAt(node.from);
      const last = doc.lineAt(Math.min(node.to, doc.length));
      const quote = quoteContext(state, node.node, first.number, last.number);
      const lineText = (n: number) => stripQuoteMarkers(doc.line(n).text, quote.depth);
      const opening = lineText(first.number);
      if (!opener.test(opening)) return false;
      if (last.number === first.number || !FENCE_CLOSE.test(lineText(last.number))) return false;
      // The code as the renderer reads it: without the quote markers, and
      // without the indentation the fence itself stands at.
      const indent = opening.length - opening.trimStart().length;
      const lines: string[] = [];
      for (let n = first.number + 1; n < last.number; n++) {
        const text = lineText(n);
        let cut = 0;
        while (cut < indent && (text[cut] === " " || text[cut] === "\t")) cut++;
        lines.push(text.slice(cut));
      }
      out.push({ from: first.from, to: last.to, firstLine: first.number, lastLine: last.number, code: lines.join("\n"), quoteDepth: quote.depth, quoteClass: quote.lineClass });
      return false;
    },
  });
  return out;
}

/** All ranges of fenced code — what other block widgets must leave alone. */
export function fencedCodeRanges(state: EditorState): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return;
      ranges.push({ from: node.from, to: node.to });
      return false;
    },
  });
  return ranges;
}
