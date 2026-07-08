import { useState } from "react";
import type { TFunction } from "i18next";
import { Trash2, FolderPlus } from "lucide-react";
import { Select, type SelectOption } from "../Select";
import { buildSourceClause, parseSourceClause } from "./filterExpr";

// Shared editor for the folder/tag source conditions of a `.base` (plan W3):
// used by the config panel's data-source section and by the creation wizard so
// both offer the same picking UI including "create a new folder" (P1).
export function SourceConditionEditor({
  conditions,
  folders,
  tags,
  t,
  onAdd,
  onRemoveAt,
  onCreateFolder,
}: {
  /** Editable source clauses with their index in the underlying filter list. */
  conditions: { clause: string; idx: number }[];
  folders: string[];
  tags: string[];
  t: TFunction;
  onAdd: (clause: string) => void;
  onRemoveAt: (idx: number) => void;
  /** Creates the folder in the vault; resolves true on success. */
  onCreateFolder?: (path: string) => Promise<boolean>;
}) {
  const [type, setType] = useState<"folder" | "tag">("folder");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState("");
  const [folderError, setFolderError] = useState(false);

  const addOptions: SelectOption[] = [
    { value: "", label: t("database.addFilter", "Filter hinzufügen") },
    ...(type === "folder"
      ? [
          { value: "/", label: `/ (${t("database.rootFolder", "Hauptverzeichnis")})` },
          ...folders.map((f) => ({ value: f, label: f })),
        ]
      : tags.map((tag) => ({ value: tag, label: `#${tag}` }))),
  ];

  const submitNewFolder = async () => {
    const path = newFolderPath.trim().replace(/^\/+|\/+$/g, "");
    if (!path || !onCreateFolder) return;
    setFolderError(false);
    const ok = await onCreateFolder(path);
    if (!ok) { setFolderError(true); return; }
    onAdd(buildSourceClause("folder", path));
    setNewFolderPath("");
    setNewFolderOpen(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {conditions.length === 0 && (
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic" }}>{t("database.noConditions", "Keine Bedingungen")}</div>
      )}
      {conditions.map(({ clause, idx }) => {
        const parsed = parseSourceClause(clause);
        const label = parsed?.type === "tag" ? t("database.tag", "Tag") : t("database.folder", "Ordner");
        let display = parsed?.value ?? clause;
        if (parsed?.type === "tag" && !display.startsWith("#")) display = `#${display}`;
        if (parsed?.type === "folder" && display === "/") display = `/ (${t("database.rootFolder", "Hauptverzeichnis")})`;
        return (
          <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", padding: "4px 8px", background: "var(--bg-secondary)", borderRadius: "var(--radius-xs)", fontSize: "0.85rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0, flex: 1 }}>
              <span style={{ fontWeight: 600, color: "var(--accent-color)", flexShrink: 0 }}>{label}:</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={display}>{display}</span>
            </div>
            <button onClick={() => onRemoveAt(idx)} aria-label={t("common.delete", "Löschen")} title={t("common.delete", "Löschen")} style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.6, flexShrink: 0, color: "var(--text-main)", display: "flex" }}>
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}

      <div style={{ display: "flex", gap: "4px", marginTop: "4px", flexWrap: "wrap" }}>
        <Select
          ariaLabel={t("database.sourceType", "Quelle")}
          value={type}
          size="sm"
          minWidth={80}
          onChange={(v) => setType(v as "folder" | "tag")}
          options={[
            { value: "folder", label: t("database.folder", "Ordner") },
            { value: "tag", label: t("database.tag", "Tag") },
          ]}
        />
        <div style={{ flex: 1, minWidth: 120 }}>
          <Select
            ariaLabel={t("database.addFilter", "Filter hinzufügen")}
            value=""
            size="sm"
            minWidth={80}
            onChange={(v) => { if (v) onAdd(buildSourceClause(type, v)); }}
            options={addOptions}
          />
        </div>
      </div>

      {onCreateFolder && !newFolderOpen && (
        <button className="base-cfg-addrow" onClick={() => setNewFolderOpen(true)}>
          <FolderPlus size={12} /> {t("database.newFolder", "Neuen Ordner anlegen")}
        </button>
      )}
      {onCreateFolder && newFolderOpen && (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", gap: "4px" }}>
            <input
              autoFocus
              type="text"
              className="base-cfg-input"
              style={{ flex: 1, minWidth: 0 }}
              placeholder={t("database.newFolderPlaceholder", "Ordnerpfad, z. B. Projekte/Neu")}
              value={newFolderPath}
              onChange={(e) => { setNewFolderPath(e.target.value); setFolderError(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitNewFolder(); if (e.key === "Escape") { setNewFolderOpen(false); setFolderError(false); } }}
            />
            <button className="base-cfg-addbtn" onClick={submitNewFolder} disabled={!newFolderPath.trim()} style={{ opacity: newFolderPath.trim() ? 1 : 0.5 }}>{t("database.add", "Hinzufügen")}</button>
          </div>
          {folderError && <div style={{ fontSize: "0.75rem", color: "var(--error-text)" }}>{t("database.createFolderFailed", "Ordner konnte nicht angelegt werden.")}</div>}
        </div>
      )}
    </div>
  );
}
