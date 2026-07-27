import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type AreaOrder,
} from "@plainva/ui";
import { RecentsSection } from "./RecentsSection";
import { BookmarksList } from "./BookmarksList";
import {
  BAR_LAYOUT_CHANGED_EVENT,
  openBarSettings,
  barDef,
  loadBarLayout,
  saveBarLayout,
} from "../services/barLayout";

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
const SPEC = barDef("leftSections").spec;
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
  bookmarks: string[];
  activePath: string | null;
  onOpen: (path: string) => void;
  /** Debounced sidebar filter — narrows the bookmarks list (as the old tab did). */
  query: string;
}

export function LeftPinnedSections({ vaultPath, recentPaths, bookmarks, activePath, onOpen, query }: Props) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<AreaOrder>(() => sanitizeAreaOrder(undefined, SPEC));
  const [open, setOpen] = useState<Record<SectionId, boolean>>(() => ({
    recents: readOpen("recents", vaultPath),
    bookmarks: readOpen("bookmarks", vaultPath),
  }));
  const [overId, setOverId] = useState<SectionId | null>(null);
  const [menuAt, setMenuAt] = useState<{ id: SectionId; x: number; y: number } | null>(null);
  const sectionEls = useRef<Partial<Record<SectionId, HTMLElement>>>({});

  // Identifies this surface in the change event, so it does not re-read the
  // store because of its own write.
  const sourceRef = useRef<string>(`leftSections-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let alive = true;
    const read = (e?: Event) => {
      if (e && (e as CustomEvent<{ source?: string }>).detail?.source === sourceRef.current) return;
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
  }, [vaultPath]);

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
      void saveBarLayout("leftSections", vaultPath, next, sourceRef.current);
    },
    [vaultPath],
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
      if (target >= 0) persist(moveArea(layout, id, target, SPEC));
    },
    onCancel: () => {
      dropRef.current = null;
      setOverId(null);
    },
  });

  const title = (id: SectionId) =>
    id === "recents" ? t("sidebar.recent") : t("sidebar.bookmarks", { defaultValue: "Lesezeichen" });

  // An empty "recently opened" header is noise — the section disappears
  // entirely rather than sitting there greyed out (plan E6).
  const hasContent = (id: SectionId) => (id === "recents" ? recentPaths.length > 0 : true);

  return (
    <div style={{ flexShrink: 0 }}>
      {shown.filter(hasContent).map((id) => {
        const isOpen = open[id];
        const isOver = overId === id && dragId !== null && dragId !== id;
        const drag = handlers(id);
        const Icon = id === "recents" ? Clock : Bookmark;
        const count = id === "bookmarks" ? bookmarks.length : undefined;
        return (
          <section
            key={id}
            className="pv-side-section"
            ref={(el) => { if (el) sectionEls.current[id] = el; else delete sectionEls.current[id]; }}
            style={{ borderBottom: "1px solid var(--border-color-light)", borderTop: isOver ? "2px solid var(--accent-color)" : "2px solid transparent", opacity: dragId === id ? 0.6 : undefined }}
          >
            <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
              <button
                {...drag}
                onClick={() => { if (consumeDragClick()) return; toggle(id); }}
                onContextMenu={(e) => {
                  // A right-click means "menu", so the pending hold is dropped.
                  drag.onContextMenu();
                  e.preventDefault();
                  setMenuAt({ id, x: e.clientX, y: e.clientY });
                }}
                aria-expanded={isOpen}
                className="pv-side-section-header"
                style={{ cursor: dragId === id ? "grabbing" : undefined }}
              >
                <ChevronDown size={ICON.ui} className="pv-side-section-glyph" style={{ transition: "transform var(--dur-2) var(--ease-1)", transform: isOpen ? "none" : "rotate(-90deg)", flexShrink: 0 }} />
                <Icon size={ICON.ui} className="pv-side-section-glyph" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, textAlign: "left", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title(id)}</span>
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
              persist(moveArea(layout, menuAt.id, 0, SPEC));
              setMenuAt(null);
            }}
          >
            {t("bars.moveUp", { defaultValue: "Nach oben" })}
          </MenuItem>
          <MenuItem
            icon={<EyeOff size={ICON.ui} />}
            onClick={() => {
              persist(setAreaVisible(layout, menuAt.id, false, SPEC));
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
