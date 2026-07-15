import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@plainva/ui";
import { SHORTCUT_CATEGORIES, type KeyRow, type MouseRow } from "../services/shortcutCatalog";

interface ShortcutsModalProps {
  onClose: () => void;
}

// The window auto-detects the platform: ⌘/⌥ on macOS, the localized Ctrl/Alt
// elsewhere. No manual toggle — every other app's help shows the current OS.
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MAC_TOKENS: Record<string, string> = {
  Mod: "⌘", Alt: "⌥", Shift: "⇧", Ctrl: "⌃", Enter: "↩", Tab: "⇥", Space: "␣",
};

const kbdStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  minWidth: "1.35rem", padding: "0.15rem 0.45rem",
  background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
  borderRadius: "var(--radius-xs)", fontSize: "var(--text-sm)", fontFamily: "monospace",
  color: "var(--text-main)", lineHeight: 1.2,
};
const gestureStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", padding: "0.15rem 0.55rem",
  background: "transparent", border: "1px dashed var(--border-color)",
  borderRadius: "var(--radius-pill)", fontSize: "var(--text-sm)", color: "var(--text-muted)",
};
const rowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "minmax(9rem, 14rem) 1fr", gap: "var(--space-4)",
  alignItems: "start", padding: "var(--space-2) var(--space-1)",
};
const keysCellStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "center" };
const sepStyle: React.CSSProperties = { color: "var(--text-faint)", fontSize: "var(--text-sm)" };
const sectionLabelStyle: React.CSSProperties = {
  textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "var(--text-xs)",
  fontWeight: 700, color: "var(--text-muted)", margin: "var(--space-4) 0 var(--space-1)",
};

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string>(SHORTCUT_CATEGORIES[0].id);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const tok = (k: string): string => {
    if (isMac) return MAC_TOKENS[k] ?? k;
    if (k === "Mod" || k === "Ctrl") return t("shortcuts.modCtrl", { defaultValue: "Ctrl" });
    return k;
  };

  const renderCombos = (keys: string[][]) =>
    keys.length === 0
      ? <span style={{ ...gestureStyle, borderStyle: "solid", opacity: 0.6 }}>—</span>
      : keys.map((combo, ci) => (
          <React.Fragment key={ci}>
            {ci > 0 && <span style={sepStyle}>/</span>}
            <span style={{ display: "inline-flex", gap: "0.2rem" }}>
              {combo.map((k, ki) => <kbd key={ki} style={kbdStyle}>{tok(k)}</kbd>)}
            </span>
          </React.Fragment>
        ));

  const renderKeyRow = (row: KeyRow, key: string, catLabel?: string) => (
    <div key={key} style={rowStyle}>
      <div style={keysCellStyle}>{renderCombos(row.keys)}</div>
      <div>
        <div style={{ fontSize: "var(--text-md)" }}>{t(row.descKey)}</div>
        {row.noteKey && <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: "0.15rem" }}>{t(row.noteKey)}</div>}
        {catLabel && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", marginTop: "0.15rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{catLabel}</div>}
      </div>
    </div>
  );

  const renderMouseRow = (row: MouseRow, key: string, catLabel?: string) => (
    <div key={key} style={rowStyle}>
      <div style={keysCellStyle}>
        {row.mods?.map((m, i) => <kbd key={i} style={kbdStyle}>{tok(m)}</kbd>)}
        {row.mods && row.mods.length > 0 && <span style={sepStyle}>+</span>}
        <span style={gestureStyle}>{t(row.gestureKey)}</span>
      </div>
      <div>
        <div style={{ fontSize: "var(--text-md)" }}>{t(row.descKey)}</div>
        {row.noteKey && <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: "0.15rem" }}>{t(row.noteKey)}</div>}
        {catLabel && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", marginTop: "0.15rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{catLabel}</div>}
      </div>
    </div>
  );

  // Global search across every category; otherwise the active category.
  const searchHits = useMemo(() => {
    if (!q) return null;
    const hitText = (parts: (string | undefined)[]) => parts.some((p) => p && p.toLowerCase().includes(q));
    const keyHits: React.ReactNode[] = [];
    const mouseHits: React.ReactNode[] = [];
    for (const cat of SHORTCUT_CATEGORIES) {
      const catLabel = t(cat.labelKey);
      cat.keyboard.forEach((r, i) => {
        const keyText = r.keys.flat().map(tok).join(" ");
        if (hitText([t(r.descKey), r.noteKey && t(r.noteKey), catLabel, keyText]))
          keyHits.push(renderKeyRow(r, `${cat.id}-k-${i}`, catLabel));
      });
      cat.mouse.forEach((r, i) => {
        if (hitText([t(r.descKey), t(r.gestureKey), r.noteKey && t(r.noteKey), catLabel]))
          mouseHits.push(renderMouseRow(r, `${cat.id}-m-${i}`, catLabel));
      });
    }
    return { keyHits, mouseHits, total: keyHits.length + mouseHits.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, t]);

  const active = SHORTCUT_CATEGORIES.find((c) => c.id === activeId) ?? SHORTCUT_CATEGORIES[0];

  return (
    <Modal onClose={onClose} title={t("shortcuts.title")} size="lg" testId="shortcuts-modal">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("shortcuts.subtitle")}</p>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("shortcuts.searchPlaceholder")}
          aria-label={t("shortcuts.searchPlaceholder")}
          data-testid="shortcuts-search"
          style={{
            width: "100%", padding: "var(--space-2) var(--space-3)",
            background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-md)", color: "var(--text-main)", fontSize: "var(--text-md)",
          }}
        />

        {!q && (
          <div role="tablist" aria-label={t("shortcuts.title")} style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {SHORTCUT_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                role="tab"
                aria-selected={cat.id === activeId}
                data-testid={`shortcuts-chip-${cat.id}`}
                onClick={() => setActiveId(cat.id)}
                style={{
                  padding: "0.35rem 0.7rem", borderRadius: "var(--radius-pill)", cursor: "pointer",
                  fontSize: "var(--text-sm)", fontWeight: 600,
                  border: cat.id === activeId ? "1px solid var(--accent-color)" : "1px solid var(--border-color)",
                  background: cat.id === activeId ? "var(--accent-color)" : "var(--bg-secondary)",
                  color: cat.id === activeId ? "var(--accent-on)" : "var(--text-muted)",
                }}
              >
                {t(cat.labelKey)}
              </button>
            ))}
          </div>
        )}

        <div style={{ maxHeight: "calc(86vh - 16rem)", overflowY: "auto", paddingRight: "var(--space-1)" }}>
          {q ? (
            searchHits && searchHits.total > 0 ? (
              <>
                {searchHits.keyHits.length > 0 && <div style={sectionLabelStyle}>{t("shortcuts.sectionKeyboard")}</div>}
                {searchHits.keyHits}
                {searchHits.mouseHits.length > 0 && <div style={sectionLabelStyle}>{t("shortcuts.sectionMouse")}</div>}
                {searchHits.mouseHits}
              </>
            ) : (
              <div style={{ padding: "var(--space-6)", textAlign: "center", color: "var(--text-muted)" }}>
                {t("shortcuts.noResults", { query })}
              </div>
            )
          ) : (
            <>
              {active.keyboard.length > 0 && <div style={sectionLabelStyle}>{t("shortcuts.sectionKeyboard")}</div>}
              {active.keyboard.map((r, i) => renderKeyRow(r, `${active.id}-k-${i}`))}
              {active.mouse.length > 0 && <div style={sectionLabelStyle}>{t("shortcuts.sectionMouse")}</div>}
              {active.mouse.map((r, i) => renderMouseRow(r, `${active.id}-m-${i}`))}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};
