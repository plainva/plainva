import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Checkbox, Modal, toast } from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";
import {
  okfMigrationPending,
  okfVersionBreakdown,
  rollbackOkfConversion,
  runOkfMigration,
  scanVaultOkfVersion,
  type OkfRunReport,
  type OkfVersionState,
} from "../services/okfMigration";

type Step = "scanning" | "summary" | "running" | "report";

/**
 * OKF bundle migration (OKF v0.2 plan, P2): lift the root index.md from the
 * version it declares to the one Plainva writes, and — opt-in, checked by
 * default (D2) — remove the legacy per-note `okf_version` key.
 *
 * Dry-run numbers first, then the run through the FULL adapter chain (backup
 * per file, sync queue, conflict detection) — the same chain as the conversion
 * wizard, explicitly not the raw adapter. A vault without a root index.md has
 * nothing to declare (valid per spec); the dialog then offers only the cleanup
 * and points to the index.md manager for creating one.
 */
export const OkfMigrationModal: React.FC<{
  onClose: () => void;
  onMigrated?: () => void;
  onOpenIndexManager?: () => void;
}> = ({ onClose, onMigrated, onOpenIndexManager }) => {
  const { t } = useTranslation();
  const { vaultAdapter, queryService, indexer, triggerFileTreeUpdate } = useVault();

  const [step, setStep] = useState<Step>("scanning");
  const [state, setState] = useState<OkfVersionState | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [stripNotes, setStripNotes] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [report, setReport] = useState<OkfRunReport | null>(null);
  const [undoing, setUndoing] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    let alive = true;
    if (!vaultAdapter || !queryService) return;
    scanVaultOkfVersion({ queryService, adapter: vaultAdapter })
      .then((result) => {
        if (!alive) return;
        setState(result);
        setStep("summary");
      })
      .catch((e) => {
        if (!alive) return;
        setScanError(e instanceof Error ? e.message : String(e));
        setStep("summary");
      });
    return () => { alive = false; };
  }, [vaultAdapter, queryService]);

  const rootPending = !!state && state.rootIndex.exists && state.rootIndex.declared !== null && !state.rootIndex.current;
  const legacyCount = state?.notesWithVersion.length ?? 0;
  const pending = !!state && okfMigrationPending(state, stripNotes);

  const runMigration = async () => {
    if (!vaultAdapter || !state) return;
    cancelRef.current = false;
    const total = (rootPending ? 1 : 0) + (stripNotes ? legacyCount : 0);
    setProgress({ done: 0, total });
    setStep("running");
    const result = await runOkfMigration({
      adapter: vaultAdapter,
      state,
      stripNoteVersion: stripNotes,
      onProgress: (done, t2) => setProgress({ done, total: t2 }),
      isCancelled: () => cancelRef.current,
    });
    setReport(result);
    // Refresh index + open editors so the changed frontmatter is visible everywhere.
    try {
      await indexer?.indexVaultFull();
      triggerFileTreeUpdate();
      for (const path of result.changed) {
        window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path } }));
      }
    } catch (e) {
      console.warn("[OkfMigration] re-index after migration failed", e);
    }
    setStep("report");
    onMigrated?.();
  };

  /** Puts every file this run changed back, from its own backup folder. */
  const undoRun = async () => {
    if (!report?.backupDir || !vaultAdapter) return;
    setUndoing(true);
    try {
      const result = await rollbackOkfConversion(vaultAdapter, report.backupDir);
      if (result.failed.length > 0) toast.error(t("okf.rollbackFailed", { count: result.failed.length }));
      else toast.info(t("okf.rollbackDone", { count: result.restored.length }));
      try {
        await indexer?.indexVaultFull();
        triggerFileTreeUpdate();
        for (const path of result.restored) {
          window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path } }));
        }
      } catch (e) {
        console.warn("[OkfMigration] re-index after undo failed", e);
      }
      onMigrated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUndoing(false);
    }
  };

  const rowStyle: React.CSSProperties = { fontSize: "var(--text-md)", margin: "0.2rem 0" };
  const running = step === "running";
  const version = state?.targetVersion ?? "";

  return (
    <Modal
      onClose={() => { if (!running) onClose(); }}
      title={t("okf.migrationTitle", { version })}
      size="md"
      hideClose={running}
      closeOnOverlay={!running}
      footer={
        step === "summary" ? (
          <>
            <Button onClick={onClose}>{t("okf.cancel")}</Button>
            <Button variant="primary" onClick={runMigration} disabled={!pending} data-testid="okf-migration-run">
              {rootPending ? t("okf.migrationRun") : t("okf.migrationRunClean")}
            </Button>
          </>
        ) : running ? (
          <Button onClick={() => { cancelRef.current = true; }}>{t("okf.cancelRun")}</Button>
        ) : step === "report" && report ? (
          <>
            {report.backupDir && report.changed.length > 0 && (
              <Button disabled={undoing} onClick={undoRun}>{t("okf.undoMigration")}</Button>
            )}
            <Button variant="primary" onClick={onClose}>{t("okf.close")}</Button>
          </>
        ) : undefined
      }
    >
      {step === "scanning" && <div style={rowStyle}>{t("okf.scanning")}</div>}

      {step === "summary" && (
        <>
          {scanError && <div style={{ ...rowStyle, color: "var(--error-text)" }}>{scanError}</div>}
          {state && (
            <>
              {!state.rootIndex.exists ? (
                <div style={rowStyle}>{t("okf.migrationIntroNoRoot")}</div>
              ) : state.rootIndex.declared === null ? (
                <div style={rowStyle}>{t("okf.migrationIntroNoDeclaration")}</div>
              ) : state.rootIndex.current ? (
                <div style={rowStyle}>{t("okf.migrationIntroCurrent", { version })}</div>
              ) : (
                <div style={rowStyle}>{t("okf.migrationIntro", { declared: state.rootIndex.declared })}</div>
              )}
              <ul style={{ margin: "0.3rem 0 0.8rem 1.1rem", padding: 0, fontSize: "var(--text-md)" }}>
                {rootPending && (
                  <li data-testid="okf-migration-root">
                    {t("okf.migrationRootLine", { from: state.rootIndex.declared, to: version })}
                  </li>
                )}
                <li>
                  {legacyCount > 0 ? (
                    <>
                      <Checkbox
                        checked={stripNotes}
                        onChange={(e) => setStripNotes(e.target.checked)}
                        data-testid="okf-migration-strip"
                      >
                        {t("okf.migrationStripLabel", { count: legacyCount })}
                      </Checkbox>
                      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginLeft: "1.6rem" }}>
                        {t("okf.migrationStripHint", { breakdown: okfVersionBreakdown(state) })}
                      </div>
                    </>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>{t("okf.migrationStripNone")}</span>
                  )}
                </li>
              </ul>
              {!pending && <div style={rowStyle}>{t("okf.migrationNothing")}</div>}
              {!state.rootIndex.exists && onOpenIndexManager && (
                <div style={{ ...rowStyle, color: "var(--text-muted)" }}>
                  {t("okf.migrationIndexHint")}{" "}
                  <Button variant="ghost" onClick={() => { onClose(); onOpenIndexManager(); }}>
                    {t("settings.okfIndexButton")}
                  </Button>
                </div>
              )}
              {pending && <div style={{ ...rowStyle, color: "var(--text-muted)" }}>{t("okf.migrationBackupHint")}</div>}
            </>
          )}
        </>
      )}

      {step === "running" && (
        <>
          <div style={rowStyle}>{t("okf.progress", { done: progress.done, total: progress.total })}</div>
          <div style={{ height: 6, background: "var(--bg-secondary)", borderRadius: "var(--radius-xs)", margin: "0.6rem 0" }}>
            <div style={{ height: "100%", width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: "var(--accent-color)", borderRadius: "var(--radius-xs)", transition: "width var(--dur-1) var(--ease-1)" }} />
          </div>
        </>
      )}

      {step === "report" && report && (
        <>
          <div style={rowStyle}>{report.cancelled ? t("okf.migrationCancelled") : t("okf.migrationDone")}</div>
          <ul style={{ margin: "0.3rem 0 0.6rem 1.1rem", padding: 0, fontSize: "var(--text-md)" }}>
            <li>{t("okf.reportChanged", { count: report.changed.length })}</li>
            <li>{t("okf.reportUnchanged", { count: report.unchanged })}</li>
            {report.skipped.length > 0 && <li style={{ color: "var(--error-text)" }}>{t("okf.reportSkipped", { count: report.skipped.length })}</li>}
          </ul>
          {report.skipped.length > 0 && (
            <pre style={{ maxHeight: 120, overflowY: "auto", background: "var(--bg-secondary)", borderRadius: "var(--radius-xs)", padding: "0.4rem", fontSize: "var(--text-sm)" }}>
              {report.skipped.map((s) => `${s.path}: ${s.error}`).join("\n")}
            </pre>
          )}
          {report.backupDir && (
            <div style={{ ...rowStyle, color: "var(--text-muted)" }}>{t("okf.reportBackup", { dir: report.backupDir })}</div>
          )}
        </>
      )}
    </Modal>
  );
};
