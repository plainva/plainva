import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { listBlocks, blockAt, type DocBlock } from "./blockModel";

// Notion-style block handles (#7). A "⠿" grip is shown just left of each block —
// anchored to the TEXT COLUMN (not a far-left gutter), so it stays next to the
// block even in the centered/readable width. Left-click/tap (without dragging)
// and right-click both open the block menu; dragging the grip reorders blocks.
//
// Drag uses POINTER tracking — NOT HTML5 drag-and-drop, which Tauri's native
// drag-drop handler swallows (dragDropEnabled defaults to true). Same lesson as
// the right sidebar / .base columns. Pointer events (with capture on the grip
// and touch-action:none) make the same click-or-drag flow work for mouse AND
// touch — the previous mouse-only listeners left the grips purely decorative
// on mobile (finding 2026-07-11, R1.2).
//
// Handles only exist while the editor is user-editable (EditorView.editable):
// the mobile read-first mode keeps the reading surface calm (E3).

const GRIP_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">' +
  '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>' +
  '<circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>' +
  '<circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

function openMenuFor(from: number, x: number, y: number) {
  window.dispatchEvent(new CustomEvent("plainva-open-block-menu", { detail: { from, x, y } }));
}

function beginDrag(view: EditorView, fromPos: number, handle: HTMLElement, down: PointerEvent) {
  const startX = down.clientX;
  const startY = down.clientY;
  // Fingers wobble more than a mouse: a larger slop keeps a tap a tap.
  const slop = down.pointerType === "mouse" ? 4 : 8;
  let dragging = false;
  let indicator: HTMLElement | null = null;
  let targetFrom: number | null = null;
  try {
    handle.setPointerCapture(down.pointerId);
  } catch {
    /* jsdom / detached node */
  }

  const onMove = (e: PointerEvent) => {
    if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < slop) return;
    dragging = true;
    document.body.style.cursor = "grabbing";
    const content = view.contentDOM.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX, content.left + 8), content.right - 8);
    const pos = view.posAtCoords({ x, y: e.clientY });
    if (!indicator) {
      indicator = document.createElement("div");
      // Drag-drop line: fixed + pointer-events:none + top-of-stack z-index —
      // exactly what the shared ghost-overlay class carries.
      indicator.className = "pv-fixed-ghost";
      indicator.style.cssText = "height:2px;background:var(--accent-color);border-radius:var(--radius-xs);";
      document.body.appendChild(indicator);
    }
    let topPx: number | null = null;
    if (pos != null) {
      const blk = blockAt(view.state, pos);
      if (blk) {
        targetFrom = blk.from;
        const c = view.coordsAtPos(blk.from);
        if (c) topPx = c.top - 1;
      }
    }
    if (topPx == null) {
      targetFrom = -1; // below the last block -> drop at the end
      const last = view.coordsAtPos(view.state.doc.length);
      if (last) topPx = last.bottom;
    }
    if (topPx != null) {
      indicator.style.display = "block";
      indicator.style.top = `${topPx}px`;
      indicator.style.left = `${content.left}px`;
      indicator.style.width = `${content.width}px`;
    }
  };

  const finish = (commit: boolean) => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onCancel);
    try {
      handle.releasePointerCapture(down.pointerId);
    } catch {
      /* already released */
    }
    document.body.style.cursor = "";
    if (indicator) indicator.remove();
    if (!commit) return;
    if (dragging) {
      if (targetFrom !== null && targetFrom !== fromPos) {
        window.dispatchEvent(new CustomEvent("plainva-move-block", { detail: { from: fromPos, targetFrom } }));
      }
    } else {
      openMenuFor(fromPos, startX, startY); // no drag -> treat as a click/tap (at the cursor)
    }
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);

  // Pointer capture routes move/up to the grip even outside its bounds.
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onCancel);
}

interface HandlePos { from: number; top: number; left: number; }

class BlockHandlesView {
  layer: HTMLElement;
  handles: HTMLElement[] = [];

