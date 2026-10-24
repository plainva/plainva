import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, Copy, ExternalLink } from "lucide-react";
import { comparisonPath } from "../services/comparisonWindow";
import { isOwnerWindow, currentWindowParams } from "../services/windowContext";
import { appConfirm } from "../services/appDialogs";
import {
  Button,
  FileComparisonDetails,
  ConflictHistory,
  Checkbox,
  ICON,
  Modal,
  adoptedCopyText,
  compareStats,
  comparesAsText,
  conflictCopyStamp,
  conflictOriginalPath,
  isImagePath,
  lineCount,
  toast,
  versionCopyPath,
  type CompareStats,
} from "@plainva/ui";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { VersionHistoryService, assertComparisonUnchanged, classifyTaskNotes, displacedTaskPath, editorTextOf, fileVersionOfBytes, isNotTextFileError, seeConflictCopy, separateTaskConflict, settleConflictCopy, utf8TextOf, writeFileVersion, type ConflictCopySight, type FileVersion } from "@plainva/core";
import { useVault } from "../contexts/VaultContext";
import { requestSaveFlush } from "../services/saveFlush";

// The image list lives in @plainva/ui (S42): three copies of the same seven
// extensions is how a format ends up viewable in one place and not another.
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

/** What the modal compares: the note's version history, or a sync-conflict copy next to it. */
export type CompareSubject =
  | { kind: "version"; path: string; orphan?: boolean; selectedBackupPath?: string }
  | { kind: "conflict"; conflictPath: string }
  /** A local fork (C36): the copy this device kept when a write was refused. Same three exits as a conflict. */
  | { kind: "fork"; forkId: string; originalPath: string; forkPath: string };

/** What became of a conflict — the host re-indexes `touched` and adopts `mergedContent`. */
export interface ConflictOutcome {
  originalPath: string;
  conflictPath: string;
  /** Set when the subject was a local fork - the host forgets the record. */
  forkId?: string;
  kind: "adopted" | "merged" | "keptBoth" | "discarded";
  /** The text the note holds now, when it changed. */
  mergedContent: string | null;
  /** Paths whose index entry changed (removed or added). */
  touched: string[];
}

const readOnlyExt = [EditorView.editable.of(false), EditorState.readOnly.of(true), EditorView.lineWrapping];
// Long identical stretches fold to a labelled bar; a long note otherwise shows
// mostly agreement (mockup: "die zusammenhängenden gleichen Blöcke sind eingeklappt").
const COLLAPSE = { margin: 3, minSize: 4 };

/**
 * ONE surface for both cases (feedback round 2026-09-01, A6 + D5). The rule
 * that carries it, from `compareVersions.ts`: the LEFT side is always what the
 * note holds right now, the RIGHT side is always the other version — an older
 * snapshot, or the copy the sync preserved. The sides never swap meaning, so
 * red on the left is what disappears if you take the right side and green on
 * the right is what would come in.
 *
 * Before: the version history put the OLD version on the left, the conflict
 * modal put the CURRENT file on the left, and the file tree offered two exits
 * that resolved a conflict WITHOUT showing a difference. Both modals are gone;
 * every entry point (tree, editor banner, sync-error dialog, tab menu) lands here.
 */
