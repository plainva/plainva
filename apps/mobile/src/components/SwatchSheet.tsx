import { useTranslation } from "react-i18next";
import { SheetGrip } from "./SheetGrip";
import { MobileSwatchGrid } from "./MobileSwatchGrid";

/**
 * A colour sheet for the user theme (plan 2026-09-04, A2): the presets the
 * spec offers plus the free colour input, the same shape as the header colour
 * sheet — but with the presets of the CALLER, because a ground and an accent
 * do not come from one palette.
 */
export function SwatchSheet({
  title,
  hint,
  presets,
  value,
  onPick,
  onClose,
}: {
  title: string;
  hint?: string;
  presets: readonly string[];
  value: string;
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        <MobileSwatchGrid ariaLabel={title} presets={presets} value={value} onPick={onPick} free={{ label: t("colorPicker.custom"), onChange: onPick }} />
        {hint ? <p className="m-hint">{hint}</p> : null}
      </div>
    </div>
  );
}