  constructor(readonly view: EditorView) {
    this.layer = document.createElement("div");
    this.layer.className = "cm-block-handle-layer";
    this.layer.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:var(--z-popover);";
    if (!view.state.facet(EditorView.editable)) this.layer.style.display = "none";
    view.dom.appendChild(this.layer);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    this.schedule();
  }

  onScroll = () => this.schedule();

  update(u: ViewUpdate) {
    // Also re-measure on async parse progress: listBlocks() reads the syntax
    // tree, so grips computed from a stale tree would sit at pre-reflow
    // positions until the next edit/scroll (Jitter, P5). An editable-facet
    // flip (mobile read/edit toggle) shows/hides the grips — the layer hides
    // immediately, the re-measure refreshes positions.
    const editableChanged =
      u.state.facet(EditorView.editable) !== u.startState.facet(EditorView.editable);
    if (editableChanged) {
      this.layer.style.display = u.state.facet(EditorView.editable) ? "" : "none";
    }
    if (
      u.docChanged ||
      u.viewportChanged ||
      u.geometryChanged ||
      syntaxTree(u.startState) !== syntaxTree(u.state) ||
      editableChanged
    ) {
      this.schedule();
    }
  }

  // Layout (coordsAtPos / rects) may only be read in the measure phase, never
  // directly during an update — so positions are computed in `read` and applied
  // in `write` (CM throws "Reading the editor layout isn't allowed" otherwise).
  private schedule() {
    this.view.requestMeasure({ key: this, read: () => this.measure(), write: (pos) => this.write(pos) });
  }

  private measure(): HandlePos[] {
    const view = this.view;
    // Read-only sessions (mobile read-first) show no grips at all (E3).
    if (!view.state.facet(EditorView.editable)) return [];
    let blocks: DocBlock[];
    try { blocks = listBlocks(view.state); } catch { return []; }
    const { from: vpFrom, to: vpTo } = view.viewport;
    const domRect = view.dom.getBoundingClientRect();
    const scRect = view.scrollDOM.getBoundingClientRect();
    const contentRect = view.contentDOM.getBoundingClientRect();
    const out: HandlePos[] = [];
    for (const b of blocks) {
      if (b.to < vpFrom || b.from > vpTo) continue;
      const coords = view.coordsAtPos(b.from);
      if (!coords || coords.top < scRect.top - 2 || coords.top > scRect.bottom - 4) continue;
      out.push({ from: b.from, top: coords.top - domRect.top, left: Math.max(0, contentRect.left - domRect.left - 22) });
    }
    return out;
  }

  private makeHandle(): HTMLElement {
    const h = document.createElement("div");
    h.className = "cm-block-handle";
    // touch-action:none keeps the browser from stealing the pointer for a
    // scroll gesture once a drag starts on the grip (mobile).
    h.style.cssText = "position:absolute;pointer-events:auto;touch-action:none;";
    h.setAttribute("aria-hidden", "true");
    h.innerHTML = GRIP_SVG;
    h.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary) return;
      if (e.pointerType === "mouse" && e.button !== 0) return; // left button: click-or-drag
      e.preventDefault();
      e.stopPropagation();
      beginDrag(this.view, Number(h.dataset.from), h, e);
    });
    h.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMenuFor(Number(h.dataset.from), e.clientX, e.clientY);
    });
    return h;
  }

  private write(items: HandlePos[]) {
    while (this.handles.length < items.length) {
      const h = this.makeHandle();
      this.layer.appendChild(h);
      this.handles.push(h);
    }
    for (let i = 0; i < this.handles.length; i++) {
      const h = this.handles[i];
      const it = items[i];
      if (!it) { h.style.display = "none"; continue; }
      h.dataset.from = String(it.from);
      h.style.display = "flex";
      h.style.top = `${it.top}px`;
      h.style.left = `${it.left}px`;
    }
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.layer.remove();
  }
}

export function blockHandles() {
  return ViewPlugin.fromClass(BlockHandlesView);
}
