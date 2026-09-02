import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, conflictCopyStamp, toast, versionCopyPath } from "@plainva/ui";
import { CompareVersions } from "./CompareVersions";
import { SheetGrip } from "./SheetGrip";
import { mConfirm } from "../services/mobileDialogs";
import { clearConflict } from "../services/conflictState";
import { noteSaver, vaultOps, type MobileVault } from "../services/vaultService";
import { syncSoon } from "../services/syncService";

/**
 * The phone's conflict surface (feedback round 2026-09-01, P2): one sheet,
 * reached from the folder banner AND the note's banner, that SHOWS the two
 * versions before it asks anything. The three blind rows it replaces ("open
 * copy", "keep this copy", "keep the current note") decided without a diff
 * and named the versions after files, not after time.
 *
 * Exits, same words as the desktop: take the copy's version (the note gets the
 * copy's text, the copy goes), keep both (the copy becomes a plain sibling
 * named by its time), discard the copy, decide later. Every destructive exit
 * asks first and says which version goes where.
 */
export function ConflictCompareSheet({
  vault,
  conflictPath,
  originalPath,
  onClose,
  onResolved,
}: {
  vault: MobileVault;
  conflictPath: string;
  originalPath: string;
  onClose: () => void;
  /** The conflict copy is gone (deleted or renamed); `touched` lists changed paths. */
  onResolved: (touched: string[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const [inNote, setInNote] = useState<string | null>(null);
  const [copy, setCopy] = useState<string | null>(null);
  const [noteMtime, setNoteMtime] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    void (async () => {
      try {
        const [note, other] = await Promise.all([vaultOps.read(vault, originalPath), vaultOps.read(vault, conflictPath)]);
        if (stale) return;
        setInNote(note.replace(/\r\n/g, "\n"));
        setCopy(other.replace(/\r\n/g, "\n"));
      } catch {
        if (!stale) setFailed(true);
      }
      try {
        const info = await vault.adapter.getFileInfo(originalPath);
        if (!stale) setNoteMtime(info.mtime);
      } catch {
        /* the card just omits the time */
      }
    })();
    return () => {
      stale = true;
    };
  }, [vault, conflictPath, originalPath]);

  const whenLabel = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }), [i18n.language]);
  const stamp = useMemo(() => conflictCopyStamp(conflictPath), [conflictPath]);
  const when = (d: number | Date | null) => (d === null ? "—" : whenLabel.format(d));

  const finish = async (touched: string[]) => {
    clearConflict(originalPath);
    try {
      await vault.reindexPaths(touched);
    } catch {
      /* next full pass repairs it */
    }
    syncSoon();
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
    onResolved(touched);
  };

  const run = async (work: () => Promise<string[]>) => {
    setBusy(true);
    try {
      const touched = await work();
      await finish(touched);
    } catch (e) {
      console.error("[ConflictCompareSheet] resolving failed", e);
      toast.error(t("conflict.resolveFailed", { error: e instanceof Error ? e.message : String(e) }));
      setBusy(false);
    }
  };

  const adopt = async () => {
    if (copy === null) return;
    const ok = await mConfirm({
      title: t("compare.adoptTitle"),
      message: t("compare.adoptMsg", { other: when(stamp), current: when(noteMtime) }),
      confirmLabel: t("compare.adoptCopy"),
    });
    if (!ok) return;
    await run(async () => {
      // S2: the note may be open with unsaved keystrokes — exactly the
      // situation that produced the conflict. Land them first, otherwise the
      // queued save settles after the promotion and puts the losing version back.
      await noteSaver.flush(originalPath);
      await vaultOps.save(vault, originalPath, copy);
      await vaultOps.remove(vault, conflictPath);
      toast.success(t("compare.resolvedAdopted"));
      return [originalPath, conflictPath];
    });
  };

  const keepBoth = async () => {
    const candidate = await versionCopyPath(originalPath, stamp ?? new Date(), (p) => vault.files.exists(p));
    const ok = await mConfirm({
      title: t("compare.keepBothTitle"),
      message: t("compare.keepBothMsg", { name: candidate }),
      confirmLabel: t("compare.keepBoth"),
    });
    if (!ok) return;
    await run(async () => {
      await vault.files.renameItem(conflictPath, candidate);
      toast.success(t("compare.resolvedKeptBoth", { name: candidate }));
      return [conflictPath, candidate];
    });
  };

  const discard = async () => {
    const ok = await mConfirm({
      title: t("compare.discardTitle"),
      message: t("compare.discardMsg", { other: when(stamp) }),
      danger: true,
      confirmLabel: t("compare.discardCopy"),
    });
    if (!ok) return;
    await run(async () => {
      await vaultOps.remove(vault, conflictPath);
      toast.success(t("compare.resolvedDiscarded"));
      return [conflictPath];
    });
  };

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="conflict-compare-sheet">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("compare.title")}</p>
        <p className="m-hint">{t("compare.conflictExplainer")}</p>
        {failed ? (
          <p className="m-hint">{t("conflict.notAConflictFile")}</p>
        ) : inNote === null || copy === null ? (
          <p className="m-hint">{t("versions.loading")}</p>
        ) : (
          <CompareVersions
            inNote={inNote}
            other={copy}
            noteMeta={{ title: t("compare.tabNote"), subtitle: `${t("compare.cameViaSync")} · ${when(noteMtime)}` }}
            otherMeta={{ title: t("compare.conflictCopy"), subtitle: t("compare.yourVersionKept", { when: when(stamp) }) }}
            cost={(s) => t("compare.costAdopt", { added: s.added, removed: s.removed })}
            hint={t("compare.mergeOnlyDesktop")}
            actions={
              <>
                <Button variant="primary" disabled={busy} onClick={() => { void adopt(); }} data-testid="compare-adopt">
                  {t("compare.adoptCopy")}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => { void keepBoth(); }} data-testid="compare-keep-both">
                  {t("compare.keepBoth")}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => { void discard(); }} data-testid="compare-discard">
                  {t("compare.discardCopy")}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={onClose}>
                  {t("compare.later")}
                </Button>
              </>
            }
          />
        )}
      </div>
    </div>
  );
}
