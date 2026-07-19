import { Columns2, History, Rows2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SplitDirection } from "./SplitButton";
import { ICON, MenuItem, MenuSeparator, MenuSurface } from "@plainva/ui";

interface Props {
  // Right-click point in viewport coordinates.
  x: number;
  y: number;
  onSplitVertical: () => void;
  onSplitHorizontal: () => void;
  onCloseTab: () => void;
  onClose: () => void;
  // When the editor is already split, the active direction; the matching split
  // option is hidden because re-splitting the same way would be a no-op.
  activeDirection?: SplitDirection;
  /** Opens the version history for the tab's file (absent for empty tabs). */
  onShowVersionHistory?: () => void;
}

/**
 * Right-click menu for tabs — a MenuSurface at the click point (plan
 * Designsprache P5: one themed look + keyboard model for every menu).
 */
export function TabContextMenu({ x, y, onSplitVertical, onSplitHorizontal, onCloseTab, onClose, activeDirection, onShowVersionHistory }: Props) {
  const { t } = useTranslation();
  return (
    <MenuSurface open onClose={onClose} at={{ x, y }} minWidth={210} ariaLabel={t("tabMenu.title", { defaultValue: "Tab-Aktionen" })}>
      {activeDirection !== "vertical" && (
        <MenuItem icon={<Columns2 size={ICON.ui} />} onSelect={onSplitVertical}>
          {t("tabMenu.splitRight", { defaultValue: "Rechts teilen" })}
        </MenuItem>
      )}
      {activeDirection !== "horizontal" && (
        <MenuItem icon={<Rows2 size={ICON.ui} />} onSelect={onSplitHorizontal}>
          {t("tabMenu.splitDown", { defaultValue: "Unten teilen" })}
        </MenuItem>
      )}
      {onShowVersionHistory && (
        <MenuItem icon={<History size={ICON.ui} />} onSelect={onShowVersionHistory}>
          {t("tabMenu.versionHistory", { defaultValue: "Versionsverlauf…" })}
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem danger icon={<X size={ICON.ui} />} onSelect={onCloseTab}>
        {t("tabMenu.close", { defaultValue: "Tab schließen" })}
      </MenuItem>
    </MenuSurface>
  );
}
