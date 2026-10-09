import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import { cx } from "./cx";
import { isModalOpen } from "./Modal";

/**
 * FloatingWindow (design sweep 2026-07-19): THE free-floating, non-modal
 * window — draggable by its tinted head (six-dot grip), resizable from the
 * bottom-right grip, viewport-clamped, position/size remembered per
 * `persistKey` for the session. Extracted from the peek/compose copy-paste
 * twins (BasePeekModal, MailDraftModal); renders the shared .pv-peek-*
 * classes so themes keep one docking point for every floating window.
 *
 * The window does NOT dim the app and never closes on an outside click —
 * that is its contract (work beside it). `onEscape` opts into Escape-to-close
 * and `escapeScope` says whose key it is first: a preview closes on Escape
 * wherever the focus is, the composer lets its own menus and the work beside
 * it have the key, and asks before a changed draft goes.
 */

const MARGIN = 8;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface FloatingRect { x: number; y: number; w: number; h: number }

// Session memory per window kind (not persisted to disk): each window type
// reopens where the user last left it.
const savedRects = new Map<string, FloatingRect>();

function defaultRect(w0: number, h0: number, minW: number, minH: number): FloatingRect {
  const w = clamp(w0, minW, window.innerWidth - MARGIN * 2);
  const h = clamp(h0, minH, window.innerHeight - MARGIN * 2);
  return {
    x: Math.max(MARGIN, Math.round((window.innerWidth - w) / 2)),
    y: Math.max(MARGIN, Math.round((window.innerHeight - h) / 2)),
    w,
    h,
  };
}

function fitRect(base: FloatingRect, minW: number, minH: number): FloatingRect {
  const w = clamp(base.w, minW, window.innerWidth - MARGIN * 2);
  const h = clamp(base.h, minH, window.innerHeight - MARGIN * 2);
  const x = clamp(base.x, MARGIN, Math.max(MARGIN, window.innerWidth - w - MARGIN));
  const y = clamp(base.y, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN));
  return { x, y, w, h };
}

export interface FloatingWindowProps {
  /** Session rect-memory key — one per window kind ("peek", "compose"). */
  persistKey: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  ariaLabel: string;
  /** Head-row content after the grip: nav, title, actions (head buttons keep
   * working during drag — pointer-down on a button never starts a drag). */
  head: ReactNode;
  /** Escape handler; who gets the key first is `escapeScope`. Omit to keep
   * Escape for the window's content. */
  onEscape?: () => void;
  /**
   * Whose key Escape is (finding 2026-10-09).
   *
   * `"window"`, the default and the behaviour every preview has always had:
   * this window's, wherever the focus is and before anything else — in the
   * capture phase, so a preview closes on Escape even while the editor it
   * shows has the caret.
   *
   * `"content"`: the content's first. The window takes the key only when
   * nothing inside used it, never when it was pressed in something else, and
   * not while a `Modal` is open on top of it. That is for a window people
   * WRITE in beside their other work, the composer: its command menu and its
   * sender list close on Escape themselves, an Escape meant for a note or a
   * palette next to it has nothing to do with the message, and Escape in the
   * question "discard this draft?" answers the question.
   */
  escapeScope?: "window" | "content";
  children: ReactNode;
  className?: string;
  testId?: string;
}

export function FloatingWindow({
  persistKey,
  defaultWidth,
  defaultHeight,
  minWidth = 420,
  minHeight = 320,
  ariaLabel,
  head,
  onEscape,
  escapeScope = "window",
  children,
  className,
  testId,
}: FloatingWindowProps) {
  const [rect, setRect] = useState<FloatingRect>(() =>
    fitRect(savedRects.get(persistKey) ?? defaultRect(defaultWidth, defaultHeight, minWidth, minHeight), minWidth, minHeight)
  );
  useEffect(() => {
    savedRects.set(persistKey, rect);
  }, [persistKey, rect]);

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onEscape) return;
    const contentFirst = escapeScope === "content";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (contentFirst) {
        // A dialog on top owns the key — first of all the question about this
        // very window: Escape there answers "Cancel", it is not a second
        // request to close.
        if (isModalOpen()) return;
        // Something inside used the key: the composer's command menu
        // (CodeMirror prevents the default), its sender list (stops the event
        // before it gets here).
        if (e.defaultPrevented) return;
        // Pressed in something else — a note, a palette, a search field. With
        // the focus nowhere (the page itself) the window still takes it:
        // nothing else is claiming the key.
        const at = e.target;
        if (at instanceof Node && at !== document.body && at !== document.documentElement && !rootRef.current?.contains(at)) return;
        // Used, and marked as used for whoever reads the event after this.
        e.preventDefault();
      }
      // Nobody further out acts on a key this window used.
      e.stopPropagation();
      onEscape();
    };
    // "window": first of all, in the capture phase. "content": last, once the
    // event has passed everything inside and React's handlers on the way up.
    if (contentFirst) {
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onEscape, escapeScope]);

  // --- Drag (by head) and resize (bottom-right grip) via pointer capture ---
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const onHeadDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // head buttons stay clickable
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: rect.x, oy: rect.y };
  };
  const onHeadMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setRect((r) => ({
      ...r,
      x: clamp(d.ox + (e.clientX - d.px), MARGIN, Math.max(MARGIN, window.innerWidth - r.w - MARGIN)),
      y: clamp(d.oy + (e.clientY - d.py), MARGIN, Math.max(MARGIN, window.innerHeight - r.h - MARGIN)),
    }));
  };
  const endDrag = (e: React.PointerEvent) => {
    drag.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* not captured */
    }
  };

  const resize = useRef<{ px: number; py: number; ow: number; oh: number } | null>(null);
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    resize.current = { px: e.clientX, py: e.clientY, ow: rect.w, oh: rect.h };
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const s = resize.current;
    if (!s) return;
    setRect((r) => ({
      ...r,
      w: clamp(s.ow + (e.clientX - s.px), minWidth, window.innerWidth - r.x - MARGIN),
      h: clamp(s.oh + (e.clientY - s.py), minHeight, window.innerHeight - r.y - MARGIN),
    }));
  };
  const endResize = (e: React.PointerEvent) => {
    resize.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* not captured */
    }
  };

  return createPortal(
    <div
      ref={rootRef}
      className={cx("pv-peek-card", "pv-peek-window", className)}
      role="dialog"
      aria-label={ariaLabel}
      data-testid={testId}
      style={
        {
          "--peek-x": `${rect.x}px`,
          "--peek-y": `${rect.y}px`,
          "--peek-w": `${rect.w}px`,
          "--peek-h": `${rect.h}px`,
        } as CSSProperties
      }
    >
      <div
        className="pv-peek-head"
        onPointerDown={onHeadDown}
        onPointerMove={onHeadMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <GripVertical size={14} className="pv-peek-grip" aria-hidden />
        {head}
      </div>
      {children}
      <div
        className="pv-peek-resize"
        aria-hidden="true"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />
    </div>,
    document.body
  );
}
