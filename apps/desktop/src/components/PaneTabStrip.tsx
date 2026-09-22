import { useRef } from "react";
import { Pin, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { tabLabel, useTabDnd, useElementWidth, tabWindowOf, dropIndicatorShadow, TAB_MIN_WIDTH } from "./tabStrip";
import { virtualTabMeta } from "./graph/virtualPaths";
import { TabOverflowButton } from "./TabOverflowButton";
import { useDocumentIcons } from "../hooks/useDocumentIcons";
import { DocIcon, ICON, isRenderableDocIcon } from "@plainva/ui";
import { useDirtyPaths } from "../services/dirtyStore";

interface Props {
  paneIndex: number;
  tabs: string[];
  /** Pin flag per tab — pinned tabs carry the pin glyph (P2). */
  pinnedTabs?: boolean[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onClose: (index: number) => void;
  onContextMenu: (index: number, x: number, y: number) => void;
  /** Move a tab within/between panes via drag (plan D5). */
  onMoveTab: (fromPane: number, fromIndex: number, toPane: number, toIndex: number | null) => void;
  onSplitWithTab?: (direction: "vertical" | "horizontal", fromPane: number, fromIndex: number) => void;
}

/**
 * Per-pane tab strip shown at the top of each editor pane while the editor area
 * is split. Mirrors the title-bar tab styling so split and unsplit look alike.
 * Tabs can be dragged to reorder within the pane or moved to the other pane.
 */
export function PaneTabStrip({ paneIndex, tabs, pinnedTabs, activeIndex, onSelect, onClose, onContextMenu, onMoveTab, onSplitWithTab }: Props) {
  const { t } = useTranslation();
  const dnd = useTabDnd(paneIndex, onMoveTab, onSplitWithTab);
  // Which tabs fit, and what goes behind the overflow button (E13).
  const stripRef = useRef<HTMLDivElement>(null);
  const tabWindow = tabWindowOf(tabs.length, activeIndex, useElementWidth(stripRef));
  const shownTabs = tabs
    .map((path, i) => ({ path, i }))
    .slice(tabWindow.start, tabWindow.start + tabWindow.count);
  const docIcons = useDocumentIcons();
  const dirtyPaths = useDirtyPaths();
  return (
    <div
      data-pv-tabstrip={paneIndex}
      role="tablist"
      aria-label={t("titlebar.openTabs", { defaultValue: "Geöffnete Dateien" })}
      ref={stripRef}
      className="tabstrip"
      style={{ display: "flex", alignItems: "stretch", height: 34, flexShrink: 0, overflow: "hidden", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-color)" }}
    >
      {shownTabs.map(({ path, i }) => {
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
            onClick={() => onSelect(i)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i); } }}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(i, e.clientX, e.clientY); }}
            data-tip={virtual ? undefined : path}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "0 9px 0 12px", height: "100%",
              // Shrink before anything overflows (finding 2026-09-22).
              flex: "1 1 0", minWidth: TAB_MIN_WIDTH,
              maxWidth: 220, whiteSpace: "nowrap", cursor: "pointer", fontSize: "var(--text-ui)",
              borderRight: "1px solid var(--border-color-light)",
              // Only the transient drag indicator is inline; the active-tab
              // underline is a stylesheet rule so themes can restyle it.
              boxShadow: dropIndicatorShadow(dnd.over, paneIndex, i),
              opacity: dnd.isDragging(i) ? 0.5 : 1,
              touchAction: "none", userSelect: "none",
            }}
          >
            {pinnedTabs?.[i] && (
              <span aria-hidden="true" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", color: "var(--accent-color)" }}>
                <Pin size={ICON.meta} />
              </span>
            )}
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
              onClick={(e) => { e.stopPropagation(); onClose(i); }}
              className="pv-tab-close"
            >
              <X size={ICON.meta} />
            </span>
          </div>
        );
      })}
      <TabOverflowButton hidden={tabWindow.hidden} tabs={tabs} onSelect={onSelect} />
    </div>
  );
}
