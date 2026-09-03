import { foldService, codeFolding, foldKeymap, foldable, foldEffect, unfoldEffect, foldedRanges } from "@codemirror/language";
import { keymap, type EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

// Foldable headings & callouts (#10). No fold gutter is added (the line-number
// gutter was intentionally removed in #6): folding is driven by the keymap
// (Ctrl/Cmd-Shift-[ to fold, -] to unfold) and the folded range shows
// CodeMirror's clickable "…" placeholder. Uses only @codemirror/language, which
// is already a dependency — no extra packages.

// Fold a heading section: from the end of the heading line to just before the
// next heading of the same or higher level (or the end of the document).
const headingFold = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const m = line.text.match(/^(#{1,6})\s/);
  if (!m) return null;
  const level = m[1].length;
  let end = state.doc.length;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const hm = state.doc.line(n).text.match(/^(#{1,6})\s/);
    if (hm && hm[1].length <= level) { end = state.doc.line(n).from - 1; break; }
  }
  return end > line.to ? { from: line.to, to: end } : null;
});

// Fold a multi-line blockquote / callout from its first line.
const quoteFold = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  if (!/^\s*>/.test(line.text)) return null;
  // Only the first line of a quote run is the fold anchor.
  if (line.number > 1 && /^\s*>/.test(state.doc.line(line.number - 1).text)) return null;
  let last = line.number;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    if (/^\s*>/.test(state.doc.line(n).text)) last = n; else break;
  }
  return last > line.number ? { from: line.to, to: state.doc.line(last).to } : null;
});

/**
 * Fold a list item over its nested lines (feedback round 2026-09-01, T8c):
 * from the end of the item's line to the last following line that is indented
 * deeper than the item — blank lines inside the run belong to it, a blank line
 * followed by a line at the item's own depth (or shallower) ends it. Same
 * shape as the heading fold: the folded range starts AFTER the line, so the
 * item itself stays visible with CodeMirror's "…" placeholder behind it.
 * Returns null for a flat item, which is what makes the tap target appear
 * only where there is something to fold.
 */
export function listFoldRange(state: EditorState, lineStart: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  const m = line.text.match(/^(\s*)(?:[-*+]|\d+[.)])\s/);
  if (!m) return null;
  const depth = indentWidth(m[1]);
  let last = line.number;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const text = state.doc.line(n).text;
    if (!text.trim()) continue; // a blank line decides nothing by itself
    const lead = text.match(/^\s*/)![0];
    if (indentWidth(lead) <= depth) break;
    last = n;
  }
  return last > line.number ? { from: line.to, to: state.doc.line(last).to } : null;
}

/** Tabs count as four columns, the way the list indent measures them. */
function indentWidth(lead: string): number {
  let w = 0;
  for (const ch of lead) w += ch === "\t" ? 4 : 1;
  return w;
}

const listFold = foldService.of((state, lineStart) => listFoldRange(state, lineStart));

/**
 * Folds or unfolds the block that starts on the line at `pos` — the tap on a
 * bullet (both shells) and nothing else. `foldable` asks every fold service,
 * so a heading, a quote or a code block on that line would fold too; the
 * bullet only exists on list lines, which keeps this to lists in practice.
 */
export function toggleFoldAtLine(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos);
  let folded: { from: number; to: number } | null = null;
  foldedRanges(view.state).between(line.from, line.to, (from, to) => {
    if (from >= line.from && from <= line.to) folded = { from, to };
  });
  if (folded) {
    view.dispatch({ effects: unfoldEffect.of(folded) });
    return true;
  }
  const range = foldable(view.state, line.from, line.to);
  if (!range) return false;
  view.dispatch({ effects: foldEffect.of(range) });
  return true;
}

/** Whether the line at `pos` is currently folded from its end. */
export function isLineFolded(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  let hit = false;
  foldedRanges(state).between(line.from, line.to, (from) => {
    if (from >= line.from && from <= line.to) hit = true;
  });
  return hit;
}

export function markdownFolding() {
  return [headingFold, quoteFold, listFold, codeFolding(), keymap.of(foldKeymap)];
}
