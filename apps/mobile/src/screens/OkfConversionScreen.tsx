import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { App as CapApp } from "@capacitor/app";
import { Button, Checkbox, GroupCard, Row, RowList, SectionLabel, TextInput, toast } from "@plainva/ui";
import type { OkfScanResult } from "@plainva/core";
import { AppBar } from "../components/AppBar";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import {
  convertVaultToOkf,
  pendingOkfRun,
  scanVaultOkf,
  undoOkfConversion,
  type OkfRunReport,
} from "../services/okfConversion";
import type { OkfJournal } from "../services/okfJournal";
import type { MobileVault } from "../services/vaultService";

/**
 * Converting a vault to the OKF minimum, from the phone (P8).
 *
 * This is the one surface in the app that writes into every note there is, on
 * a device that gets cleared out of the background without asking. The steps
 * are shaped around that rather than around the desktop's modal:
 *
 * - Nothing is written before a DRY RUN has been shown and confirmed. The
 *   preview lists the notes by name, because "412 files will change" is not
 *   something anyone can check.
 * - The progress is determinate and names the file it is on. An indeterminate
 *   bar over a five-minute run tells the user nothing about whether stopping
 *   now is cheap or expensive.
 * - Leaving the app PAUSES the run. It never continues unattended: the same
 *   question the task deletion answered, with the same answer — the safe
 *   outcome of an interrupted operation is the one that stopped.
 * - The journal is written before the first change and only cleared when the
 *   run reaches its end, so a kill leaves a marker the next start finds.
 *
 * The conversion itself and its backups are shared with the desktop; what is
 * added here is that net.
 */

type Step = "scanning" | "preview" | "running" | "paused" | "report" | "recover";

interface Progress {
  done: number;
  total: number;
  path: string;
}

