import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown } from "lucide-react";
import { ICON } from "../../lib/iconSizes";
import { cx } from "./cx";
import { useFixedPopover } from "./useFixedPopover";
import { sanitizeFontName } from "../../lib/contentFont";
import { canvasFontMeasure, detectFontPlatform, FONT_CATALOG, isFontInstalled, type CatalogFont } from "../../lib/fontCatalog";

/**
 * A font choice as a FIELD (finding 2026-09-04): the field shows what is
 * chosen — the default's real name, or the picked family — and the list only
 * appears on click, as a popover with a search line, one row per catalogued
 * font set in its own face, fonts the device lacks greyed out, and a last row
 * for typing a family the list does not know. Before this the whole list
 * stood open on the page above a text field whose placeholder explained
 * nothing.
 */
export interface FontFieldProps {
  /** The chosen family (css value or typed name); empty = the default. */
  value: string;
  onChange: (css: string) => void;
  /** What the empty value means, by name ("Standard (Inter)"). */
  defaultLabel: string;
  /** A second line under the default row ("die Schrift des Designs"). */
  defaultHint?: string;
  ariaLabel: string;
  className?: string;
  "data-testid"?: string;
}

/** Whether a value names a catalogue font (by css or by display name). */
function catalogMatch(fonts: readonly CatalogFont[], value: string): CatalogFont | undefined {
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  return fonts.find((f) => f.css.toLowerCase() === v || f.name.toLowerCase() === v);
}

export function FontField({ value, onChange, defaultLabel, defaultHint, ariaLabel, className, "data-testid": testId }: FontFieldProps) {
  const { t } = useTranslation();
  const platform = useMemo(() => detectFontPlatform(), []);
  const fonts = FONT_CATALOG[platform];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [installed, setInstalled] = useState<Record<string, boolean | null>>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useFixedPopover(open, wrapRef, { minWidth: 280 });

  useEffect(() => {
    if (!open) return;
    const measure = canvasFontMeasure();
    const out: Record<string, boolean | null> = {};
    for (const font of fonts) out[font.css] = isFontInstalled(font, measure);
    setInstalled(out);
  }, [open, fonts]);

  const close = () => { setOpen(false); setQuery(""); setTyping(false); };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) close();
    };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (css: string) => { onChange(css); close(); };
  const kindLabel: Record<CatalogFont["kind"], string> = {
    serif: t("settings.fontSerif"),
    sans: t("settings.fontSans"),
    mono: t("settings.fontMono"),
  };
  const current = catalogMatch(fonts, value);
  const shown = value.trim() === "" ? defaultLabel : (current?.name ?? value);
  const q = query.trim().toLowerCase();
  const rows = fonts.filter((f) => q === "" || f.name.toLowerCase().includes(q) || kindLabel[f.kind].toLowerCase().includes(q));

  return (
    <div ref={wrapRef} className={className} style={{ position: "relative", minWidth: 0 }} data-testid={testId}>
      <button
        type="button"
        className="pv-field pv-field--compact pv-field--select"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", textAlign: "left", fontFamily: current && installed[current.css] !== false ? current.css : undefined }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shown}</span>
        <ChevronDown size={ICON.ui} style={{ flexShrink: 0, opacity: 0.7 }} aria-hidden="true" />
      </button>
      {open && (
        <div ref={popRef} className="pv-popover pv-popover--fixed" role="listbox" aria-label={ariaLabel}>
          <input
            className="pv-field pv-field--compact"
            value={query}
            placeholder={t("settings.fontSearch")}
            aria-label={t("settings.fontSearch")}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") close(); }}
            style={{ marginBottom: "var(--space-1)" }}
          />
          {q === "" && (
            <button type="button" role="option" aria-selected={value.trim() === ""} className={cx("pv-popover-row", value.trim() === "" && "is-active")} onClick={() => pick("")}>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span>{defaultLabel}</span>
                {defaultHint ? <span className="pv-popover-count">{defaultHint}</span> : null}
              </span>
              {value.trim() === "" ? <Check size={ICON.ui} aria-hidden="true" /> : null}
            </button>
          )}
          {rows.map((font) => {
            const missing = installed[font.css] === false;
            const active = current?.css === font.css;
            return (
              <button
                key={font.css}
                type="button"
                role="option"
                aria-selected={active}
                disabled={missing}
                className={cx("pv-popover-row", active && "is-active")}
                onClick={() => pick(font.css)}
                data-testid={`font-field-${font.css}`}
                style={{ fontFamily: missing ? undefined : font.css, opacity: missing ? 0.55 : 1 }}
              >
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span>{font.name}</span>
                  <span className="pv-popover-count" style={{ fontFamily: "var(--font-ui)" }}>{missing ? `${kindLabel[font.kind]} · ${t("settings.fontNotInstalled")}` : kindLabel[font.kind]}</span>
                </span>
                {active ? <Check size={ICON.ui} aria-hidden="true" /> : null}
              </button>
            );
          })}
          {typing ? (
            <input
              className="pv-field pv-field--compact"
              value={typed}
              autoFocus
              placeholder={t("settings.fontCustomPlaceholder")}
              aria-label={t("settings.fontCustomPlaceholder")}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { const name = sanitizeFontName(typed); if (name) pick(name); }
                if (e.key === "Escape") setTyping(false);
              }}
              style={{ marginTop: "var(--space-1)" }}
            />
          ) : (
            <button type="button" className="pv-popover-row" onClick={() => { setTyped(current ? "" : value); setTyping(true); }} data-testid="font-field-other">
              <span style={{ color: "var(--accent-color)" }}>{t("settings.fontFieldOther")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
