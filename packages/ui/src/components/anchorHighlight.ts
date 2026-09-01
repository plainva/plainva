import { StateEffect, StateField, Facet, type EditorState, type Extension, type Range, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * Where a comment sits in the note, as the editor currently resolves it.
 *
 * The range is a RESULT, not a stored value: `resolveCommentAnchor` produces it
 * from the raw Markdown every time the note or the comment list changes. What
 * lives here is only the tint that makes the place visible — and, since Stufe E,
 * the frame that stands in for a tint where a widget covers the range.
 */

/**
 * What the marked range is, when it is not running text.
 *
 * Deliberately NARROWER than `WorkspaceCommentAnchorDisplay`: not everything the
 * protocol can point at is something a widget can frame. A property comment
 * (Stufe E, E2) hangs on a frontmatter key, which the editor does not render at
 * all - it can be named on a card, but never outlined in the text.
 */
export type AnchorFrameKind = "image" | "diagram" | "tableCell";

export interface AnchorFrameHint {
  kind: AnchorFrameKind;
  /** Row inside the rendered table; 0 is the header. Only for `tableCell`. */
  row?: number;
  /** Column inside the rendered table, 0-based. Only for `tableCell`. */
  column?: number;
}

/** A frontmatter property a comment hangs on - named on the card, never framed. */
export interface AnchorPropertyHint {
  kind: "property";
  /** The frontmatter key as it stood when the comment was written. */
  key: string;
  /** Set once the key was found under a former name (the `.base` rename trail). */
  renamedTo?: string;
}

/** Everything a card may have to name. Mirrors `WorkspaceCommentAnchorDisplay`. */
export type AnchorDisplayHint = AnchorFrameHint | AnchorPropertyHint;

export interface AnchorHighlight {
  /** The comment this range belongs to. */
  commentId: string;
  /** Offsets in the document the editor is showing. */
  from: number;
  to: number;
  /** The selected card's range is drawn stronger than the rest. */
  active?: boolean;
  /**
   * Present when a widget covers the range — a picture, a diagram, a table.
   * The tint is then skipped and the widget draws the frame itself, because a
   * mark can only paint over text the editor actually shows and a replaced
   * range shows none. `anchorFrameAt` is how the widget asks.
   */
  frame?: AnchorFrameHint;
}

/** A frame over a widget's range, in the shape the widget needs to render it. */
export interface AnchorFrame extends AnchorFrameHint {
  commentId: string;
  active: boolean;
}

/** Replaces the whole set. Anchors are recomputed together, never one by one. */
export const setAnchorHighlights = StateEffect.define<readonly AnchorHighlight[]>();

/**
 * How a widget offers "comment on this".
 *
 * A facet rather than a window event, because the widgets already reach the
 * shell this way (`tableLinkHandlers`) and the value has to be readable from
 * inside `toDOM`. The table cell keeps its own path: its context menu already
 * carries the range and the cell coordinates out, so a second channel would
 * only duplicate it.
 */
export interface CommentAnchorHandlers {
  /** False while the note is not in a workspace that accepts comments. */
  enabled: () => boolean;
  /** The reader asked to comment on a widget. */
  request: (req: { from: number; to: number; display: AnchorFrameHint }) => void;
}

export const commentAnchorHandlers = Facet.define<CommentAnchorHandlers, CommentAnchorHandlers | null>({
  combine: (values) => values[0] ?? null,
});

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

function clamp(entry: AnchorHighlight, docLength: number): { from: number; to: number } | null {
  // A range from a stale resolution can point past the end; clamping keeps a
  // late arrival from throwing instead of simply not being drawn.
  const from = Math.max(0, Math.min(entry.from, docLength));
  const to = Math.max(0, Math.min(entry.to, docLength));
  if (to <= from) return null; // an empty mark renders nothing and RangeSet rejects it
  return { from, to };
}

function build(list: readonly AnchorHighlight[], docLength: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const entry of list) {
    if (entry.frame) continue; // covered by a widget — see buildFrames
    const span = clamp(entry, docLength);
    if (!span) continue;
    ranges.push(markFor(entry).range(span.from, span.to));
  }
  return Decoration.set(ranges, true);
}

