import { useEffect, useState } from "react";
import { SheetGrip } from "./SheetGrip";
import { useTranslation } from "react-i18next";
import { FilePlus2, FileText } from "lucide-react";
import { ICON, listTemplates, type TemplateItem } from "@plainva/ui";
import { getMobileSettings } from "../services/mobileSettings";
import type { MobileVault } from "../services/vaultService";

/**
 * Template chooser sheet (R3.4): lists the .md files of the configured
 * template folder (shared listTemplates contract — OKF reserved names never
 * appear). Used by the editor's "insert template" slash command and the
 * quick-create "new from template" flow.
 */
export function TemplatePickSheet({
  vault,
  title,
  onPick,
  onCreate,
  onClose,
}: {
  vault: MobileVault;
  title: string;
  onPick: (template: TemplateItem) => void;
  /** When given, the sheet offers creating a fresh template (parity gap
   *  template-authoring). Left out where creating one makes no sense — the
   *  editor inserts INTO a note and has nothing to seed a template with. */
  onCreate?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const folder = getMobileSettings().templateFolder;
  const [items, setItems] = useState<TemplateItem[] | null>(null);

  useEffect(() => {
    let stale = false;
    void listTemplates(vault.files, folder).then((list) => {
      if (!stale) setItems(list);
    });
    return () => {
      stale = true;
    };
  }, [vault, folder]);

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        {items !== null && items.length === 0 && (
          <p className="m-hint">{t("database.noTemplatesFound", { folder })}</p>
        )}
        {(items ?? []).map((item) => (
          <button
            className="m-row"
            key={item.path}
            onClick={() => {
              onClose();
              onPick(item);
            }}
          >
            <FileText size={ICON.head} />
            <span>{item.title}</span>
          </button>
        ))}
        {onCreate && (
          <button
            className="m-row"
            data-testid="template-create"
            onClick={() => {
              onClose();
              onCreate();
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
