import { StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * Where a comment sits in the note, as the editor currently resolves it.
 *
 * The range is a RESULT, not a stored value: `resolveCommentAnchor` produces it
 * from the raw Markdown every time the note or the comment list changes. What
 * lives here is only the tint that makes the place visible.
 */
export interface AnchorHighlight {
  /** The comment this range belongs to. */
  commentId: string;
  /** Offsets in the document the editor is showing. */
  from: number;
  to: number;
  /** The selected card's range is drawn stronger than the rest. */
  active?: boolean;
}

/** Replaces the whole set. Anchors are recomputed together, never one by one. */
export const setAnchorHighlights = StateEffect.define<readonly AnchorHighlight[]>();

/**
 * Carries the comment id into the DOM so a click can name it without hit-testing
 * coordinates - the same reason `.cm-wiki-link` reads its target off the span.
 */
function markFor(entry: AnchorHighlight): Decoration {
  return Decoration.mark({
    class: entry.active ? "cm-anchor-highlight cm-anchor-highlight--active" : "cm-anchor-highlight",
    attributes: { "data-pv-comment": entry.commentId },
  });
}

function build(list: readonly AnchorHighlight[], docLength: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const entry of list) {
    // A range from a stale resolution can point past the end; clamping keeps a
    // late arrival from throwing instead of simply not being drawn.
    const from = Math.max(0, Math.min(entry.from, docLength));
    const to = Math.max(0, Math.min(entry.to, docLength));
    if (to <= from) continue; // an empty mark renders nothing and RangeSet rejects it
    ranges.push(markFor(entry).range(from, to));
  }
  return Decoration.set(ranges, true);
}

const anchorHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(current, tr) {
    // Mapping first is what keeps the tint on its words while someone types
    // ABOVE it. Without it the highlight would sit at a stale offset until the
    // next recompute - visibly wrong for the length of a keystroke.
    let next = current.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setAnchorHighlights)) next = build(effect.value, tr.state.doc.length);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const anchorHighlightTheme = EditorView.baseTheme({
  ".cm-anchor-highlight": {
    backgroundColor: "var(--comment-anchor-bg, color-mix(in srgb, var(--accent-color) 14%, transparent))",
    borderBottom: "2px solid var(--comment-anchor-line, color-mix(in srgb, var(--accent-color) 45%, transparent))",
    cursor: "pointer",
  },
  ".cm-anchor-highlight--active": {
    backgroundColor: "var(--comment-anchor-bg-active, color-mix(in srgb, var(--accent-color) 30%, transparent))",
    borderBottomColor: "var(--comment-anchor-line-active, var(--accent-color))",
  },
});

/**
 * Tints the places comments point at and reports a click on one.
 *
 * Lives in `packages/ui` rather than the desktop app because the mobile shell
 * needs the same building block (D5); the parity rule is to lift first and wire
 * both views afterwards.
 */
export function anchorHighlightExtension(onActivate: (commentId: string) => void): Extension {
  return [
    anchorHighlightField,
    anchorHighlightTheme,
    EditorView.domEventHandlers({
      mousedown(event) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const commentId = target?.closest<HTMLElement>("[data-pv-comment]")?.dataset.pvComment;
        if (!commentId) return false;
        onActivate(commentId);
        // Never swallow the event: the highlight is a tint, not a button, and
        // clicking a word inside it must still place the caret there.
        return false;
      },
    }),
  ];
}
