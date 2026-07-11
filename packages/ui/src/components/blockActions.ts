import { EditorView } from "@codemirror/view";
import { blockAt, listBlocks } from "./blockModel";
import { listMarkerStyle, moveBlockAbove, turnInto, type BlockTarget } from "./blockTransforms";

// Shared block-menu / block-drag actions (#7). Extracted from the desktop
// Editor so the mobile shell can execute the SAME semantics (list-separator
// guards included) instead of re-implementing them (mobile round 2, R1.2).

export type BlockAction =
  | { kind: "turn"; target: BlockTarget }
  | { kind: "duplicate" }
  | { kind: "move-up" }
  | { kind: "move-down" }
  | { kind: "delete" };

/** Replace the whole doc without the viewport jumping (block moves). */
export function replaceDocPreservingScroll(view: EditorView, newText: string) {
  if (newText === view.state.doc.toString()) return;
  const scrollTop = view.scrollDOM.scrollTop;
  const head = Math.min(view.state.selection.main.head, newText.length);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newText }, selection: { anchor: head }, scrollIntoView: false });
  view.scrollDOM.scrollTop = scrollTop;
}

/**
 * Execute a handle drag-drop: move the block at `from` above the block at
 * `targetFrom` (-1 = append at the end). E2 (2026-07-05): dropping a list next
 * to a SAME-style list would merge them — CommonMark treats blank-line-
 * separated same-marker lists as ONE loose list (Obsidian/GitHub too). An
 * invisible `<!-- -->` separator at that boundary keeps the moved list its own
 * block, everywhere.
 */
export function performBlockMove(view: EditorView, from: number, targetFrom: number): void {
  const src = blockAt(view.state, from);
  if (!src) return;
  let targetFirst: number;
  if (targetFrom === -1) {
    targetFirst = view.state.doc.lines + 1;
  } else {
    const tb = blockAt(view.state, targetFrom);
    if (!tb || tb.from === src.from) return;
    targetFirst = tb.firstLine;
  }
  const doc = view.state.doc;
  const lineText = (n: number) => (n >= 1 && n <= doc.lines ? doc.line(n).text : "");
  const srcStyle = listMarkerStyle(lineText(src.firstLine));
  let guardAbove = false;
  let guardBelow = false;
  if (srcStyle) {
    const blocks = (() => { try { return listBlocks(view.state); } catch { return []; } })();
    const above = [...blocks].reverse().find((b) => b.lastLine < targetFirst && b.from !== src.from);
    const below = blocks.find((b) => b.firstLine >= targetFirst && b.from !== src.from);
    guardAbove = !!above && listMarkerStyle(lineText(above.firstLine)) === srcStyle;
    guardBelow = !!below && listMarkerStyle(lineText(below.firstLine)) === srcStyle;
  }
  replaceDocPreservingScroll(view, moveBlockAbove(view.state.doc.toString(), src.firstLine, src.lastLine, targetFirst, { guardAbove, guardBelow }));
}

/**
 * Execute one block-menu action against the block at `from`.
 * Returns false when the block no longer exists (stale menu).
 */
export function applyBlockAction(view: EditorView, from: number, action: BlockAction): boolean {
  const blk = blockAt(view.state, from);
  if (!blk) return false;
  const text = view.state.sliceDoc(blk.from, blk.to);
  if (action.kind === "turn") {
    view.dispatch({ changes: { from: blk.from, to: blk.to, insert: turnInto(text, action.target) }, userEvent: "input" });
  } else if (action.kind === "duplicate") {
    // A real, separate block: blank line between original and the copy.
    const insert = `\n\n${text}`;
    view.dispatch({ changes: { from: blk.to, insert }, selection: { anchor: blk.to + insert.length }, userEvent: "input" });
  } else if (action.kind === "delete") {
    let end = blk.to;
    if (end < view.state.doc.length && view.state.sliceDoc(end, end + 1) === "\n") end++;
    view.dispatch({ changes: { from: blk.from, to: end, insert: "" }, userEvent: "delete" });
  } else if (action.kind === "move-up" || action.kind === "move-down") {
    const blocks = listBlocks(view.state);
    const idx = blocks.findIndex((b) => b.from === blk.from);
    let targetFirst: number | null = null;
    if (action.kind === "move-up" && idx > 0) targetFirst = blocks[idx - 1].firstLine;
    else if (action.kind === "move-down" && idx >= 0 && idx < blocks.length - 1) targetFirst = blocks[idx + 2] ? blocks[idx + 2].firstLine : view.state.doc.lines + 1;
    if (targetFirst != null) {
      replaceDocPreservingScroll(view, moveBlockAbove(view.state.doc.toString(), blk.firstLine, blk.lastLine, targetFirst));
    }
  }
  return true;
}
