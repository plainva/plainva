import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, ConflictHistory, FileComparisonDetails, comparesAsText, conflictCopyStamp, toast, versionCopyPath } from "@plainva/ui";
import { assertComparisonUnchanged, classifyTaskNotes, displacedTaskPath, isNotTextFileError, seeConflictCopy, separateTaskConflict, settleConflictCopy, type ConflictCopySight } from "@plainva/core";
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
  /**
   * One of the two files is no text by its bytes — an image, and just the same
   * a `.csv` in Windows-1252 or a note in UTF-16 (finding 2026-10-11; the
   * desktop's comparison says the same). Nothing of such a file is shown: what
   * a decoder makes of it is not the file. The exits stay and go byte for
   * byte. The sheet used to call the copy the sync leaves beside such a file
   * "not a conflict copy" where the reader refuses it — and where the reader
   * replaces what is not UTF-8, "take the copy" wrote that reading over the
   * file.
   */
  const [unreadableAt, setUnreadableAt] = useState<number | null>(null);
  /** What the byte-wise exits answer for: the bytes both files had when nothing could be shown — in the load it was found in. */
  const [sight, setSight] = useState<{ at: number; seen: ConflictCopySight } | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [revision, setRevision] = useState(0);
  const [vaultName, setVaultName] = useState(vault.vaultId);
  const originalSnapshot = useRef<string | null>(null);
  // What the NAME says — the rule both shells' comparisons share: an image is
  // shown as one, whatever an editor or the sync takes for text is read as
  // text. A file that is no text by its name is not put through a text reader.
  const namedText = comparesAsText(originalPath);
  const notText = !namedText || unreadableAt === revision;
  const sidesKnown = notText ? sight?.at === revision : copy !== null;
  const differentTasks = !notText && inNote !== null && copy !== null && classifyTaskNotes(inNote, copy) === "different";

  useEffect(() => {
    let stale = false;
    void (async () => {
      setFailed(false);
      // A reload starts from nothing: texts and sizes of an earlier one are not this one's.
      setInNote(null);
      setCopy(null);
      try {
        const entry = await getVaultEntry(vault.vaultId);
        if (!stale) setVaultName(entry?.name || i18n.t("mobile.vaultLocal"));
      } catch {
        /* the details name the vault by its id */
      }
      let unreadable = !namedText;
      if (namedText) {
        try {
          const [note, other] = await Promise.all([vault.files.exists(originalPath).then(exists => exists ? vaultOps.read(vault, originalPath) : null), vaultOps.read(vault, conflictPath)]);
          if (stale) return;
          originalSnapshot.current = note;
          setInNote(note ?? "");
          setCopy(other);
        } catch (error) {
          if (stale) return;
          unreadable = isNotTextFileError(error);
          if (unreadable) setUnreadableAt(revision);
          else setFailed(true);
        }
      }
      // Nothing to show: the bytes both files have now are what the byte-wise
      // exits will answer for (`settleConflictCopy`).
      if (unreadable) {
        try {
          const seen = await seeConflictCopy(vault.files, originalPath, conflictPath);
          if (!stale) setSight({ at: revision, seen });
        } catch {
          if (!stale) setFailed(true);
        }
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
  }, [vault, conflictPath, originalPath, namedText, revision, i18n]);

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
    if (running.current || !sidesKnown) return;
    running.current = true;
    setBusy(true);
    try {
      await noteSaver.flush(originalPath, vault);
      await noteSaver.flush(conflictPath, vault);
      // Where two texts were compared, the confirmation holds for exactly
      // those. Where nothing could be shown (`notText`), it holds for the
      // bytes that were seen — the byte-wise exits ask that themselves.
      if (!notText) await assertComparisonUnchanged(vault.files, originalPath, originalSnapshot.current, conflictPath, copy!);
      const touched = await work();
      await finish(touched);
    } catch (e) {
      console.error("[ConflictCompareSheet] resolving failed", e);
      if (e instanceof Error && e.message === "comparisonChanged") { toast.info(t("compare.comparisonChanged")); setRevision(n => n + 1); }
      else toast.error(t("conflict.resolveFailed", { error: e instanceof Error ? e.message : String(e) }));
      setBusy(false);
    } finally { running.current = false; }
  };

  /**
   * The note's editor hears of a byte-wise answer as of a change from outside
   * (the desktop's comparison does the same): it shows the file as what it is
   * now, and lets go of a working copy that is gone — it held that copy's
   * text, and its next save kept the text it had just been told to let go
   * once more.
   */
  const tellEditorOf = () => {
    window.dispatchEvent(new CustomEvent("m-external-update", { detail: { path: originalPath, vaultId: vault.vaultId } }));
  };

  const adopt = async () => {
    if (!sidesKnown || differentTasks) return;
    const seen = sight?.seen;
    const ok = await mConfirm({
      title: t("compare.adoptTitle"),
      message: t("compare.replaceMessage", { source: conflictPath, target: originalPath }),
      confirmLabel: t("compare.replaceConfirm"),
    });
    if (!ok) return;
    if (notText && seen) {
      // Byte for byte, through the one way both shells settle such a copy: it
      // takes the file's place as it lies there. No file is read as text, so
      // no reading of one can be written. What the copy replaces stays in the
      // version history, whatever the snapshot interval says — this write
      // means to take a file's place.
      await run(async () => {
        if (await vault.files.exists(originalPath)) await vault.backup?.forceBackup(originalPath);
        await settleConflictCopy(vault.files, originalPath, conflictPath, seen, { disposition: "adopt" });
        tellEditorOf();
        toast.success(t("compare.resolvedAdopted"));
        return [originalPath, conflictPath];
      });
      return;
    }
    const taken = copy!;
    await run(async () => {
      // S2: the note may be open with unsaved keystrokes — exactly the
      // situation that produced the conflict. Land them first, otherwise the
      // queued save settles after the promotion and puts the losing version back.
      const session = await vault.files.getConflictSession?.(originalPath);
      if (session?.workingCopyPath === conflictPath && vault.files.resolveConflict) {
        await vault.files.resolveConflict(originalPath, { originalText: originalSnapshot.current, copyText: taken, content: taken });
      } else {
        await vaultOps.save(vault, originalPath, taken);
        if (await vault.files.readTextFile(conflictPath) !== taken) throw new Error("comparisonChanged");
        await vaultOps.remove(vault, conflictPath);
      }
      toast.success(t("compare.resolvedAdopted"));
      return [originalPath, conflictPath];
    });
  };

  const keepBoth = async () => {
    if (!sidesKnown || (!notText && inNote === null)) return;
    const seen = sight?.seen;
    const candidate = differentTasks ? await displacedTaskPath(vault.files, originalPath, copy!) : await versionCopyPath(originalPath, stamp ?? new Date(), (p) => vault.files.exists(p));
    const ok = await mConfirm({
      title: t("compare.keepBothTitle"),
      message: t("compare.keepBothPaths", { original: originalPath, copy: candidate }),
      confirmLabel: t(differentTasks ? "compare.keepSeparateTasks" : "compare.keepBoth"),
    });
    if (!ok) return;
    if (notText && seen) {
      // The copy becomes a file of its own, as it lies there.
      await run(async () => {
        await settleConflictCopy(vault.files, originalPath, conflictPath, seen, { disposition: "discard", keepCopyAs: candidate });
        tellEditorOf();
        toast.success(t("compare.resolvedKeptBoth", { name: candidate }));
        return [conflictPath, candidate];
      });
      return;
    }
    const kept = copy!, held = inNote!;
    await run(async () => {
      const session = await vault.files.getConflictSession?.(originalPath);
      if (session?.workingCopyPath === conflictPath && vault.files.resolveConflict) {
        await vault.files.resolveConflict(originalPath, { originalText: originalSnapshot.current, copyText: kept, content: held, disposition: "discard", keepCopyAs: candidate });
      } else if (differentTasks) await separateTaskConflict(vault.files, originalPath, held, conflictPath, kept, candidate);
      else {
        if (await vault.files.exists(candidate)) throw new Error("comparisonChanged");
        await vault.files.renameItem(conflictPath, candidate);
      }
      toast.success(t("compare.resolvedKeptBoth", { name: candidate }));
      return [conflictPath, candidate];
    });
  };

  const discard = async () => {
    if (!sidesKnown || differentTasks) return;
    const seen = sight?.seen;
    const ok = await mConfirm({
      title: t("compare.discardTitle"),
      message: t("compare.discardPaths", { source: conflictPath, target: originalPath }),
      danger: true,
      confirmLabel: t("compare.discardCopy"),
    });
    if (!ok) return;
    if (notText && seen) {
      // The copy goes; the file stays as it lies.
      await run(async () => {
        await settleConflictCopy(vault.files, originalPath, conflictPath, seen, { disposition: "discard" });
        tellEditorOf();
        toast.success(t("compare.resolvedDiscarded"));
        return [conflictPath];
      });
      return;
    }
    await run(async () => {
      const session = await vault.files.getConflictSession?.(originalPath);
      if (session?.workingCopyPath === conflictPath && vault.files.resolveConflict) {
        await vault.files.resolveConflict(originalPath, { originalText: originalSnapshot.current, copyText: copy!, content: inNote ?? "", disposition: "discard" });
      } else await vaultOps.remove(vault, conflictPath);
      toast.success(t("compare.resolvedDiscarded"));
      return [conflictPath];
    });
  };

  const actions = (
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
  );

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet m-conflict-sheet" onClick={(e) => e.stopPropagation()} data-testid="conflict-compare-sheet">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("compare.title")}</p>
        <FileComparisonDetails compact vault={vaultName} originalPath={originalPath} copyPath={conflictPath} original={inNote} copy={copy} onReveal={path => { onClose(); window.dispatchEvent(new CustomEvent("m-reveal-file", { detail: { path, vaultId: vault.vaultId } })); }} />
        <div className="m-conflict-body">
        <ConflictHistory files={vault.files} path={originalPath} copyPath={conflictPath} current={inNote} copy={copy} />
        <p className="m-hint">{t(differentTasks ? "compare.differentTasks" : "compare.conflictExplainer")}</p>
        {differentTasks && <Banner kind="info" rounded>{t("compare.differentTasksHint")}</Banner>}
        {failed ? (
          <p className="m-hint">{t("conflict.notAConflictFile")}</p>
        ) : notText ? (
          // Nothing to lay side by side, and nothing of either file is shown.
          <div className="m-compare">
            <p className="m-hint" data-testid="compare-not-text">{t(namedText ? "editor.notTextBody" : "versions.binaryNoPreview")}</p>
            {sidesKnown
              ? <div className="m-compare-footer"><div className="m-compare-actions">{actions}</div></div>
              : <p className="m-hint">{t("versions.loading")}</p>}
          </div>
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
            actions={actions}
          />
        )}
        </div>
      </div>
    </div>
  );
}
