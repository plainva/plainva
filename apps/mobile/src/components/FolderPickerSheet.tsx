import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, CornerLeftUp, Folder } from "lucide-react";
import { vaultOps, type MobileVault } from "../services/vaultService";

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
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-grip" />
        <p className="m-sheet-title">{title}</p>
        <p className="m-hint m-hint--inset">/{path}</p>
        {path && (
          <button
            className="m-row"
            onClick={() => setPath(path.split("/").slice(0, -1).join("/"))}
          >
            <CornerLeftUp size={18} />
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
            <Folder className="m-accent" size={18} />
            <span>{name}</span>
            <ChevronRight className="m-chevron" size={18} />
          </button>
        ))}
        <div className="m-btnrow">
          <button className="m-btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className="m-btn m-btn--filled"
            onClick={() => {
              onPick(path);
              onClose();
            }}
          >
            {t("webDavPicker.useFolder")}
          </button>
        </div>
      </div>
    </div>
  );
}
