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
                flex: 1,
                height: 34,
                gap: 7,
                background: isActive ? "var(--accent-container)" : undefined,
                color: isActive ? "var(--on-accent-container)" : undefined,
                opacity: dragId === key ? 0.6 : undefined,
                borderLeft: isOver ? "2px solid var(--accent-color)" : "2px solid transparent",
                touchAction: "none",
              }}
            >
              <Icon size={ICON.ui} />
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
