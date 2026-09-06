import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { FONT_SLOT_FAMILIES, FontCatalogPicker, fontKindsForSlot, GroupCard, ICON, Row, RowList, SettingField, TextInput, sanitizeFontName, type ContentFontFamily, type FontChoice, type FontSlot } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * The sheet behind one font slot of Settings › Appearance (issue #82, plan
 * 2026-09-06 P2): the theme's own font and the three generic presets first,
 * then the catalogue (each row in its own face, missing fonts greyed), then a
 * field for a family the list does not know. The row that opens it shows what
 * is chosen; the list is never on the screen itself (plan 2026-09-04, A3).
 * The code slot offers monospace only — presets and catalogue alike (P2).
 * Successor of the custom theme's FontPickSheet, whose only slot moved here.
 */
export function FontSlotSheet({
  slot,
  title,
  value,
  onPick,
  onClose,
}: {
  slot: FontSlot;
  title: string;
  value: FontChoice;
  onPick: (choice: FontChoice) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [other, setOther] = useState("");
  const presetLabel: Record<Exclude<ContentFontFamily, "theme" | "custom">, string> = {
    serif: t("settings.fontSerif"),
    sans: t("settings.fontSans"),
    mono: t("settings.fontMono"),
  };
  const presets: Array<[Exclude<ContentFontFamily, "custom">, string]> = [
    ["theme", t("settings.fontTheme")],
    ...FONT_SLOT_FAMILIES[slot].map((family): [Exclude<ContentFontFamily, "custom">, string] => [family, presetLabel[family]]),
  ];
  const customName = value.family === "custom" ? value.customName : "";
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        <div className="m-sheet-scroll">
          <GroupCard>
            <RowList>
              {presets.map(([family, label]) => (
                <Row
                  key={family}
                  title={label}
                  end={value.family === family ? <Check size={ICON.ui} /> : undefined}
                  aria-pressed={value.family === family}
                  onClick={() => onPick({ family, customName: "" })}
                  data-testid={family === "theme" ? "font-sheet-default" : `font-sheet-${family}`}
                />
              ))}
            </RowList>
          </GroupCard>
          <FontCatalogPicker value={customName} kinds={fontKindsForSlot(slot)} onPick={(font) => onPick({ family: "custom", customName: font.css })} />
          <GroupCard>
            <RowList>
              <SettingField label={t("settings.fontFieldOther")}>
                <TextInput
                  value={other}
                  placeholder={t("settings.fontCustomPlaceholder")}
                  onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const name = sanitizeFontName(other);
                      if (name) onPick({ family: "custom", customName: name });
                    }
                  }}
                />
              </SettingField>
            </RowList>
          </GroupCard>
        </div>
      </div>
    </div>
  );
}
