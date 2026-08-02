import { useEffect, useState } from "react";
import { SheetGrip } from "./SheetGrip";
import { useTranslation } from "react-i18next";
import { ChevronRight, CornerLeftUp, Folder } from "lucide-react";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { Button, ICON } from "@plainva/ui";

/**
 * Vault-internal folder picker (R3.3): level-by-level navigation over the
 * live folder listing — the mobile sibling of the desktop folder picker.
 * Used by the path settings (P6) and the .base source editor (P7).
 */
export function FolderPickerSheet({
  vault,
  title,
  onPick,
  onClose,
}: {
  vault: MobileVault;
  title: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [folders, setFolders] = useState<string[]>([]);

  useEffect(() => {
    let stale = false;
    void vaultOps.listFolder(vault, path).then((l) => {
      if (!stale) setFolders(l.folders.map((x) => x.name));
    });
    return () => {
      stale = true;
    };
  }, [vault, path]);

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        <p className="m-hint m-hint--inset">/{path}</p>
        {path && (
          <button
            className="m-row"
            onClick={() => setPath(path.split("/").slice(0, -1).join("/"))}
          >
            <CornerLeftUp size={ICON.head} />
            <span>{t("webDavPicker.goUp")}</span>
          </button>
        )}
        {folders.length === 0 && <p className="m-hint m-hint--inset">{t("webDavPicker.emptyFolder")}</p>}
        {folders.map((name) => (
          <button
            className="m-row"
            key={name}
            onClick={() => setPath(path ? `${path}/${name}` : name)}
          >
            <Folder className="m-accent" size={ICON.head} />
            <span>{name}</span>
            <ChevronRight className="m-chevron" size={ICON.head} />
          </button>
        ))}
        <div className="m-btnrow">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onPick(path);
              onClose();
            }}
          >
            {t("webDavPicker.useFolder")}
          </Button>
        </div>
      </div>
    </div>
  );
}
