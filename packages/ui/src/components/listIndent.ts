import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, EditorState, Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/**
 * List indentation for live + source mode (#2).
 *
 * CodeMirror renders markdown as flat lines, so nested list items only step by
 * their literal leading spaces — nearly invisible in a proportional font, unlike
 * the read view which nests real `<ul>`/`<ol>`. This plugin adds a per-line
 * indent (derived from the real list nesting in the syntax tree, so code fences
 * and non-list text are untouched) plus a hanging indent so wrapped lines align
 * under the item text — mirroring the read view in both editor modes.
 */

const INDENT_EM = 1.5;
const MARKER_RE = /^\s*([-*+]|\d+[.)])\s/;

/** Whether a line begins a list item (bullet or ordered marker). */
export function isListMarkerLine(text: string): boolean {
  return MARKER_RE.test(text);
}

/**
 * Inline style for a list line, or null when it isn't inside a list (depth <= 0).
 *
 * The read view puts even top-level bullets one level (1.5em) in from the body
 * text, so we pad by `(depth + 1) * 1.5em` — depth 1 sits at 1.5em, not flush
 * with paragraphs. Marker lines additionally pull their first line back by one
 * step via a negative text-indent (hanging indent: the marker sits at
 * `depth * 1.5em`, wrapped/continuation text aligns one step deeper).
 */
export function listIndentStyle(depth: number, isMarker: boolean): string | null {
  if (depth <= 0) return null;
  const pad = `padding-left:${(depth + 1) * INDENT_EM}em;`;
  return isMarker ? `${pad}text-indent:-${INDENT_EM}em;` : pad;
}

/** Number of ancestor ListItem nodes at a document position (0 = not in a list). */
export function listDepthAt(state: EditorState, pos: number): number {
  let depth = 0;
  for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "ListItem") depth++;
  }
  return depth;
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const text = line.text;
      if (text.trim().length > 0) {
        // Resolve at the first non-whitespace char so we land inside the ListItem.
        const firstNonWs = line.from + (text.length - text.trimStart().length);
        const style = listIndentStyle(listDepthAt(state, firstNonWs), isListMarkerLine(text));
        if (style) builder.add(line.from, line.from, Decoration.line({ attributes: { style } }));
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/** Line-indent decorations for markdown lists; safe in both live and source mode. */
export function listIndentPlugin(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = buildDecorations(view); }
      update(u: ViewUpdate) {
        // The tree-progress check mirrors markdownDecorationPlugin: lezer parses
        // asynchronously, so right after load/paste/external reload the depth can
        // be computed from a stale tree — without rebuilding on parse progress the
        // indent then visibly "jumps" on the next unrelated update (Jitter, P5).
        if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = buildDecorations(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}
