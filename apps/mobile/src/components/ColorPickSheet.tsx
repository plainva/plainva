import { useTranslation } from "react-i18next";
import { SheetGrip } from "../components/SheetGrip";
import { Trash2 } from "lucide-react";
import { ACCENT_PALETTE, ICON } from "@plainva/ui";
import { MobileSwatchGrid } from "./MobileSwatchGrid";

/**
 * Header color sheet (M3E package C3): the curated accent palette (shared
 * DATA from @plainva/ui) in the shared colour grid — the free colour is the
 * last tile (plan "Farbwahl überall", 2026-09-04) — plus a remove row; the
 * mobile counterpart of the desktop ColorPopover.
 */
export function ColorPickSheet({
  value,
  onPick,
  onRemove,
  onClose,
}: {
  value?: string | null;
  onPick: (hex: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("colorPicker.title")}</p>
        <MobileSwatchGrid
          ariaLabel={t("colorPicker.title")}
          presets={ACCENT_PALETTE}
          value={value}
          onPick={onPick}
          free={{ label: t("colorPicker.custom"), onChange: onPick }}
        />
        <button className="m-row m-danger" onClick={onRemove}>
          <Trash2 size={ICON.head} style={{ flexShrink: 0 }} />
          <span>{t("colorPicker.remove")}</span>
        </button>
      </div>
    </div>
  );
}
