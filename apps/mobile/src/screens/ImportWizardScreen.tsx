import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, FileArchive, FolderOpen } from "lucide-react";
import { Browser } from "@capacitor/browser";
import {
  defaultImportRegistry,
  type ImportPlan,
  type ImportReport,
  type ImportSource,
} from "@plainva/core";
import {
  Banner,
  Button,
  buildImportLabels,
  GroupCard,
  ICON,
  plainvaProducer,
  Row,
  RowList,
  SectionLabel,
  Segmented,
  serializeBaseConfig,
  TextInput,
  toast,
} from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { allowHttpOrigin, webdavFetch } from "../adapters/webdavHttp";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import { analyzeSelection, pickImportFiles, type PickMode } from "../services/importService";
import { archiveByteReader, type ExtractedArchive } from "../services/importArchive";
import { createImportVault, suggestVaultName, type ImportTargetVault } from "../services/importTarget";
import { getMobileSettings } from "../services/mobileSettings";
import { switchVault, type MobileVault } from "../services/vaultService";

/**
 * The import wizard on the phone (S41, completed in P7).
 *
 * Same five steps as the desktop — choose, analyse, preview, run, report —
 * because they are not a layout, they are what an import IS: you say what you
 * have, Plainva says what it would write, you agree, it writes, and it tells
 * you what did not come along. Every one of those answers comes from the
 * shared core; this screen only asks.
 *
 * P7 closed the two things the desktop had and this did not:
 *
 * The TARGET is a choice again. Writing only into a subfolder was a deliberate
 * simplification, and it cost the case import exists for — arriving from
 * another app with nothing here yet. On the phone the choice cannot be a
 * folder picker, because a vault is a container rather than a path; it is a
 * name (see importTarget.ts).
 *
 * And a source may now be an API rather than an export. Which one it is comes
 * off the adapter (`inputKind`), never from a list of ids here: `notion_api`
 * used to be spelled out in six places in the desktop wizard, and the next API
 * source would have been handed a file picker it could not satisfy.
 */
type Step = "select" | "analyzing" | "preview" | "importing" | "report";
type Target = "subfolder" | "newVault";

