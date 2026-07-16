import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, Plus, X } from "lucide-react";
import {
  Modal,
  addTemplateForAssignment,
  parseTemplateForTargets,
  removeTemplateForAssignment,
  templateMatchesBase,
} from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";
import { applyIndexChanges } from "../services/fileActions";

/**
 * "Ziel-Datenbanken" dialog of a template note (plan Vorlagen-Datenbank-
 * Zuordnung P3, decision E3): chips of the current plainva.templateFor
 * assignments plus a typeahead over the vault's `.base` files. The plainva
 * namespace is hidden from the generic properties panel by design, so this
 * dedicated surface (Editor ⋮ → "Ziel-Datenbanken…") is the template-side
 * editor; the quick-assign toggle in each base's "+ entry" menu writes the
 * exact same data.
 */
export function TemplateTargetsModal({ templatePath, onClose }: { templatePath: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { vaultAdapter, queryService, indexer } = useVault();
  const [content, setContent] = useState<string | null>(null);
  const [bases, setBases] = useState<{ path: string; title: string }[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [raw, baseList] = await Promise.all([
          vaultAdapter ? vaultAdapter.readTextFile(templatePath) : Promise.resolve(""),
          queryService ? queryService.listBases() : Promise.resolve([] as { path: string; title: string }[]),
        ]);
        if (!alive) return;
        setContent(raw);
        setBases(baseList);
      } catch {
        if (alive) setContent("");
      }
    })();
    return () => {
      alive = false;
    };
  }, [vaultAdapter, queryService, templatePath]);

  const targets = useMemo(() => (content === null ? [] : parseTemplateForTargets(content)), [content]);

  const write = async (next: string) => {
    if (!vaultAdapter) return;
    await vaultAdapter.writeTextFile(templatePath, next);
    setContent(next);
    if (indexer) await applyIndexChanges(indexer, { added: [templatePath] }).catch(() => {});
  };

  const add = async (basePath: string) => {
    if (content === null || !vaultAdapter) return;
    try {
      const rows = queryService
        ? await queryService.db.query<{ path: string }>(`SELECT path FROM files`)
        : [];
      const res = addTemplateForAssignment(content, basePath, rows.map((r) => r.path));
      if (res.changed) await write(res.content);
      setQuery("");
    } catch (e) {
      console.error("[TemplateTargetsModal] assigning failed", e);
    }
  };

  const remove = async (target: string) => {
    if (content === null) return;
    try {
      // The stored target text doubles as the match path: bare names match by
      // basename, qualified entries match exactly (same rule the menu uses).
      const res = removeTemplateForAssignment(content, target);
      if (res.changed) await write(res.content);
    } catch (e) {
      console.error("[TemplateTargetsModal] unassigning failed", e);
    }
  };

  const q = query.trim().toLowerCase();
  const candidates = bases.filter(
    (b) =>
      !templateMatchesBase(targets, b.path) &&
      (q === "" || b.title.toLowerCase().includes(q) || b.path.toLowerCase().includes(q))
  );

  return (
    <Modal onClose={onClose} title={t("database.templateTargetsTitle", "Ziel-Datenbanken")} testId="template-targets-modal">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          {t(
            "database.templateTargetsHint",
            "Diese Vorlage erscheint im „Eintrag“-Menü der zugeordneten Datenbanken. Ohne Zuordnung ist sie dort nur unter „Alle Vorlagen anzeigen“ zu finden."
          )}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
          {targets.length === 0 && (
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-faint)" }}>
              {t("database.templateTargetsNone", "Keine Datenbank zugeordnet.")}
            </span>
          )}
          {targets.map((target) => (
            <span key={target} className="pv-chip pv-chip-link">
              <Database size={11} aria-hidden="true" /> {target}
              <button
                type="button"
                className="pv-chip-x"
                aria-label={t("properties.removeItem")}
                onClick={() => {
                  void remove(target);
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <input
          className="pv-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("database.templateTargetsSearch", "Datenbank verknüpfen…")}
          aria-label={t("database.templateTargetsSearch", "Datenbank verknüpfen…")}
          data-testid="template-targets-search"
        />
        <div style={{ display: "flex", flexDirection: "column" }}>
          {candidates.slice(0, 8).map((b) => (
            <button
              key={b.path}
              type="button"
              className="pv-menu-item"
              onClick={() => {
                void add(b.path);
              }}
            >
              <Plus size={13} style={{ flexShrink: 0 }} aria-hidden="true" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.title}</span>
              <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {b.path}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
