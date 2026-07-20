import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, GripVertical, Clock, Bookmark } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON } from "@plainva/ui";
import { RecentsSection } from "./RecentsSection";
import { BookmarksList } from "./BookmarksList";

/**
 * The two pinned sections above the file tree: "Recently opened" and
 * "Bookmarks". Both are collapsible and pointer-drag reorderable, with the
 * open/order state remembered PER VAULT (raw-path localStorage keys, mirroring
 * FileTree's expanded-folders convention — register new keys in vaultForget).
 *
 * Reuses the RightSidebar collapsible/reorder pattern (`.pv-side-section` /
 * `.pv-side-section-header` / `.pv-side-grip`) so the left and right sidebars
 * behave identically. HTML5 drag is swallowed by Tauri, so reorder is driven by
 * pointer events. Bookmarks replaces the old top "Bookmarks" tab.
 */

type SectionId = "recents" | "bookmarks";
const ALL: SectionId[] = ["recents", "bookmarks"];
// vaultPath comes right after the stem so ONE prefix ("plainva-left-sections-<v>")
// covers both order + open keys in vaultForget's per-vault cleanup.
const orderKey = (v: string) => `plainva-left-sections-${v}-order`;
const openKey = (id: SectionId, v: string) => `plainva-left-sections-${v}-open-${id}`;

function readOrder(vaultPath: string): SectionId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(orderKey(vaultPath)) || "[]") as SectionId[];
    const valid = raw.filter((id) => ALL.includes(id));
    for (const id of ALL) if (!valid.includes(id)) valid.push(id);
    return valid.length === ALL.length ? valid : [...ALL];
  } catch {
    return [...ALL];
  }
}

function readOpen(id: SectionId, vaultPath: string): boolean {
  const v = localStorage.getItem(openKey(id, vaultPath));
  if (v === null) return true; // default: both sections open
  return v === "true";
}

interface Props {
  vaultPath: string;
  recentPaths: string[];
  bookmarks: string[];
  activePath: string | null;
  onOpen: (path: string) => void;
  /** Debounced sidebar filter — narrows the bookmarks list (as the old tab did). */
  query: string;
}

export function LeftPinnedSections({ vaultPath, recentPaths, bookmarks, activePath, onOpen, query }: Props) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<SectionId[]>(() => readOrder(vaultPath));
  const [open, setOpen] = useState<Record<SectionId, boolean>>(() => ({
    recents: readOpen("recents", vaultPath),
    bookmarks: readOpen("bookmarks", vaultPath),
  }));
  const [dragId, setDragId] = useState<SectionId | null>(null);
  const [overId, setOverId] = useState<SectionId | null>(null);
  const dragIdRef = useRef<SectionId | null>(null);
  const sectionEls = useRef<Partial<Record<SectionId, HTMLElement>>>({});

  // Reload persisted state when the vault changes.
  useEffect(() => {
    setOrder(readOrder(vaultPath));
    setOpen({ recents: readOpen("recents", vaultPath), bookmarks: readOpen("bookmarks", vaultPath) });
  }, [vaultPath]);

  const toggle = (id: SectionId) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(openKey(id, vaultPath), String(next[id]));
      return next;
    });
  };

  const reorder = useCallback((from: SectionId, to: SectionId) => {
    if (from === to) return;
    setOrder((prev) => {
      const next = prev.filter((x) => x !== from);
      const idx = next.indexOf(to);
      next.splice(idx, 0, from);
      localStorage.setItem(orderKey(vaultPath), JSON.stringify(next));
      return next;
    });
  }, [vaultPath]);

  const sectionAtY = (clientY: number): SectionId | null => {
    for (const sid of order) {
      const el = sectionEls.current[sid];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return sid;
    }
    return null;
  };

  const beginDrag = (id: SectionId, e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* not supported */ }
    dragIdRef.current = id;
    setDragId(id);
    setOverId(id);
  };
  const onGripMove = (e: React.PointerEvent) => {
    if (!dragIdRef.current) return;
    const target = sectionAtY(e.clientY);
    if (target) setOverId(target);
  };
  const endDrag = (e: React.PointerEvent) => {
    const from = dragIdRef.current;
    dragIdRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* not supported */ }
    const to = sectionAtY(e.clientY);
    if (from && to && from !== to) reorder(from, to);
    setDragId(null);
    setOverId(null);
  };
  const cancelDrag = () => {
    dragIdRef.current = null;
    setDragId(null);
    setOverId(null);
  };

  // The recents section is hidden when empty (an empty "recent" header is noise).
  const hasRecents = recentPaths.length > 0;

  return (
    <div style={{ flexShrink: 0 }}>
      {order.map((id) => {
        if (id === "recents" && !hasRecents) return null;
        const isOpen = open[id];
        const isOver = overId === id && dragId !== null && dragId !== id;
        const title = id === "recents" ? t("sidebar.recent") : t("sidebar.bookmarks", { defaultValue: "Lesezeichen" });
        const Icon = id === "recents" ? Clock : Bookmark;
        const count = id === "bookmarks" ? bookmarks.length : undefined;
        const label = t("rightPanel.reorder", { defaultValue: "Abschnitt verschieben" });
        return (
          <section
            key={id}
            className="pv-side-section"
            ref={(el) => { if (el) sectionEls.current[id] = el; else delete sectionEls.current[id]; }}
            style={{ borderBottom: "1px solid var(--border-color-light)", borderTop: isOver ? "2px solid var(--accent-color)" : "2px solid transparent" }}
          >
            <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
              <span
                className="pv-side-grip"
                onPointerDown={(e) => { if (e.button === 0) beginDrag(id, e); }}
                onPointerMove={onGripMove}
                onPointerUp={endDrag}
                onPointerCancel={cancelDrag}
                role="button"
                aria-label={label}
                data-tip={label}
                style={{ position: "absolute", left: 0, top: 0, bottom: 0, display: "flex", alignItems: "center", padding: "0 2px", color: "var(--text-faint)", cursor: dragId ? "grabbing" : "grab", touchAction: "none", opacity: dragId ? 1 : undefined }}
              >
                <GripVertical size={ICON.ui} />
              </span>
              <button onClick={() => toggle(id)} aria-expanded={isOpen} className="pv-side-section-header">
                <ChevronDown size={ICON.ui} className="pv-side-section-glyph" style={{ transition: "transform var(--dur-2) var(--ease-1)", transform: isOpen ? "none" : "rotate(-90deg)", flexShrink: 0 }} />
                <Icon size={ICON.ui} className="pv-side-section-glyph" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, textAlign: "left" }}>{title}</span>
                {count !== undefined && count > 0 && <span className="pv-badge pv-badge--accent">{count}</span>}
              </button>
            </div>
            {isOpen && (
              <div className="custom-scrollbar" style={{ maxHeight: "38vh", overflowY: "auto" }}>
                {id === "recents" ? (
                  <div data-testid="recents-section" style={{ padding: "0.25rem" }}>
                    <RecentsSection recentPaths={recentPaths} activePath={activePath} onOpen={onOpen} headless />
                  </div>
                ) : (
                  <div data-testid="bookmarks-section" style={{ padding: "0.25rem" }}>
                    <BookmarksList bookmarks={bookmarks} query={query} activePath={activePath} onOpen={onOpen} />
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
