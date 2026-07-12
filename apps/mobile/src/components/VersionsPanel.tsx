import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, History } from "lucide-react";
import { VersionHistoryService, type FileVersion } from "@plainva/core";
import { collapseContext, lineDiff, toast } from "@plainva/ui";
import { mConfirm } from "../services/mobileDialogs";
import { noteSaver, vaultOps, type MobileVault } from "../services/vaultService";
import { syncSoon } from "../services/syncService";

/**
 * Version history panel (M3E package G; mockup 8): every write already
 * snapshots into .plainva/backups through the shared BackupVaultAdapter —
 * this surfaces them on touch as a SEGMENT of the note context sheet.
 * Rows group by day and carry a size-delta badge against the previous
 * snapshot; preview is read-only with an optional line diff against the
 * current content; restore flushes pending saves first and forces a
 * pre-restore snapshot (the desktop's data-loss guard), then writes through
 * the sync chain.
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
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    let stale = false;
    void service.listVersions(path).then((v) => {
      if (!stale) setVersions(v);
    });
    void vaultOps.read(vault, path).then((text) => {
      if (!stale) setCurrent(text);
    });
    return () => {
      stale = true;
    };
  }, [service, vault, path]);

  const open = (v: FileVersion) => {
    setSelected(v);
    setPreview(null);
    setShowDiff(false);
    void service
      .readVersionText(v.backupPath)
      .then(setPreview)
      .catch(() => setPreview(t("versions.binaryNoPreview")));
  };

  const when = (ts: number) => new Date(ts).toLocaleString(i18n.language);
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
        confirmLabel: t("versions.restore"),
      });
      if (!ok) return;
      await noteSaver.flush(path);
      await service.restoreVersion({
        backupPath: v.backupPath,
        targetPath: path,
        writeAdapter: vault.files,
        beforeWrite: async () => {
          await vault.backup?.forceBackup(path);
        },
      });
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
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const base = path.split("/").pop()!.replace(/\.md$/i, "");
      let name = `${base} ${t("database.copySuffix")}`;
      let n = 2;
      while (await vault.files.exists(`${dir ? `${dir}/` : ""}${name}.md`)) {
        name = `${base} ${t("database.copySuffix")} ${n++}`;
      }
      const target = `${dir ? `${dir}/` : ""}${name}.md`;
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

  const diff = useMemo(() => {
    if (!showDiff || preview === null) return null;
    const d = lineDiff(preview, current);
    return d ? collapseContext(d, 2) : null;
  }, [showDiff, preview, current]);

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
          <ChevronLeft size={18} />
          <span>{when(selected.timestamp)}</span>
        </button>
        <div className="m-config-actions">
          <button className="m-chip m-btn--filled" onClick={() => doRestore(selected)}>
            {t("versions.restore")}
          </button>
          <button className="m-chip" onClick={() => doRestoreAsCopy(selected)}>
            {t("versions.restoreAsCopy")}
          </button>
          <button
            className={`m-chip${showDiff ? " is-on" : ""}`}
            onClick={() => setShowDiff((s) => !s)}
          >
            {t("versions.diffToggle")}
          </button>
        </div>
        {preview === null ? (
          <p className="m-hint m-hint--inset">{t("versions.loading")}</p>
        ) : showDiff ? (
          diff === null ? (
            <p className="m-hint m-hint--inset">{t("versions.binaryNoPreview")}</p>
          ) : (
            <div className="m-diff">
              {diff.map((l, idx) =>
                l.type === "skip" ? (
                  <div className="m-diff-skip" key={idx}>
                    ··· {l.count} ···
                  </div>
                ) : (
                  <div className={`m-diff-line is-${l.type}`} key={idx}>
                    {l.text || " "}
                  </div>
                ),
              )}
            </div>
          )
        ) : (
          <pre className="m-version-preview">{preview}</pre>
        )}
      </>
    );
  }

  const rows = (versions ?? []).map((v, idx) => ({ v, idx, day: dayLabel(v.timestamp) }));
  const withHeaders = rows.map((r, i) => ({ ...r, header: i === 0 || rows[i - 1].day !== r.day ? r.day : null }));
  return (
    <>
      {versions === null && <p className="m-hint m-hint--inset">{t("versions.loading")}</p>}
      {versions !== null && versions.length === 0 && (
        <p className="m-hint m-hint--inset">{t("versions.empty")}</p>
      )}
      {withHeaders.map(({ v, idx, header }) => {
        const delta = deltaOf(idx);
        return (
          <div key={v.backupPath}>
            {header && <p className="m-sectionlabel m-sectionlabel--inset">{header}</p>}
            <button className="m-row" onClick={() => open(v)}>
              <History size={18} />
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
