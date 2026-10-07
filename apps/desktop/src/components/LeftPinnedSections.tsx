import type { BookmarkEntry } from "@plainva/ui";
import { useId, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Clock, Bookmark, ArrowUp, EyeOff, Settings as SettingsIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ICON,
  MenuSurface,
  MenuItem,
  MenuSeparator,
  MenuLabel,
  useHoldDrag,
  visibleAreas,
  moveArea,
  setAreaVisible,
  sanitizeAreaOrder,
  parkTreeReveal,
  toast,
  type AreaOrder,
} from "@plainva/ui";
import { RecentsSection } from "./RecentsSection";
import { BookmarksList } from "./BookmarksList";
import { FileContextMenu } from "./FileContextMenu";
import { useVault } from "../contexts/VaultContext";
import { appPrompt } from "../services/appDialogs";
import { requestCascadeDelete } from "../services/cascadeDelete";
import { applyIndexChanges, duplicateFile, promptRenameFile } from "../services/fileActions";
import { getTemplateFolder } from "../services/newItemFlow";
import { notifyFileOps } from "../services/indexMdAutoUpdate";
import { requestSaveFlush } from "../services/saveFlush";
import {
  BAR_LAYOUT_CHANGED_EVENT,
  openBarSettings,
  barDef,
  loadBarLayout,
  saveBarLayout,
} from "@plainva/ui";

/**
 * The two pinned sections above the file tree: "Recently opened" and
 * "Bookmarks". Which of them show and in which order comes from the shared
 * bar model (plan § 2) — per vault, inherited from the global default until
 * this vault is adapted. Only the open/closed state stays device-local, since
 * that is a "what am I looking at right now" detail, not an arrangement.
 *
 * Reordering is press-and-hold on the header (plan E10): the grip handle is
 * gone from the interface and lives on in Settings, where a list is being
 * arranged rather than used. Right-click carries the same actions for anyone
 * who would rather not hold.
 */

type SectionId = "recents" | "bookmarks";
let cachedSpec: ReturnType<typeof barDef>["spec"] | null = null;
/**
 * Read on first use, not while this module LOADS (C20): reaching across a
 * package boundary at module-init time is the shape that shipped a white
 * window twice. Memoised — the bar definition is static.
 */
const spec = () => (cachedSpec ??= barDef("leftSections").spec);
// vaultPath comes right after the stem so ONE prefix ("plainva-left-sections-<v>")
// covers the open keys in vaultForget's per-vault cleanup.
const openKey = (id: SectionId, v: string) => `plainva-left-sections-${v}-open-${id}`;

function readOpen(id: SectionId, vaultPath: string): boolean {
  const v = localStorage.getItem(openKey(id, vaultPath));
  if (v === null) return true; // default: both sections open
  return v === "true";
}

interface Props {
  vaultPath: string;
  recentPaths: string[];
  bookmarks: BookmarkEntry[];
  activePath: string | null;
  onOpen: (path: string) => void;
  /** Debounced sidebar filter — narrows the bookmarks list (as the old tab did). */
  query: string;
  /* Row actions — the same callbacks the file tree already gets (plan P4). */
  onOpenNewTab?: (path: string) => void;
  onOpenInSplit?: (path: string, direction: "vertical" | "horizontal") => void;
  isBookmarked?: (path: string, type?: "file" | "folder") => boolean;
  onToggleBookmarkPath?: (path: string, type?: "file" | "folder") => void;
  /** Reorders the bookmarks: one entry in front of another, or to the end (keys are `bookmarkKey`s). */
  onMoveBookmark?: (key: string, beforeKey: string | null) => void;
  /** Drops a path from "Recently opened" (the file itself stays). */
  onForgetRecent?: (path: string) => void;
}

