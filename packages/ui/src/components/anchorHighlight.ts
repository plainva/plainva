import { StateEffect, StateField, Facet, type EditorState, type Extension, type Range, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { applyRegionStyle, type AnchorRegionRect, type RegionPick } from "./anchorRegion";

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
  /** The header the column carries today, for the card (Tabellenzelle, V7). */
  columnLabel?: string | null;
  /** The cell was found somewhere else than the writer left it (V7). */
  moved?: boolean;
  /** The cell is where it was, but says something else now (V7). */
  changed?: boolean;
  /**
   * The marked region inside the picture, in fractions of it. Only for `image`.
   *
   * Absent means the comment is about the whole picture - the gesture E1
   * shipped, and what every note written before E3 still carries.
   */
  rect?: AnchorRegionRect;
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
  /**
   * Present on an OPEN suggestion while the reader wants changes shown in the
   * text (K5): the range is drawn struck through and the proposed wording
   * stands right behind it, Word-style. The document is untouched - this is a
   * decoration, and accepting is still the only write.
   */
  suggestion?: { replacement: string };
}

/**
 * How the inline proposal reaches the shell (K5). `canApply`/`canDecline`
 * decide whether the little pill shows its buttons at all: a Commenter may
 * decline but not accept, and a phone shows no pill (its sheet has the
 * buttons) - the widget asks rather than assumes.
 */
export interface SuggestionActionHandlers {
  canApply: () => boolean;
  canDecline: () => boolean;
  apply: (commentId: string) => void;
  decline: (commentId: string) => void;
  activate: (commentId: string) => void;
}

export const suggestionActionHandlers = Facet.define<SuggestionActionHandlers | null, SuggestionActionHandlers | null>({
  combine: (values) => values[0] ?? null,
});

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
  const base = entry.suggestion ? "cm-anchor-highlight cm-suggestion-del" : "cm-anchor-highlight";
  return Decoration.mark({
    class: entry.active ? `${base} cm-anchor-highlight--active` : base,
    attributes: { "data-pv-comment": entry.commentId },
  });
}

/**
 * The proposed wording, drawn behind the struck passage (K5).
 *
 * Nothing in the document changes: the widget is a decoration at the range's
 * end. Its text can be selected with the eye but not the caret - the caret
 * skips it like any widget - which is the honest shape for "what COULD stand
 * here". The pill with accept/decline appears on hover, and only where the
 * shell says the reader may do either.
 */
class SuggestionWidget extends WidgetType {
  constructor(private readonly commentId: string, private readonly replacement: string, private readonly active: boolean) { super(); }
  eq(other: SuggestionWidget) {
    return other.commentId === this.commentId && other.replacement === this.replacement && other.active === this.active;
  }
  ignoreEvent() { return true; }
  toDOM(view: EditorView) {
    const doc = view.dom.ownerDocument;
    const host = doc.createElement("span");
    host.className = this.active ? "cm-suggestion-host cm-suggestion-host--active" : "cm-suggestion-host";
    host.contentEditable = "false";
    host.setAttribute("data-pv-comment", this.commentId);
    const handlers = view.state.facet(suggestionActionHandlers);
    if (this.replacement.length > 0) {
      const ins = doc.createElement("span");
      ins.className = "cm-suggestion-ins";
      ins.textContent = this.replacement;
      ins.addEventListener("mousedown", (e) => { e.preventDefault(); });
      ins.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); handlers?.activate(this.commentId); });
      host.appendChild(ins);
    }
    if (handlers && (handlers.canApply() || handlers.canDecline())) {
      const pill = doc.createElement("span");
      pill.className = "cm-suggestion-pill";
      const button = (glyph: string, label: string, run: () => void) => {
        const el = doc.createElement("button");
        el.type = "button";
        el.className = "cm-suggestion-pill__btn";
        el.textContent = glyph;
        el.setAttribute("aria-label", label);
        el.setAttribute("data-tip", label);
        el.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        el.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); run(); });
        pill.appendChild(el);
      };
      if (handlers.canApply()) button("\u2713", "apply", () => handlers.apply(this.commentId));
      if (handlers.canDecline()) button("\u2715", "decline", () => handlers.decline(this.commentId));
      host.appendChild(pill);
    }
    return host;
  }
}

