import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Database, FilePlus2, Star } from "lucide-react";
import { errorText, groupTemplatesForBase, ICON, IconButton, templateMatchesBase, toast, type ScopedTemplateItem } from "@plainva/ui";
import { SheetGrip } from "../../components/SheetGrip";
import { loadScopedTemplates, setTemplateAssignment } from "../../services/templateAssignment";
import type { MobileVault } from "../../services/vaultService";

/**
 * The phone's counterpart of the desktop's "Entry" dropdown (parity
 * `base-template-assignment`): the templates of THIS database first — those
 * assigned to it (`plainva.templateFor`) and its default — everything else
 * behind "Show all templates". A tap on a row makes one entry from that
 * template; the database icon assigns or takes away the assignment, the star
 * sets or clears the default. The grouping, the matching and the writing are
 * the shared ones.
 */
export function BaseTemplatesSheet({
  vault,
  basePath,
  defaultTemplate,
  onCreate,
  onSetDefault,
  onCreateTemplate,
  onClose,
}: {
  vault: MobileVault;
  basePath: string;
  /** The database's default template, or null. */
  defaultTemplate: string | null;
  /** One entry from this template (null: none of them — the folder and type rules decide). */
  onCreate: (templatePath: string | null) => void;
  onSetDefault: (templatePath: string | null) => void;
  onCreateTemplate?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ScopedTemplateItem[] | null>(null);
  const [folder, setFolder] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Bumped after an assignment so the sheet reads the templates again and a row changes its group.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    loadScopedTemplates(vault)
      .then((loaded) => {
        if (!alive) return;
        setFolder(loaded.folder);
        setItems(loaded.items);
        setLoadError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setItems([]);
        setLoadError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [vault, tick]);

  const toggleAssign = async (templatePath: string, assign: boolean) => {
    try {
      await setTemplateAssignment(vault, templatePath, basePath, assign);
    } catch (e) {
      // Said with its reason, as a property write says it; the sheet reads the template again and shows what it holds.
      toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) }));
    }
    setTick((n) => n + 1);
  };

  const groups = groupTemplatesForBase(items ?? [], basePath, defaultTemplate);

  const row = (tpl: ScopedTemplateItem | null, title: string) => {
    const path = tpl?.path ?? null;
    const isDefault = defaultTemplate === path;
    const assigned = tpl ? templateMatchesBase(tpl.templateFor, basePath) : false;
    const assignLabel = assigned ? t("database.unassignTemplate") : t("database.assignTemplate");
    const defaultLabel = isDefault ? t("database.isDefaultTemplate") : t("database.setDefaultTemplate");
    return (
      <div className="m-row m-row--split" data-testid={`base-template-${path ?? "none"}`} key={path ?? "__none__"}>
        <button
          className="m-row-main"
          onClick={() => {
            onClose();
            onCreate(path);
          }}
        >
          <span>{title}</span>
        </button>
        {tpl && (
          <IconButton active={assigned} label={assignLabel} data-testid="base-template-assign" onClick={() => void toggleAssign(tpl.path, !assigned)}>
            <Database size={ICON.head} fill={assigned ? "currentColor" : "none"} />
          </IconButton>
        )}
        <IconButton active={isDefault} label={defaultLabel} data-testid="base-template-default" onClick={() => onSetDefault(path)}>
          <Star size={ICON.head} fill={isDefault ? "currentColor" : "none"} />
        </IconButton>
      </div>
    );
  };

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("database.templatesSection")}</p>
        {row(null, t("database.noTemplate"))}
        {groups.forBase.map((tpl) => row(tpl, tpl.title))}
        {items !== null && items.length > 0 && groups.forBase.length === 0 && <p className="m-hint">{t("database.noAssignedTemplates")}</p>}
        {loadError && (
          <p className="m-hint" data-testid="templates-error">
            {t("common.loadFailed", { message: loadError })}
          </p>
        )}
        {items !== null && !loadError && items.length === 0 && <p className="m-hint">{t("database.noTemplatesFound", { folder })}</p>}
        {groups.others.length > 0 && !showAll && (
          <button className="m-row" aria-expanded={false} onClick={() => setShowAll(true)}>
            <ChevronRight size={ICON.head} />
            <span>{t("database.showAllTemplates", { n: groups.others.length })}</span>
          </button>
        )}
        {groups.others.length > 0 && showAll && (
          <>
            <p className="m-hint">{t("database.allTemplatesSection")}</p>
            {groups.others.map((tpl) => row(tpl, tpl.title))}
          </>
        )}
        {onCreateTemplate && (
          <button
            className="m-row"
            data-testid="template-create"
            onClick={() => {
              onClose();
              onCreateTemplate();
            }}
          >
            <FilePlus2 size={ICON.head} />
            <span>{t("database.createTemplate")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
