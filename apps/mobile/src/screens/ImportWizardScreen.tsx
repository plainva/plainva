import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileArchive, FolderOpen } from "lucide-react";
import {
  defaultImportRegistry,
  type ImportPlan,
  type ImportReport,
  type ImportSource,
} from "@plainva/core";
import { Banner, Button, buildImportLabels, ICON, serializeBaseConfig, toast } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import { analyzeSelection, pickImportFiles, type PickMode } from "../services/importService";
import { archiveByteReader, type ExtractedArchive } from "../services/importArchive";
import { getMobileSettings } from "../services/mobileSettings";
import type { MobileVault } from "../services/vaultService";

/**
 * The import wizard on the phone (S41).
 *
 * Same five steps as the desktop — choose, analyse, preview, run, report —
 * because they are not a layout, they are what an import IS: you say what you
 * have, Plainva says what it would write, you agree, it writes, and it tells
 * you what did not come along. Every one of those answers comes from the
 * shared core; this screen only asks.
 *
 * The import always writes into a SUBFOLDER of the open vault. The desktop
 * additionally offers a brand-new vault, which on a phone would mean creating
 * a vault mid-import — a second decision inside a flow that already has one.
 * A fresh subfolder is collision-free either way, which was the point.
 */
type Step = "select" | "analyzing" | "preview" | "importing" | "report";

