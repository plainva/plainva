import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, GripVertical, Maximize2, PanelRight, SlidersHorizontal, X } from "lucide-react";
import { createDocChannel } from "../services/activeDocument";
import { peekInit, peekCurrent, canPeekBack, canPeekForward, peekBack, peekForward, peekPush, type PeekHistory } from "@plainva/ui";
import { PropertiesSection } from "./PropertiesSection";

// Floating peek window for notes opened from a `.base` view or the graph.
// It is a real free-floating (non-modal) window: it does NOT dim the app and
// does NOT close on an outside click — you can work beside it. It is
// draggable by its header, resizable from the bottom-right grip, keeps its own
// back/forward history, and can reveal a Properties column bound to the peek
// note (via a scoped document channel, so it never touches the main sidebar).
// Closable via X or Escape.
//
// The content is the full Editor in its compact `peek` variant, loaded lazily:
// the dynamic import breaks the static cycle
// Editor -> NoteEmbedPlugin -> BaseViewer -> BasePeekModal -> Editor
// (the same mechanism App uses for its lazy Editor).
const LazyEditor = lazy(() => import("./Editor").then((m) => ({ default: m.Editor })));
// A `.base` shown in the peek renders the full BaseViewer (lazy — same cycle
// break as the editor: BaseViewer -> BasePeekModal -> BaseViewer).
const LazyBaseViewer = lazy(() => import("./BaseViewer").then((m) => ({ default: m.BaseViewer })));

const MIN_W = 420;
const MIN_H = 320;
const MARGIN = 8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Rect { x: number; y: number; w: number; h: number }

// Remembered across opens within the session (not persisted to disk): the peek
// reopens where you last left it.
let savedPeekRect: Rect | null = null;

function defaultRect(): Rect {
  const w = clamp(920, MIN_W, window.innerWidth - MARGIN * 2);
  const h = clamp(680, MIN_H, window.innerHeight - MARGIN * 2);
  return {
    x: Math.max(MARGIN, Math.round((window.innerWidth - w) / 2)),
    y: Math.max(MARGIN, Math.round((window.innerHeight - h) / 2)),
    w,
    h,
  };
}

/** Clamp a candidate rect into the current viewport. */
function fitRect(base: Rect): Rect {
  const w = clamp(base.w, MIN_W, window.innerWidth - MARGIN * 2);
  const h = clamp(base.h, MIN_H, window.innerHeight - MARGIN * 2);
  const x = clamp(base.x, MARGIN, Math.max(MARGIN, window.innerWidth - w - MARGIN));
  const y = clamp(base.y, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN));
  return { x, y, w, h };
}

