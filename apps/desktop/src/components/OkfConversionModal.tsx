import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OkfScanResult, OkfViolationKind } from "@plainva/core";
import { Modal } from "@plainva/ui";
import { Button } from "@plainva/ui";
import { TextInput } from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";
import { toast } from "@plainva/ui";
import {
  scanVaultOkf,
  runOkfConversion,
  convertVaultToOkf,
  undoOkfConversion,
  pendingOkfRun,
  type OkfRunReport,
  type PendingOkfRun,
} from "../services/okfConversion";
import { getConfiguredNoteType } from "../services/newNote";

type Step = "scanning" | "pending" | "options" | "preview" | "running" | "report";

/**
 * OKF conversion wizard (Gesamtplan W6): scan summary + options → dry-run
 * preview → conversion with progress/cancel → report. Opened from the OKF
 * settings section and from the one-time vault-open offer.
 */
export const OkfConversionModal: React.FC<{
  onClose: () => void;
  onConverted?: () => void;
  /** When provided, the report step offers to continue with the index.md manager. */
  onOpenIndexManager?: () => void;
}> = ({ onClose, onConverted, onOpenIndexManager }) => {
  const { t } = useTranslation();
  // Conversion writes through the FULL adapter chain (backup/version-history +
  // conflict detection + sync-state). Speed comes from processing files
  // concurrently (runOkfConversion's worker pool), not from bypassing safety.
  const { vaultPath, vaultAdapter, queryService, indexer, triggerFileTreeUpdate } = useVault();

  const [step, setStep] = useState<Step>("scanning");
  const [scan, setScan] = useState<OkfScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [defaultType, setDefaultType] = useState("Note");
  const [strategy, setStrategy] = useState<"keep" | "rename">("keep");
  const [renameTo, setRenameTo] = useState("type_original");
  const [preview, setPreview] = useState<OkfRunReport | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [report, setReport] = useState<OkfRunReport | null>(null);
  const [pending, setPending] = useState<PendingOkfRun | null>(null);
  // The backup folder the CURRENT run is writing into. A continued run keeps
  // the folder of the run it continues, so one undo still covers both passes.
  const backupRef = useRef<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    let alive = true;
    if (!vaultPath || !vaultAdapter || !queryService) return;
    getConfiguredNoteType(vaultPath).then((v) => { if (alive) setDefaultType(v); }).catch(() => {});
    // An interrupted run comes first: offering a fresh conversion to someone
    // whose last one died halfway would start a SECOND backup folder, and
    // neither folder would then restore the vault on its own.
    pendingOkfRun({ vaultPath, queryService, adapter: vaultAdapter })
      .catch(() => null)
      .then((open) => {
        if (!alive || !open) return null;
        setPending(open);
        setDefaultType(open.journal.options.defaultType);
        setStrategy(open.journal.options.existingTypeStrategy ?? "keep");
        if (open.journal.options.renameTo) setRenameTo(open.journal.options.renameTo);
        setStep("pending");
        return open;
      })
      .then((open) => {
        if (!alive || open) return;
        return scanVaultOkf({ vaultPath, queryService, adapter: vaultAdapter }).then((result) => {
          if (!alive) return;
          setScan(result);
          setStep("options");
        });
      })
      .catch((e) => {
        if (!alive) return;
        setScanError(e instanceof Error ? e.message : String(e));
        setStep("options");
      });
    return () => { alive = false; };
  }, [vaultPath, vaultAdapter, queryService]);

  const violationCount = (kind: OkfViolationKind) =>
    scan?.violations.filter((v) => v.kind === kind).length ?? 0;
  const typeViolations =
    violationCount("missing-frontmatter") +
    violationCount("missing-type") +
    violationCount("empty-type") +
    violationCount("non-string-type");
  const reservedViolations = violationCount("reserved-name-concept");
  const unparseable = violationCount("unparseable-frontmatter");

  const options = {
    defaultType: defaultType.trim() || "Note",
    existingTypeStrategy: strategy,
    renameTo: renameTo.trim() || "type_original",
  } as const;

  const runPreview = async () => {
    if (!vaultAdapter || !scan) return;
    setStep("scanning");
    try {
      const result = await runOkfConversion({ adapter: vaultAdapter, scan, options, dryRun: true });
      setPreview(result);
      setStep("preview");
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
      setStep("options");
    }
  };

  const [undoing, setUndoing] = useState(false);

  /**
   * Puts every file this run changed back, from its own backup folder.
   *
   * The backups were always written; what was missing was a way to use them
   * that did not involve a file manager. Available while the report is on
   * screen — it undoes THIS run — and from the recovery card, where "this run"
   * is the interrupted one the journal points at.
   */
  const undoRun = async (dir?: string) => {
    const backupDir = dir ?? backupRef.current ?? report?.backupDir;
    if (!backupDir || !vaultAdapter || !vaultPath) return;
    setUndoing(true);
    try {
      const result = await undoOkfConversion(vaultPath, vaultAdapter, backupDir);
      if (result.failed.length > 0) toast.error(t("okf.rollbackFailed", { count: result.failed.length }));
      else toast.info(t("okf.rollbackDone", { count: result.restored.length }));
      onConverted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUndoing(false);
    }
  };

  /**
   * One pass over the vault, with the journal around it.
   *
   * `backupDir` is set when CONTINUING an interrupted run: the pass then keeps
   * writing into that run's backup folder, so a single undo still covers
   * everything both passes touched.
   */
  const runPass = async (target: OkfScanResult, backupDir?: string) => {
    if (!vaultAdapter || !vaultPath) return;
    cancelRef.current = false;
    setProgress({ done: 0, total: target.convertiblePaths.length });
    setStep("running");
    let result: OkfRunReport;
    try {
      result = await convertVaultToOkf({
        vaultPath,
        adapter: vaultAdapter,
        scan: target,
        options,
        backupDir,
        onProgress: (done, total) => setProgress({ done, total }),
        isCancelled: () => cancelRef.current,
      });
    } catch (e) {
      // The journal could not be written, so nothing ran. Saying so is the
      // point: a conversion nobody could recover from is worse than one that
      // never started.
      setScanError(e instanceof Error ? e.message : String(e));
      setStep("options");
      return;
    }
    backupRef.current = result.backupDir || backupDir || null;
    setReport(result);
    // Refresh index + open editors so the new frontmatter is visible everywhere.
    try {
      await indexer?.indexVaultFull();
      triggerFileTreeUpdate();
      for (const path of result.changed) {
        window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path } }));
      }
    } catch (e) {
      console.warn("[OkfConversion] re-index after conversion failed", e);
    }
    setStep("report");
    onConverted?.();
  };

  const runConversion = async () => {
    if (scan) await runPass(scan);
  };

  /**
   * Picks an interrupted run back up.
   *
   * Scans FRESH rather than trusting the journal's file list: the run died
   * halfway, so the vault has moved since — and the notes the first pass
   * already converted simply no longer show up as violations.
   */
  const resume = async (backupDir: string) => {
    if (!vaultPath || !vaultAdapter || !queryService) return;
    setStep("scanning");
    try {
      const fresh = await scanVaultOkf({ vaultPath, queryService, adapter: vaultAdapter });
      setScan(fresh);
      await runPass(fresh, backupDir);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
      setStep("options");
    }
  };

  const rowStyle: React.CSSProperties = { fontSize: "var(--text-md)", margin: "0.2rem 0" };

  const running = step === "running";
  return (
    <Modal
      onClose={() => { if (!running) onClose(); }}
      title={t("okf.wizardTitle")}
      size="md"
      hideClose={running}
      closeOnOverlay={!running}
      footer={
        step === "pending" && pending ? (
          <>
            <Button onClick={onClose}>{t("okf.recoveryLater")}</Button>
            <Button disabled={undoing} onClick={() => void undoRun(pending.journal.backupDir)}>
              {t("okf.recoveryRollback")}
            </Button>
            <Button variant="primary" onClick={() => void resume(pending.journal.backupDir)}>
              {t("okf.recoveryResume")}
            </Button>
          </>
        ) : step === "options" ? (
          <>
            <Button onClick={onClose}>{t("okf.cancel")}</Button>
            <Button variant="primary" onClick={runPreview} disabled={!scan}>{t("okf.previewButton")}</Button>
          </>
        ) : step === "preview" && preview ? (
          <>
            <Button onClick={() => setStep("options")}>{t("okf.back")}</Button>
            <Button variant="primary" onClick={runConversion} disabled={preview.changed.length === 0}>
              {t("okf.convertButton", { count: preview.changed.length })}
            </Button>
          </>
        ) : running ? (
          <Button onClick={() => { cancelRef.current = true; }}>{t("okf.cancelRun")}</Button>
        ) : step === "report" && report ? (
          <>
            {/* The backup folder was already named above; without a button it
                is an instruction to copy 400 files back by hand (P8). */}
            {report.backupDir && report.changed.length > 0 && (
              <Button disabled={undoing} onClick={() => void undoRun()}>{t("okf.undoRun")}</Button>
            )}
            {onOpenIndexManager && (
              <Button onClick={() => { onClose(); onOpenIndexManager(); }}>{t("okf.reportIndexButton")}</Button>
            )}
            <Button variant="primary" onClick={onClose}>{t("okf.close")}</Button>
          </>
        ) : undefined
      }
    >
        {step === "scanning" && <div style={rowStyle}>{t("okf.scanning")}</div>}

        {/* An interrupted run, found by its journal. It leaves an INCOMPLETE
            vault, not a broken one — the conversion only adds frontmatter keys
            — so this asks instead of rolling back on sight, and "Later" is a
            real answer: the journal stays until the run is finished or undone. */}
        {step === "pending" && pending && (
          <div data-testid="okf-pending-run">
            <div style={rowStyle}>
              {t("okf.recoveryBody", { started: new Date(pending.journal.startedAt).toLocaleString() })}
            </div>
            {pending.remaining >= 0 && (
              <div style={{ ...rowStyle, color: "var(--text-muted)" }}>
                {t("okf.recoveryRemaining", { count: pending.remaining })}
              </div>
            )}
            <div style={{ ...rowStyle, color: "var(--text-muted)" }}>
              {t("okf.reportBackup", { dir: pending.journal.backupDir })}
            </div>
          </div>
        )}

        {step === "options" && (
          <>
            {scanError && <div style={{ ...rowStyle, color: "var(--error-text)" }}>{scanError}</div>}
            {scan && (
              <>
                <div style={rowStyle}>{t("okf.scanSummary", { scanned: scan.scanned })}</div>
                <ul style={{ margin: "0.3rem 0 0.8rem 1.1rem", padding: 0, fontSize: "var(--text-md)" }}>
                  <li>{t("okf.summaryTypeViolations", { count: typeViolations })}</li>
                  {reservedViolations > 0 && <li>{t("okf.summaryReserved", { count: reservedViolations })}</li>}
                  {unparseable > 0 && <li style={{ color: "var(--error-text)" }}>{t("okf.summaryUnparseable", { count: unparseable })}</li>}
                  <li>{t("okf.summaryVersionSweep", { count: scan.convertiblePaths.length })}</li>
                </ul>

                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", ...rowStyle }}>
                  {t("okf.defaultTypeLabel")}
                  <TextInput style={{ width: "180px" }} value={defaultType} onChange={(e) => setDefaultType(e.target.value)} />
                </label>

                {scan.typedPaths.length > 0 && (
                  <fieldset style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", margin: "0.7rem 0", padding: "0.5rem 0.7rem" }}>
                    <legend style={{ fontSize: "var(--text-ui)", color: "var(--text-muted)", padding: "0 0.3rem" }}>
                      {t("okf.existingTypeLegend", { count: scan.typedPaths.length })}
                    </legend>
                    <label style={{ display: "flex", gap: "0.45rem", ...rowStyle, cursor: "pointer" }}>
                      <input type="radio" checked={strategy === "keep"} onChange={() => setStrategy("keep")} />
                      {t("okf.keepTypes")}
                    </label>
                    <label style={{ display: "flex", gap: "0.45rem", ...rowStyle, cursor: "pointer", alignItems: "center" }}>
                      <input type="radio" checked={strategy === "rename"} onChange={() => setStrategy("rename")} />
                      {t("okf.renameTypes")}
                      <TextInput
                        style={{ width: "130px" }}
                        value={renameTo}
                        disabled={strategy !== "rename"}
                        onChange={(e) => setRenameTo(e.target.value)}
                        aria-label={t("okf.renameTargetLabel")}
                      />
                    </label>
                  </fieldset>
                )}

                <div style={{ ...rowStyle, color: "var(--text-muted)" }}>{t("okf.backupHint")}</div>
                <div style={{ ...rowStyle, color: "var(--text-muted)" }}>{t("okf.syncHint")}</div>
              </>
            )}
          </>
        )}

        {step === "preview" && preview && (
          <>
            <div style={rowStyle}>{t("okf.previewSummary", { changed: preview.changed.length, unchanged: preview.unchanged, skipped: preview.skipped.length })}</div>
            {preview.samples.map((s) => (
              <div key={s.path} style={{ margin: "0.55rem 0" }}>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{s.path}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                  <pre style={{ margin: 0, padding: "0.4rem", background: "var(--bg-secondary)", borderRadius: "var(--radius-xs)", fontSize: "var(--text-sm)", overflowX: "auto" }}>{s.before || "—"}</pre>
                  <pre style={{ margin: 0, padding: "0.4rem", background: "var(--bg-secondary)", borderRadius: "var(--radius-xs)", fontSize: "var(--text-sm)", overflowX: "auto" }}>{s.after || "—"}</pre>
                </div>
              </div>
            ))}
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
            <div style={rowStyle}>
              {report.cancelled ? t("okf.reportCancelled") : t("okf.reportDone")}
            </div>
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