export function ImportWizardScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("select");
  const [sourceId, setSourceId] = useState<string>("");
  const [target, setTarget] = useState<Target>("subfolder");
  const [archive, setArchive] = useState<ExtractedArchive | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [progress, setProgress] = useState<{ percent: number; message: string }>({ percent: 0, message: "" });
  const [controller, setController] = useState<AbortController | null>(null);
  /**
   * The credential for an API source.
   *
   * Held here for the duration of the run and cleared when it ends — never
   * written to the vault, never to a credential store, never into the settings
   * profile that travels between devices. The desktop does the same, and the
   * screen says so in ten languages (`import.notionToken.notStored`); storing
   * it on one shell would make that sentence a lie on the other.
   */
  const [token, setToken] = useState("");
  /** Where a "new vault" import goes; created only once the run starts. */
  const [vaultName, setVaultName] = useState("");
  const [created, setCreated] = useState<ImportTargetVault | null>(null);
  const [subfolder, setSubfolder] = useState(
    `${t("import.defaultSubfolder")} ${new Date().toISOString().slice(0, 10)}`,
  );

  // A running import writes files; leaving mid-way would leave a half-filled
  // folder behind with nothing on screen explaining it.
  useLeaveGuard("import", step === "importing", t("mobile.leaveWizard"));

  const sources = defaultImportRegistry.list();
  const source: ImportSource | undefined = sources.find((s) => s.id === sourceId);
  const isApi = (source?.inputKind ?? "files") === "api";
  const credentials = source?.credentials;
  /** Obsidian needs no import at all — the card explains that instead. */
  const isObsidian = sourceId === OBSIDIAN_ENTRY;
  const targetLabel = target === "newVault" ? vaultName || t("import.targetNewVault") : subfolder;

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
      setVaultName((n) => n || suggestVaultName(t(`import.sources.${chosen.id}`, { defaultValue: chosen.name }), t("import.targetNewVault")));
      const built = await chosen.analyze(selection.archive.files, await buildOptions(null, null));
      setPlan(built);
      setStep("preview");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setStep("select");
    }
  };

  /** The API path: a credential instead of a file, then the same preview. */
  const startApi = async () => {
    if (!source || !token.trim()) {
      toast.error(t("import.errNoToken", { source: t(`import.sources.${sourceId}`, { defaultValue: source?.name ?? sourceId }) }));
      return;
    }
    // The native HTTP bridge refuses any host nobody registered; the adapter
    // declares which one it needs (P7). Without this the very first request
    // fails and the wizard would blame the token.
    if (credentials?.apiOrigin) await allowHttpOrigin(credentials.apiOrigin);
    setArchive(null);
    setStep("analyzing");
    try {
      setVaultName((n) => n || suggestVaultName(t(`import.sources.${source.id}`, { defaultValue: source.name }), t("import.targetNewVault")));
      const built = await source.analyze(apiPayload(), await buildOptions(null, null));
      setPlan(built);
      setStep("preview");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setStep("select");
    }
  };

  /** `token` is the generic key; `notionToken` is what the first adapter reads. */
  const apiPayload = () => [{ token: token.trim(), notionToken: token.trim() }];

  async function buildOptions(signal: AbortSignal | null, into: ImportTargetVault | null) {
    const settings = getMobileSettings();
    return {
      targetVaultPath: "",
      // OKF 0.2 provenance (plan P3b): the same `plainva-import/<version>`
      // actor the desktop writes — one producer name for both shells.
      generatedBy: await plainvaProducer("import"),
      // A new vault IS the target; a second folder inside it would only add a
      // level nobody asked for.
      targetSubfolder: into ? "" : subfolder,
      attachmentsFolder: settings.attachmentFolder,
      // S3: the adapter CHAIN, not the raw sandbox adapter. Writing raw meant
      // imported notes never entered the sync queue — on a connected vault they
      // stayed on the phone until some later full listing happened to notice
      // them, and nothing said so. The chain also gives them the snapshot and
      // conflict handling every other mobile write has. A brand-new vault is
      // the one exception: it has no queue and no history yet (importTarget).
      vaultAdapter: into ? into.adapter : vault.files,
      // Without this the importers can see an attachment and still not carry
      // it over — they would report it as skipped.
      readSourceBytes: archive ? archiveByteReader(archive) : undefined,
      archiveSkipped: archive?.skipped.map((s) => ({
        relativePath: s.relativePath,
        reason: t(`import.skip.${s.reason}`, { defaultValue: s.reason }),
      })),
      // An API source reaches the network from a WebView that CORS would stop;
      // the native bridge is the phone's way out (the desktop passes its own).
      httpFetch: webdavFetch,
      // The canonical .base writer, so an imported database is the same file
      // the app would have written itself.
      serializeBase: serializeBaseConfig,
      labels: buildImportLabels(t),
      ...(signal ? { signal } : {}),
    };
  }

  const run = async () => {
    if (!source || (!archive && !isApi)) return;
    const ac = new AbortController();
    setController(ac);
    setStep("importing");
    let into: ImportTargetVault | null = null;
    try {
      // Created HERE, not when the segment was switched: an abandoned preview
      // must not leave an empty vault in the user's list.
      if (target === "newVault") {
        into = await createImportVault(vaultName || t("import.targetNewVault"));
        setCreated(into);
      }
      const input = isApi ? apiPayload() : archive!.files;
      const result = await source.run(input, await buildOptions(ac.signal, into), (percent, message) =>
        setProgress({ percent, message }),
      );
      setReport(result);
      setStep("report");
      if (!into) {
        // The vault gained files the index has never seen. A new vault indexes
        // itself when it is opened, so there is nothing to do for it here.
        await vault.indexer?.indexVaultFull().catch(() => {});
        window.dispatchEvent(new CustomEvent("m-vault-changed"));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setStep("preview");
    } finally {
      setController(null);
      // The token was for this run. Holding it past the run would only widen
      // the window in which it could leak.
      setToken("");
    }
  };

  /** Closing after a "new vault" import opens it — the notes are the point. */
  const finish = () => {
    if (created) {
      void switchVault(created.id);
      return;
    }
    onBack();
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
          {/* The target decides what the whole run does, so it sits ABOVE the
              source list: reading top to bottom, nobody should have picked an
              importer before they have seen where it writes. */}
          <SectionLabel>{t("import.statTarget")}</SectionLabel>
          <Segmented
            onChange={(v) => setTarget(v as Target)}
            options={[
              { value: "newVault", label: t("import.targetNewVault"), testId: "import-target-newvault" },
              { value: "subfolder", label: t("import.targetSubfolder"), testId: "import-target-subfolder" },
            ]}
            value={target}
          />
          {target === "newVault" ? (
            <>
              <TextInput
                aria-label={t("import.newVaultName")}
                data-testid="import-vault-name"
                onChange={(e) => setVaultName(e.target.value)}
                placeholder={t("import.targetNewVault")}
                value={vaultName}
              />
              <p className="m-hint">{t("import.targetNewVaultHintMobile")}</p>
            </>
          ) : (
            <>
              <TextInput
                aria-label={t("import.statTarget")}
                data-testid="import-subfolder"
                onChange={(e) => setSubfolder(e.target.value)}
                value={subfolder}
              />
              <p className="m-hint">{t("import.undoFolder", { folder: subfolder })}</p>
            </>
          )}

          {/* An API source is asked for a credential, never for a file — and
              Obsidian is asked for nothing at all. */}
          {isObsidian ? (
            <ObsidianCard />
          ) : isApi && credentials ? (
            <>
              <SectionLabel>{t(`${credentials.guideKey}.label`)}</SectionLabel>
              <ol className="m-steps">
                <li>{t(`${credentials.guideKey}.step1`)}</li>
                <li>{t(`${credentials.guideKey}.step2`)}</li>
                <li>{t(`${credentials.guideKey}.step3`)}</li>
              </ol>
              <Button onClick={() => void Browser.open({ url: credentials.url })} variant="ghost">
                <ExternalLink size={ICON.ui} />
                {t(`${credentials.guideKey}.open`)}
              </Button>
              <TextInput
                aria-label={t(`${credentials.guideKey}.label`)}
                autoCapitalize="none"
                autoCorrect="off"
                data-testid="import-token"
                onChange={(e) => setToken(e.target.value)}
                /* A password field: the token must not surface in a keyboard
                   suggestion strip or a screenshot of the wizard. */
                type="password"
                value={token}
              />
              <p className="m-hint">{t(`${credentials.guideKey}.notStored`)}</p>
              <div className="m-sync-actions">
                <Button data-testid="import-api-start" onClick={() => void startApi()} variant="primary">
                  {t("common.next")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="m-hint">{t("import.step2Files")}</p>
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
            </>
          )}

          <SectionLabel>{t("import.step1")}</SectionLabel>
          {/* Twenty-eight sources as a bare run of rows was the same finding as
              the selection sheet (E2): no card, no hairlines, and the current
              choice marked only by a background tint. It is a choice, so it
              reads like every other choice in the app. */}
          <GroupCard>
            <RowList>
              {[...sources.map((s) => s.id), OBSIDIAN_ENTRY].map((id) => (
                <Row
                  key={id}
                  icon={<span className={`m-slotmark${id === sourceId ? " is-on" : ""}`} />}
                  /* The NAME is translated (import.sources.<id>); the adapter's
                     `description` is English only, and an English sentence under
                     a German name reads like a bug. The name carries the row. */
                  title={t(`import.sources.${id}`, {
                    defaultValue: sources.find((s) => s.id === id)?.name ?? id,
                  })}
                  onClick={() => setSourceId(id)}
                />
              ))}
            </RowList>
          </GroupCard>
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
              {t("import.statTarget")}: {targetLabel}
            </p>
            <p>{t("import.step3Hint")}</p>
          </div>
          {/* An import into a connected vault is a bulk UPLOAD (BS1). A brand
              new vault has no provider, so there is nothing to warn about. */}
          {target === "subfolder" && vault.syncQueue && plan.totalNotes > 0 && (
            <Banner kind="info">{t("import.syncUploadHintMobile", { n: plan.totalNotes })}</Banner>
          )}
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
            {/* The undo is the folder — or the vault. Say so while it is still
                on screen. */}
            <p>{created ? t("import.undoVaultMobile") : t("import.undoFolder", { folder: subfolder })}</p>
          </div>
          {report.reportPath && (
            <p className="m-hint">
              {t("import.reportPath")} {report.reportPath}
            </p>
          )}
          <div className="m-sync-actions">
            <Button data-testid="import-finish" onClick={finish} variant="primary">
              {created ? t("import.openNewVault") : t("common.close")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Not an importer: Obsidian vaults are opened, not converted. */
const OBSIDIAN_ENTRY = "obsidian";

/**
 * The Obsidian answer, phrased for the phone.
 *
 * The desktop offers "open vault" here, which a phone cannot do — its vaults
 * are containers, not arbitrary folders on a disk. The way in is the same
 * cloud folder the vault already lives in, so the card says that instead of
 * offering a button that would open a picker with nothing to pick.
 */
function ObsidianCard() {
  const { t } = useTranslation();
  return (
    <>
      <Banner kind="info">{t("import.obsidianLead")}</Banner>
      <p className="m-hint">{t("import.obsidianConnectMobile")}</p>
      <p className="m-hint">{t("import.obsidianGains")}</p>
      <p className="m-hint">{t("import.obsidianLimits")}</p>
    </>
  );
}