function clamp(entry: AnchorHighlight, docLength: number): { from: number; to: number } | null {
  // A range from a stale resolution can point past the end; clamping keeps a
  // late arrival from throwing instead of simply not being drawn.
  const from = Math.max(0, Math.min(entry.from, docLength));
  const to = Math.max(0, Math.min(entry.to, docLength));
  // An empty mark renders nothing and RangeSet rejects it - except for an
  // insertion point (V3), which has no passage and draws only its widget.
  if (to < from || (to === from && !entry.suggestion)) return null;
  return { from, to };
}

function build(list: readonly AnchorHighlight[], docLength: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const entry of list) {
    if (entry.frame) continue; // covered by a widget — see buildFrames
    const span = clamp(entry, docLength);
    if (!span) continue;
    if (span.to > span.from) ranges.push(markFor(entry).range(span.from, span.to));
    if (entry.suggestion) {
      ranges.push(Decoration.widget({ widget: new SuggestionWidget(entry.commentId, entry.suggestion.replacement, entry.active === true), side: 1 }).range(span.to));
    }
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
 * EVERY frame over a widget's range.
 *
 * A picture can carry more than one marking: "this field" and "that button" on
 * the same screenshot is the normal case for a region comment, not an edge one.
 * `anchorFrameAt` answers the older question - which ONE frame - and stays as it
 * is, because a table cell and a diagram frame exactly one range.
 *
 * Quiet frames come first so the active one paints on top of them.
 */
export function anchorFramesAt(state: EditorState, from: number, to: number): AnchorFrame[] {
  const set = state.field(anchorFrameField, false);
  if (!set) return [];
  const found: AnchorFrame[] = [];
  set.between(from, to, (_f, _t, deco) => {
    const frame = (deco.spec as { pvFrame?: AnchorFrame }).pvFrame;
    if (frame) found.push(frame);
  });
  return [...found.filter((f) => !f.active), ...found.filter((f) => f.active)];
}

/**
 * A widget's identity has to change with its frame, or CodeMirror keeps the DOM
 * it already built and the frame never appears. Every widget `eq()` folds this in.
 */
export function anchorFrameSignature(frame: AnchorFrame | null): string {
  if (!frame) return "";
  // The rectangle belongs to the identity too: a marking that moved is a
  // different picture to draw, and without it the widget keeps the DOM it has.
  const rect = frame.rect ? [frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h].join(",") : "";
  return [frame.commentId, frame.active ? "1" : "0", frame.kind, frame.row ?? "", frame.column ?? "", rect].join(":");
}

/** The same for a widget that draws SEVERAL frames - see `anchorFramesAt`. */
export function anchorFramesSignature(frames: readonly AnchorFrame[]): string {
  return frames.map((frame) => anchorFrameSignature(frame)).join("|");
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
 * The display record exactly as the core seals it: one plain shape with a
 * widened `kind`, carrying every field any anchor kind may need.
 *
 * Both converters below take THIS type rather than repeating its shape inline.
 * Written twice, the two copies drift: `key` reached only the lower one, so
 * handing the upper one a property record - the case it documents and handles -
 * failed to compile.
 */
export interface StoredAnchorDisplay {
  kind: string;
  row?: number;
  column?: number;
  key?: string;
  rect?: AnchorRegionRect;
}

/**
 * Narrows the stored display record to the hint a card or a widget can use.
 *
 * The core keeps ONE record with a widened `kind` (it is serialised into a
 * sealed frame and must stay a plain shape); the UI keeps a discriminated
 * union, because a frame and a property are named in different ways and only
 * one of them can be drawn around a range. These two helpers are the single
 * place that crosses between the two, so no call site has to cast.
 */
/** Where a cell anchor was found again - what the resolution learned (V7). */
export interface AnchorCellPlace {
  row: number;
  column: number;
  columnLabel?: string | null;
  changed?: boolean;
  moved?: boolean;
}

export function toAnchorFrameHint(
  display: StoredAnchorDisplay | null | undefined,
  place?: AnchorCellPlace | null,
): AnchorFrameHint | undefined {
  if (!display) return undefined;
  // A property has no range to frame - a comment on `status` marks a key in the
  // frontmatter, and the tint would have nothing to paint on.
  if (display.kind !== "image" && display.kind !== "diagram" && display.kind !== "tableCell") return undefined;
  // Only a picture carries a region. The core refuses to seal a rect on
  // anything else; dropping a stray one here keeps the reading side from
  // drawing a rectangle over a table because a foreign writer sent one.
  const rect = display.kind === "image" ? display.rect : undefined;
  // The resolution knows where the cell is TODAY (V7): a row inserted above
  // moved it, and the frame has to land on the cell, not on the coordinates
  // the writer saw. The stored hint stays untouched - it is sealed.
  if (display.kind === "tableCell" && place) {
    return { kind: display.kind, row: place.row, column: place.column, columnLabel: place.columnLabel ?? null, moved: place.moved === true, changed: place.changed === true, rect };
  }
  return { kind: display.kind, row: display.row, column: display.column, rect };
}

/** The same for a card's label, which can name a property as well as a frame. */
export function toAnchorDisplayHint(
  display: StoredAnchorDisplay | null | undefined,
  renamedTo?: string,
  place?: AnchorCellPlace | null,
): AnchorDisplayHint | undefined {
  if (!display) return undefined;
  if (display.kind === "property") {
    // A property record without its key names nothing; the card then falls back
    // to whatever it shows for an anchor it cannot describe.
    return display.key ? { kind: "property", key: display.key, renamedTo } : undefined;
  }
  return toAnchorFrameHint(display, place);
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
  if (display.kind === "image") {
    // A region names a place INSIDE the picture, and saying so is the whole
    // point of it - "on the picture" would hide what the writer marked.
    return { key: display.rect ? "workspaceSecurity.commentAtImageRegion" : "workspaceSecurity.commentAtImage" };
  }
  if (display.kind === "diagram") return { key: "workspaceSecurity.commentAtDiagram" };
  if (display.row === undefined || display.column === undefined) return { key: "workspaceSecurity.commentCellMoved" };
  // The column's header names the column where the table has one (V7), and
  // the caveat is earned rather than automatic: only a cell that moved or
  // changed says so - a cell that sits where it was says nothing.
  return {
    key: display.columnLabel ? "workspaceSecurity.commentAtCellNamed" : "workspaceSecurity.commentAtCell",
    // Columns are stored 0-based and read 1-based; the row already counts the
    // header as 0, which is what a reader points at when they say "row 1".
    params: { row: display.row, column: display.column + 1, label: display.columnLabel ?? "" },
    caveat: display.changed ? "workspaceSecurity.commentCellChanged" : display.moved ? "workspaceSecurity.commentCellMoved" : undefined,
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
  // An open suggestion shown in the text (K5): the passage struck in the
  // deletion tone, the proposal behind it in the insertion tone - the same
  // two tones the card's diff uses, so the eye moves between them freely.
  ".cm-suggestion-del": {
    textDecoration: "line-through",
    color: "var(--error-text)",
    backgroundColor: "var(--error-bg)",
    borderBottom: "none",
  },
  ".cm-suggestion-host": { position: "relative", display: "inline", whiteSpace: "pre-wrap" },
  ".cm-suggestion-ins": {
    color: "var(--success-text)",
    backgroundColor: "var(--success-bg)",
    borderBottom: "2px solid var(--success-border)",
    cursor: "pointer",
  },
  ".cm-suggestion-host--active .cm-suggestion-ins": { outline: "2px solid var(--success-border)" },
  ".cm-suggestion-pill": {
    display: "none",
    verticalAlign: "middle",
    marginLeft: "var(--space-1)",
    padding: "0",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-pill)",
    background: "var(--bg-primary)",
    lineHeight: "1",
  },
  ".cm-suggestion-host:hover .cm-suggestion-pill, .cm-suggestion-host--active .cm-suggestion-pill": { display: "inline-flex" },
  ".cm-suggestion-pill__btn": {
    border: "none",
    background: "transparent",
    width: "var(--space-6)",
    height: "var(--space-5)",
    borderRadius: "var(--radius-pill)",
    cursor: "pointer",
    color: "var(--text-muted)",
    fontSize: "var(--text-sm)",
    padding: "0",
  },
  ".cm-suggestion-pill__btn:hover": { background: "var(--bg-hover)", color: "var(--text-main)" },

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
  ".cm-anchor-bubble svg": { width: "1em", height: "1em", fontSize: "var(--text-md)" },
  ".cm-anchor-host:hover .cm-anchor-bubble": { display: "inline-flex" },
  ".cm-anchor-bubble:focus-visible": { display: "inline-flex" },
  // A table cell is small; the picture-sized bubble would cover its text.
  // Finding 2026-09-03 (K2): the cell menu alone was not found. On a touch
  // screen there is no hover and the cell's long-press sheet is the way, so
  // the bubble stays away there instead of sticking to the last tapped cell.
  ".cm-anchor-bubble--cell": { top: "2px", right: "2px", width: "20px", height: "20px", fontSize: "var(--text-xs)" },
  // A commented cell carries a corner triangle, the way a spreadsheet marks
  // a note (finding 2026-09-03): it stays inside the cell where an outline
  // ran over the borders, and a click on it opens the card. The active card
  // tints the cell, still inside its edges.
  ".cm-anchor-cell": { position: "relative" },
  ".cm-anchor-cell--active": { backgroundColor: "var(--comment-anchor-bg, color-mix(in srgb, var(--accent-color) 14%, transparent))" },
  ".cm-anchor-corner": {
    position: "absolute",
    top: "0",
    right: "0",
    width: "0",
    height: "0",
    padding: "0",
    margin: "0",
    background: "transparent",
    border: "0",
    borderTop: "10px solid var(--comment-anchor-line-active, var(--accent-color))",
    borderLeft: "10px solid transparent",
    cursor: "pointer",
  },
  ".cm-anchor-cell--active .cm-anchor-corner": { borderTopWidth: "13px", borderLeftWidth: "13px" },
  ".cm-anchor-corner:focus-visible": { outline: "2px solid var(--focus-ring, var(--accent-color))", outlineOffset: "1px" },
  "@media (hover: none)": {
    ".cm-anchor-host:hover .cm-anchor-bubble--cell": { display: "none" },
    ".cm-suggestion-host:hover .cm-suggestion-pill": { display: "none" },
  },
  // The host is an inline-block around an inline image, so it inherits the
  // baseline gap under it. A few stray pixels of height would skew every
  // percentage the markings are positioned with.
  ".cm-anchor-region-host": { position: "relative", lineHeight: "0" },
  // While drawing: crosshair over the picture, and touch scrolling suspended so
  // a finger draws a rectangle instead of moving the note.
  ".cm-anchor-region-arm": { cursor: "crosshair", touchAction: "none" },
  // The bubble sits exactly where a drag would start. Same specificity as the
  // hover rule above and written after it, so source order decides.
  ".cm-anchor-region-arm.cm-anchor-host .cm-anchor-bubble": { display: "none" },
  ".cm-anchor-region": {
    position: "absolute",
    border: "2px solid var(--comment-anchor-line, color-mix(in srgb, var(--accent-color) 45%, transparent))",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--comment-anchor-bg, color-mix(in srgb, var(--accent-color) 14%, transparent))",
    cursor: "pointer",
  },
  ".cm-anchor-region--active": {
    borderColor: "var(--comment-anchor-line-active, var(--accent-color))",
    backgroundColor: "var(--comment-anchor-bg-active, color-mix(in srgb, var(--accent-color) 30%, transparent))",
  },
  // The rubber band is not a target - it follows the pointer that draws it.
  ".cm-anchor-region--draft": { pointerEvents: "none" },
  ".cm-anchor-region-hint": {
    position: "absolute",
    left: "50%",
    top: "8px",
    transform: "translateX(-50%)",
    padding: "2px 8px",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-pill)",
    background: "var(--bg-primary)",
    color: "var(--text-muted)",
    fontSize: "var(--text-xs)",
    lineHeight: "1.4",
    whiteSpace: "nowrap",
    pointerEvents: "none",
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
   * Frames that mark a REGION instead of the whole widget, drawn as overlays
   * inside the host so several markings on one picture stay apart.
   */
  regions?: readonly AnchorFrame[];
  /**
   * Lets the reader draw a region before the comment is requested. Supplied
   * only where a region can mean anything: a picture that lives in the vault.
   * A picture from the net has no stable size to measure fractions against.
   */
  pickRegion?: () => Promise<RegionPick>;
  /**
   * Omitted where the widget already offers commenting some other way: the table
   * carries the action in its cell menu, and a second button floating over it
   * would be two doors into one room.
   */
  bubbleLabel?: string;
  /** A second class on the bubble - the table cell wants a smaller one. */
  bubbleClass?: string;
  /**
   * Draw the frame as a corner triangle inside the target instead of an
   * outline around it (a table cell, V7). The label names the button.
   */
  corner?: { label: string };
}): void {
  const { view, host, target, range, display, frame, regions, pickRegion, bubbleLabel, bubbleClass, corner } = opts;
  host.classList.add("cm-anchor-host");
  if (frame && corner) {
    target.classList.add("cm-anchor-cell");
    if (frame.active) target.classList.add("cm-anchor-cell--active");
    const button = host.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "cm-anchor-corner";
    button.setAttribute("aria-label", corner.label);
    button.setAttribute("data-tip", corner.label);
    // The corner carries the id, not the cell: a click on the cell's text
    // still edits the cell, a click on the corner opens the card - through
    // the shared mousedown handler, which is why nothing is stopped here.
    button.setAttribute("data-pv-comment", frame.commentId);
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    target.appendChild(button);
  } else if (frame) {
    target.classList.add("cm-anchor-frame");
    if (frame.active) target.classList.add("cm-anchor-frame--active");
    // Same hook the tint uses, so one click handler serves text and widgets.
    target.setAttribute("data-pv-comment", frame.commentId);
  }
  for (const region of regions ?? []) {
    if (!region.rect) continue;
    const mark = host.ownerDocument.createElement("span");
    mark.className = region.active ? "cm-anchor-region cm-anchor-region--active" : "cm-anchor-region";
    applyRegionStyle(mark, region.rect);
    // The MARKING carries the id, not the picture: a click has to name the
    // comment drawn here, and two markings on one screenshot would otherwise
    // be indistinguishable to the handler.
    mark.setAttribute("data-pv-comment", region.commentId);
    mark.addEventListener("mousedown", (e) => {
      // Deliberately no stopPropagation: the shared handler still has to see
      // this and open the card. Only the caret is refused - it would land in
      // the source and flip the picture back to raw Markdown.
      e.preventDefault();
    });
    host.appendChild(mark);
  }
  if (!bubbleLabel) return;
  const handlers = view.state.facet(commentAnchorHandlers);
  if (!handlers || !handlers.enabled()) return;
  const bubble = host.ownerDocument.createElement("button");
  bubble.type = "button";
  bubble.className = bubbleClass ? `cm-anchor-bubble ${bubbleClass}` : "cm-anchor-bubble";
  // The same glyph the ribbon and the column use (lucide `message-square`),
  // not an emoji: an emoji takes the platform's colour font and sits outside
  // the app's icon language (finding 2026-09-03).
  bubble.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
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
    if (!pickRegion) {
      handlers.request({ from: range.from, to: range.to, display });
      return;
    }
    void pickRegion().then((pick) => {
      // Cancelled means the reader changed their mind. Falling back to the
      // whole picture would put a comment where nobody asked for one.
      if (pick.kind === "cancelled") return;
      const next = pick.kind === "region" ? { ...display, rect: pick.rect } : display;
      handlers.request({ from: range.from, to: range.to, display: next });
    });
  });
  host.appendChild(bubble);
}