export function BasePeekModal({
  path,
  onClose,
  onMaximize,
  onOpenSplit,
}: {
  /** Initial note or `.base`; the host may change it to open another entry into
   * the same window — that pushes onto the history (browser-like). */
  path: string;
  onClose: () => void;
  /** Open the CURRENT peek target as a regular tab and close the peek. */
  onMaximize: (path: string) => void;
  /** Open the CURRENT peek target in the neighboring pane; absent when no split host exists. */
  onOpenSplit?: (path: string) => void;
}) {
  const { t } = useTranslation();

  // Own back/forward history, seeded from the initial `path`. A note link
  // clicked inside the peek pushes. The host also changes the `path` prop when a
  // different entry is opened into the (still-open) window — that is a real
  // navigation too, so it PUSHES onto the same stack (browser-like) instead of
  // resetting. The stack only starts fresh when the window is closed and
  // reopened (unmount/remount re-runs the initializer). peekPush dedupes the
  // current entry, so re-opening the same note is a no-op.
  const [history, setHistory] = useState<PeekHistory>(() => peekInit(path));
  const seedRef = useRef(path);
  useEffect(() => {
    if (path !== seedRef.current) {
      seedRef.current = path;
      setHistory((h) => peekPush(h, path));
    }
  }, [path]);

  const current = peekCurrent(history);
  const isBase = /\.base$/i.test(current);
  const canBack = canPeekBack(history);
  const canFwd = canPeekForward(history);
  const goBack = () => setHistory(peekBack);
  const goFwd = () => setHistory(peekForward);
  // Every navigation (link inside the peek, or an entry opened from a base shown
  // in the peek) pushes onto the history — notes AND `.base` targets alike.
  const navigate = (p: string) => {
    setHistory((h) => peekPush(h, p));
  };

  // A scoped document channel so the Properties column reflects the PEEK note
  // (the peek Editor publishes here instead of the global sidebar channel).
  const peekChannel = useMemo(() => createDocChannel(), []);
  const [showProps, setShowProps] = useState(false);

  // Free-floating position + size (remembered per session).
  const [rect, setRect] = useState<Rect>(() => fitRect(savedPeekRect ?? defaultRect()));
  useEffect(() => { savedPeekRect = rect; }, [rect]);

  // Escape closes the peek (capture, so it wins over inner editor handlers).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  // --- Drag (by header) and resize (bottom-right grip) via pointer capture ---
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const onHeadDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // let header buttons click
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
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
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
      w: clamp(s.ow + (e.clientX - s.px), MIN_W, window.innerWidth - r.x - MARGIN),
      h: clamp(s.oh + (e.clientY - s.py), MIN_H, window.innerHeight - r.y - MARGIN),
    }));
  };
  const endResize = (e: React.PointerEvent) => {
    resize.current = null;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
  };

  const title = current.split(/[/\\]/).pop()?.replace(/\.(md|base)$/i, "") || current;
  const propsLabel = t("rightPanel.properties", { defaultValue: "Eigenschaften" });

  return createPortal(
    <div
      className="pv-peek-card pv-peek-window"
      role="dialog"
      aria-label={title}
      style={{
        ["--peek-x" as string]: `${rect.x}px`,
        ["--peek-y" as string]: `${rect.y}px`,
        ["--peek-w" as string]: `${rect.w}px`,
        ["--peek-h" as string]: `${rect.h}px`,
      } as React.CSSProperties}
    >
      <div
        className="pv-peek-head"
        onPointerDown={onHeadDown}
        onPointerMove={onHeadMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <GripVertical size={14} className="pv-peek-grip" aria-hidden />
        <div className="pv-peek-nav">
          <button
            type="button"
            className="pv-peek-btn"
            onClick={goBack}
            disabled={!canBack}
            aria-label={t("editor.back")}
            title={t("editor.back")}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            className="pv-peek-btn"
            onClick={goFwd}
            disabled={!canFwd}
            aria-label={t("editor.forward")}
            title={t("editor.forward")}
          >
            <ArrowRight size={15} />
          </button>
        </div>
        <span className="pv-peek-title" title={current}>{title}</span>
        <div className="pv-peek-actions">
          {!isBase && (
            <button
              type="button"
              className={"pv-peek-btn" + (showProps ? " pv-peek-btn--active" : "")}
              onClick={() => setShowProps((v) => !v)}
              aria-pressed={showProps}
              aria-label={propsLabel}
              title={propsLabel}
            >
              <SlidersHorizontal size={15} />
            </button>
          )}
          {onOpenSplit && (
            <button
              type="button"
              className="pv-peek-btn"
              onClick={() => onOpenSplit(current)}
              aria-label={t("database.openInSplit", "Im Split öffnen")}
              title={t("database.openInSplit", "Im Split öffnen")}
            >
              <PanelRight size={15} />
            </button>
          )}
          <button
            type="button"
            className="pv-peek-btn"
            onClick={() => onMaximize(current)}
            aria-label={t("database.maximize", "Als Tab öffnen")}
            title={t("database.maximize", "Als Tab öffnen")}
          >
            <Maximize2 size={15} />
          </button>
          <button
            type="button"
            className="pv-peek-btn"
            onClick={onClose}
            aria-label={t("common.close", "Schließen")}
            title={t("common.close", "Schließen")}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="pv-peek-body">
        <div className="pv-peek-main">
          <Suspense fallback={<div style={{ padding: "2rem", color: "var(--text-muted)" }}>{t("common.loading", "Loading...")}</div>}>
            {isBase ? (
              <LazyBaseViewer
                key={current}
                activePath={current}
                isActivePane={false}
                onOpenPath={(p) => navigate(p)}
                onOpenEntry={navigate}
              />
            ) : (
              <LazyEditor
                key={current}
                activePath={current}
                peek
                isActivePane={false}
                docChannel={peekChannel}
                onOpenPath={(p) => navigate(p)}
              />
            )}
          </Suspense>
        </div>
        {showProps && !isBase && (
          <div className="pv-peek-side">
            <PropertiesSection channel={peekChannel} onOpenPath={(p) => navigate(p)} />
          </div>
        )}
      </div>
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
