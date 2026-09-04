import { useTranslation } from "react-i18next";
import { SheetGrip } from "./SheetGrip";

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
        <div className="m-colorgrid" role="group" aria-label={title}>
          {presets.map((hex) => (
            <button
              aria-label={hex}
              aria-pressed={value === hex}
              className={value === hex ? "is-on" : undefined}
              key={hex}
              onClick={() => onPick(hex)}
              style={{ background: hex }}
            />
          ))}
        </div>
        <label className="m-row">
          <span>{t("colorPicker.custom")}</span>
          <input onChange={(e) => onPick(e.target.value)} style={{ marginLeft: "auto" }} type="color" value={value} />
        </label>
        {hint ? <p className="m-hint">{hint}</p> : null}
      </div>
    </div>
  );
}
