import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, Plus } from "lucide-react";
import { useVault } from "../contexts/VaultContext";
import { ICON } from "@plainva/ui";

interface BaseRow {
  path: string;
  title: string;
}

interface Props {
  /** Embed the chosen existing `.base`. */
  onPick: (path: string) => void;
  /** Create a new inline `.base` and embed it. */
  onCreate: () => void;
  onClose: () => void;
}

// Searchable picker for embedding a `.base` via the `/` menu ("Datenbank
// einbetten"). The `@` menu lists `.base` results inline; this modal is the
// slash-command equivalent and also offers creating a new inline database.
export const BasePicker: React.FC<Props> = ({ onPick, onCreate, onClose }) => {
  const { queryService } = useVault();
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<BaseRow[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!queryService) return;
    let alive = true;
    const term = query.trim();
    const like = `%${term}%`;
    queryService.db
      .query(
        `SELECT path, title FROM files
         WHERE (title LIKE ? OR path LIKE ?) AND path LIKE '%.base'
         ORDER BY (CASE WHEN title LIKE ? THEN 1 ELSE 2 END), mtime_local DESC
         LIMIT 50`,
        [like, like, `${term}%`],
      )
      .then((r: BaseRow[]) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [query, queryService]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--overlay-bg)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}>
      <div
        ref={ref}
        role="dialog"
        aria-label={t("editor.basePickerTitle", { defaultValue: "Datenbank einbetten" })}
        style={{ width: "min(520px, 92vw)", background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-xl)", boxShadow: "0 10px 30px rgba(0,0,0,0.18)", overflow: "hidden" }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("editor.basePickerSearch", { defaultValue: "Datenbank suchen…" })}
          aria-label={t("editor.basePickerSearch", { defaultValue: "Datenbank suchen…" })}
          className="pv-field"
        />
        <div style={{ maxHeight: "50vh", overflowY: "auto", padding: "6px" }}>
          <button
            type="button"
            onClick={onCreate}
            className="pv-btn pv-btn--ghost"
            style={{ display: "flex", width: "100%", justifyContent: "flex-start", gap: "10px" }}
          >
            <Plus size={ICON.ui} />
            {t("editor.basePickerCreate", { defaultValue: "Neue Datenbank erstellen & einbetten" })}
          </button>
          {rows.map((r) => (
            <button
              key={r.path}
              type="button"
              onClick={() => onPick(r.path)}
              className="pv-btn pv-btn--ghost"
              style={{ display: "flex", width: "100%", justifyContent: "flex-start", gap: "10px" }}
            >
              <Database size={ICON.ui} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {(r.title || r.path).replace(/\.base$/i, "")}
              </span>
              <span style={{ flexShrink: 0, color: "var(--text-faint)", fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "45%" }}>{r.path}</span>
            </button>
          ))}
          {rows.length === 0 && (
            <div style={{ padding: "12px", color: "var(--text-muted)", fontSize: "var(--text-ui)" }}>
              {t("editor.basePickerEmpty", { defaultValue: "Keine .base-Dateien gefunden." })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
