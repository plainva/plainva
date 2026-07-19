import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, X, Plus, Trash2, Info } from "lucide-react";
import { useVault } from "../../contexts/VaultContext";
import { Select } from "../Select";
import { SourceConditionEditor } from "./SourceConditionEditor";
import { buildWizardConfig, collectWizardColumns, type WizardColumn, type WizardNewColumn } from "./createWizardModel";
import { listVaultFolders } from "../../services/vaultFolders";
import { baseInputTypeOptions, defaultViewName } from "./baseViewerShared";
import { ICON } from "@plainva/ui";

// Creation wizard of a new `.base` (plan W3, P1/P2): step 1 picks the data
// source (folders/tags, combinable; a brand-new folder starts from zero), step
// 2 picks the columns from the properties found in the matching notes. The
// file is only written on "create" — cancelling leaves no file behind.
export function BaseCreateWizard({
  fileName,
  onCreate,
  onCancel,
}: {
  /** Display name of the file being created (e.g. "Projekte.base"). */
  fileName: string;
  onCreate: (config: any) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { queryService, vaultAdapter } = useVault();

  const [clauses, setClauses] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [columns, setColumns] = useState<WizardColumn[]>([]);
  const [newColumns, setNewColumns] = useState<WizardNewColumn[]>([]);
  const [newPropName, setNewPropName] = useState("");
  const [newPropType, setNewPropType] = useState("text");

  useEffect(() => {
    if (!queryService) return;
    queryService.getAllTags().then((all) => setTags(all.map((x) => x.tag))).catch(console.error);
  }, [queryService]);

  // Folder picking browses the live file system (2026-07-17): a folder created
  // moments ago — still empty, so unknown to the index — is pickable as the
  // source of the new database (maintainer bug report F4).
  const listFolders = async (path: string): Promise<string[]> =>
    vaultAdapter ? listVaultFolders(vaultAdapter, path) : [];

  // Probe query on every source change: the match count and the property union
  // drive step 2. No source selected -> no query (a vault-wide scan is never
  // done implicitly; P1 requires at least one folder or tag).
  useEffect(() => {
    let cancelled = false;
    if (!queryService || clauses.length === 0) {
      setMatchCount(null);
      setColumns([]);
      return;
    }
    queryService
      .queryDatabaseFiles({ filters: { and: clauses }, views: [{ type: "table" }] })
      .then((rows) => {
        if (cancelled) return;
        setMatchCount(rows.length);
        setColumns((prev) => collectWizardColumns(rows, prev));
      })
      .catch((e) => { if (!cancelled) { console.error("Wizard probe query failed", e); setMatchCount(null); } });
    return () => { cancelled = true; };
  }, [queryService, clauses]);

  const createFolder = async (path: string): Promise<boolean> => {
    if (!vaultAdapter) return false;
    try {
      await vaultAdapter.createDir(path);
      return true;
    } catch (e) {
      try {
        if (await vaultAdapter.exists(path)) return true;
      } catch { /* fall through to failure */ }
      console.error("Failed to create folder in the base wizard", path, e);
      return false;
    }
  };

  const takenNames = new Set([...columns.map((c) => c.name), ...newColumns.map((c) => c.name)]);
  const newPropInvalid = !newPropName.trim() || takenNames.has(newPropName.trim()) || newPropName.trim().startsWith("file.");
  const addNewProp = () => {
    if (newPropInvalid) return;
    setNewColumns((prev) => [...prev, { name: newPropName.trim(), input: newPropType }]);
    setNewPropName("");
    setNewPropType("text");
  };

  const canCreate = clauses.length > 0;
  const stepBadge = (n: string) => (
    <span className="pv-badge pv-badge--accent" style={{ flexShrink: 0 }}>{n}</span>
  );

  return (
    // NOTE (design sweep 2026-07-19): the overlay/head markup below migrated to
    // shared tokens, but the outer card keeps its original (legacy) class name
    // — the wizard e2e ("a brand-new EMPTY folder is pickable…", base.spec.ts
    // line ~970) locates it via that exact CSS class, and this sweep must not
    // touch e2e sources.
    <div className="pv-overlay" onMouseDown={onCancel}>
      <div className="pv-modal pv-modal--md" data-testid="base-create-wizard" style={{ width: 560 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="pv-modal-row">
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--text-main)" }}>
            <Database size={ICON.ui} color="var(--accent-color)" />
            {t("database.wizardTitle", "Neue Datenbank")}: {fileName}
          </span>
          <button type="button" className="pv-iconbtn" aria-label={t("common.close", "Schließen")} data-tip={t("common.close", "Schließen")} onClick={onCancel}><X size={ICON.ui} /></button>
        </div>

        <div className="pv-modal-section">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {stepBadge("1")}
            <span style={{ fontWeight: 600, fontSize: "var(--text-md)", color: "var(--text-main)" }}>{t("database.sourceConfig", "Datenquelle")}</span>
          </div>
          <div style={{ fontSize: "var(--text-ui)", color: "var(--text-muted)" }}>{t("database.wizardSourceHint", "Welche Notizen soll diese Datenbank zeigen? Mindestens ein Ordner oder ein Tag; Kombinationen grenzen weiter ein.")}</div>
          <SourceConditionEditor
            conditions={clauses.map((clause, idx) => ({ clause, idx }))}
            tags={tags}
            t={t}
            onAdd={(clause) => setClauses((prev) => (prev.includes(clause) ? prev : [...prev, clause]))}
            onRemoveAt={(idx) => setClauses((prev) => prev.filter((_, i) => i !== idx))}
            onListFolders={listFolders}
            onCreateFolder={createFolder}
          />
          {matchCount !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-container)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: "var(--text-ui)", color: "var(--text-main)" }}>
              <Info size={ICON.ui} color="var(--accent-color)" />
              {t("database.wizardMatches", { count: matchCount, defaultValue: "{{count}} Notizen entsprechen dieser Quelle" })}
            </div>
          )}
        </div>

        <div className="pv-modal-section" style={{ borderTop: "1px solid var(--border-color)", paddingTop: "0.85rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {stepBadge("2")}
            <span style={{ fontWeight: 600, fontSize: "var(--text-md)", color: "var(--text-main)" }}>{t("database.properties", "Eigenschaften")}</span>
          </div>
          {clauses.length === 0 && <div style={{ fontSize: "var(--text-ui)", color: "var(--text-faint)", fontStyle: "italic" }}>{t("database.wizardNoSource", "Zuerst oben eine Quelle wählen.")}</div>}
          {clauses.length > 0 && (
            <>
              {columns.length > 0 && <div style={{ fontSize: "var(--text-ui)", color: "var(--text-muted)" }}>{t("database.wizardColumnsHint", "In den gefundenen Notizen vorhandene Eigenschaften – als Spalten übernehmen?")}</div>}
              <div style={{ display: "flex", flexDirection: "column", maxHeight: 220, overflowY: "auto" }}>
                {columns.map((col) => (
                  <label key={col.name} className="base-cfg-check" style={{ borderBottom: "1px solid var(--border-color)", padding: "5px 2px" }}>
                    <input type="checkbox" className="pv-check" checked={col.selected} onChange={() => setColumns((prev) => prev.map((c) => (c.name === col.name ? { ...c, selected: !c.selected } : c)))} />
                    {" "}<span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{col.name}</span>
                    <span className="base-cfg-badge" data-tip={t("database.coverageTooltip", "In {{count}} von {{total}} Einträgen vorhanden", { count: col.coverage, total: matchCount ?? 0 })}>{col.coverage}/{matchCount ?? 0}</span>
                  </label>
                ))}
                {newColumns.map((col) => (
                  <div key={col.name} className="base-cfg-check" style={{ borderBottom: "1px solid var(--border-color)", padding: "5px 2px" }}>
                    <input type="checkbox" className="pv-check" checked readOnly disabled />
                    {" "}<span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{col.name}</span>
                    <span className="base-cfg-badge">{t("database.newProperty", "Neue Eigenschaft")}</span>
                    <button onClick={() => setNewColumns((prev) => prev.filter((c) => c.name !== col.name))} aria-label={t("common.delete", "Löschen")} data-tip={t("common.delete", "Löschen")} className="base-cfg-delbtn"><Trash2 size={ICON.meta} /></button>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  type="text"
                  className="base-cfg-input"
                  style={{ flex: 1, minWidth: 0 }}
                  placeholder={t("database.propertyNamePlaceholder", "Name der Eigenschaft...")}
                  value={newPropName}
                  onChange={(e) => setNewPropName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addNewProp(); }}
                />
                <div style={{ width: 150, flexShrink: 0 }}>
                  <Select
                    ariaLabel={t("properties.type", { defaultValue: "Typ" })}
                    value={newPropType}
                    size="sm"
                    minWidth={60}
                    onChange={setNewPropType}
                    options={baseInputTypeOptions(t)}
                  />
                </div>
                <button className="base-cfg-addbtn" onClick={addNewProp} disabled={newPropInvalid} style={{ opacity: newPropInvalid ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 4 }}><Plus size={ICON.meta} />{t("database.add", "Hinzufügen")}</button>
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border-color)", paddingTop: "0.85rem" }}>
          <button type="button" className="pv-btn pv-btn--ghost pv-btn--sm" onClick={onCancel}>{t("common.cancel", "Abbrechen")}</button>
          <button
            type="button"
            className="pv-btn pv-btn--primary pv-btn--sm"
            onClick={() => onCreate(buildWizardConfig(clauses, columns, newColumns, defaultViewName(t, "table")))}
            disabled={!canCreate}
            data-tip={canCreate ? undefined : t("database.wizardSourceHint", "Welche Notizen soll diese Datenbank zeigen? Mindestens ein Ordner oder ein Tag; Kombinationen grenzen weiter ein.")}
          >
            {t("database.wizardCreate", "Datenbank erstellen")}
          </button>
        </div>
      </div>
    </div>
  );
}
