import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database, Plus, X } from "lucide-react";
import { errorText, ICON, IconButton, parseTemplateForTargets, SearchField, templateMatchesBase, toast } from "@plainva/ui";
import { SheetGrip } from "../../components/SheetGrip";
import { setTemplateAssignment } from "../../services/templateAssignment";
import { vaultOps, type MobileVault } from "../../services/vaultService";

/**
 * "Target databases" of a template note on the phone (parity
 * `base-template-assignment`, the template's side): the databases it is
 * assigned to (`plainva.templateFor`) and a search over the vault's databases to
 * add one. The Templates sheet of a database writes the exact same data.
 */
export function TemplateTargetsSheet({ vault, templatePath, onClose }: { vault: MobileVault; templatePath: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [bases, setBases] = useState<{ path: string; title: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [text, list] = await Promise.all([vaultOps.read(vault, templatePath), vault.queryService ? vault.queryService.listBases() : Promise.resolve([])]);
        if (!alive) return;
        setContent(text);
        setBases(list);
        setLoadError(null);
      } catch (e) {
        if (!alive) return;
        setContent("");
        setLoadError(errorText(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [vault, templatePath]);

  const targets = useMemo(() => (content === null ? [] : parseTemplateForTargets(content)), [content]);

  const change = async (basePath: string, assign: boolean) => {
    try {
      await setTemplateAssignment(vault, templatePath, basePath, assign);
      // The chips are drawn from the template as it lies there now.
      setContent(await vaultOps.read(vault, templatePath));
      if (assign) setQuery("");
    } catch (e) {
      // Said with its reason: a template whose block at the top is no YAML map takes no assignment.
      toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) }));
    }
  };

  const q = query.trim().toLowerCase();
  const candidates = bases.filter((b) => !templateMatchesBase(targets, b.path) && (q === "" || b.title.toLowerCase().includes(q) || b.path.toLowerCase().includes(q)));

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="pv-sheet m-sheet" data-testid="template-targets-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("database.templateTargetsTitle")}</p>
        <p className="m-hint">{t("database.templateTargetsHint")}</p>
        {loadError && (
          <p className="m-hint" data-testid="template-targets-error">
            {t("common.loadFailed", { message: loadError })}
          </p>
        )}
        {!loadError && content !== null && targets.length === 0 && <p className="m-hint">{t("database.templateTargetsNone")}</p>}
        {targets.map((target) => (
          <div className="m-row m-row--split" key={target}>
            <span className="m-row-main">
              <Database size={ICON.head} />
              <span>{target}</span>
            </span>
            <IconButton label={t("properties.removeItem")} data-testid="template-target-remove" onClick={() => void change(target, false)}>
              <X size={ICON.head} />
            </IconButton>
          </div>
        ))}
        <SearchField clearLabel={t("sidebar.clearSearch")} onValueChange={setQuery} placeholder={t("database.templateTargetsSearch")} value={query} />
        {candidates.slice(0, 8).map((b) => (
          <button className="m-row" key={b.path} data-testid="template-target-add" onClick={() => void change(b.path, true)}>
            <Plus size={ICON.head} />
            <span>{b.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
