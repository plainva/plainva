import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { FontCatalogPicker, GroupCard, ICON, Row, RowList, SettingField, TextInput, sanitizeFontName } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * The font sheet of the user theme (plan 2026-09-04, A3): the default by its
 * real name first, then the catalogue (each row in its own face, missing
 * fonts greyed), then a field for a family the list does not know. The row
 * that opens it shows what is chosen; the list is never on the screen itself.
 */
export function FontPickSheet({
  title,
  value,
  defaultLabel,
  defaultHint,
  onPick,
  onClose,
}: {
  title: string;
  value: string;
  defaultLabel: string;
  defaultHint: string;
  onPick: (css: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [other, setOther] = useState("");
  const isDefault = value.trim() === "";
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        <div className="m-sheet-scroll">
          <GroupCard>
            <RowList>
              <Row
                title={defaultLabel}
                subtitle={defaultHint}
                end={isDefault ? <Check size={ICON.ui} /> : undefined}
                aria-pressed={isDefault}
                onClick={() => onPick("")}
                data-testid="font-sheet-default"
              />
            </RowList>
          </GroupCard>
          <FontCatalogPicker value={value} onPick={(font) => onPick(font.css)} />
          <GroupCard>
            <RowList>
              <SettingField label={t("settings.fontFieldOther")}>
                <TextInput
                  value={other}
                  placeholder={t("settings.fontCustomPlaceholder")}
                  onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { const name = sanitizeFontName(other); if (name) onPick(name); }
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
