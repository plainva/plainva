import { EditorView } from "@codemirror/view";

/** The gap the read view leaves above a note's first line (--space-3). */
const JUMP_GAP_PX = 12;

/**
 * Go to a line and put it at the TOP of the view (TestFlight feedback,
 * October 2026): a heading picked in the outline, or the target of an anchor
 * link, is where reading continues — so it starts the page. The phone jumped
 * with a bare `scrollIntoView: true`, which scrolls as little as it can: a
 * heading further down stopped at the bottom edge, the text under it out of
 * sight. Both shells jump through here, so the two cannot drift again.
 */
export function jumpToLineTop(view: EditorView, line: number, options: { focus?: boolean } = {}): void {
  const doc = view.state.doc;
  const at = doc.line(Math.min(Math.max(Math.trunc(line) || 1, 1), doc.lines)).from;
  // With that gap a heading's own padding stays in view, below a bar too.
  view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "start", yMargin: JUMP_GAP_PX }) });
  if (options.focus) view.focus();
}

/** The custom property a shell sets on the editor when something lies over its top edge. */
export const COVERED_TOP_PROPERTY = "--pv-editor-covered-top";

/**
 * Space at the top that a shell has covered with its own controls (the
 * phone's floating reader bar): every scroll the editor makes — a jump, the
 * caret following the typing — keeps its target below them. The shell says
 * how much as a length in pixels on the scroller; unset, nothing is covered.
 */
export const coveredTopMargins = EditorView.scrollMargins.of((view) => {
  const top = parseFloat(getComputedStyle(view.scrollDOM).getPropertyValue(COVERED_TOP_PROPERTY));
  return Number.isFinite(top) && top > 0 ? { top } : null;
});

/**
 * Select a place and put it in the MIDDLE of the view: a search hit, the
 * caret a template left, a comment's passage — places to look at, with text
 * around them. The phone revealed these too with the bare `scrollIntoView:
 * true` and left them on the bottom edge; the desktop centred them.
 */
export function selectAndCenter(view: EditorView, anchor: number, head: number = anchor): void {
  view.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(Math.min(anchor, head), { y: "center" }) });
}
