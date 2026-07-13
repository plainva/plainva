import { useTranslation } from "react-i18next";
import { SheetGrip } from "../components/SheetGrip";
import { Trash2 } from "lucide-react";
import { ACCENT_PALETTE } from "@plainva/ui";

/**
 * Header color sheet (M3E package C3): the curated accent palette (shared
 * DATA from @plainva/ui) plus a native custom color input and a remove row —
 * the mobile counterpart of the desktop HeaderColorPicker.
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
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("colorPicker.title")}</p>
        <div className="m-colorgrid">
          {ACCENT_PALETTE.map((c) => (
            <button
              aria-label={c}
              aria-pressed={value === c}
              className={value === c ? "is-on" : undefined}
              key={c}
              onClick={() => onPick(c)}
              style={{ background: c }}
            />
          ))}
        </div>
        <label className="m-row">
          <span>{t("colorPicker.custom")}</span>
          <input
            onChange={(e) => onPick(e.target.value)}
            style={{ marginLeft: "auto" }}
            type="color"
            // Palette entry as the fallback — no raw hex literal (mobileLint).
            value={value && value.startsWith("#") ? value : ACCENT_PALETTE[4]}
          />
        </label>
        <button className="m-row m-danger" onClick={onRemove}>
          <Trash2 size={18} style={{ flexShrink: 0 }} />
          <span>{t("colorPicker.remove")}</span>
        </button>
      </div>
    </div>
  );
}
