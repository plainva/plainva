import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, Plus, Trash2, Info } from "lucide-react";
import { useVault } from "../../contexts/VaultContext";
import { Select } from "../Select";
import { SourceConditionEditor } from "./SourceConditionEditor";
import { buildWizardConfig, collectWizardColumns, type WizardColumn, type WizardNewColumn } from "./createWizardModel";
import { listVaultFolders } from "../../services/vaultFolders";
import { baseInputTypeOptions, defaultViewName } from "./baseViewerShared";
import { Button, ICON, IconButton, Modal } from "@plainva/ui";

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

  return (
    // The quiet-card grammar of the configuration panel (2026-07-18), not a
    // hand-rolled dialog: same groups, same cards, same spacing. The wizard used
    // its own cramped markup, which is what the maintainer kept seeing.
    <Modal
      onClose={onCancel}
      title={`${t("database.wizardTitle", "Neue Datenbank")}: ${fileName}`}
      icon={<Database size={ICON.ui} color="var(--accent-color)" />}
      size="md"
      testId="base-create-wizard"
      bodyClassName="base-cfg-body"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>{t("common.cancel", "Abbrechen")}</Button>
          <Button
            variant="primary"
            disabled={!canCreate}
            data-tip={canCreate ? undefined : t("database.wizardSourceHint", "Welche Notizen soll diese Datenbank zeigen? Mindestens ein Ordner oder ein Tag; Kombinationen grenzen weiter ein.")}
            onClick={() => onCreate(buildWizardConfig(clauses, columns, newColumns, defaultViewName(t, "table")))}
          >
            {t("database.wizardCreate", "Datenbank erstellen")}
          </Button>
        </>
      }
    >
      <div className="base-cfg-group">
        <div className="base-cfg-grouplabel">1 · {t("database.sourceConfig", "Datenquelle")}</div>
        <div className="base-cfg-pagedesc">{t("database.wizardSourceHint", "Welche Notizen soll diese Datenbank zeigen? Mindestens ein Ordner oder ein Tag; Kombinationen grenzen weiter ein.")}</div>
        <div className="base-cfg-card">
          {/* The editor brings no padding of its own (in the config panel its
              container supplies it), so it gets a proper card row here. */}
          <div className="base-cfg-cardrow base-cfg-cardrow--field">
          <SourceConditionEditor
            conditions={clauses.map((clause, idx) => ({ clause, idx }))}
            tags={tags}
            t={t}
            onAdd={(clause) => setClauses((prev) => (prev.includes(clause) ? prev : [...prev, clause]))}
            onRemoveAt={(idx) => setClauses((prev) => prev.filter((_, i) => i !== idx))}
            onListFolders={listFolders}
            onCreateFolder={createFolder}
          />
          </div>
        </div>
        {matchCount !== null && (
          <div className="base-cfg-hint">
            <Info size={ICON.meta} color="var(--accent-color)" />
            {t("database.wizardMatches", { count: matchCount, defaultValue: "{{count}} Notizen entsprechen dieser Quelle" })}
          </div>
        )}
      </div>

      <div className="base-cfg-group">
        <div className="base-cfg-grouplabel">2 · {t("database.properties", "Eigenschaften")}</div>
        {clauses.length === 0 ? (
          <div className="base-cfg-card">
            <div className="base-cfg-cardrow">
              <span className="base-cfg-empty">{t("database.wizardNoSource", "Zuerst oben eine Quelle wählen.")}</span>
            </div>
          </div>
        ) : (
          <>
            {columns.length > 0 && (
              <div className="base-cfg-pagedesc">{t("database.wizardColumnsHint", "In den gefundenen Notizen vorhandene Eigenschaften – als Spalten übernehmen?")}</div>
            )}
            <div className="base-cfg-card base-cfg-wizcols">
              {columns.map((col) => (
                <label key={col.name} className="base-cfg-cardrow">
                  <input type="checkbox" className="pv-check" checked={col.selected} onChange={() => setColumns((prev) => prev.map((c) => (c.name === col.name ? { ...c, selected: !c.selected } : c)))} />
                  <span className="base-cfg-rowlabel">{col.name}</span>
                  <span className="base-cfg-badge" data-tip={t("database.coverageTooltip", "In {{count}} von {{total}} Einträgen vorhanden", { count: col.coverage, total: matchCount ?? 0 })}>{col.coverage}/{matchCount ?? 0}</span>
                </label>
              ))}
              {newColumns.map((col) => (
                <div key={col.name} className="base-cfg-cardrow">
                  <input type="checkbox" className="pv-check" checked readOnly disabled />
                  <span className="base-cfg-rowlabel">{col.name}</span>
                  <span className="base-cfg-badge">{t("database.newProperty", "Neue Eigenschaft")}</span>
                  <IconButton
                    label={t("common.delete", "Löschen")}
                    size="sm"
                    onClick={() => setNewColumns((prev) => prev.filter((c) => c.name !== col.name))}
                  >
                    <Trash2 size={ICON.meta} />
                  </IconButton>
                </div>
              ))}
              <div className="base-cfg-cardrow">
                <input
                  type="text"
                  className="pv-field pv-field--compact"
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
                <Button variant="ghost" size="sm" disabled={newPropInvalid} onClick={addNewProp}>
                  <Plus size={ICON.meta} />
                  {t("database.add", "Hinzufügen")}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
