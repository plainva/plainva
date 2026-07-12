import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Radio } from "lucide-react";
import { DEFAULT_THEME_NAME, LCARS_VARIANTS, matchStarTrekQuote, STAR_TREK_QUOTES, TextInput, getThemeDef } from "@plainva/ui";
import { getMobileSettings, updateMobileSettings } from "../services/mobileSettings";

/**
 * Hailing frequencies (M3E package D5): the mobile counterpart of the desktop
 * easter-egg dialog. 5 taps on the About logo open this sheet; a recognised
 * Star Trek line unlocks an LCARS palette variant (or a whole theme for
 * theme-unlocking quotes) through the SHARED catalog in @plainva/ui. All copy
 * reuses the existing hailing.* keys (×10).
 */
export function HailingSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);

  const s = getMobileSettings();
  const collected = s.unlockedThemeVariants.length;

  const transmit = () => {
    const input = text.trim();
    if (!input) return;
    const id = matchStarTrekQuote(input);
    if (!id) {
      setFeedback(t(misses >= 1 ? "hailing.shaka" : "hailing.noResponse"));
      setMisses((n) => n + 1);
      return;
    }
    const quote = STAR_TREK_QUOTES.find((q) => q.id === id)!;
    const cur = getMobileSettings();
    // Remember the theme LCARS/win95 replaces so the off toggle can return to it.
    const themeBefore = cur.themeName === "lcars" || cur.themeName === "win95" ? cur.themeBefore : cur.themeName;
    if (quote.unlocksTheme) {
      // Whole-theme unlock (win95): activate it, remember it in the picker.
      const known = cur.unlockedThemes.includes(quote.unlocksTheme);
      const unlockedThemes = known ? cur.unlockedThemes : [...cur.unlockedThemes, quote.unlocksTheme];
      void updateMobileSettings({ unlockedThemes, themeBefore, themeName: quote.unlocksTheme }).then(onChanged);
      const def = getThemeDef(quote.unlocksTheme);
      setFeedback(
        known
          ? t("hailing.alreadyKnown")
          : t("hailing.themeUnlocked", { name: t(`themes.names.${quote.unlocksTheme}`, { defaultValue: def?.label ?? quote.unlocksTheme }) }),
      );
    } else {
      // LCARS collectible: unlock the theme, collect the variant, switch to it.
      const unlockedThemes = cur.unlockedThemes.includes("lcars") ? cur.unlockedThemes : [...cur.unlockedThemes, "lcars"];
      const known = cur.unlockedThemeVariants.includes(id);
      const unlockedThemeVariants = known ? cur.unlockedThemeVariants : [...cur.unlockedThemeVariants, id];
      void updateMobileSettings({
        unlockedThemes,
        unlockedThemeVariants,
        themeBefore,
        themeVariants: { ...cur.themeVariants, lcars: id },
        themeName: "lcars",
      }).then(onChanged);
      const variant = LCARS_VARIANTS.find((v) => v.id === id);
      setFeedback(
        known
          ? t("hailing.alreadyKnown")
          : t("hailing.variantReceived", { variant: t(`themes.variants.${id}`, { defaultValue: variant?.label ?? id }) }),
      );
    }
    setText("");
  };

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-grip" />
        <p className="m-sheet-title">{t("hailing.prompt")}</p>
        <div className="m-field">
          <TextInput
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") transmit();
            }}
            placeholder={t("hailing.placeholder")}
            value={text}
          />
        </div>
        {feedback && (
          <p className="m-hint m-hint--inset" role="status">
            {feedback}
          </p>
        )}
        <p className="m-hint m-hint--inset">
          <Radio size={13} style={{ verticalAlign: -2 }} /> {t("hailing.collection", { count: collected, total: LCARS_VARIANTS.length })}
        </p>
        {collected > 0 && (
          <>
            <label className="m-hail-toggle">
              <input
                checked={s.themeName === "lcars"}
                onChange={() => {
                  const cur = getMobileSettings();
                  if (cur.themeName === "lcars") {
                    void updateMobileSettings({ themeName: cur.themeBefore || DEFAULT_THEME_NAME }).then(onChanged);
                  } else {
                    const themeBefore = cur.themeName === "win95" ? cur.themeBefore : cur.themeName;
                    void updateMobileSettings({
                      themeBefore,
                      themeName: "lcars",
                      themeVariants: { ...cur.themeVariants, lcars: cur.themeVariants.lcars ?? cur.unlockedThemeVariants[0] },
                    }).then(onChanged);
                  }
                }}
                type="checkbox"
              />
              {t("hailing.lcarsActive")}
            </label>
            <div className="m-hail-chips">
              {LCARS_VARIANTS.filter((v) => s.unlockedThemeVariants.includes(v.id)).map((v) => {
                const active = s.themeName === "lcars" && (s.themeVariants.lcars ?? "make-it-so") === v.id;
                return (
                  <button
                    className={active ? "m-chip is-on" : "m-chip"}
                    key={v.id}
                    onClick={() => {
                      const cur = getMobileSettings();
                      const themeBefore =
                        cur.themeName === "lcars" || cur.themeName === "win95" ? cur.themeBefore : cur.themeName;
                      void updateMobileSettings({
                        themeBefore,
                        themeName: "lcars",
                        themeVariants: { ...cur.themeVariants, lcars: v.id },
                      }).then(onChanged);
                    }}
                    style={{ borderColor: v.accent }}
                  >
                    <span className="m-hail-dot" style={{ background: v.accent }} />
                    {t(`themes.variants.${v.id}`, { defaultValue: v.label })}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <div className="m-btnrow">
          <button className="m-btn" onClick={onClose}>
            {t("common.close", { defaultValue: "Schließen" })}
          </button>
          <button className="m-btn m-btn--filled" onClick={transmit}>
            {t("hailing.transmit")}
          </button>
        </div>
      </div>
    </div>
  );
}