export function LeftPinnedSections({
  vaultPath, recentPaths, bookmarks, activePath, onOpen, query,
  onOpenNewTab, onOpenInSplit, isBookmarked, onToggleBookmarkPath, onMoveBookmark, onForgetRecent,
}: Props) {
  const { t } = useTranslation();
  const { vaultAdapter, queryService, indexer, triggerFileTreeUpdate } = useVault();
  const [layout, setLayout] = useState<AreaOrder>(() => sanitizeAreaOrder(undefined, spec()));
  const [open, setOpen] = useState<Record<SectionId, boolean>>(() => ({
    recents: readOpen("recents", vaultPath),
    bookmarks: readOpen("bookmarks", vaultPath),
  }));
  const [overId, setOverId] = useState<SectionId | null>(null);
  const [menuAt, setMenuAt] = useState<{ id: SectionId; x: number; y: number } | null>(null);
  // Right-click on an entry (not the header) — which list it came from decides
  // what "remove from list" means.
  const [rowMenu, setRowMenu] = useState<{ id: SectionId; path: string; type: "file" | "folder"; x: number; y: number } | null>(null);
  const sectionEls = useRef<Partial<Record<SectionId, HTMLElement>>>({});

  // Identifies this surface in the change event, so it does not re-read the
  // store because of its own write. useId is stable per instance and pure —
  // a random id in the render body is not (react-hooks/purity).
  const source = useId();

  useEffect(() => {
    let alive = true;
    const read = (e?: Event) => {
      if (e && (e as CustomEvent<{ source?: string }>).detail?.source === source) return;
      void loadBarLayout("leftSections", vaultPath).then((v) => {
        if (alive) setLayout(v);
      });
    };
    read();
    window.addEventListener(BAR_LAYOUT_CHANGED_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(BAR_LAYOUT_CHANGED_EVENT, read);
    };
  }, [vaultPath, source]);

  // Reload the device-local open state when the vault changes.
  useEffect(() => {
    setOpen({ recents: readOpen("recents", vaultPath), bookmarks: readOpen("bookmarks", vaultPath) });
  }, [vaultPath]);

  const toggle = (id: SectionId) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(openKey(id, vaultPath), String(next[id]));
      return next;
    });
  };

  const persist = useCallback(
    (next: AreaOrder) => {
      setLayout(next);
      void saveBarLayout("leftSections", vaultPath, next, source);
    },
    [vaultPath, source],
  );

  const shown = useMemo(() => visibleAreas(layout) as SectionId[], [layout]);

  const sectionAtY = useCallback((clientY: number): SectionId | null => {
    for (const sid of shown) {
      const el = sectionEls.current[sid];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return sid;
    }
    return null;
  }, [shown]);

  const dropRef = useRef<SectionId | null>(null);
  const { dragId, handlers, consumeDragClick } = useHoldDrag({
    onMove: (_id, ev) => {
      const target = sectionAtY(ev.clientY);
      dropRef.current = target;
      setOverId(target);
    },
    onDrop: (id) => {
      const to = dropRef.current;
      dropRef.current = null;
      setOverId(null);
      if (!to || to === id) return;
      const target = layout.order.indexOf(to);
      if (target >= 0) persist(moveArea(layout, id, target, spec()));
    },
    onCancel: () => {
      dropRef.current = null;
      setOverId(null);
    },
  });

  const title = (id: SectionId) =>
    id === "recents" ? t("sidebar.recent") : t("sidebar.bookmarks", { defaultValue: "Lesezeichen" });

  const openRowMenu = useCallback((id: SectionId) => (path: string, e: React.MouseEvent<HTMLElement>, type: "file" | "folder" = "file") => {
    setMenuAt(null); // never two menus at once
    setRowMenu({ id, path, type, x: e.clientX, y: e.clientY });
  }, []);

  const renameRow = useCallback(async (path: string) => {
    if (!vaultAdapter) return;
    await promptRenameFile(path, {
      adapter: vaultAdapter,
      queryService: queryService ?? null,
      indexer: indexer ?? null,
      t,
      prompt: appPrompt,
      toast,
      flush: requestSaveFlush,
      templateFolder: () => getTemplateFolder(vaultPath),
      refresh: triggerFileTreeUpdate,
      notify: notifyFileOps,
    });
  }, [vaultAdapter, queryService, indexer, t, vaultPath, triggerFileTreeUpdate]);

  const duplicateRow = useCallback(async (path: string) => {
    if (!vaultAdapter) return;
    try {
      const copy = await duplicateFile(vaultAdapter, path, t("fileTree.copySuffix"));
      if (indexer) await applyIndexChanges(indexer, { added: [copy] });
      triggerFileTreeUpdate();
      notifyFileOps([{ type: "create", path: copy }]);
    } catch (err) {
      toast.error(t("dialogs.createErrorMsg", { error: (err as Error).message }));
    }
  }, [vaultAdapter, indexer, t, triggerFileTreeUpdate]);

  const copyRowPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast.info(t("fileTree.pathCopied", "Pfad kopiert."));
    } catch (err) {
      console.warn("Failed to copy file path", err);
    }
  }, [t]);

  // An empty "recently opened" header is noise — the section disappears
  // entirely rather than sitting there greyed out (plan E6).
  const hasContent = (id: SectionId) => (id === "recents" ? recentPaths.length > 0 : true);

  return (
    <div style={{ flexShrink: 0 }}>
      {shown.filter(hasContent).map((id, index, order) => {
        const isOpen = open[id];
        const isOver = overId === id && dragId !== null && dragId !== id;
        const drag = handlers(id);
        const Icon = id === "recents" ? Clock : Bookmark;
        const count = id === "bookmarks" ? bookmarks.length : undefined;
        // A hairline separates rows INSIDE this block; what ends the block is
        // space. The last one drew a third line straight under the second, and
        // the view switch sat flush on it — measured, zero pixels between them
        // (device report 2026-08-15). That is the mobile settings rule, where a
        // gap groups and a line only divides within a group.
        const isLast = index === order.length - 1;
        return (
          <section
            key={id}
            className="pv-side-section"
            ref={(el) => { if (el) sectionEls.current[id] = el; else delete sectionEls.current[id]; }}
            style={{ borderBottom: isLast ? "none" : "1px solid var(--border-color-light)", borderTop: isOver ? "2px solid var(--accent-color)" : "2px solid transparent", opacity: dragId === id ? 0.6 : undefined }}
          >
            <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
              <button
                {...drag}
                onClick={() => { if (consumeDragClick()) return; toggle(id); }}
                onContextMenu={(e) => {
                  // A right-click means "menu", so the pending hold is dropped.
                  drag.onContextMenu();
                  e.preventDefault();
                  setRowMenu(null);
                  setMenuAt({ id, x: e.clientX, y: e.clientY });
                }}
                aria-expanded={isOpen}
                className="pv-side-section-header"
                style={{ cursor: dragId === id ? "grabbing" : undefined }}
              >
                <ChevronDown size={ICON.ui} className="pv-side-section-glyph" style={{ transition: "transform var(--dur-2) var(--ease-1)", transform: isOpen ? "none" : "rotate(-90deg)", flexShrink: 0 }} />
                <Icon size={ICON.ui} className="pv-side-section-glyph" style={{ flexShrink: 0 }} />
                {/* The head is one fixed grid on both sides of the window: the
                    count slot is there whether or not a number is. */}
                <span className="pv-side-section-title">{title(id)}</span>
                <span className="pv-side-section-count">
                  {count !== undefined && count > 0 && <span className="pv-badge pv-badge--accent">{count}</span>}
                </span>
              </button>
            </div>
            {isOpen && (
              <div className="custom-scrollbar" style={{ maxHeight: "38vh", overflowY: "auto" }}>
                {id === "recents" ? (
                  <div className="pv-side-section-rows" data-testid="recents-section">
                    <RecentsSection recentPaths={recentPaths} activePath={activePath} onOpen={onOpen} headless onRowContextMenu={openRowMenu("recents")} />
                  </div>
                ) : (
                  <div className="pv-side-section-rows" data-testid="bookmarks-section">
                    <BookmarksList bookmarks={bookmarks} query={query} activePath={activePath} onOpen={onOpen} onRowContextMenu={openRowMenu("bookmarks")} onMove={onMoveBookmark} />
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}

      {rowMenu && (
        // The same menu the file tree shows, minus the branches that only make
        // sense there: these lists hold files, never folders, and have no
        // multi-selection. "Remove from list" is the entry the tree has no use
        // for — it drops the row, never the file.
        <FileContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          path={rowMenu.path}
          isFolder={rowMenu.type === "folder"}
          onClose={() => setRowMenu(null)}
          onOpenNewTab={rowMenu.type === "file" ? onOpenNewTab : undefined}
          onOpenInSplit={rowMenu.type === "file" ? onOpenInSplit : undefined}
          onRename={rowMenu.type === "file" ? (p) => void renameRow(p) : undefined}
          onDuplicate={rowMenu.type === "file" ? (paths) => void duplicateRow(paths[0]) : undefined}
          isBookmarked={isBookmarked}
          onToggleBookmark={onToggleBookmarkPath}
          onVersionHistory={rowMenu.type === "file" ? (p) => window.dispatchEvent(new CustomEvent("plainva-show-version-history", { detail: { path: p } })) : undefined}
          onRevealInTree={(p) => {
            parkTreeReveal(p);
            window.dispatchEvent(new CustomEvent("plainva-reveal-folder", { detail: { path: p } }));
          }}
          onCopyPath={(p) => void copyRowPath(p)}
          onRemoveFromList={
            rowMenu.id === "recents"
              ? onForgetRecent
              : (p) => onToggleBookmarkPath?.(p, rowMenu.type) /* a bookmark row is bookmarked, so the toggle removes it */
          }
          onDelete={(p) => void requestCascadeDelete({ paths: [p] })}
        />
      )}

      {menuAt && (
        <MenuSurface
          open
          onClose={() => setMenuAt(null)}
          at={{ x: menuAt.x, y: menuAt.y }}
          minWidth={188}
          ariaLabel={title(menuAt.id)}
        >
          <MenuLabel>{title(menuAt.id)}</MenuLabel>
          <MenuItem
            icon={<ArrowUp size={ICON.ui} />}
            onClick={() => {
              persist(moveArea(layout, menuAt.id, 0, spec()));
              setMenuAt(null);
            }}
          >
            {t("bars.moveUp", { defaultValue: "Nach oben" })}
          </MenuItem>
          <MenuItem
            icon={<EyeOff size={ICON.ui} />}
            onClick={() => {
              persist(setAreaVisible(layout, menuAt.id, false, spec()));
              setMenuAt(null);
            }}
          >
            {t("bars.hide", { defaultValue: "Ausblenden" })}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<SettingsIcon size={ICON.ui} />}
            onClick={() => {
              openBarSettings();
              setMenuAt(null);
            }}
          >
            {t("bars.customize", { defaultValue: "Leisten anpassen…" })}
          </MenuItem>
        </MenuSurface>
      )}
    </div>
  );
}
