import { useId, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder, Hash, Database, ArrowUp, EyeOff, Settings as SettingsIcon } from "lucide-react";
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
import {
  BAR_LAYOUT_CHANGED_EVENT,
  openBarSettings,
  barDef,
  loadBarLayout,
  saveBarLayout,
} from "../services/barLayout";

/**
 * The view switch of the left sidebar. Which tabs it carries and in which order
 * comes from the shared bar model (plan § 2), so it behaves like the action
 * rail and both sidebars: press and hold to move, right-click for the same
 * actions, arranged centrally in Settings.
 *
 * "Files" is pinned (`alwaysVisible`) — a sidebar whose only tab is hidden is a
 * sidebar the user cannot get back, and the file tree is what the sidebar is
 * for. Bookmarks and "Recently opened" are sections above the tree
 * (LeftPinnedSections), not tabs.
 */

export type LeftTabId = "files" | "tags" | "databases";
const SPEC = barDef("leftTabs").spec;
/** Space between the tabs (matches the row gap below). */
const TAB_GAP_PX = 4;
/** Rounding safety only — the button's own padding is the breathing room. */
const LABEL_BREATHING_PX = 2;

/** How much of the row the labels get: every tab, only the active one, none. */
type LabelMode = "all" | "active" | "none";

/**
 * Whether the labels fit. Both halves are MEASURED rather than guessed: the
 * text in the actual font (the canvas trick the all-day gutter uses), and the
 * chrome beside it from the rendered button. A fixed pixel threshold would
 * either cut the German "Datenbanken" or hide the English "Tags" long before it
 * had to — and it would silently rot the moment the padding changes.
 */
function fitLabels(rowWidth: number, tabs: HTMLElement[], font: string, activeIndex: number): LabelMode {
  if (tabs.length === 0) return "none";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return "none"; // no canvas (jsdom): icons only, never a cut label
  ctx.font = font;
  const first = tabs[0];
  const style = window.getComputedStyle(first);
  const icon = first.querySelector("svg")?.getBoundingClientRect().width ?? 15;
  const chrome =
    parseFloat(style.paddingLeft || "0")
    + parseFloat(style.paddingRight || "0")
    + parseFloat(style.columnGap || style.gap || "0")
    + icon
    + LABEL_BREATHING_PX;
  const widths = tabs.map((b) => ctx.measureText(b.getAttribute("aria-label") ?? "").width);
  const fixed = tabs.length * chrome + (tabs.length - 1) * TAB_GAP_PX;
  // Summed, not "widest x count": with labels the tabs size to their own text
  // instead of all taking the width of the longest. Equal thirds would make
  // "Tags" as wide as "Databases" and cost roughly 100 px of room the labels
  // never needed.
  if (rowWidth >= widths.reduce((a, b) => a + b, 0) + fixed) return "all";
  // Falling straight to icons at the DEFAULT panel width would mean nobody ever
  // sees a label, so the tab you are standing on keeps its name the longest.
  if (rowWidth >= (widths[activeIndex] ?? 0) + fixed) return "active";
  return "none";
}

interface Props {
  vaultPath: string | null;
  active: LeftTabId;
  onSelect: (tab: LeftTabId) => void;
}

