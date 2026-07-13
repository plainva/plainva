import { useEffect, useState } from "react";
import { SheetGrip } from "./SheetGrip";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { listTemplates, type TemplateItem } from "@plainva/ui";
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
  onClose,
}: {
  vault: MobileVault;
  title: string;
  onPick: (template: TemplateItem) => void;
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
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        {items !== null && items.length === 0 && (
          <p className="m-hint m-hint--inset">{t("database.noTemplatesFound", { folder })}</p>
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
            <FileText size={18} />
            <span>{item.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
