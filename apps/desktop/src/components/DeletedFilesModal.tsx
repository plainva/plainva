import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, History } from "lucide-react";
import { VersionHistoryService, type OrphanedBackupGroup } from "@plainva/core";
import { useVault } from "../contexts/VaultContext";
import { formatBytes } from "./VersionHistoryModal";
import { Modal } from "@plainva/ui";
import { Button } from "@plainva/ui";

/**
 * Vault-wide recovery of deleted files (Gesamtplan Backups & Versionierung
 * 2026-07-05, P6): lists snapshot groups whose original file no longer exists.
 * Restore recreates the newest snapshot at the original path (parent folders
 * included); "Versions…" jumps into the per-file history in orphan mode.
 * Files removed via a recursive FOLDER delete have no fresh pre-delete
 * snapshot — the OS trash stays the primary recovery for those.
 */
export const DeletedFilesModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t, i18n } = useTranslation();
  const { vaultAdapter, indexer, triggerFileTreeUpdate } = useVault();

  const [groups, setGroups] = useState<OrphanedBackupGroup[] | null>(null);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const service = useMemo(
    () => (vaultAdapter ? new VersionHistoryService(vaultAdapter) : null),
    [vaultAdapter]
  );

  useEffect(() => {
    if (!service) return;
    const controller = new AbortController();
    abortRef.current = controller;
    service
      .listOrphans({ signal: controller.signal, onProgress: setScanned })
      .then((result) => setGroups(result))
      .catch((e) => {
        if ((e as Error)?.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
        setGroups([]);
      });
    return () => controller.abort();
  }, [service]);

  const when = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
    [i18n.language]
  );

  const restore = async (group: OrphanedBackupGroup) => {
    if (!service || !vaultAdapter) return;
    setBusyPath(group.originalPath);
    setError(null);
    try {
      const newest = group.versions[0];
      await service.restoreVersion({ backupPath: newest.backupPath, targetPath: group.originalPath, writeAdapter: vaultAdapter });
      await indexer?.indexFile({
        path: group.originalPath,
        name: group.originalPath.split(/[/\\]/).pop() || group.originalPath,
        isDirectory: false,
        mtime: Date.now(),
        size: newest.size,
      }).catch(() => {});
      triggerFileTreeUpdate();
      setGroups((prev) => (prev ?? []).filter((g) => g.originalPath !== group.originalPath));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyPath(null);
    }
  };

  const openVersions = (group: OrphanedBackupGroup) => {
    window.dispatchEvent(
      new CustomEvent("plainva-show-version-history", { detail: { path: group.originalPath, orphan: true } })
    );
    onClose();
  };

  return (
    <Modal
      onClose={() => { if (!busyPath) onClose(); }}
      title={t("versions.deletedTitle", { defaultValue: "Restore deleted files" })}
      size="lg"
      testId="deleted-files-modal"
      closeOnOverlay={!busyPath}
      bodyClassName="pv-deleted-files-body"
    >
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginBottom: "var(--space-3)" }}>
        {t("versions.deletedHint", { defaultValue: "Every deletion in Plainva saves a snapshot first. Files removed by deleting a whole folder may only have older snapshots — the system trash is the primary recovery for those." })}
      </div>

      {error && (
        <div style={{ marginBottom: "var(--space-2)", fontSize: "var(--text-sm)", color: "var(--error-text)" }}>{error}</div>
      )}

      {groups === null && (
        <div style={{ padding: "var(--space-5)", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>
          {t("versions.scanning", { defaultValue: "Scanning snapshots… ({{scanned}} checked)", scanned })}
        </div>
      )}
      {groups !== null && groups.length === 0 && (
        <div style={{ padding: "var(--space-5)", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>
          {t("versions.deletedEmpty", { defaultValue: "No recoverable deleted files found." })}
        </div>
      )}
      {(groups ?? []).map((group) => {
        const newest = group.versions[0];
        const busy = busyPath === group.originalPath;
        return (
          <div
            key={group.originalPath}
            data-testid="deleted-file-row"
            style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "var(--space-2) 0", borderBottom: "1px solid var(--border-color-light, var(--border-color))" }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--text-md)" }} title={group.originalPath}>{group.originalPath}</div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                {t("versions.deletedMeta", {
                  defaultValue: "{{when}} · {{versions}} versions · {{size}}",
                  when: when.format(new Date(newest.timestamp)),
                  versions: group.versions.length,
                  size: formatBytes(newest.size),
                })}
              </div>
            </div>
            <Button size="sm" icon={<History size={13} />} onClick={() => openVersions(group)} disabled={!!busyPath}>
              {t("versions.showVersions", { defaultValue: "Versions…" })}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<RotateCcw size={13} />}
              data-testid="deleted-file-restore"
              onClick={() => restore(group)}
              disabled={!!busyPath}
              style={{ opacity: busy ? 0.6 : 1 }}
            >
              {t("versions.restore", { defaultValue: "Restore" })}
            </Button>
          </div>
        );
      })}
    </Modal>
  );
};