export function LeftSidebarTabs({ vaultPath, active, onSelect }: Props) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<AreaOrder>(() => sanitizeAreaOrder(undefined, SPEC));
  const [overId, setOverId] = useState<LeftTabId | null>(null);
  const [menuAt, setMenuAt] = useState<{ id: LeftTabId; x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Labels as long as they fit (plan P5). Measured on the row, not the window:
  // the sidebar is resizable, so a media query would be answering the wrong
  // question. Below the threshold each tab falls back to its icon alone.
  const [labelMode, setLabelMode] = useState<LabelMode>("none");
  const labelsKey = t("sidebar.files") + t("sidebar.tags") + t("sidebar.databases", { defaultValue: "Datenbanken" });
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = (width: number) => {
      const tabs = Array.from(el.querySelectorAll<HTMLElement>("[data-left-tab]"));
      const style = window.getComputedStyle(tabs[0] ?? el);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const activeIndex = Math.max(0, tabs.findIndex((b) => b.getAttribute("aria-selected") === "true"));
      const mode = fitLabels(width, tabs, font, activeIndex);
      setLabelMode((prev) => (mode === prev ? prev : mode));
    };
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // Re-measure when the language (and thus the label text) or the active tab
    // changes — in "active" mode the row's needs depend on which tab that is.
  }, [labelsKey, active]);

  // Identifies this surface in the change event, so it does not re-read the
  // store because of its own write. useId is stable per instance and pure —
  // a random id in the render body is not (react-hooks/purity).
  const source = useId();

  useEffect(() => {
    let alive = true;
    const read = (e?: Event) => {
      if (e && (e as CustomEvent<{ source?: string }>).detail?.source === source) return;
      void loadBarLayout("leftTabs", vaultPath).then((v) => {
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

  const persist = useCallback(
    (next: AreaOrder) => {
      setLayout(next);
      void saveBarLayout("leftTabs", vaultPath, next, source);
    },
    [vaultPath, source],
  );

  const shown = useMemo(() => visibleAreas(layout) as LeftTabId[], [layout]);

  // Hiding the tab you are standing on must not leave an empty pane.
  useEffect(() => {
    if (shown.length > 0 && !shown.includes(active)) onSelect(shown[0]);
  }, [shown, active, onSelect]);

  /** Which tab the pointer sits over — the switch is a horizontal row. */
  const slotAt = useCallback((clientX: number): LeftTabId | null => {
    const list = listRef.current;
    if (!list) return null;
    for (const b of Array.from(list.querySelectorAll<HTMLElement>("[data-left-tab]"))) {
      const r = b.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return (b.dataset.leftTab as LeftTabId) ?? null;
    }
    return null;
  }, []);

  const dropRef = useRef<LeftTabId | null>(null);
  const { dragId, handlers, consumeDragClick } = useHoldDrag({
    onMove: (_id, ev) => {
      const target = slotAt(ev.clientX);
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

  const meta: Record<LeftTabId, { label: string; Icon: typeof Folder }> = {
    files: { label: t("sidebar.files"), Icon: Folder },
    tags: { label: t("sidebar.tags"), Icon: Hash },
    databases: { label: t("sidebar.databases", { defaultValue: "Datenbanken" }), Icon: Database },
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 10px 8px" }}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={t("sidebar.viewSwitch", { defaultValue: "Ansicht" })}
        style={{ display: "flex", gap: 4, flex: 1 }}
      >
        {shown.map((key) => {
          const { label, Icon } = meta[key];
          const isActive = active === key;
          const drag = handlers(key);
          const isOver = overId === key && dragId !== null && dragId !== key;
          return (
            <button
              key={key}
              data-left-tab={key}
              role="tab"
              aria-selected={isActive}
              aria-label={label}
              data-tip={label}
              {...drag}
              onClick={() => {
                if (consumeDragClick()) return;
                onSelect(key);
              }}
              onContextMenu={(e) => {
                drag.onContextMenu();
                e.preventDefault();
                setMenuAt({ id: key, x: e.clientX, y: e.clientY });
              }}
              className="pv-btn pv-btn--ghost"
              style={{
                // Labelled tabs size to their text (see labelsFit); icon-only
                // tabs share the row evenly, which is what looks right there.
                flex: labelMode === "all" ? "0 1 auto" : 1,
                minWidth: 0,
                height: 34,
                gap: 7,
                background: isActive ? "var(--accent-container)" : undefined,
                color: isActive ? "var(--on-accent-container)" : undefined,
                opacity: dragId === key ? 0.6 : undefined,
                borderLeft: isOver ? "2px solid var(--accent-color)" : "2px solid transparent",
                touchAction: "none",
              }}
            >
              <Icon size={ICON.ui} style={{ flexShrink: 0 }} />
              {(labelMode === "all" || (labelMode === "active" && isActive)) && (
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
              )}
            </button>
          );
        })}
      </div>

      {menuAt && (
        <MenuSurface
          open
          onClose={() => setMenuAt(null)}
          at={{ x: menuAt.x, y: menuAt.y }}
          minWidth={188}
          ariaLabel={meta[menuAt.id].label}
        >
          <MenuLabel>{meta[menuAt.id].label}</MenuLabel>
          <MenuItem
            icon={<ArrowUp size={ICON.ui} />}
            onClick={() => {
              persist(moveArea(layout, menuAt.id, 0, SPEC));
              setMenuAt(null);
            }}
          >
            {t("bars.moveUp", { defaultValue: "Nach oben" })}
          </MenuItem>
          {menuAt.id !== "files" && (
            <MenuItem
              icon={<EyeOff size={ICON.ui} />}
              onClick={() => {
                persist(setAreaVisible(layout, menuAt.id, false, SPEC));
                setMenuAt(null);
              }}
            >
              {t("bars.hide", { defaultValue: "Ausblenden" })}
            </MenuItem>
          )}
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
