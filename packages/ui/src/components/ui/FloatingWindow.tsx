import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import { cx } from "./cx";

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
 * (peek yes; compose decides for itself to avoid data loss).
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
  /** Escape handler (capture phase, wins over inner editors). Omit to keep
   * Escape for the window's content (compose). */
  onEscape?: () => void;
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

  useEffect(() => {
    if (!onEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onEscape();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onEscape]);

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
