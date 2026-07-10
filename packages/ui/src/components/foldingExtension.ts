import { foldService, codeFolding, foldKeymap } from "@codemirror/language";
import { keymap } from "@codemirror/view";

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

export function markdownFolding() {
  return [headingFold, quoteFold, codeFolding(), keymap.of(foldKeymap)];
}