export function OkfConversionScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("scanning");
  const [scan, setScan] = useState<OkfScanResult | null>(null);
  const [pending, setPending] = useState<OkfJournal | null>(null);
  const [remaining, setRemaining] = useState(-1);
  const [defaultType, setDefaultType] = useState("note");
  const [renameExisting, setRenameExisting] = useState(false);
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 0, path: "" });
  const [report, setReport] = useState<OkfRunReport | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Read by the run loop between files. A ref rather than state because the
   * loop does not re-render to see a new value — it asks on every iteration.
   */
  const cancelRef = useRef(false);
  /** The folder the run is writing its backups into, kept for undo and resume. */
  const backupRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const open = await pendingOkfRun(vault);
    if (open) {
      setPending(open.journal);
      setRemaining(open.remaining);
      setStep("recover");
      return;
    }
    try {
      const result = await scanVaultOkf(vault);
      setScan(result);
      setStep("preview");
    } catch (e) {
      toast.error(`${t("okf.scanning")} — ${e instanceof Error ? e.message : String(e)}`);
      onBack();
    }
  }, [onBack, t, vault]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Backgrounding pauses. Not "keeps going quietly": the OS may kill the
   * process at any point after this, and a run the user cannot see is a run
   * they cannot stop. Pausing turns a possible kill into a decision.
   */
  useEffect(() => {
    if (step !== "running") return;
    const handle = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) cancelRef.current = true;
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [step]);

  useLeaveGuard("okf", step === "running", t("mobile.leaveWizard"));

  const runPass = async (target: OkfScanResult, backupDir?: string) => {
    cancelRef.current = false;
    setProgress({ done: 0, total: target.convertiblePaths.length, path: "" });
    setStep("running");
    try {
      const result = await convertVaultToOkf({
        vault,
        scan: target,
        options: {
          defaultType: defaultType.trim() || "note",
          existingTypeStrategy: renameExisting ? "rename" : "keep",
        },
        backupDir,
        onProgress: (done, total, path) => setProgress({ done, total, path }),
        isCancelled: () => cancelRef.current,
      });
      backupRef.current = result.backupDir || backupDir || null;
      setReport(result);
      setStep(result.cancelled ? "paused" : "report");
    } catch (e) {
      // A journal that could not be written lands here, and that is the whole
      // point of it being fail-closed: nothing was converted.
      toast.error(`${t("okf.journalFailed")} ${e instanceof Error ? e.message : String(e)}`);
      setStep(scan ? "preview" : "recover");
    }
  };

  /** Continue where the interrupted run stopped, into the SAME backup folder. */
  const resume = async (backupDir: string, options: OkfJournal["options"]) => {
    setBusy(true);
    try {
      setDefaultType(options.defaultType);
      setRenameExisting(options.existingTypeStrategy === "rename");
      const fresh = await scanVaultOkf(vault);
      setScan(fresh);
      await runPass(fresh, backupDir);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = async (backupDir: string) => {
    setBusy(true);
    setProgress({ done: 0, total: 0, path: "" });
    try {
      const result = await undoOkfConversion(vault, backupDir, (done, total) =>
        setProgress({ done, total, path: "" }),
      );
      if (result.failed.length > 0) toast.error(t("okf.rollbackFailed", { count: result.failed.length }));
      else toast.info(t("okf.rollbackDone", { count: result.restored.length }));
      setPending(null);
      setReport(null);
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
      <AppBar onBack={step === "running" ? undefined : onBack} title={t("okf.wizardTitle")} />

      {step === "scanning" && <p className="m-hint">{t("okf.scanning")}</p>}

      {/* An interrupted run is answered before anything else on this screen:
          continuing and undoing are the only two sensible moves, and picking
          neither leaves the vault exactly as it is. */}
      {step === "recover" && pending && (
        <>
        <SectionLabel>{t("okf.recoveryTitle")}</SectionLabel>
        <GroupCard>
          <div className="m-card">
            <p>{t("okf.recoveryBody", { started: new Date(pending.startedAt).toLocaleString() })}</p>
            {remaining >= 0 && <p className="m-hint">{t("okf.recoveryRemaining", { count: remaining })}</p>}
            <p className="m-hint">{t("okf.reportBackup", { dir: pending.backupDir })}</p>
          </div>
          <div className="m-sync-actions">
            <Button
              data-testid="okf-resume"
              disabled={busy}
              onClick={() => void resume(pending.backupDir, pending.options)}
              variant="primary"
            >
              {t("okf.recoveryResume")}
            </Button>
            <Button data-testid="okf-rollback" disabled={busy} onClick={() => void undo(pending.backupDir)} variant="ghost">
              {t("okf.recoveryRollback")}
            </Button>
          </div>
        </GroupCard>
        </>
      )}

      {step === "preview" && scan && (
        <>
          <div className="m-card">
            <p>{t("okf.scanSummary", { scanned: scan.scanned })}</p>
            <p>
              <b>{t("okf.summaryTypeViolations", { count: scan.violations.length })}</b>
            </p>
            <p className="m-hint">{t("okf.backupHint")}</p>
            <p className="m-hint">{t("okf.syncHint")}</p>
          </div>

          <SectionLabel>{t("okf.defaultTypeLabel")}</SectionLabel>
          <GroupCard>
            <div className="m-card">
              <TextInput autoCapitalize="none" onChange={(e) => setDefaultType(e.target.value)} value={defaultType} />
              {scan.typedPaths.length > 0 && (
                <Checkbox checked={renameExisting} onChange={(e) => setRenameExisting(e.target.checked)}>
                  {t("okf.existingTypeLegend", { count: scan.typedPaths.length })}
                </Checkbox>
              )}
            </div>
          </GroupCard>

          {/* The list, not just the number: a run over every note in the vault
              is not something anyone should confirm on a count alone. */}
          <SectionLabel>{t("okf.affectedTitle", { count: scan.convertiblePaths.length })}</SectionLabel>
          <GroupCard>
            <RowList>
              {scan.convertiblePaths.slice(0, 200).map((p) => (
                <Row key={p} title={p} />
              ))}
            </RowList>
          </GroupCard>
          {scan.convertiblePaths.length > 200 && (
            <p className="m-hint">{t("okf.affectedMore", { count: scan.convertiblePaths.length - 200 })}</p>
          )}

          <div className="m-sync-actions">
            <Button
              data-testid="okf-start"
              disabled={scan.convertiblePaths.length === 0}
              onClick={() => void runPass(scan)}
              variant="primary"
            >
              {t("okf.convertButton", { count: scan.convertiblePaths.length })}
            </Button>
          </div>
        </>
      )}

      {step === "running" && (
        <>
          <div className="m-card">
            <p>{t("okf.progress", { done: progress.done, total: progress.total })}</p>
            <div
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={percent}
              className="m-progress"
              role="progressbar"
            >
              <div className="m-progress-bar" style={{ width: `${percent}%` }} />
            </div>
            {progress.path && <p className="m-hint">{progress.path}</p>}
          </div>
          <div className="m-sync-actions">
            <Button data-testid="okf-pause" onClick={() => (cancelRef.current = true)} variant="ghost">
              {t("okf.cancelRun")}
            </Button>
          </div>
        </>
      )}

      {/* Stopped, on purpose or because the app went away. The count is the
          honest one: what already changed stays changed. */}
      {step === "paused" && report && (
        <>
        <SectionLabel>{t("okf.pausedTitle")}</SectionLabel>
        <GroupCard>
          <div className="m-card">
            <p>{t("okf.reportCancelled")}</p>
            <p>{t("okf.reportChanged", { count: report.changed.length })}</p>
            {report.backupDir && <p className="m-hint">{t("okf.reportBackup", { dir: report.backupDir })}</p>}
          </div>
          <div className="m-sync-actions">
            <Button
              data-testid="okf-resume"
              disabled={busy}
              onClick={() => void resume(backupRef.current ?? report.backupDir, { defaultType })}
              variant="primary"
            >
              {t("okf.recoveryResume")}
            </Button>
            <Button
              data-testid="okf-rollback"
              disabled={busy || !report.backupDir}
              onClick={() => void undo(backupRef.current ?? report.backupDir)}
              variant="ghost"
            >
              {t("okf.undoRun")}
            </Button>
          </div>
        </GroupCard>
        </>
      )}

      {step === "report" && report && (
        <>
          <div className="m-card">
            <p>
              <b>{t("okf.reportDone")}</b>
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
              data-testid="okf-rollback"
              disabled={busy || !report.backupDir}
              onClick={() => void undo(report.backupDir)}
              variant="ghost"
            >
              {t("okf.undoRun")}
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