export const CompareModal: React.FC<{
  subject: CompareSubject;
  onClose: () => void;
  onRestored?: (restoredPath: string) => void;
  onResolved?: (outcome: ConflictOutcome) => void;
  standalone?: boolean;
}> = ({ subject, onClose, onRestored, onResolved, standalone = false }) => {
  const { t, i18n } = useTranslation();
  const { vaultPath, vaultAdapter, backupAdapter, indexer, triggerFileTreeUpdate, workspaceSecurityStatus, listWorkspaceRevisions, readWorkspaceRevision } = useVault();
  const workspaceHistory = workspaceSecurityStatus !== null;

  // A fork is a conflict copy whose original is named outright rather than
  // derived from a `.CONFLICT` file name (C36).
  const isConflict = subject.kind === "conflict" || subject.kind === "fork";
  const forkId = subject.kind === "fork" ? subject.forkId : undefined;
  const conflictPath = subject.kind === "conflict" ? subject.conflictPath : subject.kind === "fork" ? subject.forkPath : null;
  const originalOfConflict = subject.kind === "conflict" ? conflictOriginalPath(subject.conflictPath) : subject.kind === "fork" ? subject.originalPath : null;
  // The note both cases talk about.
  const path = subject.kind === "version" ? subject.path : originalOfConflict ?? conflictPath ?? "";
  const orphan = subject.kind === "version" && subject.orphan === true;
  const initialVersion = subject.kind === "version" ? subject.selectedBackupPath : undefined;

  const basename = path.split(/[/\\]/).pop() || path;
  // What the NAME says — the rule both shells' comparisons share, not a list
  // of this surface's own (finding 2026-10-11): an image is shown as one, and
  // whatever an editor or the sync takes for text is read as text. Whether a
  // side IS text is asked of its bytes, where it is read: see `notText` below.
  const isText = comparesAsText(path);
  const isImage = isImagePath(path);

  // Version history state.
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [selected, setSelected] = useState<FileVersion | null>(null);
  const [versionText, setVersionText] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(isText && !orphan);
  // Shared state.
  const [currentText, setCurrentText] = useState<string | null>(null);
  const [currentMtime, setCurrentMtime] = useState<number | null>(null);
  const [conflictText, setConflictText] = useState<string | null>(null);
  const [rightEdited, setRightEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * A side of the comparison is no text by its bytes — an image, and just the
   * same a `.csv` in Windows-1252 or a note in UTF-16 (finding 2026-10-11).
   * There is nothing to lay side by side then, and nothing of such a file is
   * shown: what a decoder makes of it is not the file. The exits stay, and go
   * byte for byte. This used to end in an error line and three dead buttons —
   * for the very copy the sync leaves beside such a file.
   *
   * Kept with the load it was found in (`revision`), and for the version it
   * was found for: a reload, or another version, asks again.
   */
  const [unreadableAt, setUnreadableAt] = useState<number | null>(null);
  const [unreadableVersion, setUnreadableVersion] = useState<string | null>(null);
  /** What the byte-wise exits answer for: the bytes both files had when the comparison found nothing to show — in the load it was found in. */
  const [sight, setSight] = useState<{ at: number; seen: ConflictCopySight } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const originalSnapshot = useRef<string | null>(null);
  const copySnapshot = useRef<string | null>(null);
  const resolving = useRef(false);
  const [revision, setRevision] = useState(0);

  const service = useMemo(() => (vaultAdapter ? new VersionHistoryService(vaultAdapter) : null), [vaultAdapter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The note's current text + modification time (the left side, both cases).
  // Both sides are SHOWN the way an editor holds them (`editorTextOf`): line
  // ends and a byte order mark are no difference between two versions. What is
  // written comes from the snapshots, which are the files as they lie there.
  useEffect(() => {
    let alive = true;
    if (!vaultAdapter || orphan || !isText) return;
    vaultAdapter.exists(path).then(exists => exists ? vaultAdapter.readTextFile(path) : null)
      .then(text => { if (alive) { originalSnapshot.current = text; setCurrentText(text === null ? (isConflict ? "" : null) : editorTextOf(text)); } })
      .catch(e => { if (alive) { if (isNotTextFileError(e)) setUnreadableAt(revision); else setError(String(e)); } });
    vaultAdapter
      .getFileInfo(path)
      .then((info) => alive && setCurrentMtime(info.mtime))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [vaultAdapter, path, orphan, isText, isConflict, revision]);

  // Conflict: the preserved copy (the right side).
  useEffect(() => {
    let alive = true;
    // A copy that is no text by its name is not put through a text reader.
    if (!vaultAdapter || !conflictPath || !isText) return;
    vaultAdapter
      .readTextFile(conflictPath)
      .then(text => { if (alive) { copySnapshot.current = text; setConflictText(editorTextOf(text)); } })
      .catch((e) => { if (alive) { if (isNotTextFileError(e)) setUnreadableAt(revision); else setError(e instanceof Error ? e.message : String(e)); } });
    return () => {
      alive = false;
    };
  }, [vaultAdapter, conflictPath, isText, revision]);

  // Version history: the list, once.
  useEffect(() => {
    let alive = true;
    if (isConflict || (!service && !workspaceHistory)) return;
    (workspaceHistory
      ? listWorkspaceRevisions(path).then((list) => (list ?? []).map((revision) => ({ backupPath: `workspace:${revision.revisionId}`, timestamp: Date.parse(revision.createdAt ?? "1970-01-01T00:00:00.000Z"), size: 0 })))
      : service!.listVersions(path))
      .then((list) => {
        if (!alive) return;
        setVersions(list);
        const chosen = initialVersion ? list.find(version => version.backupPath === initialVersion) : list[0];
        setSelected(chosen ?? null);
        if (initialVersion && !chosen) setError(t("compare.versionUnavailable"));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [isConflict, service, path, workspaceHistory, listWorkspaceRevisions, initialVersion, t]);

  // Version history: the selected version's content (text or image blob).
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setVersionText(null);
    setImageUrl(null);
    if (isConflict || (!service && !workspaceHistory) || !selected) return;
    setError(null);
    const readBytes = () => workspaceHistory
      ? readWorkspaceRevision(selected.backupPath.slice("workspace:".length))
      : service!.readVersionBinary(selected.backupPath);
    if (isText) {
      // The version's text, or null where its bytes are not UTF-8 — a snapshot
      // of a file in another encoding is kept byte for byte and has no preview.
      const backupPath = selected.backupPath;
      (workspaceHistory
        ? readBytes().then((bytes) => utf8TextOf(bytes))
        : service!.readVersionText(backupPath).catch((e) => { if (isNotTextFileError(e)) return null; throw e; }))
        .then((text) => { if (alive) { if (text === null) setUnreadableVersion(backupPath); else setVersionText(editorTextOf(text)); } })
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
  }, [isConflict, service, selected, isText, isImage, path, workspaceHistory, readWorkspaceRevision]);

  // The right side: the other version.
  const rightText = isConflict ? conflictText : versionText;
  // Nothing to lay side by side (see `unreadableAt`): in a conflict when either
  // file is no text, in the history when the note or the chosen version is not.
  const notText = isConflict ? !isText || unreadableAt === revision : unreadableAt === revision || (selected !== null && unreadableVersion === selected.backupPath);
  const differentTasks = !notText && isConflict && currentText !== null && conflictText !== null && classifyTaskNotes(currentText, conflictText) === "different";
  const canDiff = isText && !notText && !orphan && currentText !== null && rightText !== null;
  /** The exits of a conflict are there once it is known what the two files are: two texts, or two files whose bytes were seen. */
  const sidesKnown = notText ? sight?.at === revision : rightText !== null;
  const diffMounted = isConflict ? canDiff : canDiff && showDiff;

  // Nothing to show of a conflict: the bytes both files have now are what the
  // byte-wise exits will answer for (`settleConflictCopy`).
  useEffect(() => {
    let alive = true;
    if (!isConflict || !notText || !vaultAdapter || !conflictPath || !originalOfConflict) return;
    seeConflictCopy(vaultAdapter, originalOfConflict, conflictPath)
      .then((seen) => { if (alive) setSight({ at: revision, seen }); })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof Error && e.message === "comparisonChanged") setNotice(t("compare.comparisonChanged"));
        else setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [isConflict, notText, vaultAdapter, conflictPath, originalOfConflict, revision, t]);

  // The comparison itself. Left = the note (a), right = the other version (b);
  // in a conflict the right side is editable with per-chunk arrows from the
  // left, so a merge is "edit the right side, then apply it".
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !diffMounted || currentText === null || rightText === null) return;
    setRightEdited(false);
    const view = new MergeView({
      a: { doc: currentText, extensions: readOnlyExt },
      b: {
        doc: rightText,
        extensions: isConflict && !differentTasks
          ? [EditorView.lineWrapping, EditorView.updateListener.of((u) => { if (u.docChanged) setRightEdited(true); })]
          : readOnlyExt,
      },
      parent: host,
      collapseUnchanged: COLLAPSE,
      ...(isConflict && !differentTasks ? { revertControls: "a-to-b" as const } : {}),
    });
    mergeRef.current = view;
    return () => {
      mergeRef.current = null;
      view.destroy();
    };
  }, [diffMounted, currentText, rightText, isConflict, differentTasks]);

  const stats: CompareStats | null = useMemo(
    () => (currentText !== null && rightText !== null ? compareStats(currentText, rightText) : null),
    [currentText, rightText]
  );

  const dayLabel = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: "full" }), [i18n.language]);
  const timeLabel = useMemo(() => new Intl.DateTimeFormat(i18n.language, { timeStyle: "medium" }), [i18n.language]);
  const whenLabel = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }), [i18n.language]);
  const when = (ts: number | Date | null) => (ts === null ? "—" : whenLabel.format(ts));

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

  const conflictStamp = useMemo(() => (conflictPath ? conflictCopyStamp(conflictPath) : null), [conflictPath]);

  const finishRestore = async (targetPath: string, size: number) => {
    if (comparesAsText(targetPath) && vaultAdapter) {
      // Hand the restored content to any open editor, bypassing its dirty
      // guard. A version that is no text by its bytes has none to hand over:
      // the editor hears of the file all the same, and shows what it is now.
      const text = await vaultAdapter.readTextFile(targetPath).catch((e) => { if (isNotTextFileError(e)) return null; throw e; });
      window.dispatchEvent(new CustomEvent("plainva-file-restored", { detail: { path: targetPath, ...(text === null ? {} : { content: editorTextOf(text) }) } }));
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

  // ---- version history exits ------------------------------------------------

  const doRestore = async () => {
    if ((!service && !workspaceHistory) || !selected || !vaultAdapter) return;
    const ok = await appConfirm({
      title: t("versions.restoreConfirmTitle"),
      message: t("versions.restoreConfirmMsg", {
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
        // The version as it was, mark included: a plain decoder drops the mark,
        // and the restored file came back without the one it had. As text
        // where it is text, byte for byte where not (`writeFileVersion`).
        await writeFileVersion(vaultAdapter, path, fileVersionOfBytes(bytes));
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
    const candidate = await versionCopyPath(path, new Date(selected.timestamp), (p) => vaultAdapter.exists(p));
    // The name is on the table before the file exists (mockup: "nennt im
    // Bestätigungsdialog wieder den entstehenden Dateinamen").
    const ok = await appConfirm({
      title: t("compare.copyTitle"),
      message: t("compare.copyMsg", { when: when(selected.timestamp), name: candidate }),
      kind: "info",
      confirmLabel: t("versions.restoreAsCopy"),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      if (workspaceHistory) {
        const bytes = await readWorkspaceRevision(selected.backupPath.slice("workspace:".length));
        await writeFileVersion(vaultAdapter, candidate, fileVersionOfBytes(bytes));
      } else await service!.restoreVersion({ backupPath: selected.backupPath, targetPath: candidate, writeAdapter: vaultAdapter });
      await finishRestore(candidate, selected.size);
      setNotice(t("versions.copyCreated", { path: candidate }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ---- conflict exits -------------------------------------------------------

  const resolve = async (work: () => Promise<ConflictOutcome>) => {
    if (resolving.current || !vaultAdapter || !conflictPath || !originalOfConflict || (!notText && copySnapshot.current === null)) return;
    resolving.current = true;
    setBusy(true);
    try {
      await requestSaveFlush(originalOfConflict);
      await requestSaveFlush(conflictPath);
      // Where two texts were compared, the confirmation holds for exactly
      // those. Where nothing could be shown (`notText`), it holds for the
      // bytes that were seen — the byte-wise exits ask that themselves.
      if (!notText) await assertComparisonUnchanged(vaultAdapter, originalOfConflict, originalSnapshot.current, conflictPath, copySnapshot.current!);
      const outcome = await work();
      onResolved?.(outcome);
    } catch (e) {
      setBusy(false);
      toast.error(t("conflict.resolveFailed", { error: e instanceof Error ? e.message : String(e) }));
      if (e instanceof Error && e.message === "comparisonChanged") { setNotice(t("compare.comparisonChanged")); setRevision(n => n + 1); }
    } finally { resolving.current = false; }
  };

  /**
   * The three exits where nothing could be laid side by side (`notText`) — the
   * same three, byte for byte, through the one way both shells settle such a
   * copy (`settleConflictCopy`): the copy takes the file's place as it lies
   * there, becomes a file of its own, or goes. None of them reads a file as
   * text, so none can write a reading of it; an open conflict ends through
   * its own gate; and nothing happens where a file changed since it was seen.
   */
  /**
   * The editor of the file in this window hears of a byte-wise answer, as of a
   * restored version: it shows the file as what it is now, and lets go of a
   * working copy that is gone — it held that copy's text, and its next save
   * kept the text it had just been told to let go once more.
   */
  const tellEditorOf = (target: string) => {
    window.dispatchEvent(new CustomEvent("plainva-file-restored", { detail: { path: target } }));
  };
  const adoptBytes = async () => {
    if (!vaultAdapter || !conflictPath || !originalOfConflict || sight?.at !== revision) return;
    const { seen } = sight;
    const ok = await appConfirm({
      title: t("compare.adoptTitle"),
      message: t("compare.replaceMessage", { source: conflictPath, target: originalOfConflict }),
      kind: "warning",
      confirmLabel: t("compare.replaceConfirm"),
    });
    if (!ok) return;
    await resolve(async () => {
      // What the copy replaces stays in the version history, whatever the
      // snapshot interval says: this write means to take a file's place.
      if (await vaultAdapter.exists(originalOfConflict)) await backupAdapter?.forceBackup(originalOfConflict);
      await settleConflictCopy(vaultAdapter, originalOfConflict, conflictPath, seen, { disposition: "adopt" });
      tellEditorOf(originalOfConflict);
      toast.success(t("compare.resolvedAdopted"));
      return { originalPath: originalOfConflict, conflictPath, forkId, kind: "adopted", mergedContent: null, touched: [originalOfConflict, conflictPath] };
    });
  };
  const keepBothBytes = async () => {
    if (!vaultAdapter || !conflictPath || !originalOfConflict || sight?.at !== revision) return;
    const { seen } = sight;
    const candidate = await versionCopyPath(originalOfConflict, conflictStamp ?? new Date(), (p) => vaultAdapter.exists(p));
    const ok = await appConfirm({
      title: t("compare.keepBothTitle"),
      message: t("compare.keepBothPaths", { original: originalOfConflict, copy: candidate }),
      kind: "info",
      confirmLabel: t("compare.keepBoth"),
    });
    if (!ok) return;
    await resolve(async () => {
      await settleConflictCopy(vaultAdapter, originalOfConflict, conflictPath, seen, { disposition: "discard", keepCopyAs: candidate });
      tellEditorOf(originalOfConflict);
      toast.success(t("compare.resolvedKeptBoth", { name: candidate }));
      return { originalPath: originalOfConflict, conflictPath, forkId, kind: "keptBoth", mergedContent: null, touched: [conflictPath, candidate] };
    });
  };
  const discardBytes = async () => {
    if (!vaultAdapter || !conflictPath || !originalOfConflict || sight?.at !== revision) return;
    const { seen } = sight;
    const ok = await appConfirm({
      title: t("compare.discardTitle"),
      message: t("compare.discardPaths", { source: conflictPath, target: originalOfConflict }),
      kind: "danger",
      confirmLabel: t("compare.discardCopy"),
    });
    if (!ok) return;
    await resolve(async () => {
      await settleConflictCopy(vaultAdapter, originalOfConflict, conflictPath, seen, { disposition: "discard" });
      tellEditorOf(originalOfConflict);
      toast.success(t("compare.resolvedDiscarded"));
      return { originalPath: originalOfConflict, conflictPath, forkId, kind: "discarded", mergedContent: null, touched: [conflictPath] };
    });
  };

  /** Take the right side into the note — the copy as it is, or as merged. */
  const adoptRight = async () => {
    if (notText) return adoptBytes();
    if (!vaultAdapter || !conflictPath || !originalOfConflict || differentTasks || copySnapshot.current === null) return;
    // What takes the note's place: the copy as it lies there, or the reader's
    // text in the copy's shape — never the text of the comparison as it
    // stands, which has neither the copy's line ends nor its mark.
    const merged = adoptedCopyText(copySnapshot.current, mergeRef.current ? mergeRef.current.b.state.doc.toString() : conflictText ?? "");
    const ok = await appConfirm({
      title: rightEdited ? t("compare.mergeTitle") : t("compare.adoptTitle"),
      message: rightEdited
        ? t("compare.mergeMsg", { current: when(currentMtime) })
        : t("compare.replaceMessage", { source: conflictPath, target: originalOfConflict }),
      kind: "warning",
      confirmLabel: rightEdited ? t("compare.applyMerge") : t("compare.replaceConfirm"),
    });
    if (!ok) return;
    await resolve(async () => {
      // Same handshake as the version restore: a pending 1-s editor save for
      // the note would otherwise overwrite the resolution a second later.
      const session = await vaultAdapter.getConflictSession?.(originalOfConflict);
      if (session?.workingCopyPath === conflictPath && vaultAdapter.resolveConflict) {
        await vaultAdapter.resolveConflict(originalOfConflict, { originalText: originalSnapshot.current, copyText: copySnapshot.current!, content: merged });
      } else {
        await vaultAdapter.writeTextFile(originalOfConflict, merged);
        if (await vaultAdapter.readTextFile(conflictPath) !== copySnapshot.current) throw new Error("comparisonChanged");
        await vaultAdapter.deleteItem(conflictPath);
      }
      toast.success(rightEdited ? t("compare.resolvedMerged") : t("compare.resolvedAdopted"));
      return { originalPath: originalOfConflict, conflictPath, forkId, kind: rightEdited ? "merged" : "adopted", mergedContent: merged, touched: [originalOfConflict, conflictPath] };
    });
  };

  /** The note stays; the copy becomes a plain sibling named by its time. */
  const keepBoth = async () => {
    if (notText) return keepBothBytes();
    if (!vaultAdapter || !conflictPath || !originalOfConflict) return;
    const candidate = differentTasks ? await displacedTaskPath(vaultAdapter, originalOfConflict, copySnapshot.current!) : await versionCopyPath(originalOfConflict, conflictStamp ?? new Date(), (p) => vaultAdapter.exists(p));
    const ok = await appConfirm({
      title: t("compare.keepBothTitle"),
      message: t("compare.keepBothPaths", { original: originalOfConflict, copy: candidate }),
      kind: "info",
      confirmLabel: t(differentTasks ? "compare.keepSeparateTasks" : "compare.keepBoth"),
    });
    if (!ok) return;
    await resolve(async () => {
      const session = await vaultAdapter.getConflictSession?.(originalOfConflict);
      if (session?.workingCopyPath === conflictPath && vaultAdapter.resolveConflict) {
        await vaultAdapter.resolveConflict(originalOfConflict, { originalText: originalSnapshot.current, copyText: copySnapshot.current!, content: originalSnapshot.current ?? "", disposition: "discard", keepCopyAs: candidate });
      } else if (differentTasks) await separateTaskConflict(vaultAdapter, originalOfConflict, originalSnapshot.current!, conflictPath, copySnapshot.current!, candidate);
      else { if (await vaultAdapter.exists(candidate)) throw new Error("comparisonChanged"); await vaultAdapter.renameItem(conflictPath, candidate); }
      toast.success(t("compare.resolvedKeptBoth", { name: candidate }));
      return { originalPath: originalOfConflict, conflictPath, forkId, kind: "keptBoth", mergedContent: null, touched: [conflictPath, candidate] };
    });
  };

  /** The note stays; the copy is deleted (a snapshot of it remains). */
  const discardCopy = async () => {
    if (notText) return discardBytes();
    if (!vaultAdapter || !conflictPath || !originalOfConflict || differentTasks) return;
    const ok = await appConfirm({
      title: t("compare.discardTitle"),
      message: t("compare.discardPaths", { source: conflictPath, target: originalOfConflict }),
      kind: "danger",
      confirmLabel: t("compare.discardCopy"),
    });
    if (!ok) return;
    await resolve(async () => {
      const session = await vaultAdapter.getConflictSession?.(originalOfConflict);
      if (session?.workingCopyPath === conflictPath && vaultAdapter.resolveConflict) {
        await vaultAdapter.resolveConflict(originalOfConflict, { originalText: originalSnapshot.current, copyText: copySnapshot.current!, content: originalSnapshot.current ?? "", disposition: "discard" });
      } else await vaultAdapter.deleteItem(conflictPath);
      toast.success(t("compare.resolvedDiscarded"));
      return { originalPath: originalOfConflict, conflictPath, forkId, kind: "discarded", mergedContent: null, touched: [conflictPath] };
    });
  };

  // ---- rendering ------------------------------------------------------------

  const sideMeta = (text: string | null, mtime: number | Date | null) =>
    text === null ? "" : t("compare.sizeLines", { size: formatBytes(new TextEncoder().encode(text).length), lines: lineCount(text) }) + (mtime ? ` · ${when(mtime)}` : "");

  const rightTitle = isConflict ? t("compare.conflictCopy") : t("compare.savedVersion");
  const rightSubtitle = isConflict
    ? when(conflictStamp)
    : selected
      ? when(selected.timestamp)
      : "";

  const footerStats = (() => {
    if (!canDiff || differentTasks) return null;
    if (!stats) return t("compare.countsUnavailable");
    if (stats.hunks === 0) return t("compare.identical");
    const cost = isConflict
      ? rightEdited
        ? t("compare.costMerge")
        : t("compare.costAdopt", { added: stats.added, removed: stats.removed })
      : t("compare.costRestore", { added: stats.added, removed: stats.removed });
    return `${t("compare.stats", { hunks: stats.hunks, same: stats.same })} — ${cost}`;
  })();

  const header = (
    <div style={{ display: "flex", gap: "0.75rem", padding: "0.5rem 0.9rem", borderBottom: "1px solid var(--border-color)", flexShrink: 0, fontSize: "var(--text-sm)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "var(--text-main)", fontWeight: 600 }}>{t("compare.currentFile")}</div>
        <div style={{ color: "var(--text-muted)" }}>{sideMeta(currentText, currentMtime)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.4px", fontSize: "var(--text-xs)" }}>{t("compare.sideRight", { what: rightTitle })}</div>
        <div style={{ color: "var(--text-main)", fontWeight: 600 }}>{rightSubtitle}</div>
        <div style={{ color: "var(--text-muted)" }}>{sideMeta(rightText, isConflict ? null : null)}</div>
      </div>
    </div>
  );

  const content = (
    <div className="custom-scrollbar" style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg-primary)" }}>
      {diffMounted ? (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div ref={hostRef} data-testid="version-diff-host" className="pv-merge-host" style={{ flex: 1, minHeight: 0 }} />
        </div>
      ) : !isConflict && selected && isText && versionText !== null ? (
        <pre data-testid="version-preview" style={{ margin: 0, padding: "0.8rem 1rem", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-content)", fontSize: "var(--text-md)", lineHeight: 1.5 }}>{versionText}</pre>
      ) : !isConflict && selected && isImage && imageUrl ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", height: "100%" }}>
          <img src={imageUrl} alt={basename} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </div>
      ) : !isConflict && selected ? (
        // No preview: an image format the viewer does not have, any other kind
        // of bytes — and a version whose name says text and whose bytes do not.
        <div data-testid="version-no-preview" style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>
          {t(unreadableVersion === selected.backupPath ? "editor.notTextBody" : "versions.binaryNoPreview")} ({formatBytes(selected.size)})
        </div>
      ) : isConflict && notText ? (
        <div data-testid="compare-not-text" style={{ padding: "var(--space-4)", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>
          {t(isText ? "editor.notTextBody" : "versions.binaryNoPreview")}
        </div>
      ) : isConflict && (currentText === null || rightText === null) && !error ? (
        <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>{t("versions.loading")}</div>
      ) : null}
    </div>
  );

  const footer = (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.9rem", borderTop: "1px solid var(--border-color)", flexShrink: 0, flexWrap: "wrap" }}>
      <span data-testid="compare-stats" style={{ flex: 1, minWidth: 200, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{footerStats}</span>
      {isConflict ? (
        <>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t("compare.later")}</Button>
          {!differentTasks && <Button size="sm" variant="secondary" data-testid="compare-discard" onClick={() => { void discardCopy(); }} disabled={busy || !sidesKnown}>{t("compare.discardCopy")}</Button>}
          <Button size="sm" variant={differentTasks ? "primary" : "secondary"} data-testid="compare-keep-both" onClick={() => { void keepBoth(); }} disabled={busy || !sidesKnown}>{t(differentTasks ? "compare.keepSeparateTasks" : "compare.keepBoth")}</Button>
          {!differentTasks && <Button size="sm" variant="primary" data-testid="compare-adopt" onClick={() => { void adoptRight(); }} disabled={busy || !sidesKnown}>
            {rightEdited ? t("compare.applyMerge") : t("compare.adoptCopy")}
          </Button>}
        </>
      ) : (
        <>
          {!standalone && selected && <Button size="sm" icon={<ExternalLink size={ICON.ui} />} data-testid="version-popout" disabled={busy} onClick={() => {
            if (!vaultPath) return;
            const transferPath = comparisonPath(path, selected.backupPath, orphan);
            void (async () => {
              if (isOwnerWindow()) {
                const { openOrFocusContent } = await import("../services/windowManager");
                await openOrFocusContent({ vaultPath, path: transferPath, newWindow: true, title: `${t("compare.title")} · ${basename}` });
              } else {
                const { getWindowBus } = await import("../services/windowBus");
                await (await getWindowBus()).request("open-content", { path: transferPath, newWindow: true, from: currentWindowParams().label ?? undefined }, { vaultPath });
              }
              onClose();
            })().catch(() => setError(t("compare.windowFailed")));
          }}>{t("window.openInNewWindow")}</Button>}
          {canDiff && (
            <Checkbox checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)}>
              {t("versions.diffToggle")}
            </Checkbox>
          )}
          <Button size="sm" icon={<Copy size={ICON.ui} />} data-testid="version-restore-copy" onClick={doRestoreAsCopy} disabled={busy || !selected}>
            {t("versions.restoreAsCopy")}
          </Button>
          <Button size="sm" variant="primary" icon={<RotateCcw size={ICON.ui} />} data-testid="version-restore" onClick={doRestore} disabled={busy || !selected}>
            {t("compare.restoreThis")}
          </Button>
        </>
      )}
    </div>
  );

  const body = <>
      {isConflict && conflictPath ? <FileComparisonDetails vault={vaultPath ?? "Plainva"} originalPath={path} copyPath={conflictPath} original={currentText} copy={conflictText} onReveal={file => { onClose(); window.dispatchEvent(new CustomEvent("plainva-reveal-folder", { detail: { path: file } })); }} /> : <div style={{ padding: "0.45rem 1rem", fontSize: "var(--text-sm)", color: "var(--text-muted)", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-color)", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-tip={path}>
        {path}
        {orphan && <> — {t("versions.orphanHint")}</>}
        {isConflict && <> — {t("compare.conflictExplainer")}</>}
      </div>}
      {isConflict && <p className="pv-comparison-explainer">{t(differentTasks ? "compare.differentTasksHint" : "compare.replaceHint", { name: basename })}</p>}
      {isConflict && vaultAdapter && conflictPath && <ConflictHistory files={vaultAdapter} path={path} copyPath={conflictPath} current={currentText} copy={conflictText} />}

      {isConflict && !originalOfConflict ? (
        <div style={{ padding: "1rem", color: "var(--error-text)" }}>{t("conflict.notAConflictFile")}</div>
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {!isConflict && (
            <div className="custom-scrollbar" style={{ width: "250px", flexShrink: 0, overflowY: "auto", borderRight: "1px solid var(--border-color)", background: "var(--bg-secondary)", padding: "0.5rem" }}>
              {versions === null && <div style={{ padding: "0.6rem", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>{t("versions.loading")}</div>}
              {versions !== null && versions.length === 0 && (
                <div style={{ padding: "0.6rem", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>{t("versions.empty")}</div>
              )}
              {grouped.map((group) => (
                <div key={group.day} style={{ marginBottom: "0.4rem" }}>
                  <div style={{ padding: "0.35rem 0.4rem 0.2rem", fontSize: "var(--text-sm)", textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--text-faint)" }}>{group.day}</div>
                  {group.items.map((v, idx) => {
                    const isSel = selected?.backupPath === v.backupPath;
                    const older = group.items[idx + 1] ?? (versions ?? [])[(versions ?? []).indexOf(v) + 1];
                    const delta = older ? v.size - older.size : null;
                    return (
                      <button
                        key={v.backupPath}
                        data-version={v.backupPath}
                        aria-pressed={isSel}
                        data-testid="version-item"
                        onClick={() => setSelected(v)}
                        style={{
                          display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem", width: "100%", textAlign: "left",
                          padding: "0.4rem 0.5rem", borderRadius: "var(--radius-sm)", cursor: "pointer",
                          border: "1px solid " + (isSel ? "var(--accent-color)" : "transparent"),
                          background: isSel ? "var(--bg-hover)" : "transparent", color: "var(--text-main)",
                        }}
                      >
                        <span style={{ fontVariantNumeric: "tabular-nums" }}>{timeLabel.format(new Date(v.timestamp))}</span>
                        {delta !== null && delta !== 0 && (
                          <span style={{ fontSize: "var(--text-xs)", color: delta > 0 ? "var(--success-text)" : "var(--error-text)" }}>
                            {delta > 0 ? "+" : "−"}{formatBytes(Math.abs(delta))}
                          </span>
                        )}
                        <span style={{ marginLeft: "auto", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{formatBytes(v.size)}</span>
                        {isSel && stats && <span data-testid="version-row-lines" style={{ flexBasis: "100%", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{t("compare.lineChanges", { added: stats.added, removed: stats.removed })}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            {(isConflict || (selected && canDiff && showDiff)) && header}
            {(error || notice) && (
              <div style={{ padding: "0.4rem 0.9rem", fontSize: "var(--text-sm)", flexShrink: 0, color: error ? "var(--error-text)" : "var(--text-muted)", borderBottom: "1px solid var(--border-color)" }}>
                {error || notice}
              </div>
            )}
            {isConflict && !differentTasks && !notText && (
              <div style={{ padding: "0.3rem 0.9rem", fontSize: "var(--text-sm)", color: "var(--text-faint)", flexShrink: 0 }}>{t("compare.mergeHint")}</div>
            )}
            {content}
            {footer}
          </div>
        </div>
      )}
  </>;
  return standalone ? <section data-testid="comparison-window" aria-label={t("compare.title")} style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>{body}</section> : (
    <Modal onClose={() => { if (!busy) onClose(); }} title={t("compare.title")} size="xl"
      testId={isConflict ? "compare-modal" : "version-history-modal"} closeOnOverlay={!busy} bodyClassName="pv-modal-body--flush">{body}</Modal>
  );
};
