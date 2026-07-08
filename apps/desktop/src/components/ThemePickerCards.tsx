import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Moon } from "lucide-react";
import {
  AVAILABLE_THEMES,
  DEFAULT_THEME_NAME,
  ThemeDef,
  ThemeMode,
  getStoredThemeVariants,
  getUnlockedThemes,
  getUnlockedVariants,
  setStoredThemeVariant,
  visibleThemes,
} from "../services/theme";

interface ThemePickerCardsProps {
  value: string;
  onChange: (id: string) => void;
}

/** Resolves which swatch to preview: the current app mode when the theme ships
 * it, otherwise the theme's only mode (e.g. dark-only LCARS in a light app). */
function previewMode(def: ThemeDef, currentMode: ThemeMode): ThemeMode {
  return def.modes.includes(currentMode) ? currentMode : def.modes[0];
}

/**
 * Theme picker as preview cards (splash-template style, decision E6): a tiny
 * app mock (title bar, sidebar, text lines, accent pill) rendered from the
 * registry's concrete swatch colours, so every card shows its theme without
 * activating it. Easter-egg themes stay hidden until unlocked; the LCARS card
 * lists collected variants as clickable dots.
 */
export function ThemePickerCards({ value, onChange }: ThemePickerCardsProps) {
  const { t } = useTranslation();
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [collectedVariants, setCollectedVariants] = useState<Record<string, string[]>>({});
  const [activeVariants, setActiveVariants] = useState<Record<string, string>>({});
  const [currentMode, setCurrentMode] = useState<ThemeMode>(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"
  );

  useEffect(() => {
    Promise.all([getUnlockedThemes(), getUnlockedVariants(), getStoredThemeVariants()])
      .then(([u, cv, av]) => {
        setUnlocked(u);
        setCollectedVariants(cv);
        setActiveVariants(av);
      })
      .catch(() => {});
    const root = document.documentElement;
    const obs = new MutationObserver(() =>
      setCurrentMode(root.getAttribute("data-theme") === "dark" ? "dark" : "light")
    );
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const themes = visibleThemes(unlocked);

  return (
    <div
      role="radiogroup"
      aria-label={t("settings.themeName", { defaultValue: "Theme" })}
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(146px, 1fr))", gap: 10, width: "100%" }}
    >
      {themes.map((def) => {
        const active = (value || DEFAULT_THEME_NAME) === def.id;
        const sw = def.swatch[previewMode(def, currentMode)] ?? def.swatch[def.modes[0]];
        if (!sw) return null;
        const label = t(`themes.names.${def.id}`, { defaultValue: def.label });
        const collected = def.variants ? (collectedVariants[def.id] ?? []) : [];
        return (
          <div
            key={def.id}
            style={{
              display: "flex", flexDirection: "column", gap: 6, padding: 7,
              border: `2px solid ${active ? "var(--accent-color)" : "var(--border-color)"}`,
              borderRadius: "var(--radius-lg)",
            }}
            onMouseOver={(e) => { if (!active) e.currentTarget.style.borderColor = "var(--accent-color)"; }}
            onMouseOut={(e) => { if (!active) e.currentTarget.style.borderColor = "var(--border-color)"; }}
          >
            {/* The card itself is the radio; variant dots live OUTSIDE the button
                (interactive controls must not nest). */}
            <button
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`theme-card-${def.id}`}
              onClick={() => onChange(def.id)}
              title={label}
              style={{ display: "flex", flexDirection: "column", gap: 6, padding: 0, textAlign: "left", background: "transparent", border: "none", cursor: "pointer", width: "100%" }}
            >
              {/* Miniature app mock from concrete swatch colours */}
              <div aria-hidden="true" style={{ background: sw.bg, borderRadius: "var(--radius-sm)", height: 64, padding: 5, display: "flex", flexDirection: "column", gap: 4, border: "1px solid rgba(128,128,128,0.25)", width: "100%" }}>
                <div style={{ height: 7, borderRadius: 3, background: sw.surface }} />
                <div style={{ display: "flex", gap: 4, flex: 1, minHeight: 0 }}>
                  <div style={{ width: "28%", background: sw.surface, borderRadius: 3 }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, justifyContent: "center" }}>
                    <div style={{ height: 4, width: "82%", background: sw.text, opacity: 0.75, borderRadius: 2 }} />
                    <div style={{ height: 4, width: "58%", background: sw.text, opacity: 0.45, borderRadius: 2 }} />
                    <div style={{ height: 9, width: 36, background: sw.accent, borderRadius: 999, marginTop: 2 }} />
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, width: "100%" }}>
                {active && <Check size={13} style={{ color: "var(--accent-color)", flexShrink: 0 }} />}
                <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{label}</span>
                {def.modes.length === 1 && def.modes[0] === "dark" && (
                  <Moon size={11} style={{ color: "var(--text-faint)", flexShrink: 0 }} aria-label={t("settings.themeDark")} />
                )}
              </div>
            </button>
            {/* Collected variant dots (LCARS collection) — click switches the palette. */}
            {def.variants && collected.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {def.variants.filter((v) => collected.includes(v.id)).map((v) => {
                  const variantActive = active && (activeVariants[def.id] ?? def.defaultVariant) === v.id;
                  const vLabel = t(`themes.variants.${v.id}`, { defaultValue: v.label });
                  return (
                    <button
                      key={v.id}
                      type="button"
                      data-testid={`theme-variant-dot-${v.id}`}
                      title={vLabel}
                      aria-label={vLabel}
                      aria-pressed={variantActive}
                      onClick={() => {
                        setStoredThemeVariant(def.id, v.id)
                          .then(() => setActiveVariants((a) => ({ ...a, [def.id]: v.id })))
                          .catch(console.error);
                        if (!active) onChange(def.id);
                      }}
                      style={{
                        width: 13, height: 13, borderRadius: "50%", background: v.accent, cursor: "pointer",
                        border: "none", padding: 0,
                        outline: variantActive ? "2px solid var(--accent-color)" : "1px solid rgba(128,128,128,0.4)",
                        outlineOffset: 1, flexShrink: 0,
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Re-exported for the settings mode select (pinning). */
export { AVAILABLE_THEMES };
