import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Reordering a short list with the pointer (plan Befunde 2026-10-06, W6) — the
 * bookmarks of both shells: the desktop drags a row of the sidebar, the phone
 * drags the grip at a row's end.
 *
 * The answer is given in KEYS — "this entry, in front of that one, or at the
 * end" — never as a position: a position is only true for the rows a view
 * shows right now (a filtered list, a file that changed underneath), and the
 * owner of the list decides what "in front of" means there.
 *
 * A press becomes a drag after `threshold` pixels; with 0 it is one at once,
 * which is what a grip wants. Where the row itself is the handle, the click
 * that follows a drop is the browser's, not the person's: `wasDrag()` lets the
 * row's click handler tell the two apart.
 */
export interface PointerReorderOptions<K> {
  /** The keys in the order the rows are drawn. */
  keys: readonly K[];
  /** The row elements in that order — read when a drag starts and while it moves. */
  rows: () => HTMLElement[];
  onMove: (key: K, beforeKey: K | null) => void;
  /** Pixels the pointer travels before a press becomes a drag. 0: at once. */
  threshold?: number;
  /** The row left its place (haptics). */
  onLift?: () => void;
  /** The pointer moved while dragging — an auto-scroller listens here. */
  onDragMove?: (clientY: number) => void;
  /** The drag is over, moved or not. */
  onDragEnd?: () => void;
}

export interface PointerReorderHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
}

export interface PointerReorder<K> {
  /** The entry being dragged, or null. */
  dragKey: K | null;
  /** Where a drop would land: 0 … rows, counted in insertion slots; null while nothing would move. */
  dropIndex: number | null;
  /** The handlers for the element that starts the drag of `key`. */
  bind: (key: K) => PointerReorderHandlers;
  /** True once after a drag ended — asked by a click handler on the same element. */
  wasDrag: () => boolean;
}

/**
 * Where a drop at insertion slot `index` puts `key`: in front of which entry,
 * or at the end (`null`). `undefined` means the slot is the entry's own place.
 */
export function reorderTarget<K>(keys: readonly K[], key: K, index: number): { beforeKey: K | null } | undefined {
  const from = keys.indexOf(key);
  if (from < 0 || index === from || index === from + 1) return undefined;
  return { beforeKey: index >= keys.length ? null : keys[index] };
}

export function usePointerReorder<K>({ keys, rows, onMove, threshold = 0, onLift, onDragMove, onDragEnd }: PointerReorderOptions<K>): PointerReorder<K> {
  const [dragKey, setDragKey] = useState<K | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const press = useRef<{ key: K; x: number; y: number; dragging: boolean } | null>(null);
  const dragged = useRef(false);

  /** Insertion slot from the pointer position: the row midpoints, in drawing order. */
  const slotAt = (clientY: number): number => {
    let index = 0;
    for (const row of rows()) {
      const box = row.getBoundingClientRect();
      if (clientY > box.top + box.height / 2) index += 1;
    }
    return index;
  };
  const shownSlot = (key: K, clientY: number): number | null => {
    const index = slotAt(clientY);
    return reorderTarget(keys, key, index) ? index : null;
  };

  const lift = (e: ReactPointerEvent<HTMLElement>, key: K) => {
    // Capture keeps every move, also outside the row the drag started on.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer (synthetic events) — go on uncaptured */
    }
    if (press.current) press.current.dragging = true;
    onLift?.();
    setDragKey(key);
    setDropIndex(shownSlot(key, e.clientY));
  };

  const finish = (e: ReactPointerEvent<HTMLElement>, drop: boolean) => {
    const state = press.current;
    press.current = null;
    if (state?.dragging) {
      dragged.current = true;
      onDragEnd?.();
      const target = drop ? reorderTarget(keys, state.key, slotAt(e.clientY)) : undefined;
      if (target) onMove(state.key, target.beforeKey);
    }
    setDragKey(null);
    setDropIndex(null);
  };

  return {
    dragKey,
    dropIndex,
    wasDrag: () => {
      const was = dragged.current;
      dragged.current = false;
      return was;
    },
    bind: (key) => ({
      onPointerDown: (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        dragged.current = false;
        press.current = { key, x: e.clientX, y: e.clientY, dragging: false };
        if (threshold <= 0) {
          // The handle owns the gesture: nothing scrolls or selects instead.
          e.preventDefault();
          lift(e, key);
        }
      },
      onPointerMove: (e) => {
        const state = press.current;
        if (!state) return;
        if (!state.dragging) {
          if (Math.hypot(e.clientX - state.x, e.clientY - state.y) < threshold) return;
          lift(e, state.key);
        }
        onDragMove?.(e.clientY);
        setDropIndex(shownSlot(state.key, e.clientY));
      },
      onPointerUp: (e) => finish(e, true),
      onPointerCancel: (e) => finish(e, false),
    }),
  };
}
