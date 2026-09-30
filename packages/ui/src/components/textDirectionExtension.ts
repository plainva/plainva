import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { lineDirections, mayContainRtl, type TextDirection } from "../lib/textDirection";

/**
 * Right-to-left lines in the note editor (issue 111, plan Teil R, R2).
 *
 * The direction of every line comes from the SOURCE (lib/textDirection.ts),
 * never from the rendered line: in live preview the caret line shows its
 * syntax, and `- [x]` would hand `dir="auto"` a Latin letter first. The line
 * gets its direction as an explicit `dir` attribute, and
 * `EditorView.perLineTextDirection` makes CodeMirror read it per line, so the
 * caret, the arrow keys and the selection move the way the line runs.
 *
 * Only right-to-left lines are decorated. The editor's own direction is
 * left-to-right, so a note without RTL text renders exactly as before - no
 * attribute, no layout change - and a note without any RTL character is not
 * even scanned (`mayContainRtl`).
 *
 * Desktop and phone build their editor from the same session, and the phone's
 * read mode is that session read-only: one extension serves all three.
 */

/** Per-line directions of the document, or null while it holds no RTL character. */
export const lineDirectionField = StateField.define<readonly TextDirection[] | null>({
  create: (state) => scan(state.doc, null),
  update(value, tr) {
    if (!tr.docChanged) return value;
    if (value === null) {
      // Nothing was right-to-left: only an inserted RTL character can change that.
      let inserted = false;
      tr.changes.iterChanges((_fa, _ta, _fb, _tb, text) => {
        if (!inserted && mayContainRtl(text.toString())) inserted = true;
      });
      return inserted ? scan(tr.newDoc, true) : null;
    }
    return scan(tr.newDoc, true);
  },
});

function scan(doc: Text, known: boolean | null): readonly TextDirection[] | null {
  if (known === null && !mayContainRtl(doc.toString())) return null;
  return lineDirections(doc.iterLines());
}

/** The direction of line `lineNumber` (1-based) in an editor state. */
export function editorLineDirection(state: EditorState, lineNumber: number): TextDirection {
  const dirs = state.field(lineDirectionField, false);
  return dirs?.[lineNumber - 1] ?? "ltr";
}

const RTL_LINE = Decoration.line({ attributes: { dir: "rtl" } });

function build(view: EditorView): DecorationSet {
  const dirs = view.state.field(lineDirectionField, false);
  if (!dirs) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      if (dirs[line.number - 1] === "rtl") builder.add(line.from, line.from, RTL_LINE);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const lineDirectionPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Right-to-left note text, line by line: the field, the decorations, and CodeMirror's per-line direction. */
export function textDirectionExtension(): Extension {
  return [lineDirectionField, lineDirectionPlugin, EditorView.perLineTextDirection.of(true)];
}
