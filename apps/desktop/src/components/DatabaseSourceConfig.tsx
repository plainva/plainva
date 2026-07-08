import React, { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useVault } from "../contexts/VaultContext";
import { SourceConditionEditor } from "./base/SourceConditionEditor";
import { isSourceCondition } from "./base/filterExpr";

interface DatabaseSourceConfigProps {
  dbConfig: any;
  onSaveConfig: (newConfig: any) => void;
}

// Data-source section of the config panel (folder/tag conditions). Property
// filters live in their own panel section — this component only shows and edits
// the SOURCE conditions and leaves everything else in filters.and/or untouched.
export const DatabaseSourceConfig: React.FC<DatabaseSourceConfigProps> = ({ dbConfig, onSaveConfig }) => {
  const { t } = useTranslation();
  const { queryService, vaultAdapter } = useVault();

  const [folders, setFolders] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (queryService) {
      queryService.getAllFolders().then(setFolders).catch(console.error);
      queryService.getAllTags().then(t => setTags(t.map(x => x.tag))).catch(console.error);
    }
  }, [queryService]);

  const listOf = (logic: "and" | "or"): any[] => (Array.isArray(dbConfig?.filters?.[logic]) ? dbConfig.filters[logic] : []);
  const sourceConditions = (logic: "and" | "or") =>
    listOf(logic)
      .map((clause, idx) => ({ clause, idx }))
      .filter((c): c is { clause: string; idx: number } => isSourceCondition(c.clause));

  const withFilters = (mutate: (filters: any) => void) => {
    const newConfig = JSON.parse(JSON.stringify(dbConfig ?? {}));
    if (!newConfig.filters) newConfig.filters = {};
    if (!Array.isArray(newConfig.filters.and)) newConfig.filters.and = [...listOf("and")];
    if (!Array.isArray(newConfig.filters.or)) newConfig.filters.or = [...listOf("or")];
    mutate(newConfig.filters);
    onSaveConfig(newConfig);
  };

  const addClause = (logic: "and" | "or", clause: string) => {
    if (listOf(logic).includes(clause)) return;
    withFilters((filters) => filters[logic].push(clause));
  };

  const removeAt = (logic: "and" | "or", idx: number) => {
    withFilters((filters) => filters[logic].splice(idx, 1));
  };

  // Create a folder in the vault so a database can start from zero (P1). An
  // already existing folder counts as success — the clause is what matters.
  const createFolder = async (path: string): Promise<boolean> => {
    if (!vaultAdapter) return false;
    try {
      await vaultAdapter.createDir(path);
      return true;
    } catch (e) {
      try {
        if (await vaultAdapter.exists(path)) return true;
      } catch { /* fall through to failure */ }
      console.error("Failed to create folder for database source", path, e);
      return false;
    }
  };

  const totalConditions = sourceConditions("and").length + sourceConditions("or").length;

  // Auto-expand if no conditions exist
  useEffect(() => {
    if (totalConditions === 0) setIsExpanded(true);
  }, [totalConditions]);

  return (
    <div style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", background: "var(--bg-primary)", overflow: "hidden" }}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-secondary)", cursor: "pointer", borderBottom: isExpanded ? "1px solid var(--border-color)" : "none" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 500, fontSize: "0.9rem", color: "var(--text-main)" }}>
          <Settings size={16} color="var(--accent-color)" />
          {t("database.sourceConfig", "Datenquelle")}
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", gap: "8px" }}>
          {totalConditions === 0 && <span style={{ color: "var(--error-text)" }}>{t("database.noSources", "Keine Quelle – zeigt alle Dateien")}</span>}
          {totalConditions > 0 && <span>{totalConditions} {t("database.activeConditions", "aktive Bedingungen")}</span>}
        </div>
      </div>

      {isExpanded && (
        <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ padding: "12px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", background: "var(--bg-primary)" }}>
            <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "8px", color: "var(--text-main)" }}>
              {t("database.matchAll", "Alle folgenden Bedingungen müssen erfüllt sein (AND):")}
            </div>
            <SourceConditionEditor
              conditions={sourceConditions("and")}
              folders={folders}
              tags={tags}
              t={t}
              onAdd={(clause) => addClause("and", clause)}
              onRemoveAt={(idx) => removeAt("and", idx)}
              onCreateFolder={createFolder}
            />
          </div>

          <div style={{ padding: "12px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", background: "var(--bg-primary)" }}>
            <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "8px", color: "var(--text-main)" }}>
              {t("database.matchAny", "Mindestens eine der folgenden Bedingungen muss erfüllt sein (OR):")}
            </div>
            <SourceConditionEditor
              conditions={sourceConditions("or")}
              folders={folders}
              tags={tags}
              t={t}
              onAdd={(clause) => addClause("or", clause)}
              onRemoveAt={(idx) => removeAt("or", idx)}
              onCreateFolder={createFolder}
            />
          </div>
        </div>
      )}
    </div>
  );
};