/**
 * Frames ride in a SECOND set that is deliberately never handed to
 * `EditorView.decorations`.
 *
 * It is a DecorationSet purely for the machinery around it: the set maps itself
 * through every change, so a frame keeps pointing at its table while someone
 * types above it, and `between()` answers "is there a frame over this widget"
 * without a scan. The payload rides on `spec.pvFrame`.
 */
function buildFrames(list: readonly AnchorHighlight[], docLength: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const entry of list) {
    if (!entry.frame) continue;
    const span = clamp(entry, docLength);
    if (!span) continue;
    const frame: AnchorFrame = { ...entry.frame, commentId: entry.commentId, active: entry.active === true };
    ranges.push(Decoration.mark({ class: "cm-anchor-frame-carrier", pvFrame: frame }).range(span.from, span.to));
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

const anchorFrameField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(current, tr) {
    let next = current.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setAnchorHighlights)) next = buildFrames(effect.value, tr.state.doc.length);
    }
    return next;
  },
  // Deliberately NOT provided as decorations — see buildFrames.
});

/**
 * The frame over a widget's range, or null.
 *
 * A widget asks for its OWN range; overlap is enough, because a widget covers
 * exactly the stretch of Markdown its anchor was taken from. An active frame
 * beats a quiet one so the card the reader has open is the one that stands out.
 */
export function anchorFrameAt(state: EditorState, from: number, to: number): AnchorFrame | null {
  const set = state.field(anchorFrameField, false);
  if (!set) return null;
  const found: AnchorFrame[] = [];
  set.between(from, to, (_f, _t, deco) => {
    const frame = (deco.spec as { pvFrame?: AnchorFrame }).pvFrame;
    if (frame) found.push(frame);
  });
  return found.find((f) => f.active) ?? found[0] ?? null;
}

/**
 * A widget's identity has to change with its frame, or CodeMirror keeps the DOM
 * it already built and the frame never appears. Every widget `eq()` folds this in.
 */
export function anchorFrameSignature(frame: AnchorFrame | null): string {
  if (!frame) return "";
  return [frame.commentId, frame.active ? "1" : "0", frame.kind, frame.row ?? "", frame.column ?? ""].join(":");
}

/**
 * How a card names what a framed comment points at.
 *
 * Both shells ask, so the wording cannot drift: a widget anchor has no readable
 * quote (its "text" is `![[picture.png]]` or a whole table's Markdown), and a
 * card that showed that would be worse than one that says nothing.
 *
 * The cell carries a caveat, and it is deliberate: row and column are what the
 * writer saw. A row inserted above still resolves the anchor, so presenting the
 * old coordinates as fact would be a quiet lie - the card says they may have moved.
 */
/**
 * Narrows the stored display record to the hint a card or a widget can use.
 *
 * The core keeps ONE record with a widened `kind` (it is serialised into a
 * sealed frame and must stay a plain shape); the UI keeps a discriminated
 * union, because a frame and a property are named in different ways and only
 * one of them can be drawn around a range. These two helpers are the single
 * place that crosses between the two, so no call site has to cast.
 */
export function toAnchorFrameHint(display: { kind: string; row?: number; column?: number } | null | undefined): AnchorFrameHint | undefined {
  if (!display) return undefined;
  // A property has no range to frame - a comment on `status` marks a key in the
  // frontmatter, and the tint would have nothing to paint on.
  if (display.kind !== "image" && display.kind !== "diagram" && display.kind !== "tableCell") return undefined;
  return { kind: display.kind, row: display.row, column: display.column };
}

/** The same for a card's label, which can name a property as well as a frame. */
export function toAnchorDisplayHint(
  display: { kind: string; row?: number; column?: number; key?: string } | null | undefined,
  renamedTo?: string,
): AnchorDisplayHint | undefined {
  if (!display) return undefined;
  if (display.kind === "property") {
    // A property record without its key names nothing; the card then falls back
    // to whatever it shows for an anchor it cannot describe.
    return display.key ? { kind: "property", key: display.key, renamedTo } : undefined;
  }
  return toAnchorFrameHint(display);
}

