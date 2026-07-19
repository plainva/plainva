import { useState } from "react";
import type { TFunction } from "i18next";
import { Trash2, FolderOpen } from "lucide-react";
import { Select, type SelectOption } from "../Select";
import { buildSourceClause, ICON, parseSourceClause } from "@plainva/ui";
import { SyncFolderPickerModal } from "../SyncFolderPickerModal";

// Shared editor for the folder/tag source conditions of a `.base` (plan W3):
// used by the config panel's data-source section and by the creation wizard so
// both offer the same picking UI. Since 2026-07-17 the folder side is a
// BROWSABLE picker over the live file system (maintainer request A2) instead
// of an index-backed dropdown — freshly created EMPTY folders are pickable
// immediately (the index only knows folders that contain indexed files), and
// the picker's "new folder" row replaces the old inline create form.
export function SourceConditionEditor({
  conditions,
  tags,
  t,
  onAdd,
  onRemoveAt,
  onListFolders,
  onCreateFolder,
}: {
  /** Editable source clauses with their index in the underlying filter list. */
  conditions: { clause: string; idx: number }[];
  tags: string[];
  t: TFunction;
  onAdd: (clause: string) => void;
  onRemoveAt: (idx: number) => void;
  /** Child folder names one level below `path` ("" = vault root), from the file system. */
  onListFolders: (path: string) => Promise<string[]>;
  /** Creates the folder in the vault; resolves true on success. */
  onCreateFolder?: (path: string) => Promise<boolean>;
}) {
  const [type, setType] = useState<"folder" | "tag">("folder");
  const [pickerOpen, setPickerOpen] = useState(false);

  const tagOptions: SelectOption[] = [
    { value: "", label: t("database.addFilter", "Filter hinzufügen") },
    ...tags.map((tag) => ({ value: tag, label: `#${tag}` })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {conditions.length === 0 && (
        <div style={{ fontSize: "var(--text-ui)", color: "var(--text-muted)", fontStyle: "italic" }}>{t("database.noConditions", "Keine Bedingungen")}</div>
      )}
      {conditions.map(({ clause, idx }) => {
        const parsed = parseSourceClause(clause);
        const label = parsed?.type === "tag" ? t("database.tag", "Tag") : t("database.folder", "Ordner");
        let display = parsed?.value ?? clause;
        if (parsed?.type === "tag" && !display.startsWith("#")) display = `#${display}`;
        if (parsed?.type === "folder" && display === "/") display = `/ (${t("database.rootFolder", "Hauptverzeichnis")})`;
        return (
          <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", padding: "4px 8px", background: "var(--bg-secondary)", borderRadius: "var(--radius-xs)", fontSize: "var(--text-md)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0, flex: 1 }}>
              <span style={{ fontWeight: 600, color: "var(--accent-color)", flexShrink: 0 }}>{label}:</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-tip={display}>{display}</span>
            </div>
            <button onClick={() => onRemoveAt(idx)} aria-label={t("common.delete", "Löschen")} data-tip={t("common.delete", "Löschen")} className="pv-iconbtn">
              <Trash2 size={ICON.ui} />
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
        {type === "folder" ? (
          <button
            type="button"
            className="base-cfg-addrow"
            data-source-browse="true"
            style={{ flex: 1, minWidth: 120, justifyContent: "flex-start" }}
            onClick={() => setPickerOpen(true)}
          >
            <FolderOpen size={ICON.meta} /> {t("settings.browseFolders", "Ordner auswählen…")}
          </button>
        ) : (
          <div style={{ flex: 1, minWidth: 120 }}>
            <Select
              ariaLabel={t("database.addFilter", "Filter hinzufügen")}
              value=""
              size="sm"
              minWidth={80}
              onChange={(v) => { if (v) onAdd(buildSourceClause("tag", v)); }}
              options={tagOptions}
            />
          </div>
        )}
      </div>

      {pickerOpen && (
        <SyncFolderPickerModal
          listFolders={onListFolders}
          rootLabel={`/ (${t("database.rootFolder", "Hauptverzeichnis")})`}
          allowRoot
          createFolder={
            onCreateFolder
              ? async (path: string) => {
                  const ok = await onCreateFolder(path);
                  if (!ok) throw new Error(t("database.createFolderFailed", "Ordner konnte nicht angelegt werden."));
                }
              : undefined
          }
          onSelect={(path) => {
            setPickerOpen(false);
            onAdd(buildSourceClause("folder", path === "" ? "/" : path));
          }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
