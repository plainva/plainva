import { useEffect, useState } from "react";
import { SheetGrip } from "./SheetGrip";
import { useTranslation } from "react-i18next";
import { ChevronRight, CornerLeftUp, Folder } from "lucide-react";

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
  onPick,
  onClose,
}: {
  title: string;
  listFolders: (path: string) => Promise<string[]>;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
