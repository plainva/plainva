import { useRef, useState } from "react";
import type * as React from "react";

/**
 * Pointer-based reordering for small vertical row lists (HTML5 DnD is swallowed
 * by Tauri WebViews — same reason the board/tab drags use pointer events). The
 * host renders one grip per row, spreads `gripProps(i)` on it and attaches
 * `rowRef(i)` to the row element; on drop `onMove(from, to)` fires with the
 * list indices. `dragIdx`/`overIdx` drive the usual dim + drop-line styling.
 */
export function useRowDrag(onMove: (from: number, to: number) => void) {
  const rowEls = useRef<Record<number, HTMLElement | null>>({});
  const dragFrom = useRef<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const rowAtY = (clientY: number): number | null => {
    for (const [key, el] of Object.entries(rowEls.current)) {
      if (!el || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return Number(key);
    }
    return null;
  };

  const reset = () => {
    dragFrom.current = null;
    setDragIdx(null);
    setOverIdx(null);
  };

  const gripProps = (i: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* unsupported */ }
      dragFrom.current = i;
      setDragIdx(i);
      setOverIdx(i);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (dragFrom.current == null) return;
      const over = rowAtY(e.clientY);
      if (over != null) setOverIdx(over);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const from = dragFrom.current;
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* unsupported */ }
      const to = rowAtY(e.clientY);
      reset();
      if (from == null || to == null || from === to) return;
      onMove(from, to);
    },
    onPointerCancel: reset,
  });

  const rowRef = (i: number) => (el: HTMLElement | null) => {
    rowEls.current[i] = el;
  };

  return { dragIdx, overIdx, gripProps, rowRef };
}
