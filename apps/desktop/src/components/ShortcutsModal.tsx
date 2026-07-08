import React from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

interface ShortcutsModalProps {
  onClose: () => void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const kbdStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "0.15rem 0.5rem",
  background: "var(--bg-secondary)",
  border: "1px solid var(--border-color)",
  borderRadius: "var(--radius-xs)",
  fontSize: "var(--text-sm)",
  fontFamily: "monospace",
  color: "var(--text-main)",
};

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ onClose }) => {
  const { t } = useTranslation();

  // Localized modifier label: "Strg" (de) / "Ctrl" (en); "⌘" on macOS regardless of language.
  const mod = isMac ? "⌘" : t("shortcuts.modCtrl", { defaultValue: "Strg" });

  // Each entry can list several alternative key combinations (rendered "A / B").
  const SHORTCUTS: { combos: string[][]; descKey: string }[] = [
    { combos: [[mod, "O"], [mod, "K"]], descKey: "shortcuts.quickSwitcher" },
    { combos: [[mod, "P"]], descKey: "palette.title" },
    { combos: [[mod, ","]], descKey: "shortcuts.openSettings" },
    { combos: [[mod, "Alt", "T"]], descKey: "shortcuts.insertTemplate" },
    { combos: [[mod, "Shift", "G"]], descKey: "graph.open" },
    { combos: [[mod, "Alt", "V"]], descKey: "shortcuts.splitVertical" },
    { combos: [[mod, "Alt", "S"]], descKey: "shortcuts.splitHorizontal" },
    { combos: [[mod, "Alt", "B"]], descKey: "shortcuts.toggleLeftSidebar" },
    { combos: [[mod, "Alt", "R"]], descKey: "shortcuts.toggleRightSidebar" },
    { combos: [["/"]], descKey: "shortcuts.slashMenu" },
    { combos: [["F1"]], descKey: "shortcuts.showShortcuts" },
    { combos: [["Esc"]], descKey: "shortcuts.cancelAction" },
  ];

  return (
    <Modal
      onClose={onClose}
      title={t("shortcuts.title")}
      size="sm"
      footer={<Button variant="primary" onClick={onClose}>{t("shortcuts.close")}</Button>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {SHORTCUTS.map((s) => (
          <div key={s.descKey} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)" }}>
            <span style={{ fontSize: "var(--text-md)" }}>{t(s.descKey)}</span>
            <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
              {s.combos.map((combo, ci) => (
                <React.Fragment key={ci}>
                  {ci > 0 && <span style={{ color: "var(--text-faint)", fontSize: "var(--text-sm)" }}>/</span>}
                  <span style={{ display: "flex", gap: "0.25rem" }}>
                    {combo.map((k, ki) => (
                      <kbd key={ki} style={kbdStyle}>{k}</kbd>
                    ))}
                  </span>
                </React.Fragment>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
};
