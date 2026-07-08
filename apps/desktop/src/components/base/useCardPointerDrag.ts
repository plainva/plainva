import { useEffect, useRef, useState } from "react";
import type React from "react";

// Pointer-event card drag for the board/calendar/timeline/gallery views (plans
// W6/P5 and Base-UX2 P2). HTML5 drag-and-drop is swallowed by Tauri's native
// drag-drop handler (the reason tab and column drags are already
// pointer-driven), so cards use pointer events. The gesture listens on the
// WINDOW instead of capturing the pointer: setPointerCapture on pointerdown
// retargets the compatibility mouse events (and thus the ensuing click) to the
// card element, which silently swallowed the title/cell clicks inside a card —
// the board's "cannot open, cannot inline-edit" bug. Window listeners keep
// plain clicks untouched; a drag arms after a 5px threshold, hit-tests the
// registered drop targets by rect, moves the ghost element with the pointer
// (direct DOM positioning — no re-render per move) and suppresses the click
// that follows a real drag so dropping never also opens the note.

const DRAG_THRESHOLD_PX = 5;

/** Ghost offset from the pointer so the cursor never covers the card preview. */
const GHOST_OFFSET = { x: 14, y: 10 };

/** Pure rect hit-test over the registered drop targets (exported for tests). */
export function hitTest<T>(targets: Map<T, HTMLElement>, x: number, y: number): T | null {
  for (const [key, el] of targets) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return key;
  }
  return null;
}

export function useCardPointerDrag<T>({ onDrop }: { onDrop: (path: string, target: T) => void }) {
  const targetsRef = useRef<Map<T, HTMLElement>>(new Map());
  const ghostElRef = useRef<HTMLElement | null>(null);
  const lastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const cleanupRef = useRef<(() => void) | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [overTarget, setOverTarget] = useState<T | null>(null);

  const registerTarget = (key: T) => (el: HTMLElement | null) => {
    if (el) targetsRef.current.set(key, el);
    else targetsRef.current.delete(key);
  };

  const positionGhost = () => {
    const el = ghostElRef.current;
    if (!el) return;
    el.style.left = `${lastPosRef.current.x + GHOST_OFFSET.x}px`;
    el.style.top = `${lastPosRef.current.y + GHOST_OFFSET.y}px`;
  };

  // Callback ref for the ghost: the view renders it only while draggingPath is
  // set, so position it the moment it mounts.
  const setGhostEl = (el: HTMLElement | null) => {
    ghostElRef.current = el;
    positionGhost();
  };

  // Remove the window listeners if the view unmounts mid-drag.
  useEffect(() => () => cleanupRef.current?.(), []);

  const cardHandlers = (path: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      // Inputs, buttons and the inline cell editors keep their native pointer
      // behaviour (text selection, dropdowns) — never start a card drag there.
      const target = e.target as HTMLElement | null;
      if (target && target.closest("input, textarea, select, button, a, [contenteditable='true'], .base-inline-editor")) return;
      cleanupRef.current?.();
      const d = { pointerId: e.pointerId, path, startX: e.clientX, startY: e.clientY, moved: false };
      lastPosRef.current = { x: e.clientX, y: e.clientY };

      // Restores text selection once the gesture ends (set on arm).
      let restoreUserSelect: (() => void) | null = null;

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        restoreUserSelect?.();
        restoreUserSelect = null;
        cleanupRef.current = null;
        setDraggingPath(null);
        setOverTarget(null);
      };
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== d.pointerId) return;
        if (!d.moved) {
          if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
          d.moved = true;
          setDraggingPath(d.path);
          // A card drag must never paint a text selection across the board
          // (native report): suppress selection globally while armed and drop
          // whatever the first pixels of movement already selected.
          const prev = document.body.style.userSelect;
          document.body.style.userSelect = "none";
          restoreUserSelect = () => { document.body.style.userSelect = prev; };
          window.getSelection()?.removeAllRanges();
        }
        lastPosRef.current = { x: ev.clientX, y: ev.clientY };
        positionGhost();
        setOverTarget(hitTest(targetsRef.current, ev.clientX, ev.clientY));
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== d.pointerId) return;
        cleanup();
        if (!d.moved) return; // plain click — let the click handlers run
        // The click after a real drag fires at the common ancestor of the
        // down/up targets; a one-shot window capture listener swallows exactly
        // that one (the timeout clears it if no click follows, e.g. on touch).
        const suppress = (ce: MouseEvent) => {
          ce.preventDefault();
          ce.stopPropagation();
        };
        window.addEventListener("click", suppress, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", suppress, { capture: true }), 0);
        const target = hitTest(targetsRef.current, ev.clientX, ev.clientY);
        if (target != null) onDrop(d.path, target);
      };
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId === d.pointerId) cleanup();
      };

      cleanupRef.current = cleanup;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
  });

  // Spread onto the ghost element the view renders while draggingPath is set
  // ("the card sticks to the mouse", P2). Non-interactive by design; the view
  // supplies the visual card content and any extra styling. The position comes
  // exclusively from direct DOM writes (ref callback on mount + pointermove) —
  // starting offscreen keeps the first paint from flashing at a stale corner.
  const ghostProps: { setEl: (el: HTMLElement | null) => void; style: React.CSSProperties } = {
    setEl: setGhostEl,
    style: {
      position: "fixed",
      left: -9999,
      top: -9999,
      zIndex: 1000,
      pointerEvents: "none",
    },
  };

  return { cardHandlers, registerTarget, draggingPath, overTarget, ghostProps };
}
