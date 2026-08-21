import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { App as CapApp } from "@capacitor/app";
import { okfMigrationPending, type OkfVersionState } from "@plainva/core";
import { Button, Checkbox, GroupCard, Row, RowList, SectionLabel, okfVersionBreakdown, toast } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import {
  migrateVaultOkf,
  scanVaultOkfVersion,
  undoOkfMigration,
  type OkfRunReport,
} from "../services/okfMigration";
import type { MobileVault } from "../services/vaultService";

/**
 * Lifting the bundle to the OKF version Plainva writes, from the phone (OKF
 * v0.2 plan, P2). Same shape as the conversion screen — numbers and names
 * first, then a determinate run that backgrounding pauses — but without the
 * journal: every edit here is idempotent and reversible from its backup
 * folder, and a half-finished run is a valid, visible state the next scan
 * simply offers to finish (see the service for the full reasoning).
 */

type Step = "scanning" | "summary" | "running" | "report";

interface Progress {
  done: number;
  total: number;
  path: string;
}

export function OkfMigrationScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("scanning");
  const [state, setState] = useState<OkfVersionState | null>(null);
  const [stripNotes, setStripNotes] = useState(true);
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 0, path: "" });
  const [report, setReport] = useState<OkfRunReport | null>(null);
  const [busy, setBusy] = useState(false);
  /** Read by the run loop between files; a ref because the loop does not re-render. */
  const cancelRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const result = await scanVaultOkfVersion(vault);
      setState(result);
      setStep("summary");
    } catch (e) {
      toast.error(`${t("okf.scanning")} — ${e instanceof Error ? e.message : String(e)}`);
      onBack();
    }
  }, [onBack, t, vault]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Backgrounding pauses — a run the user cannot see is a run they cannot stop. */
  useEffect(() => {
    if (step !== "running") return;
    const handle = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) cancelRef.current = true;
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [step]);

  useLeaveGuard("okfmigration", step === "running", t("mobile.leaveWizard"));

  const rootPending = !!state && state.rootIndex.exists && state.rootIndex.declared !== null && !state.rootIndex.current;
  const legacyCount = state?.notesWithVersion.length ?? 0;
  const pending = !!state && okfMigrationPending(state, stripNotes);
  const version = state?.targetVersion ?? "";

  const refreshIndex = async (paths: string[]) => {
    try {
      await vault.indexer?.indexVaultFull();
    } catch {
      // The index catches up on the next pass; the files themselves are written.
    }
    window.dispatchEvent(new CustomEvent("m-index-changed"));
    for (const path of paths) {
      window.dispatchEvent(new CustomEvent("m-external-update", { detail: { path } }));
    }
  };

  const run = async () => {
    if (!state) return;
    cancelRef.current = false;
    setProgress({ done: 0, total: (rootPending ? 1 : 0) + (stripNotes ? legacyCount : 0), path: "" });
    setStep("running");
    try {
      const result = await migrateVaultOkf({
        vault,
        state,
        stripNoteVersion: stripNotes,
        onProgress: (done, total, path) => setProgress({ done, total, path }),
        isCancelled: () => cancelRef.current,
      });
      setReport(result);
      await refreshIndex(result.changed);
      setStep("report");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setStep("summary");
    }
  };

  const undo = async (backupDir: string) => {
    setBusy(true);
    setProgress({ done: 0, total: 0, path: "" });
    try {
      const result = await undoOkfMigration(vault, backupDir, (done, total) => setProgress({ done, total, path: "" }));
      if (result.failed.length > 0) toast.error(t("okf.rollbackFailed", { count: result.failed.length }));
      else toast.info(t("okf.rollbackDone", { count: result.restored.length }));
      await refreshIndex(result.restored);
      setReport(null);
      setStep("scanning");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="m-screen m-page">
      <AppBar onBack={step === "running" ? undefined : onBack} title={t("okf.migrationTitle", { version })} />

      {step === "scanning" && <p className="m-hint">{t("okf.scanning")}</p>}

      {step === "summary" && state && (
        <>
          <div className="m-card">
            {!state.rootIndex.exists ? (
              <p>{t("okf.migrationIntroNoRoot")}</p>
            ) : state.rootIndex.declared === null ? (
              <p>{t("okf.migrationIntroNoDeclaration")}</p>
            ) : state.rootIndex.current ? (
              <p>{t("okf.migrationIntroCurrent", { version })}</p>
            ) : (
              <p>{t("okf.migrationIntro", { declared: state.rootIndex.declared })}</p>
            )}
            {rootPending && (
              <p data-testid="okf-migrate-root">
                <b>{t("okf.migrationRootLine", { from: state.rootIndex.declared, to: version })}</b>
              </p>
            )}
            {!state.rootIndex.exists && <p className="m-hint">{t("okf.migrationIndexHint")}</p>}
            {!pending && <p className="m-hint">{t("okf.migrationNothing")}</p>}
            {pending && <p className="m-hint">{t("okf.migrationBackupHint")}</p>}
          </div>

          {/* The legacy per-note key: a checkbox (on by default, D2) and the
              names — a run that edits thirty notes is not confirmed on a count. */}
          <GroupCard>
            <div className="m-card">
              {legacyCount > 0 ? (
                <>
                  <Checkbox
                    checked={stripNotes}
                    data-testid="okf-migrate-strip"
                    onChange={(e) => setStripNotes(e.target.checked)}
                  >
                    {t("okf.migrationStripLabel", { count: legacyCount })}
                  </Checkbox>
                  <p className="m-hint">{t("okf.migrationStripHint", { breakdown: okfVersionBreakdown(state) })}</p>
                </>
              ) : (
                <p className="m-hint">{t("okf.migrationStripNone")}</p>
              )}
            </div>
          </GroupCard>
          {legacyCount > 0 && (
            <>
              <SectionLabel>{t("okf.affectedTitle", { count: legacyCount })}</SectionLabel>
              <GroupCard>
                <RowList>
                  {state.notesWithVersion.slice(0, 200).map((n) => (
                    <Row key={n.path} subtitle={`okf_version: ${n.value}`} title={n.path} />
                  ))}
                </RowList>
              </GroupCard>
              {legacyCount > 200 && <p className="m-hint">{t("okf.affectedMore", { count: legacyCount - 200 })}</p>}
            </>
          )}

          <div className="m-sync-actions">
            <Button data-testid="okf-migrate-start" disabled={!pending} onClick={() => void run()} variant="primary">
              {rootPending ? t("okf.migrationRun") : t("okf.migrationRunClean")}
            </Button>
          </div>
        </>
      )}

      {step === "running" && (
        <>
          <div className="m-card">
            <p>{t("okf.progress", { done: progress.done, total: progress.total })}</p>
            <div aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent} className="m-progress" role="progressbar">
              <div className="m-progress-bar" style={{ width: `${percent}%` }} />
            </div>
            {progress.path && <p className="m-hint">{progress.path}</p>}
          </div>
          <div className="m-sync-actions">
            <Button data-testid="okf-migrate-pause" onClick={() => (cancelRef.current = true)} variant="ghost">
              {t("okf.cancelRun")}
            </Button>
          </div>
        </>
      )}

      {step === "report" && report && (
        <>
          <div className="m-card">
            <p>
              <b>{report.cancelled ? t("okf.migrationCancelled") : t("okf.migrationDone")}</b>
            </p>
            <p>{t("okf.reportChanged", { count: report.changed.length })}</p>
            <p>{t("okf.reportUnchanged", { count: report.unchanged })}</p>
            {report.skipped.length > 0 && <p>{t("okf.reportSkipped", { count: report.skipped.length })}</p>}
            {report.backupDir && <p className="m-hint">{t("okf.reportBackup", { dir: report.backupDir })}</p>}
          </div>
          {report.skipped.length > 0 && (
            <GroupCard>
              <RowList>
                {report.skipped.map((s) => (
                  <Row key={s.path} subtitle={s.error} title={s.path} />
                ))}
              </RowList>
            </GroupCard>
          )}
          <div className="m-sync-actions">
            <Button
              data-testid="okf-migrate-rollback"
              disabled={busy || !report.backupDir || report.changed.length === 0}
              onClick={() => void undo(report.backupDir)}
              variant="ghost"
            >
              {t("okf.undoMigration")}
            </Button>
            <Button onClick={onBack} variant="primary">
              {t("okf.close")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