export function ImportWizardScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("select");
  const [sourceId, setSourceId] = useState<string>("");
  const [archive, setArchive] = useState<ExtractedArchive | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [progress, setProgress] = useState<{ percent: number; message: string }>({ percent: 0, message: "" });
  const [controller, setController] = useState<AbortController | null>(null);

  // A running import writes files; leaving mid-way would leave a half-filled
  // folder behind with nothing on screen explaining it.
  useLeaveGuard("import", step === "importing", t("mobile.leaveWizard"));

  const sources = defaultImportRegistry.list().filter((s) => (s.inputKind ?? "files") === "files");
  const source: ImportSource | undefined = sources.find((s) => s.id === sourceId);
  const subfolder = `${t("import.defaultSubfolder")} ${new Date()
    .toISOString()
    .slice(0, 10)}`;

  const pick = async (mode: PickMode) => {
    const files = await pickImportFiles(mode);
    if (files.length === 0) return; // dismissed — a file input has no cancel event
    setStep("analyzing");
    try {
      const selection = await analyzeSelection(files);
      setArchive(selection.archive);
      if (selection.detected) setSourceId(selection.detected.id);
      const chosen = selection.detected ?? sources.find((s) => s.id === sourceId);
      if (!chosen) {
        // Nothing recognised it and nothing was chosen: back to the list rather
        // than a preview of an importer nobody picked.
        setStep("select");
        return;
      }
      const built = await chosen.analyze(selection.archive.files, buildOptions(null));
      setPlan(built);
      setStep("preview");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setStep("select");
    }
  };

  function buildOptions(signal: AbortSignal | null) {
    const settings = getMobileSettings();
    return {
      targetVaultPath: "",
      targetSubfolder: subfolder,
      attachmentsFolder: settings.attachmentFolder,
      vaultAdapter: vault.adapter,
      // Without this the importers can see an attachment and still not carry
      // it over — they would report it as skipped.
      readSourceBytes: archive ? archiveByteReader(archive) : undefined,
      archiveSkipped: archive?.skipped.map((s) => ({
        relativePath: s.relativePath,
        reason: t(`import.skip.${s.reason}`, { defaultValue: s.reason }),
      })),
      // The canonical .base writer, so an imported database is the same file
      // the app would have written itself.
      serializeBase: serializeBaseConfig,
      labels: buildImportLabels(t),
      ...(signal ? { signal } : {}),
    };
  }

  const run = async () => {
    if (!source || !archive) return;
    const ac = new AbortController();
    setController(ac);
    setStep("importing");
    try {
      const result = await source.run(archive.files, buildOptions(ac.signal), (percent, message) =>
        setProgress({ percent, message }),
      );
      setReport(result);
      setStep("report");
      // The vault gained files the index has never seen.
      await vault.indexer?.indexVaultFull().catch(() => {});
      window.dispatchEvent(new CustomEvent("m-vault-changed"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setStep("preview");
    } finally {
      setController(null);
    }
  };

  return (
    <div className="m-page">
      {/* Three steps for the reader — choose, check, done — with the two waits
          counted as the work of the step they belong to (N5.1/N7). The bar was
          the only thing on screen during "analyzing" and it said nothing about
          how far along the import was. */}
      <AppBar
        onBack={step === "importing" ? undefined : onBack}
        subtitle={t("mobile.stepOf", {
          n: step === "select" || step === "analyzing" ? 1 : step === "report" ? 3 : 2,
          total: 3,
        })}
        title={t("import.title")}
      />

      {step === "select" && (
        <>
          <p className="m-hint m-hint--inset">{t("import.step2Files")}</p>
          <div className="m-sync-actions m-sync-actions--column">
            <Button onClick={() => void pick("files")} variant="tonal">
              <FileArchive size={ICON.ui} />
              {t("import.chooseFiles")}
            </Button>
            <Button onClick={() => void pick("folder")} variant="tonal">
              <FolderOpen size={ICON.ui} />
              {t("import.chooseFolder")}
            </Button>
          </div>
          <p className="m-sectionlabel">{t("import.step1")}</p>
          {sources.map((s) => (
            <button
              className={`m-row${s.id === sourceId ? " is-selected" : ""}`}
              key={s.id}
              onClick={() => setSourceId(s.id)}
            >
              {/* The NAME is translated (import.sources.<id>); the adapter's
                  `description` is English only, and an English sentence under a
                  German name reads like a bug. The name carries the row. */}
              <span>{t(`import.sources.${s.id}`, { defaultValue: s.name })}</span>
            </button>
          ))}
        </>
      )}

      {step === "analyzing" && (
        <div className="m-card">
          <p>{t("import.analyzingTitle")}</p>
        </div>
      )}

      {step === "preview" && plan && (
        <>
          <div className="m-card">
            <p>
              <b>{t(`import.sources.${plan.sourceId}`, { defaultValue: plan.sourceName })}</b>
            </p>
            <p>
              {t("import.statNotes")}: {plan.totalNotes} · {t("import.statAttachments")}:{" "}
              {plan.totalAttachments} · {t("import.statDatabases")}: {plan.totalDatabases}
            </p>
            <p>
              {t("import.statTarget")}: {subfolder}
            </p>
            <p>{t("import.step3Hint")}</p>
          </div>
          {plan.warnings.map((warning, i) => (
            <Banner key={i} kind="warning">
              {warning}
            </Banner>
          ))}
          {archive && archive.skipped.length > 0 && (
            <Banner kind="warning">
              {archive.skipped
                .slice(0, 3)
                .map((skip) => t("import.archiveSkipped", { path: skip.relativePath, reason: skip.reason }))
                .join(" · ")}
            </Banner>
          )}
          <div className="m-sync-actions m-sync-actions--column">
            <Button onClick={() => void run()} variant="primary">
              {t("import.start")}
            </Button>
            <Button onClick={() => setStep("select")} variant="ghost">
              {t("import.back")}
            </Button>
          </div>
        </>
      )}

      {step === "importing" && (
        <>
          <div className="m-card">
            <p>{progress.message || t("import.preparing")}</p>
            <div
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(progress.percent)}
              className="m-progress"
              role="progressbar"
            >
              <div className="m-progress-bar" style={{ width: `${Math.round(progress.percent)}%` }} />
            </div>
          </div>
          {/* Aborting is not a failure: the adapters stop between entries and
              the report still describes what already landed. */}
          <div className="m-sync-actions">
            <Button onClick={() => controller?.abort()} variant="ghost">
              {t("import.stop")}
            </Button>
          </div>
        </>
      )}

      {step === "report" && report && (
        <>
          <div className="m-card">
            <p>
              <b>{t(report.skippedCount > 0 ? "import.reportTitlePartial" : "import.reportTitleDone")}</b>
            </p>
            <p>
              {t("import.statNotes")}: {report.importedNotesCount} · {t("import.statAttachments")}:{" "}
              {report.importedAttachmentsCount} · {t("import.statDatabases")}: {report.importedDatabasesCount}
            </p>
            {/* The undo is the folder — say so while it is still on screen. */}
            <p>{t("import.undoFolder", { folder: subfolder })}</p>
          </div>
          {report.reportPath && (
            <p className="m-hint m-hint--inset">
              {t("import.reportPath")} {report.reportPath}
            </p>
          )}
          <div className="m-sync-actions">
            <Button onClick={onBack} variant="primary">
              {t("common.close")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
