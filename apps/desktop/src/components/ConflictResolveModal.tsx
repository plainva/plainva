import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@plainva/ui";
import { Button } from "@plainva/ui";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useVault } from "../contexts/VaultContext";
import { conflictOriginalPath } from "@plainva/ui";
import { appConfirm } from "../services/appDialogs";
import { toast } from "@plainva/ui";
import { requestSaveFlush } from "../services/saveFlush";

/**
 * Resolves a sync conflict copy (P3.11). Left: the CURRENT file (the other
 * side, read-only). Right: YOUR preserved version — editable, with per-chunk
 * revert controls to pull lines over from the left. "Resolve" writes the
 * right side into the original file and removes the .CONFLICT copy; "keep
 * other side" just removes the copy. Built on the same @codemirror/merge
 * infrastructure as the version history diff.
 */
export const ConflictResolveModal: React.FC<{
  conflictPath: string;
  onClose: () => void;
  onResolved: (originalPath: string, conflictPath: string, mergedContent: string | null) => void;
}> = ({ conflictPath, onClose, onResolved }) => {
  const { t } = useTranslation();
  const { vaultAdapter } = useVault();
  const originalPath = conflictOriginalPath(conflictPath);
  const [currentText, setCurrentText] = useState<string | null>(null);
  const [conflictText, setConflictText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mergeRef = useRef<MergeView | null>(null);

  useEffect(() => {
    if (!vaultAdapter || !originalPath) return;
    let alive = true;
    void (async () => {
      try {
        const [cur, conf] = await Promise.all([
          vaultAdapter.readTextFile(originalPath).catch(() => ""),
          vaultAdapter.readTextFile(conflictPath),
        ]);
        if (alive) {
          setCurrentText(cur.replace(/\r\n/g, "\n"));
          setConflictText(conf.replace(/\r\n/g, "\n"));
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [vaultAdapter, originalPath, conflictPath]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || currentText === null || conflictText === null) return;
    const view = new MergeView({
      a: { doc: currentText, extensions: [EditorView.editable.of(false), EditorState.readOnly.of(true), EditorView.lineWrapping] },
      b: { doc: conflictText, extensions: [EditorView.lineWrapping] },
      parent: host,
      revertControls: "a-to-b",
    });
    mergeRef.current = view;
    return () => {
      mergeRef.current = null;
      view.destroy();
    };
  }, [currentText, conflictText]);

  const resolveWithMerged = async () => {
    if (!vaultAdapter || !originalPath) return;
    const merged = mergeRef.current ? mergeRef.current.b.state.doc.toString() : conflictText ?? "";
    setBusy(true);
    try {
      // Same handshake as the version restore: a pending 1-s editor save for
      // the original would otherwise overwrite the resolution a second later.
      await requestSaveFlush(originalPath);
      await vaultAdapter.writeTextFile(originalPath, merged);
      await vaultAdapter.deleteItem(conflictPath);
      onResolved(originalPath, conflictPath, merged);
    } catch (e) {
      setBusy(false);
      toast.error(t("conflict.resolveFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const keepOtherSide = async () => {
    if (!vaultAdapter || !originalPath) return;
    const ok = await appConfirm({
      title: t("conflict.keepOtherTitle"),
      message: t("conflict.keepOtherMsg"),
      kind: "danger",
      confirmLabel: t("conflict.keepOtherConfirm"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await vaultAdapter.deleteItem(conflictPath);
      onResolved(originalPath, conflictPath, null);
    } catch (e) {
      setBusy(false);
      toast.error(t("conflict.resolveFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <Modal title={t("conflict.title")} onClose={onClose} size="xl">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", minHeight: 0 }}>
        {!originalPath ? (
          <div style={{ color: "var(--error-text)" }}>{t("conflict.notAConflictFile")}</div>
        ) : error ? (
          <div style={{ color: "var(--error-text)" }}>{error}</div>
        ) : (
          <>
            <div style={{ fontSize: "var(--text-ui)", color: "var(--text-muted)" }}>
              {t("conflict.explainer", { file: originalPath })}
            </div>
            <div style={{ display: "flex", gap: "0.75rem", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              <span style={{ flex: 1 }}>{t("conflict.leftLabel")}</span>
              <span style={{ flex: 1 }}>{t("conflict.rightLabel")}</span>
            </div>
            <div
              ref={hostRef}
              className="pv-merge-host"
              style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", overflow: "auto", maxHeight: "56vh", minHeight: 200 }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", flexWrap: "wrap" }}>
              <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
              <Button variant="secondary" onClick={() => { void keepOtherSide(); }} disabled={busy || currentText === null}>
                {t("conflict.keepOther")}
              </Button>
              <Button variant="primary" onClick={() => { void resolveWithMerged(); }} disabled={busy || conflictText === null}>
                {t("conflict.resolveWithMine")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
