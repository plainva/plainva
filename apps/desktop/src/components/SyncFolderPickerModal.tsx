import React, { useCallback, useEffect, useState } from "react";
import { Folder, CornerLeftUp, Check } from "lucide-react";
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
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export const SyncFolderPickerModal: React.FC<SyncFolderPickerModalProps> = ({
  listFolders,
  rootLabel,
  allowRoot = false,
  onSelect,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [segments, setSegments] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      </div>
    </Modal>
  );
};
