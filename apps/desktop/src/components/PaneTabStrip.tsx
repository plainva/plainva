import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { tabLabel, useTabDnd, dropIndicatorShadow } from "./tabStrip";
import { virtualTabMeta } from "./graph/virtualPaths";
import { useDocumentIcons } from "../hooks/useDocumentIcons";
import { DocIcon, isRenderableDocIcon } from "@plainva/ui";
import { useDirtyPaths } from "../services/dirtyStore";

interface Props {
  paneIndex: number;
  tabs: string[];
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
export function PaneTabStrip({ paneIndex, tabs, activeIndex, onSelect, onClose, onContextMenu, onMoveTab, onSplitWithTab }: Props) {
  const { t } = useTranslation();
  const dnd = useTabDnd(paneIndex, onMoveTab, onSplitWithTab);
  const docIcons = useDocumentIcons();
  const dirtyPaths = useDirtyPaths();
  return (
    <div
      data-pv-tabstrip={paneIndex}
      role="tablist"
      aria-label={t("titlebar.openTabs", { defaultValue: "Geöffnete Dateien" })}
      className="tabstrip"
      style={{ display: "flex", alignItems: "stretch", height: 34, flexShrink: 0, overflowX: "auto", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-color)" }}
    >
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
            onClick={() => onSelect(i)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(i); } }}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(i, e.clientX, e.clientY); }}
            data-tip={path}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "0 9px 0 12px", height: "100%",
              maxWidth: 220, whiteSpace: "nowrap", cursor: "pointer", fontSize: "0.83rem",
              color: active ? "var(--text-main)" : "var(--text-muted)",
              borderRight: "1px solid var(--border-color-light)",
              // Only the transient drag indicator is inline; the active-tab
              // underline is a stylesheet rule so themes can restyle it.
              boxShadow: dropIndicatorShadow(dnd.over, paneIndex, i),
              opacity: dnd.isDragging(i) ? 0.5 : 1,
              touchAction: "none", userSelect: "none",
            }}
            onMouseOver={(e) => { if (!active) e.currentTarget.style.color = "var(--text-main)"; }}
            onMouseOut={(e) => { if (!active) e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {VirtualIcon ? (
              <span aria-hidden="true" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center" }}>
                <VirtualIcon size={15} />
              </span>
            ) : docIcons.get(path) && isRenderableDocIcon(docIcons.get(path)!.icon) ? (
              <span aria-hidden="true" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center" }}>
                <DocIcon icon={docIcons.get(path)!.icon} color={docIcons.get(path)!.color} size={15} />
              </span>
            ) : null}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{virtual ? t(virtual.labelKey, { defaultValue: virtual.defaultLabel }) : tabLabel(path)}</span>
            {dirtyPaths.has(path) && <span className="pv-tab-dirty" aria-hidden="true" />}
            <span
              aria-hidden="true"
              data-tip={t("titlebar.closeTab", { defaultValue: "Tab schließen" })}
              onClick={(e) => { e.stopPropagation(); onClose(i); }}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "var(--radius-sm)", opacity: 0.55, flexShrink: 0 }}
              onMouseOver={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "var(--bg-active)"; }}
              onMouseOut={(e) => { e.currentTarget.style.opacity = "0.55"; e.currentTarget.style.background = "transparent"; }}
            >
              <X size={12} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
