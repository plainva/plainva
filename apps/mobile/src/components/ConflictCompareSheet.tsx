import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, FileComparisonDetails, conflictCopyStamp, toast, versionCopyPath } from "@plainva/ui";
import { assertComparisonUnchanged, classifyTaskNotes, displacedTaskPath, separateTaskConflict } from "@plainva/core";
import { getVaultEntry } from "../services/vaultRegistry";
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
  const running = useRef(false);
  const [revision, setRevision] = useState(0);
  const [vaultName, setVaultName] = useState(vault.vaultId);
  const originalSnapshot = useRef<string | null>(null);
  const differentTasks = inNote !== null && copy !== null && classifyTaskNotes(inNote, copy) === "different";

  useEffect(() => {
    let stale = false;
    void (async () => {
      try {
        setFailed(false);
        const [note, other] = await Promise.all([vault.files.exists(originalPath).then(exists => exists ? vaultOps.read(vault, originalPath) : null), vaultOps.read(vault, conflictPath)]);
        if (stale) return;
        originalSnapshot.current = note;
        setInNote(note ?? "");
        setCopy(other);
        const entry = await getVaultEntry(vault.vaultId);
        if (!stale) setVaultName(entry?.name || i18n.t("mobile.vaultLocal"));
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
  }, [vault, conflictPath, originalPath, revision, i18n]);

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
    if (running.current || copy === null) return;
    running.current = true;
    setBusy(true);
    try {
      await noteSaver.flush(originalPath, vault);
      await noteSaver.flush(conflictPath, vault);
      await assertComparisonUnchanged(vault.files, originalPath, originalSnapshot.current, conflictPath, copy);
      const touched = await work();
      await finish(touched);
    } catch (e) {
      console.error("[ConflictCompareSheet] resolving failed", e);
      if (e instanceof Error && e.message === "comparisonChanged") { toast.info(t("compare.comparisonChanged")); setRevision(n => n + 1); }
      else toast.error(t("conflict.resolveFailed", { error: e instanceof Error ? e.message : String(e) }));
      setBusy(false);
    } finally { running.current = false; }
  };

  const adopt = async () => {
    if (copy === null || differentTasks) return;
    const ok = await mConfirm({
      title: t("compare.adoptTitle"),
      message: t("compare.replaceMessage", { source: conflictPath, target: originalPath }),
      confirmLabel: t("compare.replaceConfirm"),
    });
    if (!ok) return;
    await run(async () => {
      // S2: the note may be open with unsaved keystrokes — exactly the
      // situation that produced the conflict. Land them first, otherwise the
      // queued save settles after the promotion and puts the losing version back.
      await vaultOps.save(vault, originalPath, copy);
      if (await vault.files.readTextFile(conflictPath) !== copy) throw new Error("comparisonChanged");
      await vaultOps.remove(vault, conflictPath);
      toast.success(t("compare.resolvedAdopted"));
      return [originalPath, conflictPath];
    });
  };

  const keepBoth = async () => {
    if (copy === null || inNote === null) return;
    const candidate = differentTasks ? await displacedTaskPath(vault.files, originalPath, copy) : await versionCopyPath(originalPath, stamp ?? new Date(), (p) => vault.files.exists(p));
    const ok = await mConfirm({
      title: t("compare.keepBothTitle"),
      message: t("compare.keepBothPaths", { original: originalPath, copy: candidate }),
      confirmLabel: t(differentTasks ? "compare.keepSeparateTasks" : "compare.keepBoth"),
    });
    if (!ok) return;
    await run(async () => {
      if (differentTasks) await separateTaskConflict(vault.files, originalPath, inNote, conflictPath, copy, candidate);
      else {
        if (await vault.files.exists(candidate)) throw new Error("comparisonChanged");
        await vault.files.renameItem(conflictPath, candidate);
      }
      toast.success(t("compare.resolvedKeptBoth", { name: candidate }));
      return [conflictPath, candidate];
    });
  };

  const discard = async () => {
    if (differentTasks) return;
    const ok = await mConfirm({
      title: t("compare.discardTitle"),
      message: t("compare.discardPaths", { source: conflictPath, target: originalPath }),
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
      <div className="pv-sheet m-sheet m-conflict-sheet" onClick={(e) => e.stopPropagation()} data-testid="conflict-compare-sheet">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("compare.title")}</p>
        <FileComparisonDetails compact vault={vaultName} originalPath={originalPath} copyPath={conflictPath} original={inNote} copy={copy} onReveal={path => { onClose(); window.dispatchEvent(new CustomEvent("m-reveal-file", { detail: { path, vaultId: vault.vaultId } })); }} />
        <div className="m-conflict-body">
        <p className="m-hint">{t(differentTasks ? "compare.differentTasks" : "compare.conflictExplainer")}</p>
        {differentTasks && <Banner kind="info" rounded>{t("compare.differentTasksHint")}</Banner>}
        {failed ? (
          <p className="m-hint">{t("conflict.notAConflictFile")}</p>
        ) : inNote === null || copy === null ? (
          <p className="m-hint">{t("versions.loading")}</p>
        ) : (
          <CompareVersions
            inNote={inNote}
            other={copy}
            noteMeta={{ title: t("compare.currentFile"), subtitle: when(noteMtime) }}
            otherMeta={{ title: t("compare.conflictCopy"), subtitle: when(stamp) }}
            cost={differentTasks ? undefined : (s) => t("compare.costAdopt", { added: s.added, removed: s.removed })}
            hint={differentTasks ? undefined : t("compare.mergeOnlyDesktop")}
            actions={
              <>
                {!differentTasks && <><Button variant="primary" disabled={busy} onClick={() => { void adopt(); }} data-testid="compare-adopt">
                  {t("compare.adoptCopy")}
                </Button><p className="m-hint">{t("compare.replaceHint", { name: originalPath.split("/").pop() })}</p></>}
                <Button variant={differentTasks ? "primary" : "secondary"} disabled={busy} onClick={() => { void keepBoth(); }} data-testid="compare-keep-both">
                  {t(differentTasks ? "compare.keepSeparateTasks" : "compare.keepBoth")}
                </Button>
                {!differentTasks && <Button variant="secondary" disabled={busy} onClick={() => { void discard(); }} data-testid="compare-discard">
                  {t("compare.discardCopy")}
                </Button>}
                <Button variant="ghost" disabled={busy} onClick={onClose}>
                  {t("compare.later")}
                </Button>
              </>
            }
          />
        )}
        </div>
      </div>
    </div>
  );
}
