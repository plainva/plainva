import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Columns2, ExternalLink, Maximize2, MoreVertical, PanelRight, X } from "lucide-react";
import { createDocChannel } from "../services/activeDocument";
import { FloatingWindow, ICON, MenuSurface, MenuItem, MenuLabel, MenuSeparator, opensExternally, peekInit, peekCurrent, canPeekBack, canPeekForward, peekBack, peekForward, peekPush, resolveOpenAction, type PeekHistory } from "@plainva/ui";
import { PropertiesSection } from "./PropertiesSection";
import { SidebarStepContext, clampPeekSideWidth, readPeekSideWidth, useSidebarStep, writePeekSideWidth } from "../lib/sidebarStep";
import { openAttachmentExternally } from "../services/openAttachment";
import { useVault } from "../contexts/VaultContext";

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
// Same lazy treatment for the image viewer — a peek opened on a gallery row is
// an image often enough that it belongs here, and loading it eagerly would pull
// the canvas editor into every note peek.
const LazyImageViewer = lazy(() => import("./ImageViewer").then((m) => ({ default: m.ImageViewer })));

export function BasePeekModal({
  path,
  onClose,
  onMaximize,
  onOpenSplit,
  onRename,
  onDelete,
}: {
  /** Initial note or `.base`; the host may change it to open another entry into
   * the same window — that pushes onto the history (browser-like). */
  path: string;
  onClose: () => void;
  /** Open the CURRENT peek target as a regular tab and close the peek. */
  onMaximize: (path: string) => void;
  /** Open the CURRENT peek target in the neighboring pane; absent when no split host exists. */
  onOpenSplit?: (path: string) => void;
  /**
   * Entry actions (issue #34). The peek deliberately hides the editor's own ⋮,
   * so an entry opened from a database had no way to be renamed or deleted —
   * you had to find the note in the file tree. The host supplies both.
   */
  onRename?: (path: string) => void;
  onDelete?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const { vaultPath } = useVault();

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
  const action = resolveOpenAction(current);
  const isBase = action === "base";
  // A row in a `.base` gallery is often an image, and the peek used to know only
  // `isBase` — so it handed the PNG to the editor, which cannot decode it. The
  // tab route has had the viewer since P10; the peek simply never asked.
  const isImage = action === "image";
  const canBack = canPeekBack(history);
  const canFwd = canPeekForward(history);
  const goBack = () => setHistory(peekBack);
  const goFwd = () => setHistory(peekForward);
  // Every navigation (link inside the peek, or an entry opened from a base shown
  // in the peek) pushes onto the history — notes AND `.base` targets alike.
  // An attachment is the exception: a peek is a PREVIEW, and Plainva has none
  // for a PDF, so it goes straight to the system and the window stays where it
  // is (issue #55; the peek used to render the editor on it, which produced the
  // load error).
  const navigate = (p: string) => {
    if (opensExternally(p)) {
      if (vaultPath) void openAttachmentExternally(vaultPath, p, t);
      return;
    }
    setHistory((h) => peekPush(h, p));
  };

  // A scoped document channel so the Properties column reflects the PEEK note
  // (the peek Editor publishes here instead of the global sidebar channel).
  const peekChannel = useMemo(() => createDocChannel(), []);
  const [showProps, setShowProps] = useState(false);
  // The properties column: measured for the three steps and draggable at its
  // left edge, remembered across sessions (2026-09-04).
  const { step: sideStep, ref: sideRef } = useSidebarStep();
  const [sideWidth, setSideWidth] = useState<number>(() => readPeekSideWidth());
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { writePeekSideWidth(sideWidth); }, [sideWidth]);
  const onSideGripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sideWidth;
    const bodyWidth = bodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const move = (ev: PointerEvent) => setSideWidth(clampPeekSideWidth(startWidth + (startX - ev.clientX), bodyWidth));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

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
          <span
            className="pv-peek-title"
            data-tip={onRename && !isBase ? t("database.entryRenameHint") : current}
            onDoubleClick={onRename && !isBase ? () => onRename(current) : undefined}
          >
            {title}
          </span>
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
              data-testid="peek-new-window"
              onClick={() => {
                // The owner opens the window and closes whatever held the note;
                // the peek's own job here is to get out of the way.
                window.dispatchEvent(new CustomEvent("plainva-open-in-new-window", { detail: { path: current } }));
                onClose();
              }}
              aria-label={t("window.openInNewWindow")}
              data-tip={t("window.openInNewWindow")}
            >
              <ExternalLink size={ICON.ui} />
            </button>
            {(onRename || onDelete) && !isBase && (
              <button
                ref={menuBtnRef}
                type="button"
                className="pv-peek-btn"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={t("common.moreActions")}
                data-tip={t("common.moreActions")}
                data-testid="peek-menu-btn"
              >
                <MoreVertical size={ICON.ui} />
              </button>
            )}
            <button
              type="button"
              className="pv-peek-btn"
              onClick={onClose}
              aria-label={t("common.close", "Schließen")}
              data-tip={t("common.close", "Schließen")}
            >
              <X size={ICON.ui} />
            </button>
            {menuOpen && (
              <MenuSurface open anchorRef={menuBtnRef} align="right" onClose={() => setMenuOpen(false)} ariaLabel={t("database.entryActions")}>
                <MenuLabel>{t("database.entry")}</MenuLabel>
                {onRename && (
                  <MenuItem data-testid="peek-menu-rename" onSelect={() => { setMenuOpen(false); onRename(current); }}>
                    {t("database.entryRename")}
                  </MenuItem>
                )}
                {onDelete && (
                  <>
                    <MenuSeparator />
                    <MenuItem danger onSelect={() => { setMenuOpen(false); onDelete(current); }}>
                      {t("database.entryDelete")}
                    </MenuItem>
                  </>
                )}
              </MenuSurface>
            )}
          </div>
        </>
      }
    >
      <div className="pv-peek-body" ref={bodyRef}>
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
            ) : isImage ? (
              <LazyImageViewer key={current} path={current} onOpenPath={(p) => navigate(p)} />
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
          <div className="pv-peek-side" ref={sideRef} data-side-step={sideStep} style={{ width: sideWidth }}>
            <div className="pv-peek-side-scroll">
              <SidebarStepContext.Provider value={sideStep}>
                <PropertiesSection channel={peekChannel} onOpenPath={(p) => navigate(p)} />
              </SidebarStepContext.Provider>
            </div>
            {/* After the scroll host in DOM order, so it paints above it without a z-index. */}
            <div
              className="pv-peek-side-grip"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("properties.resizeColumn")}
              data-tip={t("properties.resizeColumn")}
              onPointerDown={onSideGripDown}
            />
          </div>
        )}
      </div>
    </FloatingWindow>
  );
}
