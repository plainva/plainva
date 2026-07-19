import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Radio } from "lucide-react";
import { matchStarTrekQuote, STAR_TREK_QUOTES } from "../services/startrekQuotes";
import {
  LCARS_VARIANTS,
  activateEasterEggTheme,
  activateEasterEggThemeNoVariant,
  deactivateEasterEggTheme,
  getStoredThemeName,
  getStoredThemeVariants,
  getThemeDef,
  getUnlockedVariants,
} from "../services/theme";
import { Button, ICON, Modal } from "@plainva/ui";

interface HailingFrequenciesModalProps {
  onClose: () => void;
}

/**
 * The LCARS easter egg: opened by 5 quick clicks on the title-bar logo.
 * A recognised Star Trek line (any supported language, canonical dub lines —
 * see services/startrekQuotes.ts) unlocks the LCARS theme plus one collectible
 * palette variant. Once anything is collected, the dialog doubles as the
 * collection screen (progress, variant chips, on/off switch) — which is why
 * the 5-click gesture always opens the dialog instead of toggling the theme.
 * Runs on the Modal primitive (design sweep 2026-07-19): under Win95 the
 * hailing dialog finally gets the navy title bar of the theme it unlocks.
 */
export function HailingFrequenciesModal({ onClose }: HailingFrequenciesModalProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [failures, setFailures] = useState(0);
  const [feedback, setFeedback] = useState<"none" | "no-response" | "aye" | "known" | "theme">("none");
  const [lastVariant, setLastVariant] = useState<string | null>(null);
  const [lastTheme, setLastTheme] = useState<string | null>(null);
  const [collected, setCollected] = useState<string[]>([]);
  const [lcarsActive, setLcarsActive] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The collection counts LCARS palette variants only — theme-unlocking
  // quotes ("hello-computer" → win95) are bonus finds outside the x/13.
  const total = LCARS_VARIANTS.length;
  const variantLabel = (id: string) =>
    t(`themes.variants.${id}`, { defaultValue: LCARS_VARIANTS.find((v) => v.id === id)?.label ?? id });

  useEffect(() => {
    Promise.all([getUnlockedVariants(), getStoredThemeName()])
      .then(([variants, name]) => {
        setCollected(variants["lcars"] ?? []);
        setLcarsActive(name === "lcars");
      })
      .catch(() => {});
  }, []);

  const transmit = () => {
    const id = matchStarTrekQuote(input);
    if (!id) {
      setFailures((f) => f + 1);
      setFeedback("no-response");
      setShake(true);
      window.setTimeout(() => setShake(false), 400);
      inputRef.current?.focus();
      return;
    }
    const quote = STAR_TREK_QUOTES.find((q) => q.id === id);
    if (quote?.unlocksTheme) {
      // Theme-unlocking line ("Hello computer" → win95): switches the whole
      // theme, stays out of the LCARS variant collection.
      const themeId = quote.unlocksTheme;
      activateEasterEggThemeNoVariant(themeId)
        .then(() => {
          setLcarsActive(false);
          setLastTheme(themeId);
          setFeedback("theme");
          setFailures(0);
          setInput("");
        })
        .catch(console.error);
      return;
    }
    const alreadyKnown = collected.includes(id);
    activateEasterEggTheme("lcars", id)
      .then(() => {
        setCollected((c) => (c.includes(id) ? c : [...c, id]));
        setLcarsActive(true);
        setLastVariant(id);
        setFeedback(alreadyKnown ? "known" : "aye");
        setFailures(0);
        setInput("");
      })
      .catch(console.error);
  };

  const activateVariant = (id: string) => {
    activateEasterEggTheme("lcars", id)
      .then(() => {
        setLcarsActive(true);
        setLastVariant(id);
        setFeedback("none");
      })
      .catch(console.error);
  };

  const toggleLcars = () => {
    if (lcarsActive) {
      deactivateEasterEggTheme("lcars").then(() => setLcarsActive(false)).catch(console.error);
    } else {
      getStoredThemeVariants()
        .then((v) => activateEasterEggTheme("lcars", v["lcars"] ?? "make-it-so"))
        .then(() => setLcarsActive(true))
        .catch(console.error);
    }
  };

  return (
    <Modal
      onClose={onClose}
      size="sm"
      title={t("hailing.prompt")}
      icon={<Radio size={ICON.head} style={{ color: "var(--accent-color)" }} />}
      testId="hailing-dialog"
      className={shake ? "pv-hailing-shake" : undefined}
      initialFocusRef={inputRef}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <form
          onSubmit={(e) => { e.preventDefault(); transmit(); }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            ref={inputRef}
            className="pv-field"
            data-testid="hailing-input"
            value={input}
            onChange={(e) => { setInput(e.target.value); if (feedback !== "none") setFeedback("none"); }}
            placeholder={t("hailing.placeholder")}
            aria-label={t("hailing.prompt")}
            spellCheck={false}
            style={{ flex: 1, fontFamily: "var(--font-ui)", letterSpacing: "0.02em" }}
          />
          <Button type="submit" variant="primary" data-testid="hailing-send" disabled={!input.trim()}>
            {t("hailing.transmit")}
          </Button>
        </form>

        {feedback === "no-response" && (
          <div data-testid="hailing-feedback" style={{ fontSize: "var(--text-md)", color: "var(--text-muted)" }}>
            {t("hailing.noResponse")}
            {failures >= 2 && (
              <div style={{ fontStyle: "italic", color: "var(--text-faint)", marginTop: 2 }}>{t("hailing.shaka")}</div>
            )}
          </div>
        )}
        {(feedback === "aye" || feedback === "known") && lastVariant && (
          <div data-testid="hailing-feedback" style={{ fontSize: "var(--text-md)", color: "var(--accent-color)", fontWeight: 600 }}>
            {feedback === "aye" ? t("hailing.aye") : t("hailing.alreadyKnown")}
            <div style={{ fontSize: "var(--text-ui)", color: "var(--text-muted)", fontWeight: 400, marginTop: 2 }}>
              {t("hailing.variantReceived", { variant: variantLabel(lastVariant) })}
            </div>
          </div>
        )}
        {feedback === "theme" && lastTheme && (
          <div data-testid="hailing-feedback" style={{ fontSize: "var(--text-md)", color: "var(--accent-color)", fontWeight: 600 }}>
            {t("hailing.aye")}
            <div style={{ fontSize: "var(--text-ui)", color: "var(--text-muted)", fontWeight: 400, marginTop: 2 }}>
              {t("hailing.themeUnlocked", {
                name: t(`themes.names.${lastTheme}`, { defaultValue: getThemeDef(lastTheme)?.label ?? lastTheme }),
              })}
            </div>
          </div>
        )}

        {collected.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--border-color-light)", paddingTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span data-testid="hailing-progress" style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("hailing.collection", { count: collected.length, total })}
              </span>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-ui)", color: "var(--text-main)", cursor: "pointer" }}>
                <input type="checkbox" data-testid="hailing-toggle" checked={lcarsActive} onChange={toggleLcars} />
                {t("hailing.lcarsActive")}
              </label>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {LCARS_VARIANTS.filter((v) => collected.includes(v.id)).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="pv-chip pv-chip-plain"
                  data-testid={`hailing-chip-${v.id}`}
                  onClick={() => activateVariant(v.id)}
                  data-tip={variantLabel(v.id)}
                  style={{ cursor: "pointer", borderColor: v.accent, gap: 5 }}
                >
                  <span className="pv-dot" style={{ color: v.accent }} />
                  {variantLabel(v.id)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
