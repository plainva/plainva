import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OkfScanResult, OkfViolationKind } from "@plainva/core";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { TextInput } from "./ui/Field";
import { useVault } from "../contexts/VaultContext";
import { scanVaultOkf, runOkfConversion, type OkfRunReport } from "../services/okfConversion";
import { getConfiguredNoteType } from "../services/newNote";

type Step = "scanning" | "options" | "preview" | "running" | "report";

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
  const cancelRef = useRef(false);

  useEffect(() => {
    let alive = true;
    if (!vaultPath || !vaultAdapter || !queryService) return;
    getConfiguredNoteType(vaultPath).then((v) => { if (alive) setDefaultType(v); }).catch(() => {});
    scanVaultOkf({ vaultPath, queryService, adapter: vaultAdapter })
      .then((result) => {
        if (!alive) return;
        setScan(result);
        setStep("options");
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

  const runConversion = async () => {
    if (!vaultAdapter || !scan) return;
    cancelRef.current = false;
    setProgress({ done: 0, total: scan.convertiblePaths.length });
    setStep("running");
    const result = await runOkfConversion({
      adapter: vaultAdapter,
      scan,
      options,
      onProgress: (done, total) => setProgress({ done, total }),
      isCancelled: () => cancelRef.current,
    });
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

  const rowStyle: React.CSSProperties = { fontSize: "0.88rem", margin: "0.2rem 0" };

  const running = step === "running";
  return (
    <Modal
      onClose={() => { if (!running) onClose(); }}
      title={t("okf.wizardTitle")}
      size="md"
      hideClose={running}
      closeOnOverlay={!running}
      footer={
        step === "options" ? (
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
            {onOpenIndexManager && (
              <Button onClick={() => { onClose(); onOpenIndexManager(); }}>{t("okf.reportIndexButton")}</Button>
            )}
            <Button variant="primary" onClick={onClose}>{t("okf.close")}</Button>
          </>
        ) : undefined
      }
    >
        {step === "scanning" && <div style={rowStyle}>{t("okf.scanning")}</div>}

        {step === "options" && (
          <>
            {scanError && <div style={{ ...rowStyle, color: "var(--error-text)" }}>{scanError}</div>}
            {scan && (
              <>
                <div style={rowStyle}>{t("okf.scanSummary", { scanned: scan.scanned })}</div>
                <ul style={{ margin: "0.3rem 0 0.8rem 1.1rem", padding: 0, fontSize: "0.85rem" }}>
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
                    <legend style={{ fontSize: "0.8rem", color: "var(--text-muted)", padding: "0 0.3rem" }}>
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
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{s.path}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                  <pre style={{ margin: 0, padding: "0.4rem", background: "var(--bg-secondary)", borderRadius: "var(--radius-xs)", fontSize: "0.72rem", overflowX: "auto" }}>{s.before || "—"}</pre>
                  <pre style={{ margin: 0, padding: "0.4rem", background: "var(--bg-secondary)", borderRadius: "var(--radius-xs)", fontSize: "0.72rem", overflowX: "auto" }}>{s.after || "—"}</pre>
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
            <ul style={{ margin: "0.3rem 0 0.6rem 1.1rem", padding: 0, fontSize: "0.85rem" }}>
              <li>{t("okf.reportChanged", { count: report.changed.length })}</li>
              <li>{t("okf.reportUnchanged", { count: report.unchanged })}</li>
              {report.skipped.length > 0 && <li style={{ color: "var(--error-text)" }}>{t("okf.reportSkipped", { count: report.skipped.length })}</li>}
            </ul>
            {report.skipped.length > 0 && (
              <pre style={{ maxHeight: 120, overflowY: "auto", background: "var(--bg-secondary)", borderRadius: "var(--radius-xs)", padding: "0.4rem", fontSize: "0.72rem" }}>
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
