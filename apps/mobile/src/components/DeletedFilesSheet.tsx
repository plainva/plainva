import { useEffect, useState } from "react";
import { SheetGrip } from "../components/SheetGrip";
import { useTranslation } from "react-i18next";
import { FileClock } from "lucide-react";
import { VersionHistoryService, type OrphanedBackupGroup } from "@plainva/core";
import { toast } from "@plainva/ui";
import { mConfirm } from "../services/mobileDialogs";
import { syncSoon } from "../services/syncService";
import type { MobileVault } from "../services/vaultService";

/**
 * "Restore deleted files" (package G, mockup 8 caption): backups outlive
 * their notes — this lists backup groups whose original no longer exists
 * and restores the newest snapshot through the sync chain.
 */
export function DeletedFilesSheet({ vault, onClose }: { vault: MobileVault; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [groups, setGroups] = useState<OrphanedBackupGroup[] | null>(null);
  const [scanned, setScanned] = useState(0);

  useEffect(() => {
    let stale = false;
    const service = new VersionHistoryService(vault.adapter);
    void service
      .listOrphans({ onProgress: (n) => !stale && setScanned(n) })
      .then((list) => {
        if (!stale) setGroups(list);
      })
      .catch(() => {
        if (!stale) setGroups([]);
      });
    return () => {
      stale = true;
    };
  }, [vault]);

  const restore = (g: OrphanedBackupGroup) => {
    void (async () => {
      const ok = await mConfirm({
        title: t("versions.deletedTitle"),
        message: g.originalPath,
        confirmLabel: t("versions.restore"),
      });
      if (!ok) return;
      const service = new VersionHistoryService(vault.adapter);
      await service.restoreVersion({
        backupPath: g.versions[0].backupPath,
        targetPath: g.originalPath,
        writeAdapter: vault.files,
      });
      try {
        await vault.indexer?.indexFile(await vault.adapter.getFileInfo(g.originalPath));
      } catch {
        /* next full pass repairs it */
      }
      syncSoon();
      toast.info(g.originalPath);
      window.dispatchEvent(new CustomEvent("m-vault-changed"));
      setGroups((prev) => (prev ?? []).filter((x) => x !== g));
    })();
  };

  const when = (ts: number) => new Date(ts).toLocaleString(i18n.language);

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("versions.deletedTitle")}</p>
        <p className="m-hint m-hint--inset">{t("versions.deletedHint")}</p>
        {groups === null && (
          <p className="m-hint m-hint--inset">{t("versions.scanning", { scanned })}</p>
        )}
        {groups !== null && groups.length === 0 && (
          <p className="m-hint m-hint--inset">{t("versions.deletedEmpty")}</p>
        )}
        {(groups ?? []).map((g) => (
          <button className="m-row" key={g.originalPath} onClick={() => restore(g)}>
            <FileClock className="m-accent" size={18} />
            <span className="m-row-txt">
              <b>{g.originalPath}</b>
              <span>{t("versions.deletedMeta", {
                when: when(g.versions[0].timestamp),
                versions: g.versions.length,
                size: Math.max(1, Math.round(g.versions[0].size / 1024)) + " KB",
              })}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
