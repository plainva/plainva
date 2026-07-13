import { useEffect, useState } from "react";
import { SheetGrip } from "./SheetGrip";
import { useTranslation } from "react-i18next";
import { ChevronRight, CornerLeftUp, Folder, FolderPlus } from "lucide-react";

/**
 * Cloud folder picker (#10): level-by-level navigation over a provider's remote
 * folders at connect time — the mobile sibling of the desktop sync folder
 * picker. Fed by a `listFolders(path)` built from the fresh credentials
 * (Drive/OneDrive/Dropbox after OAuth, S3 from the form). Keep `listFolders`
 * stable (useCallback) so navigation doesn't re-fetch on every render.
 */
export function CloudFolderPickerSheet({
  title,
  listFolders,
  createFolder,
  onPick,
  onClose,
}: {
  title: string;
  listFolders: (path: string) => Promise<string[]>;
  /**
   * Optional "new folder" row (2026-07-13): creates the folder at the current
   * level and descends into it — the create-online-vault flow relies on it.
   */
  createFolder?: (path: string) => Promise<void>;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreateFolder = async () => {
    if (!createFolder) return;
    const name = newName.trim();
    if (!name) return;
    if (folders.some((f) => f.toLowerCase() === name.toLowerCase())) {
      setCreateError(t("webDavPicker.folderExists"));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const next = path ? `${path}/${name}` : name;
      await createFolder(next);
      setNewName("");
      setPath(next); // descend: the fresh folder is the selection
    } catch (e) {
      setCreateError(String(e instanceof Error ? e.message : e));
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    void listFolders(path)
      .then((l) => { if (!stale) setFolders(l); })
      .catch((e) => { if (!stale) setError(String(e instanceof Error ? e.message : e)); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [path, listFolders]);

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        <p className="m-hint m-hint--inset">/{path}</p>
        {path && (
          <button className="m-row" onClick={() => setPath(path.split("/").slice(0, -1).join("/"))}>
            <CornerLeftUp size={18} />
            <span>{t("webDavPicker.goUp")}</span>
          </button>
        )}
        {error && <p className="m-sync-error">{error}</p>}
        {loading && <p className="m-hint m-hint--inset">{t("common.loading")}</p>}
        {!loading && !error && folders.length === 0 && (
          <p className="m-hint m-hint--inset">{t("webDavPicker.emptyFolder")}</p>
        )}
        {folders.map((name) => (
          <button className="m-row" key={name} onClick={() => setPath(path ? `${path}/${name}` : name)}>
            <Folder className="m-accent" size={18} />
            <span>{name}</span>
            <ChevronRight className="m-chevron" size={18} />
          </button>
        ))}
        {createFolder && !loading && !error && (
          <>
            <div className="m-sheet-inputrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <FolderPlus className="m-accent" size={18} style={{ flexShrink: 0 }} />
              <input
                className="m-searchfield"
                style={{ flex: 1, minWidth: 0 }}
                placeholder={t("webDavPicker.newFolder")}
                value={newName}
                disabled={creating}
                onChange={(e) => {
                  // Names only — a slash would create a chain the level-by-level
                  // descend cannot follow.
                  setNewName(e.target.value.replace(/[/\\]/g, ""));
                  setCreateError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreateFolder();
                }}
              />
              <button
                className="m-btn m-btn--filled"
                disabled={creating || newName.trim().length === 0}
                onClick={() => void handleCreateFolder()}
              >
                {t("webDavPicker.createFolder")}
              </button>
            </div>
            {createError && <p className="m-sync-error">{createError}</p>}
          </>
        )}
        <div className="m-btnrow">
          <button className="m-btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="m-btn m-btn--filled" onClick={() => onPick(path)}>
            {t("webDavPicker.useFolder")}
          </button>
        </div>
      </div>
    </div>
  );
}
