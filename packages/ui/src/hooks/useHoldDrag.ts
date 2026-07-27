import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Press-and-hold, then drag — the gesture for reordering bars in the normal
 * interface (plan E10). Drag HANDLES stay in Settings and the .base
 * configuration, where a list is being arranged; in the interface itself the
 * element is held and dragged, the way the action rail already works.
 *
 * Deliberately NOT a copy of AppRibbon's inline timer. That one has a latent
 * bug the plan calls out: it never cancels on movement, so in a scrollable list
 * every swipe would arm a drag. Everything below exists because of a concrete
 * failure mode:
 *
 * - `slopPx` cancels the timer as soon as the pointer travels — scrolling wins.
 * - Pointer capture is taken only AFTER the hold fires, so a plain click still
 *   reaches the button underneath.
 * - `touch-action` is never set statically (that would kill scrolling); instead
 *   a non-passive `touchmove` listener calls preventDefault once armed — the
 *   pattern the mobile board uses.
 * - The click that follows a drag is swallowed, Escape and the context menu
 *   cancel, and text selection is suppressed while dragging.
 */

export interface HoldDragOptions {
  /** Hold duration before the drag arms. Desktop 400 ms, touch shells 350 ms. */
  holdMs?: number;
  /** Movement before arming that cancels the hold (scroll wins). */
  slopPx?: number;
  /** Called once the hold fires. */
  onStart?: (id: string, ev: PointerEvent) => void;
  /** Called on every move while armed. */
  onMove: (id: string, ev: PointerEvent) => void;
  /** Called on release while armed. */
  onDrop: (id: string) => void;
  /** Called when an armed drag is abandoned (Escape, cancel). */
  onCancel?: (id: string) => void;
  /** Optional scroll container; the list auto-scrolls near its edges. */
  scrollRef?: { current: HTMLElement | null };
  enabled?: boolean;
}

const EDGE_PX = 28;
const EDGE_STEP = 10;

export function useHoldDrag(options: HoldDragOptions) {
  const {
    holdMs = 400,
    slopPx = 8,
    onStart,
    onMove,
    onDrop,
    onCancel,
    scrollRef,
    enabled = true,
  } = options;

  const [dragId, setDragId] = useState<string | null>(null);
  // Mirrors dragId synchronously: pointer handlers must not read stale state.
  const dragRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const pendingRef = useRef<{ id: string; target: HTMLElement } | null>(null);
  const armedRef = useRef(false);
  const scrollTimerRef = useRef<number | null>(null);
  /**
   * Survives the drag so the click that follows it can be recognised. It has to
   * outlive `finish()`, because `pointerup` clears the drag state BEFORE the
   * browser dispatches `click` — checking `armedRef` there would always read
   * false and the button would fire its action after every drag. Cleared on the
   * next press, never by a reader, so both the capture guard and an explicit
   * `consumeDragClick()` in the component see the same truth.
   */
  const justDraggedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (scrollTimerRef.current !== null) {
      window.clearInterval(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
  }, []);

  const finish = useCallback(
    (mode: "drop" | "cancel") => {
      const id = dragRef.current;
      clearTimer();
      stopAutoScroll();
      pendingRef.current = null;
      originRef.current = null;
      if (armedRef.current) justDraggedRef.current = true;
      armedRef.current = false;
      dragRef.current = null;
      setDragId(null);
      document.body.style.removeProperty("user-select");
      if (!id) return;
      if (mode === "drop") onDrop(id);
      else onCancel?.(id);
    },
    [clearTimer, stopAutoScroll, onDrop, onCancel],
  );

  // Once armed, swallow touch scrolling. Registered here rather than via a
  // static touch-action so the list stays scrollable when nothing is dragged.
  useEffect(() => {
    if (!dragId) return;
    const block = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", block, { passive: false });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish("cancel");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("touchmove", block);
      window.removeEventListener("keydown", onKey);
    };
  }, [dragId, finish]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (scrollTimerRef.current !== null) window.clearInterval(scrollTimerRef.current);
  }, []);

  const autoScroll = useCallback(
    (clientY: number) => {
      const el = scrollRef?.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const up = clientY < r.top + EDGE_PX;
      const down = clientY > r.bottom - EDGE_PX;
      stopAutoScroll();
      if (!up && !down) return;
      scrollTimerRef.current = window.setInterval(() => {
        el.scrollTop += up ? -EDGE_STEP : EDGE_STEP;
      }, 16);
    },
    [scrollRef, stopAutoScroll],
  );

  const onPointerDown = useCallback(
    (id: string) => (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0) return;
      justDraggedRef.current = false;
      const target = e.currentTarget as HTMLElement;
      pendingRef.current = { id, target };
      originRef.current = { x: e.clientX, y: e.clientY };
      armedRef.current = false;
      clearTimer();
      const native = e.nativeEvent;
      const pointerId = e.pointerId;
      timerRef.current = window.setTimeout(() => {
        const pending = pendingRef.current;
        if (!pending) return;
        armedRef.current = true;
        dragRef.current = pending.id;
        setDragId(pending.id);
        document.body.style.setProperty("user-select", "none");
        window.getSelection()?.removeAllRanges();
        try {
          pending.target.setPointerCapture(pointerId);
        } catch {
          /* capture is a nicety; the window listeners carry the drag anyway */
        }
        onStart?.(pending.id, native);
      }, holdMs);
    },
    [enabled, clearTimer, holdMs, onStart],
  );

  const onPointerMove = useCallback(
    () => (e: React.PointerEvent) => {
      const origin = originRef.current;
      if (!armedRef.current) {
        // Still counting down: any real movement means the user is scrolling.
        if (origin && timerRef.current !== null) {
          const dx = Math.abs(e.clientX - origin.x);
          const dy = Math.abs(e.clientY - origin.y);
          if (dx > slopPx || dy > slopPx) {
            clearTimer();
            pendingRef.current = null;
            originRef.current = null;
          }
        }
        return;
      }
      const id = dragRef.current;
      if (!id) return;
      onMove(id, e.nativeEvent);
      autoScroll(e.clientY);
    },
    [slopPx, clearTimer, onMove, autoScroll],
  );

  const onPointerUp = useCallback(() => {
    if (!armedRef.current) {
      clearTimer();
      pendingRef.current = null;
      originRef.current = null;
      return;
    }
    finish("drop");
  }, [clearTimer, finish]);

  const onPointerCancel = useCallback(() => {
    if (!armedRef.current) {
      clearTimer();
      pendingRef.current = null;
      originRef.current = null;
      return;
    }
    finish("cancel");
  }, [clearTimer, finish]);

  /**
   * A drag must not also read as a click on whatever sits inside the element.
   * React does NOT let a capture handler suppress `onClick` on the SAME node,
   * so the element's own handler additionally asks `consumeDragClick()`.
   */
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (dragRef.current || armedRef.current || justDraggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  /** True when the click being handled is the tail of a drag — ignore it. */
  const consumeDragClick = useCallback(() => justDraggedRef.current, []);

  /** Right-clicking mid-hold means "menu", not "drag". */
  const onContextMenu = useCallback(() => {
    clearTimer();
    if (armedRef.current) finish("cancel");
    pendingRef.current = null;
    originRef.current = null;
  }, [clearTimer, finish]);

  const handlers = useCallback(
    (id: string) => ({
      onPointerDown: onPointerDown(id),
      onPointerMove: onPointerMove(),
      onPointerUp,
      onPointerCancel,
      onClickCapture,
      onContextMenu,
    }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture, onContextMenu],
  );

  return { dragId, handlers, consumeDragClick, cancel: () => finish("cancel") };
}
