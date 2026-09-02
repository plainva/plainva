import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, Copy } from "lucide-react";
import { appConfirm } from "../services/appDialogs";
import {
  Button,
  Checkbox,
  ICON,
  Modal,
  compareStats,
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
import { VersionHistoryService, isTextLikePath, type FileVersion } from "@plainva/core";
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
  | { kind: "version"; path: string; orphan?: boolean }
  | { kind: "conflict"; conflictPath: string };

/** What became of a conflict — the host re-indexes `touched` and adopts `mergedContent`. */
export interface ConflictOutcome {
  originalPath: string;
  conflictPath: string;
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
}> = ({ subject, onClose, onRestored, onResolved }) => {
  const { t, i18n } = useTranslation();
  const { vaultAdapter, backupAdapter, indexer, triggerFileTreeUpdate, workspaceSecurityStatus, listWorkspaceRevisions, readWorkspaceRevision } = useVault();
  const workspaceHistory = workspaceSecurityStatus !== null;

  const isConflict = subject.kind === "conflict";
  const conflictPath = isConflict ? subject.conflictPath : null;
  const originalOfConflict = conflictPath ? conflictOriginalPath(conflictPath) : null;
  // The note both cases talk about.
  const path = isConflict ? originalOfConflict ?? subject.conflictPath : subject.path;
  const orphan = !isConflict && subject.orphan === true;

  const basename = path.split(/[/\\]/).pop() || path;
  const isText = isTextLikePath(path);
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
  const hostRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);

  const service = useMemo(() => (vaultAdapter ? new VersionHistoryService(vaultAdapter) : null), [vaultAdapter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The note's current text + modification time (the left side, both cases).
  useEffect(() => {
    let alive = true;
    if (!vaultAdapter || orphan || !isText) return;
    vaultAdapter
      .readTextFile(path)
      .then((text) => alive && setCurrentText(text.replace(/\r\n/g, "\n")))
      .catch(() => alive && setCurrentText(isConflict ? "" : null));
    vaultAdapter
      .getFileInfo(path)
      .then((info) => alive && setCurrentMtime(info.mtime))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [vaultAdapter, path, orphan, isText, isConflict]);

  // Conflict: the preserved copy (the right side).
  useEffect(() => {
    let alive = true;
    if (!vaultAdapter || !conflictPath) return;
    vaultAdapter
      .readTextFile(conflictPath)
      .then((text) => alive && setConflictText(text.replace(/\r\n/g, "\n")))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [vaultAdapter, conflictPath]);

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
        setSelected(list[0] ?? null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [isConflict, service, path, workspaceHistory, listWorkspaceRevisions]);

  // Version history: the selected version's content (text or image blob).
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setVersionText(null);
    setImageUrl(null);
    if (isConflict || (!service && !workspaceHistory) || !selected) return;
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
  }, [isConflict, service, selected, isText, isImage, path, workspaceHistory, readWorkspaceRevision]);

  // The right side: the other version.
  const rightText = isConflict ? conflictText : versionText;
  const canDiff = isText && !orphan && currentText !== null && rightText !== null;
  const diffMounted = isConflict ? canDiff : canDiff && showDiff;

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
        extensions: isConflict
          ? [EditorView.lineWrapping, EditorView.updateListener.of((u) => { if (u.docChanged) setRightEdited(true); })]
          : readOnlyExt,
      },
      parent: host,
      collapseUnchanged: COLLAPSE,
      ...(isConflict ? { revertControls: "a-to-b" as const } : {}),
    });
    mergeRef.current = view;
    return () => {
      mergeRef.current = null;
      view.destroy();
    };
  }, [diffMounted, currentText, rightText, isConflict]);

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
        if (isTextLikePath(candidate)) await vaultAdapter.writeTextFile(candidate, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        else await vaultAdapter.writeBinaryFile(candidate, bytes);
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
    setBusy(true);
    try {
      const outcome = await work();
      onResolved?.(outcome);
    } catch (e) {
      setBusy(false);
      toast.error(t("conflict.resolveFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  /** Take the right side into the note — the copy as it is, or as merged. */
  const adoptRight = async () => {
    if (!vaultAdapter || !conflictPath || !originalOfConflict) return;
    const merged = mergeRef.current ? mergeRef.current.b.state.doc.toString() : conflictText ?? "";
    const ok = await appConfirm({
      title: rightEdited ? t("compare.mergeTitle") : t("compare.adoptTitle"),
      message: rightEdited
        ? t("compare.mergeMsg", { current: when(currentMtime) })
        : t("compare.adoptMsg", { other: when(conflictStamp), current: when(currentMtime) }),
      kind: "warning",
      confirmLabel: rightEdited ? t("compare.applyMerge") : t("compare.adoptCopy"),
    });
    if (!ok) return;
    await resolve(async () => {
      // Same handshake as the version restore: a pending 1-s editor save for
      // the note would otherwise overwrite the resolution a second later.
      await requestSaveFlush(originalOfConflict);
      await vaultAdapter.writeTextFile(originalOfConflict, merged);
      await vaultAdapter.deleteItem(conflictPath);
      toast.success(rightEdited ? t("compare.resolvedMerged") : t("compare.resolvedAdopted"));
      return { originalPath: originalOfConflict, conflictPath, kind: rightEdited ? "merged" : "adopted", mergedContent: merged, touched: [originalOfConflict, conflictPath] };
    });
  };

  /** The note stays; the copy becomes a plain sibling named by its time. */
  const keepBoth = async () => {
    if (!vaultAdapter || !conflictPath || !originalOfConflict) return;
    const candidate = await versionCopyPath(originalOfConflict, conflictStamp ?? new Date(), (p) => vaultAdapter.exists(p));
    const ok = await appConfirm({
      title: t("compare.keepBothTitle"),
      message: t("compare.keepBothMsg", { name: candidate }),
      kind: "info",
      confirmLabel: t("compare.keepBoth"),
    });
    if (!ok) return;
    await resolve(async () => {
      await vaultAdapter.renameItem(conflictPath, candidate);
      toast.success(t("compare.resolvedKeptBoth", { name: candidate }));
      return { originalPath: originalOfConflict, conflictPath, kind: "keptBoth", mergedContent: null, touched: [conflictPath, candidate] };
    });
  };

  /** The note stays; the copy is deleted (a snapshot of it remains). */
  const discardCopy = async () => {
    if (!vaultAdapter || !conflictPath || !originalOfConflict) return;
    const ok = await appConfirm({
      title: t("compare.discardTitle"),
      message: t("compare.discardMsg", { other: when(conflictStamp) }),
      kind: "danger",
      confirmLabel: t("compare.discardCopy"),
    });
    if (!ok) return;
    await resolve(async () => {
      await vaultAdapter.deleteItem(conflictPath);
      toast.success(t("compare.resolvedDiscarded"));
      return { originalPath: originalOfConflict, conflictPath, kind: "discarded", mergedContent: null, touched: [conflictPath] };
    });
  };

  // ---- rendering ------------------------------------------------------------

  const sideMeta = (text: string | null, mtime: number | Date | null) =>
    text === null ? "" : t("compare.sizeLines", { size: formatBytes(new TextEncoder().encode(text).length), lines: lineCount(text) }) + (mtime ? ` · ${when(mtime)}` : "");

  const rightTitle = isConflict ? t("compare.conflictCopy") : t("compare.savedVersion");
  const rightSubtitle = isConflict
    ? t("compare.yourVersionKept", { when: when(conflictStamp) })
    : selected
      ? when(selected.timestamp)
      : "";

  const footerStats = (() => {
    if (!diffMounted || !stats) return null;
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
        <div style={{ color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.4px", fontSize: "var(--text-xs)" }}>{t("compare.sideLeft")}</div>
        <div style={{ color: "var(--text-main)", fontWeight: 600 }}>{isConflict ? t("compare.cameViaSync") : t("compare.currentState")}</div>
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
        <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>
          {t("versions.binaryNoPreview")} ({formatBytes(selected.size)})
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
          <Button size="sm" variant="secondary" data-testid="compare-discard" onClick={() => { void discardCopy(); }} disabled={busy || rightText === null}>{t("compare.discardCopy")}</Button>
          <Button size="sm" variant="secondary" data-testid="compare-keep-both" onClick={() => { void keepBoth(); }} disabled={busy || rightText === null}>{t("compare.keepBoth")}</Button>
          <Button size="sm" variant="primary" data-testid="compare-adopt" onClick={() => { void adoptRight(); }} disabled={busy || rightText === null}>
            {rightEdited ? t("compare.applyMerge") : t("compare.adoptCopy")}
          </Button>
        </>
      ) : (
        <>
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

  return (
    <Modal
      onClose={() => { if (!busy) onClose(); }}
      title={t("compare.title")}
      size="xl"
      testId={isConflict ? "compare-modal" : "version-history-modal"}
      closeOnOverlay={!busy}
      bodyClassName="pv-modal-body--flush"
    >
      <div style={{ padding: "0.45rem 1rem", fontSize: "var(--text-sm)", color: "var(--text-muted)", background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-color)", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-tip={path}>
        {path}
        {orphan && <> — {t("versions.orphanHint")}</>}
        {isConflict && <> — {t("compare.conflictExplainer")}</>}
      </div>

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
                        {delta !== null && delta !== 0 && (
                          <span style={{ fontSize: "var(--text-xs)", color: delta > 0 ? "var(--success-text)" : "var(--error-text)" }}>
                            {delta > 0 ? "+" : "−"}{formatBytes(Math.abs(delta))}
                          </span>
                        )}
                        <span style={{ marginLeft: "auto", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{formatBytes(v.size)}</span>
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
            {isConflict && (
              <div style={{ padding: "0.3rem 0.9rem", fontSize: "var(--text-sm)", color: "var(--text-faint)", flexShrink: 0 }}>{t("compare.mergeHint")}</div>
            )}
            {content}
            {footer}
          </div>
        </div>
      )}
    </Modal>
  );
};
