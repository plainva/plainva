import { useEffect, useRef, useState } from "react";
import { SunMoon, X, Plus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEFAULT_THEME_NAME, isModePinned, toggleLightDark } from "../services/theme";
import { ICON, PlainvaLogo } from "@plainva/ui";
import { WindowControls, detectMac } from "./WindowControls";
import { HailingFrequenciesModal } from "./HailingFrequenciesModal";
import { tabLabel, useTabDnd, dropIndicatorShadow } from "./tabStrip";
import { virtualTabMeta } from "./graph/virtualPaths";
import { useDocumentIcons } from "../hooks/useDocumentIcons";
import { DocIcon, isRenderableDocIcon } from "@plainva/ui";
import { useDirtyPaths } from "../services/dirtyStore";

interface TitleBarProps {
  /** Active path of each open tab (already resolved from tab history). */
  tabs: string[];
  activeIndex: number;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  onNewTab?: () => void;
  /** Right-click on a tab (viewport coords) — used to open the split/close menu. */
  onTabContextMenu?: (index: number, x: number, y: number) => void;
  /** Width of the left sidebar, so the tabs begin exactly at the sidebar/document boundary. */
  leftWidth: number;
  /** Focused pane index + tab-move handler, so title-bar tabs can be reordered by drag (plan D5). */
  paneIndex?: number;
  onMoveTab?: (fromPane: number, fromIndex: number, toPane: number, toIndex: number | null) => void;
  onSplitWithTab?: (direction: "vertical" | "horizontal", fromPane: number, fromIndex: number) => void;
  /** Sidebar collapse state + toggles (plan Designsprache P6/L1). */
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
}

