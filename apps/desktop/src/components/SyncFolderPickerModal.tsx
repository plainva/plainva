import React, { useCallback, useEffect, useState } from "react";
import { Folder, FolderPlus, CornerLeftUp, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "@plainva/ui";
import { Button } from "@plainva/ui";

/**
 * Provider-agnostic remote-folder picker for the sync settings (2026-07-06):
 * Google Drive / OneDrive / Dropbox / S3 get the same "browse instead of
 * typing" flow WebDAV always had. The provider specifics live entirely in the
 * injected `listFolders` (the core adapters' ISyncTarget.listFolders); the
 * modal only walks names level by level. Click descends, the footer button
 * picks the CURRENT folder ("a/b/c" — no leading slash; the caller formats
 * provider-style).
 */
interface SyncFolderPickerModalProps {
  /** Child folder NAMES one level below `path` ("" = root). */
  listFolders: (path: string) => Promise<string[]>;
  /** Display label of the root level (bucket name, "OneDrive", …). */
  rootLabel: string;
  /** Whether the root itself is a valid pick (S3: empty prefix = bucket root). */
  allowRoot?: boolean;
  /**
   * Optional "new folder" row (2026-07-13): creates `path` at the current level
   * (the core adapters' ISyncTarget.createFolder) and descends into it, so the
   * fresh folder is the selection. The create-online-vault flow relies on it.
   */
  createFolder?: (path: string) => Promise<void>;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export const SyncFolderPickerModal: React.FC<SyncFolderPickerModalProps> = ({
  listFolders,
  rootLabel,
  allowRoot = false,
  createFolder,
  onSelect,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [segments, setSegments] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(
    async (next: string[]) => {
      setLoading(true);
      setError(null);
      try {
        const names = await listFolders(next.join("/"));
        setFolders(names);
        setSegments(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [listFolders]
  );

  useEffect(() => {
    void load([]);
  }, [load]);

  const currentPath = segments.join("/");
  const canUse = !loading && !error && (allowRoot || segments.length > 0);

  // "New folder" row (2026-07-13): create at the current level, then descend
  // into it — the fresh folder IS the selection the footer button confirms.
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
      await createFolder([...segments, name].join("/"));
      setNewName("");
      await load([...segments, name]);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const rowStyle: React.CSSProperties = {
    padding: "var(--space-2)", borderBottom: "1px solid var(--border-color)", cursor: "pointer",
    display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-md)",
  };

  return (
    <Modal
      onClose={onCancel}
      title={t("webDavPicker.title")}
      size="lg"
      footer={
        <>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            icon={<Check size={16} />}
            disabled={!canUse}
            onClick={() => onSelect(currentPath)}
          >
            {t("webDavPicker.useFolder")}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", height: "min(52vh, 520px)" }}>
        {error && (
          <div style={{ padding: "var(--space-2)", background: "var(--error-bg)", color: "var(--error-text)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-md)", overflowWrap: "anywhere" }}>
            {error}
          </div>
        )}

        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", wordBreak: "break-all", background: "var(--bg-secondary)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)" }}>
          {rootLabel}
          {currentPath ? ` / ${currentPath}` : ""}
        </div>

        {loading && <div>{t("webDavPicker.loading")}</div>}

        {!loading && !error && (
          <div style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", background: "var(--bg-secondary)", overflowY: "auto", flex: 1 }}>
            {segments.length > 0 && (
              <div
                onClick={() => void load(segments.slice(0, -1))}
                className="pv-rowhover"
                style={rowStyle}
              >
                <CornerLeftUp size={16} color="var(--text-muted)" />
                <span style={{ color: "var(--text-muted)" }}>{t("webDavPicker.goUp")}</span>
              </div>
            )}

            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {folders.map((name) => (
                <li
                  key={name}
                  onClick={() => void load([...segments, name])}
                  className="pv-rowhover"
                  style={rowStyle}
                >
                  <Folder size={16} color="var(--accent-color)" />
                  {name}
                </li>
              ))}
              {folders.length === 0 && (
                <div style={{ padding: "var(--space-4)", color: "var(--text-muted)", textAlign: "center", fontSize: "var(--text-md)" }}>
                  {t("webDavPicker.emptyFolder")}
                </div>
              )}
            </ul>
          </div>
        )}

        {createFolder && !loading && !error && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <FolderPlus size={16} color="var(--accent-color)" style={{ flexShrink: 0 }} />
              <input
                className="pv-field"
                style={{ flex: 1, minWidth: 0 }}
                placeholder={t("webDavPicker.newFolder")}
                value={newName}
                disabled={creating}
                onChange={(e) => {
                  // Names only — a slash would create a chain the descend below
                  // cannot follow level by level.
                  setNewName(e.target.value.replace(/[/\\]/g, ""));
                  setCreateError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreateFolder();
                }}
              />
              <Button
                disabled={creating || newName.trim().length === 0}
                onClick={() => void handleCreateFolder()}
              >
                {t("webDavPicker.createFolder")}
              </Button>
            </div>
            {createError && (
              <div style={{ marginTop: "4px", fontSize: "var(--text-sm)", color: "var(--error-text)", overflowWrap: "anywhere" }}>
                {createError}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
