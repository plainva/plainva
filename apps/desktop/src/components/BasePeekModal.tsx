import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Columns2, Maximize2, PanelRight, X } from "lucide-react";
import { createDocChannel } from "../services/activeDocument";
import { FloatingWindow, ICON, peekInit, peekCurrent, canPeekBack, canPeekForward, peekBack, peekForward, peekPush, type PeekHistory } from "@plainva/ui";
import { PropertiesSection } from "./PropertiesSection";

// Floating peek window for notes opened from a `.base` view or the graph.
// The window chrome (drag by head, resize grip, session position memory,
// Escape-to-close) comes from the shared FloatingWindow primitive — this file
// only owns the peek-specific content: its own back/forward history, the
// Properties column bound to the peek note (scoped document channel), and the
// maximize/split handoffs.
//
// The content is the full Editor in its compact `peek` variant, loaded lazily:
// the dynamic import breaks the static cycle
// Editor -> NoteEmbedPlugin -> BaseViewer -> BasePeekModal -> Editor
// (the same mechanism App uses for its lazy Editor).
const LazyEditor = lazy(() => import("./Editor").then((m) => ({ default: m.Editor })));
// A `.base` shown in the peek renders the full BaseViewer (lazy — same cycle
// break as the editor: BaseViewer -> BasePeekModal -> BaseViewer).
const LazyBaseViewer = lazy(() => import("./BaseViewer").then((m) => ({ default: m.BaseViewer })));

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

  const title = current.split(/[/\\]/).pop()?.replace(/\.(md|base)$/i, "") || current;
  const propsLabel = t("rightPanel.properties", { defaultValue: "Eigenschaften" });

  return (
    <FloatingWindow
      persistKey="peek"
      defaultWidth={920}
      defaultHeight={680}
      ariaLabel={title}
      onEscape={onClose}
      head={
        <>
          <div className="pv-peek-nav">
            <button
              type="button"
              className="pv-peek-btn"
              onClick={goBack}
              disabled={!canBack}
              aria-label={t("editor.back")}
              data-tip={t("editor.back")}
            >
              <ArrowLeft size={ICON.ui} />
            </button>
            <button
              type="button"
              className="pv-peek-btn"
              onClick={goFwd}
              disabled={!canFwd}
              aria-label={t("editor.forward")}
              data-tip={t("editor.forward")}
            >
              <ArrowRight size={ICON.ui} />
            </button>
          </div>
          <span className="pv-peek-title" data-tip={current}>{title}</span>
          <div className="pv-peek-actions">
            {onOpenSplit && (
              <button
                type="button"
                className="pv-peek-btn"
                onClick={() => onOpenSplit(current)}
                aria-label={t("database.openInSplit", "Im Split öffnen")}
                data-tip={t("database.openInSplit", "Im Split öffnen")}
              >
                <Columns2 size={ICON.ui} />
              </button>
            )}
            {!isBase && (
              <button
                type="button"
                className={"pv-peek-btn" + (showProps ? " pv-peek-btn--active" : "")}
                onClick={() => setShowProps((v) => !v)}
                aria-pressed={showProps}
                aria-label={propsLabel}
                data-tip={propsLabel}
              >
                <PanelRight size={ICON.ui} />
              </button>
            )}
            <button
              type="button"
              className="pv-peek-btn"
              onClick={() => onMaximize(current)}
              aria-label={t("database.maximize", "Als Tab öffnen")}
              data-tip={t("database.maximize", "Als Tab öffnen")}
            >
              <Maximize2 size={ICON.ui} />
            </button>
            <button
              type="button"
              className="pv-peek-btn"
              onClick={onClose}
              aria-label={t("common.close", "Schließen")}
              data-tip={t("common.close", "Schließen")}
            >
              <X size={ICON.ui} />
            </button>
          </div>
        </>
      }
    >
      <div className="pv-peek-body">
        <div className="pv-peek-main">
          <Suspense fallback={<div style={{ padding: "var(--space-8)", color: "var(--text-muted)" }}>{t("common.loading", "Loading...")}</div>}>
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
    </FloatingWindow>
  );
}
