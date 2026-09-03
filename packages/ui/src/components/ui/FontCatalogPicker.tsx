import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { ICON } from "../../lib/iconSizes";
import { cx } from "./cx";
import { GroupCard, Row, RowList } from "./GroupedRows";
import { canvasFontMeasure, detectFontPlatform, FONT_CATALOG, isFontInstalled, type CatalogFont } from "../../lib/fontCatalog";

export interface FontCatalogPickerProps {
  /** The current custom family (css value or typed name) — marks the row it matches. */
  value: string;
  onPick: (font: CatalogFont) => void;
  className?: string;
}

/**
 * The curated font list in front of the free-text field (feedback round
 * 2026-09-01, T7 / P12), shared by both shells' appearance settings. Each row
 * previews itself in its own font, says what kind it is, and — the part a
 * text field could never say — whether the device actually has it: a font
 * that is not installed is named as such and cannot be picked, so a typo no
 * longer ends in "nothing changed". The free-text field below stays the last
 * resort for a family the list does not know.
 */
export function FontCatalogPicker({ value, onPick, className }: FontCatalogPickerProps) {
  const { t } = useTranslation();
  const platform = useMemo(() => detectFontPlatform(), []);
  const fonts = FONT_CATALOG[platform];
  const [installed, setInstalled] = useState<Record<string, boolean | null>>({});

  // Measured after mount: the canvas is a renderer question, not a render one.
  useEffect(() => {
    const measure = canvasFontMeasure();
    const out: Record<string, boolean | null> = {};
    for (const font of fonts) out[font.css] = isFontInstalled(font, measure);
    setInstalled(out);
  }, [fonts]);

  const kindLabel: Record<CatalogFont["kind"], string> = {
    serif: t("settings.fontSerif"),
    sans: t("settings.fontSans"),
    mono: t("settings.fontMono"),
  };
  const current = value.trim().toLowerCase();

  return (
    <div className={cx("pv-fontpick", className)} data-testid="font-catalog" data-platform={platform}>
      <GroupCard>
        <RowList>
          {fonts.map((font) => {
            const missing = installed[font.css] === false;
            const active = current !== "" && (current === font.css.toLowerCase() || current === font.name.toLowerCase());
            return (
              <Row
                key={font.css}
                title={<span style={{ fontFamily: missing ? undefined : font.css }}>{font.name}</span>}
                subtitle={missing ? `${kindLabel[font.kind]} · ${t("settings.fontNotInstalled")}` : kindLabel[font.kind]}
                end={active ? <Check size={ICON.ui} /> : undefined}
                disabled={missing}
                aria-pressed={active}
                onClick={() => onPick(font)}
                data-testid={`font-catalog-${font.css}`}
              />
            );
          })}
        </RowList>
      </GroupCard>
      <p className="pv-fontpick-hint">{t("settings.fontCatalogHint")}</p>
    </div>
  );
}
