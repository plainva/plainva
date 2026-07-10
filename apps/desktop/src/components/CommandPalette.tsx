import { useMemo, useRef, useState, useEffect } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "@plainva/ui";
import { filterCommands, type AppCommand } from "../services/commandRegistry";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Command palette (plan Designsprache P9/L11): Mod+P opens a type-to-run list
 * of app commands on the shared .pv-palette look (same family as the
 * QuickSwitcher). Arrow keys + Enter, click, Escape/outside closes.
 */
export function CommandPalette({ commands, onClose }: { commands: AppCommand[]; onClose: () => void }) {
  const { t } = useTranslation();
  const trapRef = useFocusTrap(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const titleOf = (c: AppCommand) => t(c.titleKey, { defaultValue: c.titleDefault });
  const results = useMemo(() => filterCommands(commands, query, titleOf), [commands, query, t]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSelected(0); }, [query]);

  const runCommand = (c: AppCommand) => {
    onClose();
    c.run();
  };

  const hintLabel = (hint: string) =>
    hint.replace("Mod", isMac ? "⌘" : t("shortcuts.modCtrl", { defaultValue: "Strg" }));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const c = results[selected];
      if (c) runCommand(c);
    }
  };

  return (
    <div ref={trapRef} className="pv-palette-overlay" onClick={onClose} data-testid="command-palette">
      <div className="pv-palette" role="dialog" aria-label={t("palette.title", { defaultValue: "Befehle" })} onClick={(e) => e.stopPropagation()}>
        <div className="pv-palette-inputrow">
          <Search size={18} style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            className="pv-palette-input"
            placeholder={t("palette.placeholder", { defaultValue: "Befehl eingeben…" })}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div style={{ maxHeight: "50vh", overflowY: "auto", padding: "var(--space-1)" }}>
          {results.length === 0 ? (
            <div style={{ padding: "var(--space-5)", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-ui)" }}>
              {t("palette.noResults", { defaultValue: "Kein Befehl gefunden" })}
            </div>
          ) : (
            results.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className="pv-menu-item"
                style={{ background: i === selected ? "var(--bg-hover)" : undefined }}
                onMouseEnter={() => setSelected(i)}
                onClick={() => runCommand(c)}
              >
                <span className="pv-menu-text">{titleOf(c)}</span>
                {c.hint && <span className="pv-menu-hint">{hintLabel(c.hint)}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
