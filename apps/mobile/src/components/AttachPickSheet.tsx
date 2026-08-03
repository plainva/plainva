import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CornerLeftUp, File as FileIcon, Folder } from "lucide-react";
import { ICON } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import type { MobileVault } from "../services/vaultService";

/**
 * Picking a file to attach to a message (S28).
 *
 * On a phone the vault IS the filesystem the user can reach — there is no
 * desktop file dialog, and everything that arrives on the device (a saved
 * attachment, a photo inserted into a note) already lands there. So the picker
 * browses the vault rather than asking the platform for an arbitrary path.
 *
 * Unlike the folder and template pickers it lists EVERY file, not just `.md`:
 * the whole point is attaching the PDF or the image.
 */
export function AttachPickSheet({
  vault,
  onPick,
  onClose,
}: {
  vault: MobileVault;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<Array<{ name: string; path: string }>>([]);

  useEffect(() => {
    let stale = false;
    void vault.files
      .listDir(path)
      .then((entries) => {
        if (stale) return;
        setFolders(
          entries
            .filter((e) => e.isDirectory && !e.name.startsWith("."))
            .map((e) => e.name)
            .sort(),
        );
        setFiles(
          entries
            .filter((e) => !e.isDirectory && !e.name.startsWith("."))
            .map((e) => ({ name: e.name, path: e.path }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => {
        if (!stale) {
          setFolders([]);
          setFiles([]);
        }
      });
    return () => {
      stale = true;
    };
  }, [vault, path]);

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("mail.attachFile")}</p>
        <p className="m-hint m-hint--inset">/{path}</p>
        {path && (
          <button className="m-row" onClick={() => setPath(path.split("/").slice(0, -1).join("/"))} type="button">
            <CornerLeftUp size={ICON.head} />
            <span>{t("webDavPicker.goUp")}</span>
          </button>
        )}
        {folders.length === 0 && files.length === 0 && (
          <p className="m-hint m-hint--inset">{t("webDavPicker.emptyFolder")}</p>
        )}
        {folders.map((name) => (
          <button
            className="m-row"
            key={`d:${name}`}
            onClick={() => setPath(path ? `${path}/${name}` : name)}
            type="button"
          >
            <Folder className="m-accent" size={ICON.head} />
            <span>{name}</span>
          </button>
        ))}
        {files.map((f) => (
          <button className="m-row" key={f.path} onClick={() => onPick(f.path)} type="button">
            <FileIcon size={ICON.head} />
            <span>{f.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
