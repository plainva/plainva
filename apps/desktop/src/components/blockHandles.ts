import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { listBlocks, blockAt, type DocBlock } from "./blockModel";

// Notion-style block handles (#7). A "⠿" grip is shown just left of each block —
// anchored to the TEXT COLUMN (not a far-left gutter), so it stays next to the
// block even in the centered/readable width. Left-click (without dragging) and
// right-click both open the block menu; dragging the grip reorders blocks.
//
// Drag uses mouse tracking — NOT HTML5 drag-and-drop, which Tauri's native
// drag-drop handler swallows (dragDropEnabled defaults to true). Same lesson as
// the right sidebar / .base columns.

const GRIP_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">' +
  '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>' +
  '<circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>' +
  '<circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

function openMenuFor(from: number, x: number, y: number) {
  window.dispatchEvent(new CustomEvent("plainva-open-block-menu", { detail: { from, x, y } }));
}

function beginDrag(view: EditorView, fromPos: number, down: MouseEvent) {
  const startX = down.clientX;
  const startY = down.clientY;
  let dragging = false;
  let indicator: HTMLElement | null = null;
  let targetFrom: number | null = null;

  const onMove = (e: MouseEvent) => {
    if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
    dragging = true;
    document.body.style.cursor = "grabbing";
    const content = view.contentDOM.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX, content.left + 8), content.right - 8);
    const pos = view.posAtCoords({ x, y: e.clientY });
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.style.cssText =
        "position:fixed;height:2px;background:var(--accent-color);z-index:60;pointer-events:none;border-radius:2px;";
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

  const onUp = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
    document.body.style.cursor = "";
    if (indicator) indicator.remove();
    if (dragging) {
      if (targetFrom !== null && targetFrom !== fromPos) {
        window.dispatchEvent(new CustomEvent("plainva-move-block", { detail: { from: fromPos, targetFrom } }));
      }
    } else {
      openMenuFor(fromPos, startX, startY); // no drag -> treat as a click (at the cursor)
    }
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", onUp, true);
}

interface HandlePos { from: number; top: number; left: number; }

class BlockHandlesView {
  layer: HTMLElement;
  handles: HTMLElement[] = [];

  constructor(readonly view: EditorView) {
    this.layer = document.createElement("div");
    this.layer.className = "cm-block-handle-layer";
    this.layer.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:5;";
    view.dom.appendChild(this.layer);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    this.schedule();
  }

  onScroll = () => this.schedule();

  update(u: ViewUpdate) {
    // Also re-measure on async parse progress: listBlocks() reads the syntax
    // tree, so grips computed from a stale tree would sit at pre-reflow
    // positions until the next edit/scroll (Jitter, P5).
    if (u.docChanged || u.viewportChanged || u.geometryChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
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
    h.style.cssText = "position:absolute;pointer-events:auto;";
    h.setAttribute("aria-hidden", "true");
    h.innerHTML = GRIP_SVG;
    h.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return; // left button: click-or-drag
      e.preventDefault();
      e.stopPropagation();
      beginDrag(this.view, Number(h.dataset.from), e);
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
