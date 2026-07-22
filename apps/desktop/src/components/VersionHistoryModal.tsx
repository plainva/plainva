import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, Copy } from "lucide-react";
import { appConfirm } from "../services/appDialogs";
import { ICON, Modal } from "@plainva/ui";
import { Button } from "@plainva/ui";
import { Checkbox } from "@plainva/ui";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { format } from "date-fns";
import { VersionHistoryService, isTextLikePath, type FileVersion } from "@plainva/core";
import { useVault } from "../contexts/VaultContext";
import { requestSaveFlush } from "../services/saveFlush";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif",
};

const extOf = (path: string): string => {
  const name = path.split(/[/\\]/).pop() || "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Per-file version history over the `.plainva/backups` snapshots
 * (Gesamtplan Backups & Versionierung 2026-07-05, P5): list + preview/diff
 * against the current content, restore in place or as a copy. In orphan mode
 * (deleted files) there is no current content, so no diff — restoring
 * recreates the file at its original path.
 */
export const VersionHistoryModal: React.FC<{
  path: string;
  orphan?: boolean;
  onClose: () => void;
  onRestored?: (restoredPath: string) => void;
}> = ({ path, orphan = false, onClose, onRestored }) => {
  const { t, i18n } = useTranslation();
  const { vaultAdapter, backupAdapter, indexer, triggerFileTreeUpdate, workspaceSecurityStatus, listWorkspaceRevisions, readWorkspaceRevision } = useVault();
  const workspaceHistory = workspaceSecurityStatus !== null;

  const basename = path.split(/[/\\]/).pop() || path;
  const isText = isTextLikePath(path);
  const isImage = IMAGE_EXTS.has(extOf(path));

  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [selected, setSelected] = useState<FileVersion | null>(null);
  const [currentText, setCurrentText] = useState<string | null>(null);
  const [versionText, setVersionText] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(isText && !orphan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const diffHostRef = useRef<HTMLDivElement>(null);

  const service = useMemo(
    () => (vaultAdapter ? new VersionHistoryService(vaultAdapter) : null),
    [vaultAdapter]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load the version list once.
  useEffect(() => {
    let alive = true;
    if (!service && !workspaceHistory) return;
    (workspaceHistory
      ? listWorkspaceRevisions(path).then((list) => (list ?? []).map((revision) => ({ backupPath: `workspace:${revision.revisionId}`, timestamp: Date.parse(revision.createdAt ?? "1970-01-01T00:00:00.000Z"), size: 0 })))
      : service!.listVersions(path))
      .then((list) => {
        if (!alive) return;
        setVersions(list);
        setSelected(list[0] ?? null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [service, path, workspaceHistory, listWorkspaceRevisions]);

  // Current content for the diff (skipped for orphans/binaries).
  useEffect(() => {
    let alive = true;
    if (!vaultAdapter || orphan || !isText) return;
    vaultAdapter
      .readTextFile(path)
      .then((text) => alive && setCurrentText(text.replace(/\r\n/g, "\n")))
      .catch(() => alive && setCurrentText(null));
    return () => {
      alive = false;
    };
  }, [vaultAdapter, path, orphan, isText]);

  // Selected version content (text or image blob).
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setVersionText(null);
    setImageUrl(null);
    if ((!service && !workspaceHistory) || !selected) return;
    const readBytes = () => workspaceHistory
      ? readWorkspaceRevision(selected.backupPath.slice("workspace:".length))
      : service!.readVersionBinary(selected.backupPath);
    if (isText) {
      (workspaceHistory ? readBytes().then((bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes)) : service!.readVersionText(selected.backupPath))
        .then((text) => alive && setVersionText(text.replace(/\r\n/g, "\n")))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    } else if (isImage) {
      readBytes()
        .then((bytes) => {
          if (!alive) return;
          url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: IMAGE_MIME[extOf(path)] || "application/octet-stream" }));
          setImageUrl(url);
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    }
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [service, selected, isText, isImage, path, workspaceHistory, readWorkspaceRevision]);

  // Side-by-side diff: selected version (left) vs current content (right).
  useEffect(() => {
    const host = diffHostRef.current;
    if (!host || !showDiff || versionText === null || currentText === null) return;
    const readOnly = [EditorView.editable.of(false), EditorState.readOnly.of(true), EditorView.lineWrapping];
    const view = new MergeView({
      a: { doc: versionText, extensions: readOnly },
      b: { doc: currentText, extensions: readOnly },
      parent: host,
    });
    return () => view.destroy();
  }, [showDiff, versionText, currentText]);

  const dayLabel = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: "full" }),
    [i18n.language]
  );
  const timeLabel = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { timeStyle: "medium" }),
    [i18n.language]
  );

  const grouped = useMemo(() => {
    const groups: { day: string; items: FileVersion[] }[] = [];
    for (const v of versions ?? []) {
      const day = dayLabel.format(new Date(v.timestamp));
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(v);
      else groups.push({ day, items: [v] });
    }
    return groups;
  }, [versions, dayLabel]);

  const finishRestore = async (targetPath: string, size: number) => {
    if (isTextLikePath(targetPath) && vaultAdapter) {
      // Hand the restored content to any open editor, bypassing its dirty guard.
      const text = await vaultAdapter.readTextFile(targetPath);
      window.dispatchEvent(new CustomEvent("plainva-file-restored", { detail: { path: targetPath, content: text.replace(/\r\n/g, "\n") } }));
    }
    await indexer?.indexFile({
      path: targetPath,
      name: targetPath.split(/[/\\]/).pop() || targetPath,
      isDirectory: false,
      mtime: Date.now(),
      size,
    }).catch(() => {});
    triggerFileTreeUpdate();
  };

  const doRestore = async () => {
    if ((!service && !workspaceHistory) || !selected || !vaultAdapter) return;
    const ok = await appConfirm({
      title: t("versions.restoreConfirmTitle", { defaultValue: "Restore version" }),
      message: t("versions.restoreConfirmMsg", {
        defaultValue: "Replace the current content of \"{{name}}\" with the version from {{when}}? The current state is saved as a snapshot first.",
        name: basename,
        when: `${dayLabel.format(new Date(selected.timestamp))} ${timeLabel.format(new Date(selected.timestamp))}`,
      }),
      kind: "warning",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      if (!orphan) await requestSaveFlush(path);
      if (workspaceHistory) {
        const bytes = await readWorkspaceRevision(selected.backupPath.slice("workspace:".length));
        if (!orphan) await backupAdapter?.forceBackup(path);
        if (isTextLikePath(path)) await vaultAdapter.writeTextFile(path, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        else await vaultAdapter.writeBinaryFile(path, bytes);
      } else await service!.restoreVersion({
          backupPath: selected.backupPath,
          targetPath: path,
          writeAdapter: vaultAdapter,
          beforeWrite: orphan ? undefined : async () => { await backupAdapter?.forceBackup(path); },
        });
      await finishRestore(path, selected.size);
      onRestored?.(path);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doRestoreAsCopy = async () => {
    if ((!service && !workspaceHistory) || !selected || !vaultAdapter) return;
    setBusy(true);
    setError(null);
    try {
      const dot = basename.lastIndexOf(".");
      const stem = dot > 0 ? basename.slice(0, dot) : basename;
      const ext = dot > 0 ? basename.slice(dot) : "";
      const dir = path.slice(0, path.length - basename.length);
      const stamp = format(new Date(selected.timestamp), "yyyy-MM-dd HH-mm");
      let candidate = `${dir}${stem} (Version ${stamp})${ext}`;
      let n = 2;
      while (await vaultAdapter.exists(candidate)) {
        candidate = `${dir}${stem} (Version ${stamp} ${n})${ext}`;
        n++;
      }
      if (workspaceHistory) {
        const bytes = await readWorkspaceRevision(selected.backupPath.slice("workspace:".length));
        if (isTextLikePath(candidate)) await vaultAdapter.writeTextFile(candidate, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        else await vaultAdapter.writeBinaryFile(candidate, bytes);
      } else await service!.restoreVersion({ backupPath: selected.backupPath, targetPath: candidate, writeAdapter: vaultAdapter });
      await finishRestore(candidate, selected.size);
      setNotice(t("versions.copyCreated", { defaultValue: "Copy created: {{path}}", path: candidate }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const canDiff = isText && !orphan && currentText !== null;

  return (
    <Modal
      onClose={() => { if (!busy) onClose(); }}
      title={t("versions.title", { defaultValue: "Version history" })}
      size="xl"
      testId="version-history-modal"
      closeOnOverlay={!busy}
      bodyClassName="pv-modal-body--flush"
    >
        <div style={{ padding: "0.45rem 1rem", fontSize: "var(--text-sm)", color: "var(--text-muted)", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-color)", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-tip={path}>
          {path}
          {orphan && <> — {t("versions.orphanHint", { defaultValue: "This file no longer exists in the vault. Restoring recreates it at its original location." })}</>}
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Version list */}
          <div className="custom-scrollbar" style={{ width: "250px", flexShrink: 0, overflowY: "auto", borderRight: "1px solid var(--border-color)", background: "var(--bg-secondary)", padding: "0.5rem" }}>
            {versions === null && <div style={{ padding: "0.6rem", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>{t("versions.loading", { defaultValue: "Loading versions…" })}</div>}
            {versions !== null && versions.length === 0 && (
              <div style={{ padding: "0.6rem", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>{t("versions.empty", { defaultValue: "No saved versions yet. Snapshots are created automatically as you edit." })}</div>
            )}
            {grouped.map((group) => (
              <div key={group.day} style={{ marginBottom: "0.4rem" }}>
                <div style={{ padding: "0.35rem 0.4rem 0.2rem", fontSize: "var(--text-sm)", textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--text-faint)" }}>{group.day}</div>
                {group.items.map((v) => {
                  const isSel = selected?.backupPath === v.backupPath;
                  return (
                    <button
                      key={v.backupPath}
                      data-testid="version-item"
                      onClick={() => setSelected(v)}
                      style={{
                        display: "flex", alignItems: "baseline", gap: "0.5rem", width: "100%", textAlign: "left",
                        padding: "0.4rem 0.5rem", borderRadius: "var(--radius-sm)", cursor: "pointer",
                        border: "1px solid " + (isSel ? "var(--accent-color)" : "transparent"),
                        background: isSel ? "var(--bg-hover)" : "transparent", color: "var(--text-main)",
                      }}
                    >
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{timeLabel.format(new Date(v.timestamp))}</span>
                      <span style={{ marginLeft: "auto", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{formatBytes(v.size)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Content pane */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.9rem", borderBottom: "1px solid var(--border-color)", flexShrink: 0, flexWrap: "wrap" }}>
              {canDiff && (
                <Checkbox checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)}>
                  {t("versions.diffToggle", { defaultValue: "Compare with current" })}
                </Checkbox>
              )}
              <div style={{ flex: 1 }} />
              <Button
                size="sm"
                icon={<Copy size={ICON.ui} />}
                data-testid="version-restore-copy"
                onClick={doRestoreAsCopy}
                disabled={busy || !selected}
              >
                {t("versions.restoreAsCopy", { defaultValue: "Restore as copy" })}
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<RotateCcw size={ICON.ui} />}
                data-testid="version-restore"
                onClick={doRestore}
                disabled={busy || !selected}
              >
                {t("versions.restore", { defaultValue: "Restore" })}
              </Button>
            </div>

            {(error || notice) && (
              <div style={{ padding: "0.4rem 0.9rem", fontSize: "var(--text-sm)", flexShrink: 0, color: error ? "var(--error-text)" : "var(--text-muted)", borderBottom: "1px solid var(--border-color)" }}>
                {error || notice}
              </div>
            )}

            <div className="custom-scrollbar" style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg-primary)" }}>
              {selected && canDiff && showDiff ? (
                <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                  <div style={{ display: "flex", fontSize: "var(--text-sm)", color: "var(--text-faint)", padding: "0.3rem 0.9rem 0", gap: "0.5rem" }}>
                    <span style={{ flex: 1 }}>{t("versions.sideVersion", { defaultValue: "Selected version" })}</span>
                    <span style={{ flex: 1 }}>{t("versions.sideCurrent", { defaultValue: "Current content" })}</span>
                  </div>
                  <div ref={diffHostRef} data-testid="version-diff-host" className="pv-merge-host" style={{ flex: 1, minHeight: 0 }} />
                </div>
              ) : selected && isText && versionText !== null ? (
                <pre data-testid="version-preview" style={{ margin: 0, padding: "0.8rem 1rem", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-content)", fontSize: "var(--text-md)", lineHeight: 1.5 }}>{versionText}</pre>
              ) : selected && isImage && imageUrl ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", height: "100%" }}>
                  <img src={imageUrl} alt={basename} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                </div>
              ) : selected ? (
                <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>
                  {t("versions.binaryNoPreview", { defaultValue: "No preview for this file type." })}{" "}
                  ({formatBytes(selected.size)})
                </div>
              ) : null}
            </div>
          </div>
        </div>
    </Modal>
  );
};
