import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/**
 * The comment anchor markers, hidden in live preview (K1, finding 2026-09-03).
 *
 * A hard anchor is a pair of HTML comments around the passage
 * (`<!--pv#xxxx-->…<!--/pv#xxxx-->` with a four-digit id, see `commentAnchor.ts` in core). The read
 * view strips HTML comments and the source mode shows them raw — both right.
 * Live preview was the odd one out: it DIMMED every HTML comment (a rule made
 * for the block-drag list separator `<!-- -->`) and so left the markers
 * standing in the sentence. The tinted range already says "a remark sits
 * here"; the marker adds nothing a reader wants to see.
 *
 * Hidden on the active line too. Every other mark reappears where the caret
 * is, but a marker is not syntax the writer edits: its text is an id, and a
 * caret inside it would only ever break it. The ranges are atomic for the same
 * reason - the caret steps over a marker as if it were a single character.
 */
export const ANCHOR_MARKER_SOURCE = "<!--\\/?pv#[0-9a-f]{4}-->";
const ANCHOR_MARKER_EXACT = new RegExp(`^${ANCHOR_MARKER_SOURCE}$`);
const HIDE = Decoration.replace({});

/** True when this text is exactly one anchor marker (opening or closing). */
export function isAnchorMarkerText(text: string): boolean {
  return ANCHOR_MARKER_EXACT.test(text);
}

function buildMarkerHides(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const re = new RegExp(ANCHOR_MARKER_SOURCE, "g");
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      builder.add(from + match.index, from + match.index + match[0].length, HIDE);
    }
  }
  return builder.finish();
}

export function anchorMarkerHidePlugin(isLive: boolean): Extension {
  if (!isLive) return [];
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildMarkerHides(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = buildMarkerHides(update.view);
      }
    },
    { decorations: (value) => value.decorations },
  );
  return [plugin, EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none)];
}
