import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, History } from "lucide-react";
import { VersionHistoryService, type FileVersion } from "@plainva/core";
import { Button, EmptyState, ICON, toast, versionCopyPath } from "@plainva/ui";
import { CompareVersions } from "./CompareVersions";
import { mConfirm } from "../services/mobileDialogs";
import { noteSaver, vaultOps, type MobileVault } from "../services/vaultService";
import { syncSoon } from "../services/syncService";

/**
 * Version history panel (M3E package G; mockup 8): every write already
 * snapshots into .plainva/backups through the shared BackupVaultAdapter —
 * this surfaces them on touch as a SEGMENT of the note context sheet.
 * Rows group by day and carry a size-delta badge against the previous
 * snapshot. A selected version opens in the ONE comparison surface
 * (feedback round 2026-09-01, P2): the note's current text on the left,
 * the saved version on the right — the same rule and the same words as
 * the desktop and the conflict sheet. Restore flushes pending saves first
 * and forces a pre-restore snapshot (the desktop's data-loss guard), then
 * writes through the sync chain.
 */
export function VersionsPanel({
  vault,
  path,
  onDone,
  onRestored,
}: {
  vault: MobileVault;
  path: string;
  /** Closes the hosting sheet (after a restore/copy). */
  onDone: () => void;
  onRestored: () => void;
}) {
  const { t, i18n } = useTranslation();
  const service = useMemo(() => new VersionHistoryService(vault.adapter), [vault]);
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [selected, setSelected] = useState<FileVersion | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [current, setCurrent] = useState<string>("");
  const [currentMtime, setCurrentMtime] = useState<number | null>(null);

  useEffect(() => {
    let stale = false;
    void service.listVersions(path).then((v) => {
      if (!stale) setVersions(v);
    });
    void vaultOps.read(vault, path).then((text) => {
      if (!stale) setCurrent(text.replace(/\r\n/g, "\n"));
    });
    void vault.adapter
      .getFileInfo(path)
      .then((info) => {
        if (!stale) setCurrentMtime(info.mtime);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [service, vault, path]);

  const open = (v: FileVersion) => {
    setSelected(v);
    setPreview(null);
    void service
      .readVersionText(v.backupPath)
      .then((text) => setPreview(text.replace(/\r\n/g, "\n")))
      .catch(() => setPreview(t("versions.binaryNoPreview")));
  };

  const whenLabel = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }), [i18n.language]);
  const when = (ts: number | null) => (ts === null ? "—" : whenLabel.format(ts));
  const timeOf = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" });
  const dayOf = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "long" });

  const doRestore = (v: FileVersion) => {
    void (async () => {
      const ok = await mConfirm({
        title: t("versions.restoreConfirmTitle"),
        message: t("versions.restoreConfirmMsg", {
          name: path.split("/").pop(),
          when: when(v.timestamp),
        }),
        confirmLabel: t("compare.restoreThis"),
      });
      if (!ok) return;
      await noteSaver.flush(path);
      try {
        await service.restoreVersion({
          backupPath: v.backupPath,
          targetPath: path,
          writeAdapter: vault.files,
          beforeWrite: async () => {
            await vault.backup?.forceBackup(path);
          },
        });
      } catch (e) {
        // The user confirmed a restore and watched nothing happen: the panel
        // sat unchanged and no toast fired, so a failed write read exactly like
        // a successful one (S45).
        console.error("[VersionsPanel] restore failed", e);
        toast.warning(t("versions.restoreFailed"));
        return;
      }
      try {
        await vault.indexer?.indexFile(await vault.adapter.getFileInfo(path));
      } catch {
        /* next full pass repairs it */
      }
      syncSoon();
      onRestored();
      onDone();
    })();
  };

  const doRestoreAsCopy = (v: FileVersion) => {
    void (async () => {
      // One grammar with "keep both" and the desktop: `<note> (Version <stamp>)`,
      // and the name is on the table before the file exists.
      const target = await versionCopyPath(path, new Date(v.timestamp), (p) => vault.files.exists(p));
      const ok = await mConfirm({
        title: t("compare.copyTitle"),
        message: t("compare.copyMsg", { when: when(v.timestamp), name: target }),
        confirmLabel: t("versions.restoreAsCopy"),
      });
      if (!ok) return;
      await service.restoreVersion({
        backupPath: v.backupPath,
        targetPath: target,
        writeAdapter: vault.files,
      });
      try {
        await vault.indexer?.indexFile(await vault.adapter.getFileInfo(target));
      } catch {
        /* next full pass repairs it */
      }
      syncSoon();
      toast.info(t("versions.copyCreated", { path: target }));
      window.dispatchEvent(new CustomEvent("m-vault-changed"));
      onDone();
    })();
  };

  // Size delta against the previous (older) snapshot — cheap and honest
  // (backups carry no cause metadata; the list is newest-first).
  const deltaOf = (idx: number): number | null => {
    const list = versions ?? [];
    const prev = list[idx + 1];
    if (!prev) return null;
    return list[idx].size - prev.size;
  };
  const deltaLabel = (d: number) => {
    const abs = Math.abs(d);
    const txt = abs >= 1024 ? `${Math.round(abs / 1024)} KB` : `${abs} B`;
    return `${d >= 0 ? "+" : "−"}${txt}`;
  };
  const dayLabel = (ts: number): string => {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return t("mobile.today");
    if (d.toDateString() === yesterday.toDateString()) return t("mobile.yesterday");
    return dayOf.format(d);
  };

  if (selected) {
    return (
      <>
        <button className="m-row" onClick={() => setSelected(null)}>
          <ChevronLeft size={ICON.head} />
          <span>{when(selected.timestamp)}</span>
        </button>
        {preview === null ? (
          <p className="m-hint">{t("versions.loading")}</p>
        ) : (
          <CompareVersions
            inNote={current}
            other={preview}
            noteMeta={{ title: t("compare.tabNote"), subtitle: `${t("compare.currentState")} · ${when(currentMtime)}` }}
            otherMeta={{ title: t("compare.savedVersion"), subtitle: when(selected.timestamp) }}
            cost={(s) => t("compare.costRestore", { added: s.added, removed: s.removed })}
            actions={
              <>
                <Button variant="primary" onClick={() => doRestore(selected)}>
                  {t("compare.restoreThis")}
                </Button>
                <Button variant="ghost" onClick={() => doRestoreAsCopy(selected)}>
                  {t("versions.restoreAsCopy")}
                </Button>
              </>
            }
          />
        )}
      </>
    );
  }

  const rows = (versions ?? []).map((v, idx) => ({ v, idx, day: dayLabel(v.timestamp) }));
  const withHeaders = rows.map((r, i) => ({ ...r, header: i === 0 || rows[i - 1].day !== r.day ? r.day : null }));
  return (
    <>
      {versions === null && <p className="m-hint">{t("versions.loading")}</p>}
      {versions !== null && versions.length === 0 && (
        <EmptyState icon={<History size={ICON.empty} />}>{t("versions.empty")}</EmptyState>
      )}
      {withHeaders.map(({ v, idx, header }) => {
        const delta = deltaOf(idx);
        return (
          <div key={v.backupPath}>
            {header && <p className="m-sectionlabel m-sectionlabel--inset">{header}</p>}
            <button className="m-row" onClick={() => open(v)}>
              <History size={ICON.head} />
              <span>{timeOf.format(new Date(v.timestamp))}</span>
              {delta !== null && (
                <span className={`m-delta${delta >= 0 ? " is-plus" : " is-minus"}`}>{deltaLabel(delta)}</span>
              )}
              <span className="m-row-detail">{Math.max(1, Math.round(v.size / 1024))} KB</span>
            </button>
          </div>
        );
      })}
    </>
  );
}
