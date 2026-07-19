import React, { useState, useEffect } from "react";
import { fetch } from "@tauri-apps/plugin-http";
import { Folder, CornerLeftUp, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON, Modal } from "@plainva/ui";
import { Button } from "@plainva/ui";

interface WebDavFolderPickerModalProps {
  initialUrl: string;
  user: string;
  pass: string;
  onSelect: (url: string) => void;
  onCancel: () => void;
}

export const WebDavFolderPickerModal: React.FC<WebDavFolderPickerModalProps> = ({ initialUrl, user, pass, onSelect, onCancel }) => {
  const { t } = useTranslation();
  const [currentNavPath, setCurrentNavPath] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchFolders = async (targetUrl: string) => {
    try {
      setError(null);
      setLoading(true);
      const auth = btoa(`${user}:${pass}`);
      if (!targetUrl.endsWith("/")) targetUrl += "/";

      const res = await fetch(targetUrl, {
        method: "PROPFIND",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Depth": "1"
        }
      });

      if (!res.ok) {
        setError(`Connection failed: ${res.status} ${res.statusText}`);
        setLoading(false);
        setCurrentNavPath(null);
        return;
      }

      const xml = await res.text();
      const responseRegex = /<[a-z0-9:]*response>[\s\S]*?<\/[a-z0-9:]*response>/gi;
      const hrefRegex = /<[a-z0-9:]*href>(.*?)<\/[a-z0-9:]*href>/i;
      const isCollectionRegex = /<[a-z0-9:]*collection\s*\/>/i;

      const subfolders: string[] = [];
      let match;
      const basePath = new URL(targetUrl).pathname;

      while ((match = responseRegex.exec(xml)) !== null) {
        const respStr = match[0];
        // Ensure it's strictly a collection (folder)
        if (!isCollectionRegex.test(respStr)) continue;

        const hrefMatch = hrefRegex.exec(respStr);
        if (hrefMatch) {
          let href = decodeURI(hrefMatch[1]);
          const cleanHref = href.endsWith("/") ? href : href + "/";
          const cleanBase = basePath.endsWith("/") ? basePath : basePath + "/";

          if (cleanHref !== cleanBase && cleanHref.startsWith(cleanBase)) {
            subfolders.push(href);
          }
        }
      }

      setFolders(subfolders);
      setCurrentNavPath(targetUrl);
      setLoading(false);
    } catch (e: any) {
      setError(`Error: ${e instanceof Error ? e.message : (e?.message || String(e))}`);
      setLoading(false);
      setCurrentNavPath(null);
    }
  };

  useEffect(() => {
    fetchFolders(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  const handleSelectFolder = async (folderHref: string) => {
    if (!currentNavPath) return;
    const origin = new URL(currentNavPath).origin;
    await fetchFolders(origin + folderHref);
  };

  const handleGoUp = async () => {
    if (!currentNavPath) return;
    const urlObj = new URL(currentNavPath);
    let path = urlObj.pathname;
    if (path.endsWith("/")) path = path.slice(0, -1);
    const parts = path.split('/');
    parts.pop();
    const parentPath = parts.length > 0 ? parts.join('/') : '/';
    await fetchFolders(urlObj.origin + parentPath + "/");
  };

  const getBasename = (href: string) => {
    let clean = href.endsWith("/") ? href.slice(0, -1) : href;
    return clean.split('/').pop() || clean;
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
            icon={<Check size={ICON.ui} />}
            disabled={!currentNavPath}
            onClick={() => { if (currentNavPath) onSelect(currentNavPath); }}
          >
            {t("webDavPicker.useFolder")}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", height: "min(52vh, 520px)" }}>
        {error && (
          <div style={{ padding: "var(--space-2)", background: "var(--error-bg)", color: "var(--error-text)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-md)" }}>
            {error}
          </div>
        )}

        {loading && <div>{t("webDavPicker.loading")}</div>}

        {!loading && currentNavPath && (
          <>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", wordBreak: "break-all", background: "var(--bg-secondary)", padding: "var(--space-2)", borderRadius: "var(--radius-sm)" }}>
              {currentNavPath}
            </div>
            <div style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", background: "var(--bg-secondary)", overflowY: "auto", flex: 1 }}>
              <div
                onClick={handleGoUp}
                className="pv-rowhover"
                style={rowStyle}
              >
                <CornerLeftUp size={ICON.ui} color="var(--text-muted)" />
                <span style={{ color: "var(--text-muted)" }}>{t("webDavPicker.goUp")}</span>
              </div>

              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {folders.map(f => (
                  <li
                    key={f}
                    onClick={() => handleSelectFolder(f)}
                    className="pv-rowhover"
                    style={rowStyle}
                  >
                    <Folder size={ICON.ui} color="var(--accent-color)" />
                    {getBasename(f)}
                  </li>
                ))}
                {folders.length === 0 && (
                  <div style={{ padding: "var(--space-4)", color: "var(--text-muted)", textAlign: "center", fontSize: "var(--text-md)" }}>
                    {t("webDavPicker.emptyFolder")}
                  </div>
                )}
              </ul>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