export function anchorDisplayLabel(display: AnchorDisplayHint): { key: string; params?: Record<string, unknown>; caveat?: string } {
  if (display.kind === "property") {
    // A renamed property names BOTH: the key the writer saw is what makes the
    // comment readable, the key it lives under today is what makes it findable.
    if (display.renamedTo && display.renamedTo !== display.key) {
      return { key: "workspaceSecurity.commentAtPropertyRenamed", params: { key: display.key, current: display.renamedTo } };
    }
    return { key: "workspaceSecurity.commentAtProperty", params: { key: display.key } };
  }
  if (display.kind === "image") return { key: "workspaceSecurity.commentAtImage" };
  if (display.kind === "diagram") return { key: "workspaceSecurity.commentAtDiagram" };
  if (display.row === undefined || display.column === undefined) return { key: "workspaceSecurity.commentCellMoved" };
  return {
    key: "workspaceSecurity.commentAtCell",
    // Columns are stored 0-based and read 1-based; the row already counts the
    // header as 0, which is what a reader points at when they say "row 1".
    params: { row: display.row, column: display.column + 1 },
    caveat: "workspaceSecurity.commentCellMoved",
  };
}

/** True when this transaction changed the anchor set — widget fields rebuild on it. */
export function hasAnchorHighlightChange(tr: Transaction): boolean {
  for (const effect of tr.effects) if (effect.is(setAnchorHighlights)) return true;
  return false;
}

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
  // A widget cannot be underlined, so the frame carries the same two states an
  // underline does: quiet while the comment is one of many, solid when it is
  // the card the reader has open.
  ".cm-anchor-frame": {
    outline: "2px solid var(--comment-anchor-line, color-mix(in srgb, var(--accent-color) 45%, transparent))",
    outlineOffset: "2px",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  ".cm-anchor-frame--active": {
    outlineColor: "var(--comment-anchor-line-active, var(--accent-color))",
    backgroundColor: "var(--comment-anchor-bg, color-mix(in srgb, var(--accent-color) 14%, transparent))",
  },
  // The speech bubble stays out of the way until the pointer is on the widget —
  // a permanent button on every picture in the note would be noise.
  ".cm-anchor-host": { position: "relative" },
  ".cm-anchor-bubble": {
    position: "absolute",
    top: "4px",
    right: "4px",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    padding: "0",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    background: "var(--bg-primary)",
    color: "var(--text-muted)",
    cursor: "pointer",
    lineHeight: "1",
    fontSize: "var(--text-sm)",
  },
  ".cm-anchor-host:hover .cm-anchor-bubble": { display: "inline-flex" },
  ".cm-anchor-bubble:focus-visible": { display: "inline-flex" },
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
    anchorFrameField,
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

/**
 * Puts the frame and the comment affordance onto a widget's DOM.
 *
 * Shared by all three widget kinds so a picture, a diagram and a table behave
 * identically — the reader should not have to learn three gestures. The element
 * is mutated in place.
 */
export function decorateAnchorTarget(opts: {
  view: EditorView;
  /** The positioned element the bubble is placed in. */
  host: HTMLElement;
  /** The element the frame is drawn around; often the host itself. */
  target: HTMLElement;
  range: { from: number; to: number };
  display: AnchorFrameHint;
  frame: AnchorFrame | null;
  /**
   * Omitted where the widget already offers commenting some other way: the table
   * carries the action in its cell menu, and a second button floating over it
   * would be two doors into one room.
   */
  bubbleLabel?: string;
}): void {
  const { view, host, target, range, display, frame, bubbleLabel } = opts;
  host.classList.add("cm-anchor-host");
  if (frame) {
    target.classList.add("cm-anchor-frame");
    if (frame.active) target.classList.add("cm-anchor-frame--active");
    // Same hook the tint uses, so one click handler serves text and widgets.
    target.setAttribute("data-pv-comment", frame.commentId);
  }
  if (!bubbleLabel) return;
  const handlers = view.state.facet(commentAnchorHandlers);
  if (!handlers || !handlers.enabled()) return;
  const bubble = host.ownerDocument.createElement("button");
  bubble.type = "button";
  bubble.className = "cm-anchor-bubble";
  bubble.textContent = "\u{1F4AC}";
  bubble.setAttribute("aria-label", bubbleLabel);
  bubble.setAttribute("data-tip", bubbleLabel);
  bubble.addEventListener("mousedown", (e) => {
    // The widget owns this click. Without it the caret would land in the source
    // and live preview would flip the widget straight back to raw Markdown.
    e.preventDefault();
    e.stopPropagation();
  });
  bubble.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handlers.request({ from: range.from, to: range.to, display });
  });
  host.appendChild(bubble);
}