export function TitleBar({ tabs, activeIndex, onSelectTab, onCloseTab, onNewTab, onTabContextMenu, leftWidth, paneIndex = 0, onMoveTab, onSplitWithTab, leftCollapsed, rightCollapsed, onToggleLeftSidebar, onToggleRightSidebar }: TitleBarProps) {
  const { t } = useTranslation();
  const isMac = detectMac();
  const dnd = useTabDnd(paneIndex, onMoveTab ?? (() => {}), onSplitWithTab);
  const docIcons = useDocumentIcons();
  const dirtyPaths = useDirtyPaths();
  const [themeName, setThemeName] = useState(() => document.documentElement.getAttribute("data-theme-name") || DEFAULT_THEME_NAME);
  const [showHailing, setShowHailing] = useState(false);
  // 5 quick clicks on the logo open the hailing-frequencies dialog (easter
  // egg). Rolling 3s window between clicks; plain clicks do nothing else.
  const logoClicks = useRef({ n: 0, t: 0 });

  // Track the theme name for mode pinning (single-mode themes disable the
  // light/dark toggle). The toggle icon itself is static (SunMoon).
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => {
      setThemeName(root.getAttribute("data-theme-name") || DEFAULT_THEME_NAME);
    });
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-theme-name"] });
    return () => obs.disconnect();
  }, []);

  const handleLogoClick = () => {
    const now = Date.now();
    logoClicks.current = now - logoClicks.current.t > 3000
      ? { n: 1, t: now }
      : { n: logoClicks.current.n + 1, t: now };
    if (logoClicks.current.n >= 5) {
      logoClicks.current = { n: 0, t: 0 };
      setShowHailing(true);
    }
  };

  // The chrome left of the tabs must span everything left of the document
  // surface so the first tab lines up with the editor's left edge. Below the
  // title bar sit, in order: the ribbon rail (42px), the sidebar (leftWidth)
  // and — while it's open — its 5px resize handle. The sidebar-toggle button
  // (28 + 2px margin = 30px) renders between the brand zone and the tabs, so
  // the brand zone covers the remainder. (Ribbon/handle/toggle widths are
  // defined in AppRibbon.tsx and App.tsx.)
  const RIBBON_WIDTH = 42;
  const RESIZE_HANDLE_WIDTH = leftCollapsed ? 0 : 5;
  const TOGGLE_WIDTH = onToggleLeftSidebar ? 30 : 0;
  const brandZoneWidth = leftWidth + RIBBON_WIDTH + RESIZE_HANDLE_WIDTH - TOGGLE_WIDTH;

  return (
    <header
      data-tauri-drag-region
      style={{
        display: "flex", alignItems: "center", height: 40, flexShrink: 0,
        background: "var(--titlebar-bg)", borderBottom: "1px solid var(--border-color)",
        paddingRight: 6, userSelect: "none",
      }}
    >
      {/* Brand zone spans the ribbon + left sidebar (+ resize handle) so, after
          the sidebar-toggle button, the tabs begin exactly at the sidebar/
          document boundary. On macOS the leading inset clears the native
          traffic lights. */}
      <div data-tauri-drag-region style={{ width: brandZoneWidth, flexShrink: 0, display: "flex", alignItems: "center", gap: 9, paddingLeft: isMac ? 78 : 12, paddingRight: 8, boxSizing: "border-box", overflow: "hidden" }}>
        {/* Buttons don't carry data-tauri-drag-region, so quick clicks here never
            start a window drag or a double-click maximize. cursor stays default —
            the 5-click easter egg should not advertise itself. */}
        <button
          type="button"
          aria-label="Plainva"
          data-testid="titlebar-logo"
          onClick={handleLogoClick}
          style={{ display: "flex", alignItems: "center", background: "transparent", border: "none", padding: 0, cursor: "default", flexShrink: 0 }}
        >
          <PlainvaLogo size={ICON.touch} />
        </button>
        <b style={{ fontSize: "var(--text-md)", fontWeight: 700, letterSpacing: "-0.01em", color: "var(--titlebar-fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Plainva</b>
      </div>

      {onToggleLeftSidebar && (
        <button
          type="button"
          aria-label={t("titlebar.toggleLeftSidebar", { defaultValue: "Linke Seitenleiste umschalten" })}
          data-tip={t("titlebar.toggleLeftSidebar", { defaultValue: "Linke Seitenleiste umschalten" })}
          onClick={onToggleLeftSidebar}
          className="pv-titlebar-btn pv-titlebar-btn--sm"
          style={{ alignSelf: "center", marginRight: 2, flexShrink: 0 }}
        >
          {leftCollapsed ? <PanelLeftOpen size={ICON.ui} /> : <PanelLeftClose size={ICON.ui} />}
        </button>
      )}

      {/* Tabs (flat, underline-active, subtle divider — Screenshot 1 style) */}
      {tabs.length > 0 && (
      <div data-pv-tabstrip={paneIndex} role="tablist" aria-label={t("titlebar.openTabs", { defaultValue: "Geöffnete Dateien" })} style={{ display: "flex", alignItems: "stretch", minWidth: 0, overflowX: "auto", height: "100%" }} className="tabstrip tabstrip--titlebar">
        {tabs.map((path, i) => {
          const active = i === activeIndex;
          // Virtual views (vault map, tasks) carry a localized name and a
          // dedicated icon instead of the raw pseudo path.
          const virtual = virtualTabMeta(path);
          const VirtualIcon = virtual?.icon;
          return (
            <div
              key={`${path}-${i}`}
              data-pv-tab={i}
              data-pv-pane={paneIndex}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              {...dnd.tabHandlers(i)}
              onClick={() => onSelectTab(i)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectTab(i); } }}
              onContextMenu={(e) => { if (onTabContextMenu) { e.preventDefault(); onTabContextMenu(i, e.clientX, e.clientY); } }}
              data-tip={virtual ? undefined : path}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: "0 9px 0 12px", height: "100%",
                maxWidth: 220, whiteSpace: "nowrap", cursor: "pointer", fontSize: "var(--text-ui)",
                borderRight: "1px solid var(--border-color-light)",
                // Only the transient drag indicator is inline; the active-tab
                // underline is a stylesheet rule so themes can restyle it.
                boxShadow: dropIndicatorShadow(dnd.over, paneIndex, i),
                opacity: dnd.isDragging(i) ? 0.5 : 1,
                touchAction: "none", userSelect: "none",
              }}
            >
              {VirtualIcon ? (
                <span aria-hidden="true" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center" }}>
                  <VirtualIcon size={ICON.ui} />
                </span>
              ) : docIcons.get(path) && isRenderableDocIcon(docIcons.get(path)!.icon) ? (
                <span aria-hidden="true" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center" }}>
                  <DocIcon icon={docIcons.get(path)!.icon} color={docIcons.get(path)!.color} size={ICON.ui} />
                </span>
              ) : null}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{virtual ? t(virtual.labelKey, { defaultValue: virtual.defaultLabel }) : tabLabel(path)}</span>
              {dirtyPaths.has(path) && <span className="pv-tab-dirty" aria-hidden="true" />}
              <span
                aria-hidden="true"
                data-tip={t("titlebar.closeTab", { defaultValue: "Tab schließen" })}
                onClick={(e) => { e.stopPropagation(); onCloseTab(i); }}
                className="pv-tab-close"
              >
                <X size={ICON.meta} />
              </span>
            </div>
          );
        })}
      </div>
      )}
      {onNewTab && (
        <button
          type="button"
          aria-label={t("titlebar.newTab", { defaultValue: "Neuer Tab" })}
          data-tip={t("titlebar.newTab", { defaultValue: "Neuer Tab" })}
          onClick={onNewTab}
          className="pv-titlebar-btn pv-titlebar-btn--sm"
          style={{ alignSelf: "center", marginLeft: 4, flexShrink: 0 }}
        >
          <Plus size={ICON.ui} />
        </button>
      )}

      <div data-tauri-drag-region style={{ flex: 1, minWidth: 12, alignSelf: "stretch" }} />

      {onToggleRightSidebar && (
        <button
          type="button"
          aria-label={t("titlebar.toggleRightSidebar", { defaultValue: "Rechte Seitenleiste umschalten" })}
          data-tip={t("titlebar.toggleRightSidebar", { defaultValue: "Rechte Seitenleiste umschalten" })}
          onClick={onToggleRightSidebar}
          className="pv-titlebar-btn"
        >
          {rightCollapsed ? <PanelRightOpen size={ICON.ui} /> : <PanelRightClose size={ICON.ui} />}
        </button>
      )}

      {/* Theme quick toggle (far right). Disabled while a single-mode theme
          (e.g. LCARS, Midnight) pins the mode. */}
      <button
        type="button"
        aria-label={t("titlebar.toggleTheme", { defaultValue: "Hell/Dunkel umschalten" })}
        data-tip={isModePinned(themeName) ? t("titlebar.themePinned", { defaultValue: "Modus vom Theme festgelegt" }) : t("titlebar.toggleTheme", { defaultValue: "Hell/Dunkel umschalten" })}
        disabled={isModePinned(themeName)}
        onClick={() => { toggleLightDark().catch(console.error); }}
        className="pv-titlebar-btn"
      >
        <SunMoon size={ICON.ui} />
      </button>

      {/* Window controls — Windows/Linux only (right). macOS uses native traffic lights (left). */}
      <WindowControls />
      {showHailing && <HailingFrequenciesModal onClose={() => setShowHailing(false)} />}
    </header>
  );
}
