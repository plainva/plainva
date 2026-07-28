import React, { useState, useRef, useEffect } from 'react';
import { Modal, Button, Select, Segmented, Checkbox, Banner, ICON, serializeBaseConfig } from '@plainva/ui';
import { useTranslation } from 'react-i18next';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Download, Folder, AlertTriangle, CheckCircle2, FileText, Database, Sparkles, Paperclip, ListChecks, ExternalLink } from 'lucide-react';
import {
  defaultImportRegistry,
  type ImportOptionKey,
  type ImportPlan,
  type ImportReport,
  type ImportSourceId,
} from '@plainva/core';
import { useVault } from '../../contexts/VaultContext';
import { syncStatusStore } from '../../services/syncStatusStore';
import { TauriVaultAdapter } from '../../adapters/TauriVaultAdapter';
import { scaffoldVaultTemplate } from '../../services/vaultTemplates';
import { buildImportLabels } from './importLabels';
import { extractArchive, discardExtractedArchive, type ExtractedArchive } from '../../services/importArchive';

/**
 * Where the Notion integration token is created — linked, not retyped.
 *
 * The token flow is the one place a user has to understand Notion's own
 * internals; a link into the right page removes most of that.
 */
const NOTION_INTEGRATIONS_URL = 'https://www.notion.so/my-integrations';

/**
 * Above this many notes, indexing and the first sync are a noticeable wait.
 *
 * Well below the documented cold-index budget break (20k notes ≈ 151 s) so the
 * warning arrives before the machine does — it is a heads-up, not an error.
 */
const LARGE_IMPORT_NOTES = 2000;

/** The settings label each sync provider already has — no second set of names. */
const PROVIDER_LABEL_KEY: Record<string, string> = {
  webdav: 'settings.providerWebDav',
  drive: 'settings.providerDrive',
  onedrive: 'settings.providerOneDrive',
  dropbox: 'settings.providerDropbox',
  s3: 'settings.providerS3',
};

interface ImportWizardModalProps {
  targetVaultPath: string;
  onClose: () => void;
}

/**
 * Where an import writes.
 *
 * Exactly one of the two per run — never a combination. Two independent
 * toggles read as combinable, which is the mockup error the plan calls out;
 * a radio group can only ever have one answer.
 */
type ImportTarget = 'subfolder' | 'newVault';

interface SelectedFileItem {
  name: string;
  path?: string;
  file?: File;
}

/**
 * Obsidian is offered as a choice but never imports anything.
 *
 * Someone coming from Obsidian looks for their app in this list, and the honest
 * answer is that there is nothing to import: Plainva opens the same Markdown
 * files. Saying that where they look beats saying it in a FAQ they will not
 * read (plan §5, E10).
 */
const OBSIDIAN_ENTRY: ImportSourceId = 'obsidian';

export const ImportWizardModal: React.FC<ImportWizardModalProps> = ({ targetVaultPath, onClose }) => {
  const { vaultAdapter, triggerFileTreeUpdate, openVault } = useVault();
  const { t } = useTranslation();

  const [selectedSourceId, setSelectedSourceId] = useState<ImportSourceId>('generic_markdown');
  // Without an open vault (the splash entry) a subfolder has nothing to sit in.
  const [target, setTarget] = useState<ImportTarget>(targetVaultPath ? 'subfolder' : 'newVault');
  const [newVaultPath, setNewVaultPath] = useState<string>('');
  const [subfolder, setSubfolder] = useState<string>(t('import.defaultSubfolder'));
  const [notionToken, setNotionToken] = useState<string>('');
  const [selectedFiles, setSelectedFiles] = useState<SelectedFileItem[]>([]);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>('');
  const [step, setStep] = useState<'select' | 'analyzing' | 'preview' | 'importing' | 'report'>('select');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  /** Entries the extractor refused — shown next to the importer's own warnings. */
  const [archiveNotes, setArchiveNotes] = useState<string[]>([]);
  /** Source the selection was recognised as, when detection had an answer. */
  const [detectedSourceId, setDetectedSourceId] = useState<ImportSourceId | null>(null);
  /**
   * The chosen source's toggles, keyed by option key.
   *
   * Seeded from the adapter's own defaults whenever the source changes, so a
   * switch always starts where that importer says it should.
   */
  const [optionValues, setOptionValues] = useState<Partial<Record<ImportOptionKey, boolean>>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sources = defaultImportRegistry.list();
  const activeSource = defaultImportRegistry.get(selectedSourceId);
  const sourceOptions = activeSource?.options ?? [];
  const isObsidian = selectedSourceId === OBSIDIAN_ENTRY;

  /**
   * A subfolder import writes into a synced vault, so every note becomes an
   * upload. Plainva guards mass DELETES but has never mentioned mass uploads.
   */
  const syncProvider = syncStatusStore.get().provider;

  // Each source brings its own switches; a new source starts at its defaults.
  // The list is looked up inside the effect rather than passed in: it is a
  // stable property of the adapter, and the id is what actually changes.
  useEffect(() => {
    const next: Partial<Record<ImportOptionKey, boolean>> = {};
    for (const option of defaultImportRegistry.get(selectedSourceId)?.options ?? []) {
      next[option.key] = option.defaultValue;
    }
    setOptionValues(next);
  }, [selectedSourceId]);

  /** Lets the user stop a running import; one controller per run. */
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Archives already unpacked in this session, keyed by their source path.
   *
   * Analyse and run both build the payload, and unpacking a large export twice
   * is pure waste — the extraction folder lives until the selection changes or
   * the wizard closes, then it is removed.
   */
  const extractedRef = useRef<Map<string, ExtractedArchive>>(new Map());

  /**
   * Refused archive entries, localized, for the report.
   *
   * A ref rather than state because `buildOptions` runs in the same tick as
   * `loadInputPayload` — a state update would not be visible yet.
   */
  const archiveSkipsRef = useRef<Array<{ relativePath: string; reason: string }>>([]);

  const clearExtracted = () => {
    for (const archive of extractedRef.current.values()) {
      void discardExtractedArchive(archive.root);
    }
    extractedRef.current.clear();
  };

  // Leaving the wizard must not leave unpacked exports behind in the temp dir.
  useEffect(() => () => clearExtracted(), []);

  /** Translated source name; falls back to the importer's own English name. */
  const sourceName = (id: ImportSourceId, fallback: string): string =>
    t(`import.sources.${id}`, { defaultValue: fallback }) as string;

  const getSourceHint = (id: ImportSourceId): string =>
    t(`import.hints.${id}`, { defaultValue: t('import.hints.generic_markdown') }) as string;

  const handleSelectFilesNative = async () => {
    setErrorMsg('');
    setArchiveNotes([]);
    clearExtracted();
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const res: unknown = await openDialog({
        multiple: true,
        directory: selectedSourceId === 'logseq' || selectedSourceId === 'generic_markdown',
        filters: getFiltersForSource(selectedSourceId),
      });

      if (!res) return;

      let picked: SelectedFileItem[] = [];
      if (typeof res === 'string') {
        setSelectedFolderPath(res);
        picked = [{ name: res.split(/[/\\]/).pop() || res, path: res }];
      } else if (Array.isArray(res)) {
        setSelectedFolderPath('');
        picked = (res as string[]).map((p: string) => ({ name: p.split(/[/\\]/).pop() || p, path: p }));
      }
      setSelectedFiles(picked);
      // Recognise the source from what was picked, before the user has to.
      await runDetection(await loadInputPayload(picked, typeof res === 'string' ? res : ''));
    } catch {
      fileInputRef.current?.click();
    }
  };

  /**
   * Opens an existing vault straight from the wizard (the Obsidian entry).
   *
   * The answer to "how do I import my Obsidian vault" is a folder picker, not
   * an import — so the wizard offers exactly that and closes.
   */
  const handleOpenExistingVault = async () => {
    setErrorMsg('');
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const res: unknown = await openDialog({ directory: true, multiple: false });
      if (typeof res === 'string' && res) {
        await openVault(res);
        onClose();
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  /** Picks the folder a fresh vault is created in (the "New vault" target). */
  const handleSelectNewVaultFolder = async () => {
    setErrorMsg('');
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const res: unknown = await openDialog({ directory: true, multiple: false });
      if (typeof res === 'string' && res) setNewVaultPath(res);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleWebFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const picked = Array.from(e.target.files).map((f) => ({ name: f.name, file: f }));
    setSelectedFolderPath('');
    setSelectedFiles(picked);
    setErrorMsg('');
    setArchiveNotes([]);
    clearExtracted();
    try {
      await runDetection(await loadInputPayload(picked, ''));
    } catch {
      // A ZIP without a path cannot be read here; the analyse step says so.
    }
  };

  const getFiltersForSource = (id: ImportSourceId) => {
    switch (id) {
      case 'evernote':
        return [{ name: 'Evernote', extensions: ['enex', 'zip'] }];
      case 'google_keep':
      case 'simplenote':
        return [{ name: 'JSON', extensions: ['json', 'zip'] }];
      case 'notion_file':
        return [{ name: 'Notion', extensions: ['zip', 'md', 'csv'] }];
      case 'generic_markdown':
      default:
        return [{ name: 'Markdown / ZIP', extensions: ['md', 'markdown', 'zip', 'txt'] }];
    }
  };

  /**
   * Builds the payload the importers see.
   *
   * Takes the selection explicitly so it can run in the same tick as the file
   * dialog, where the state update is not visible yet; without arguments it
   * uses the current state.
   */
  const loadInputPayload = async (
    files: SelectedFileItem[] = selectedFiles,
    folderPath: string = selectedFolderPath
  ): Promise<any[]> => {
    if (selectedSourceId === 'notion_api') {
      return [{ notionToken }];
    }

    if (files.length === 0 && !folderPath) {
      return [];
    }

    const payload: Array<{ relativePath: string; content: string; contentXml?: string; mtimeMs?: number }> = [];
    const notes: string[] = [];
    const skips: Array<{ relativePath: string; reason: string }> = [];

    for (const f of files) {
      const isZip = f.name.toLowerCase().endsWith('.zip');

      if (f.file) {
        if (isZip) {
          // The archive is unpacked natively and needs a path on disk; the
          // browser fallback only ever hands us an in-memory File.
          throw new Error(t('import.errZipNeedsPath'));
        } else {
          const text = await f.file.text();
          payload.push({ relativePath: f.name, content: text, contentXml: text });
        }
      } else if (f.path) {
        if (isZip) {
          let archive = extractedRef.current.get(f.path);
          if (!archive) {
            archive = await extractArchive(f.path);
            extractedRef.current.set(f.path, archive);
          }
          payload.push(...archive.files);
          for (const entry of archive.skipped) {
            const reason = t(`import.archiveSkip.${entry.reason}`, {
              defaultValue: t('import.archiveSkip.unreadable'),
            }) as string;
            notes.push(t('import.archiveSkipped', { path: entry.relativePath, reason }));
            skips.push({ relativePath: entry.relativePath, reason });
          }
        } else {
          try {
            const { readTextFile, stat } = await import('@tauri-apps/plugin-fs');
            const text = await readTextFile(f.path);
            // The file's own date is the only timestamp a plain selection has;
            // for a Markdown folder it is exactly the note's date.
            let mtimeMs: number | undefined;
            try {
              const info = await stat(f.path);
              mtimeMs = info.mtime ? info.mtime.getTime() : undefined;
            } catch {
              // Dates are a bonus here, never a reason to skip the file.
            }
            payload.push({ relativePath: f.name, content: text, contentXml: text, mtimeMs });
          } catch {
            // File unreadable
          }
        }
      }
    }

    archiveSkipsRef.current = skips;
    setArchiveNotes(notes);
    return payload;
  };

  /** Last path segment of an OS path — the vault's name. */
  const basenameOf = (path: string): string => path.split(/[/\\]/).filter(Boolean).pop() || path;

  /** Vault path and subfolder the current target resolves to. */
  const resolvedTarget = (): { vaultPath: string; subfolder: string } =>
    target === 'newVault'
      ? { vaultPath: newVaultPath, subfolder: '' }
      : { vaultPath: targetVaultPath, subfolder };

  /** The concrete destination, spelled out under the target choice. */
  const targetPathLabel = (): string => {
    const { vaultPath, subfolder: sub } = resolvedTarget();
    if (!vaultPath) return t('import.noVaultFolderChosen');
    return sub ? `${vaultPath}/${sub}` : vaultPath;
  };

  /**
   * Options shared by analyze and run.
   *
   * `serializeBase` hands the core the app's canonical `.base` writer so an
   * imported database is byte-identical to one created in Plainva.
   */
  const buildOptions = (httpFetch: typeof fetch, writeAdapter?: unknown, signal?: AbortSignal) => {
    const resolved = resolvedTarget();
    return {
      targetVaultPath: resolved.vaultPath,
      targetSubfolder: resolved.subfolder,
      vaultAdapter: writeAdapter ?? vaultAdapter,
      httpFetch,
      labels: buildImportLabels(t),
      archiveSkipped: archiveSkipsRef.current,
      signal,
      serializeBase: (config: any) => serializeBaseConfig(config),
      // The wizard only ever sends what this source declared, so a switch it
      // does not know cannot reach the importer.
      ...optionValues,
    };
  };

  /**
   * Recognises the source of a selection and switches to it.
   *
   * `detect()` has existed on every importer since the feature shipped and was
   * never called once — the user had to know which of seven entries described
   * their own export. The chosen source stays editable; this only moves the
   * starting point to the right place.
   */
  const runDetection = async (payload: unknown[]) => {
    setDetectedSourceId(null);
    if (payload.length === 0) return;
    try {
      const detected = await defaultImportRegistry.detect(payload);
      if (!detected) return;
      setDetectedSourceId(detected.id);
      setSelectedSourceId(detected.id);
    } catch {
      // Detection is a convenience — a failure leaves the user's choice alone.
    }
  };

  const resolveHttpFetch = async (): Promise<typeof fetch> => {
    try {
      const tauriHttp = await import('@tauri-apps/plugin-http');
      if (typeof tauriHttp.fetch === 'function') return tauriHttp.fetch as typeof fetch;
    } catch {
      // Not running under Tauri — the plain fetch is fine in the browser shell.
    }
    return globalThis.fetch;
  };

  const handleAnalyze = async () => {
    if (selectedSourceId !== 'notion_api' && selectedFiles.length === 0 && !selectedFolderPath) {
      setErrorMsg(t('import.errNoFiles'));
      return;
    }
    if (selectedSourceId === 'notion_api' && !notionToken.trim()) {
      setErrorMsg(t('import.errNoToken'));
      return;
    }
    if (target === 'newVault' && !newVaultPath) {
      setErrorMsg(t('import.errNoVaultFolder'));
      return;
    }
    // Reachable from the splash, where "subfolder of the open vault" has no
    // vault to sit in — without this the run would write to a bare path.
    if (target === 'subfolder' && !targetVaultPath) {
      setErrorMsg(t('import.noVaultOpen'));
      return;
    }

    setStep('analyzing');
    setErrorMsg('');

    try {
      const source = defaultImportRegistry.get(selectedSourceId);
      if (!source) throw new Error(t('import.errUnknownImporter'));

      const httpFetch = await resolveHttpFetch();
      const inputPayload = await loadInputPayload();
      const analyzedPlan = await source.analyze(inputPayload, buildOptions(httpFetch));

      setPlan(analyzedPlan);
      setStep('preview');
    } catch (e) {
      console.error('Import analyse failed', e);
      setErrorMsg(`${t('import.errAnalyze')} ${e instanceof Error ? e.message : String(e)}`);
      setStep('select');
    }
  };

  const handleRunImport = async () => {
    setStep('importing');
    setProgressPct(10);
    setStatusMsg(t('import.preparing'));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const source = defaultImportRegistry.get(selectedSourceId);
      if (!source) throw new Error(t('import.errUnknownImporter'));

      // "New vault" writes into a fresh folder that is not open yet, so the
      // wizard brings its own adapter and seeds the empty-vault scaffold first
      // — an imported vault must be an OKF vault like any other.
      let writeAdapter: unknown = vaultAdapter;
      if (target === 'newVault') {
        const adapter = new TauriVaultAdapter(newVaultPath);
        await adapter.initialize();
        await scaffoldVaultTemplate({
          adapter,
          template: null,
          vaultName: basenameOf(newVaultPath),
          subfoldersHeading: t('indexMd.subfoldersHeading'),
        });
        writeAdapter = adapter;
      }

      const httpFetch = await resolveHttpFetch();
      const inputPayload = await loadInputPayload();
      const executedReport = await source.run(
        inputPayload,
        buildOptions(httpFetch, writeAdapter, controller.signal),
        (pct: number, msg: string) => {
          setProgressPct(pct);
          setStatusMsg(msg);
        }
      );

      if (target === 'subfolder') triggerFileTreeUpdate();
      setReport(executedReport);
      setStep('report');
    } catch (e) {
      console.error('Import execution failed', e);
      setErrorMsg(`${t('import.errRun')} ${e instanceof Error ? e.message : String(e)}`);
      setStep('preview');
    } finally {
      abortRef.current = null;
      // The token was for this run. It is never stored, and holding it in state
      // past the run would only widen the window in which it could leak.
      setNotionToken('');
    }
  };

  /**
   * Closing after a "new vault" import opens it — the notes are the point, and
   * leaving the user on the splash with a folder they cannot see is not.
   */
  const handleFinish = () => {
    if (target === 'newVault' && newVaultPath && report && report.importedNotesCount > 0) {
      void openVault(newVaultPath);
    }
    onClose();
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 'var(--text-ui)',
    fontWeight: 600,
    color: 'var(--text-main)',
    marginBottom: 'var(--space-2)',
  };

  const hintStyle: React.CSSProperties = {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
    lineHeight: '1.5',
    margin: 'var(--space-2) 0 0 0',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 'var(--control-md)',
    padding: '0 var(--space-3)',
    fontSize: 'var(--text-ui)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-card)',
    color: 'var(--text-main)',
    boxSizing: 'border-box',
  };

  const incompleteCount = report ? report.degradedCount + report.skippedCount : 0;

  return (
    <Modal
      onClose={onClose}
      title={t('import.title')}
      icon={<Download size={ICON.head} style={{ color: 'var(--accent-color)' }} />}
      size="md"
      footer={
        <>
          {step === 'select' && (
            <>
              <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
              {isObsidian ? (
                <Button variant="primary" onClick={handleOpenExistingVault}>
                  {t('import.obsidianOpenVault')}
                </Button>
              ) : (
                <Button variant="primary" onClick={handleAnalyze}>{t('import.next')}</Button>
              )}
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="ghost" onClick={() => setStep('select')}>{t('import.back')}</Button>
              <Button variant="primary" onClick={handleRunImport}>{t('import.start')}</Button>
            </>
          )}
          {step === 'importing' && (
            <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
              {t('import.stop')}
            </Button>
          )}
          {step === 'report' && (
            <Button variant="primary" onClick={handleFinish}>
              {target === 'newVault' && report && report.importedNotesCount > 0
                ? t('import.openNewVault')
                : t('common.close')}
            </Button>
          )}
        </>
      }
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleWebFileChange}
        style={{ display: 'none' }}
        multiple
      />

      {errorMsg && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--error-bg)',
          border: '1px solid var(--error-text)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--error-text)',
          fontSize: 'var(--text-sm)',
          marginBottom: 'var(--space-5)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}>
          <AlertTriangle size={ICON.ui} style={{ flexShrink: 0 }} />
          <span>{errorMsg}</span>
        </div>
      )}

      {step === 'select' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', padding: 'var(--space-2) 0' }}>
          <div>
            <label style={labelStyle}>{t('import.step1')}</label>
            <Select<ImportSourceId>
              value={selectedSourceId}
              onChange={(val) => {
                setSelectedSourceId(val);
                setSelectedFiles([]);
                setSelectedFolderPath('');
                setErrorMsg('');
                setArchiveNotes([]);
                clearExtracted();
              }}
              ariaLabel={t('import.step1')}
              options={[
                ...sources.map((s) => ({ value: s.id, label: sourceName(s.id, s.name) })),
                // Last, and deliberately in the same list: someone from Obsidian
                // looks here first, and this is where the answer belongs.
                { value: OBSIDIAN_ENTRY, label: t('import.sources.obsidian') },
              ]}
            />
            {detectedSourceId && detectedSourceId === selectedSourceId && (
              <p style={{ ...hintStyle, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Sparkles size={ICON.meta} style={{ flexShrink: 0, color: 'var(--accent-color)' }} />
                <span data-testid="import-detected">
                  {t('import.detected', {
                    source: sourceName(
                      detectedSourceId,
                      defaultImportRegistry.get(detectedSourceId)?.name ?? detectedSourceId
                    ),
                  })}
                </span>
              </p>
            )}
            {!isObsidian && <p style={hintStyle}>{getSourceHint(selectedSourceId)}</p>}
          </div>

          {isObsidian ? (
            <div data-testid="import-obsidian-card">
              <Banner kind="info" rounded>
                {t('import.obsidianLead')}
              </Banner>
              <p style={{ ...hintStyle, marginTop: 'var(--space-4)' }}>{t('import.obsidianGains')}</p>
              <p style={hintStyle}>{t('import.obsidianLimits')}</p>
            </div>
          ) : selectedSourceId === 'notion_api' ? (
            <div>
              <label style={labelStyle}>{t('import.step2Token')}</label>
              <ol style={{ ...hintStyle, margin: '0 0 var(--space-3) 0', paddingLeft: 'var(--space-5)' }}>
                <li>{t('import.tokenStep1')}</li>
                <li>{t('import.tokenStep2')}</li>
                <li>{t('import.tokenStep3')}</li>
              </ol>
              <Button variant="ghost" onClick={() => void openUrl(NOTION_INTEGRATIONS_URL)}>
                <ExternalLink size={ICON.ui} style={{ marginRight: 'var(--space-2)' }} />
                {t('import.tokenOpenNotion')}
              </Button>
              <input
                type="password"
                value={notionToken}
                onChange={(e) => setNotionToken(e.target.value)}
                style={{ ...inputStyle, marginTop: 'var(--space-3)' }}
                placeholder="secret_..."
                aria-label={t('import.step2Token')}
              />
              {/* Where the token goes is a fair question; the answer is nowhere. */}
              <p style={hintStyle}>{t('import.tokenNotStored')}</p>
            </div>
          ) : (
            <div>
              <label style={labelStyle}>{t('import.step2Files')}</label>
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                <Button variant="secondary" onClick={handleSelectFilesNative}>
                  <Folder size={ICON.ui} style={{ marginRight: 'var(--space-2)' }} />
                  {t('import.chooseFiles')}
                </Button>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                  {selectedFolderPath
                    ? t('import.chosenFolder', { path: selectedFolderPath })
                    : selectedFiles.length > 0
                      ? t('import.chosenFiles', { n: selectedFiles.length })
                      : t('import.noFilesChosen')}
                </span>
              </div>
            </div>
          )}

          {!isObsidian && (
          <div>
            <label style={labelStyle}>{t('import.step3')}</label>
            {/* Exactly one target per run — a radio group cannot say "both". */}
            <Segmented<ImportTarget>
              value={target}
              onChange={setTarget}
              ariaLabel={t('import.step3')}
              options={[
                { value: 'subfolder', label: t('import.targetSubfolder'), testId: 'import-target-subfolder' },
                { value: 'newVault', label: t('import.targetNewVault'), testId: 'import-target-newvault' },
              ]}
            />

            <div style={{ marginTop: 'var(--space-3)' }}>
              {target === 'subfolder' ? (
                <>
                  <input
                    type="text"
                    value={subfolder}
                    onChange={(e) => setSubfolder(e.target.value)}
                    style={inputStyle}
                    placeholder={t('import.defaultSubfolder')}
                    aria-label={t('import.targetSubfolder')}
                  />
                  <p style={hintStyle}>
                    {targetVaultPath ? t('import.step3Hint') : t('import.noVaultOpen')}
                  </p>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                    <Button variant="secondary" onClick={handleSelectNewVaultFolder}>
                      <Folder size={ICON.ui} style={{ marginRight: 'var(--space-2)' }} />
                      {t('import.chooseVaultFolder')}
                    </Button>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                      {newVaultPath || t('import.noVaultFolderChosen')}
                    </span>
                  </div>
                  <p style={hintStyle}>{t('import.targetNewVaultHint')}</p>
                </>
              )}
            </div>

            {/* The concrete path, so the target is never a guess. */}
            <p style={{ ...hintStyle, marginTop: 'var(--space-2)' }}>
              {t('import.statTarget')}: <code>{targetPathLabel()}</code>
            </p>
          </div>
          )}

          {/*
            Source-dependent switches, rendered from what the adapter declared.
            The wizard never learns a source: a new importer brings its own
            options and appears here without a line of change in this file.

            They sit AFTER the three numbered steps, not between them: the
            mockup put them on the preview screen, but the preview's counts are
            computed by `analyze`, so a toggle there would either show stale
            numbers or re-run the analysis — for the Notion API that is a
            network round trip per click. Deciding before the preview keeps the
            numbers honest for free.
          */}
          {!isObsidian && sourceOptions.length > 0 && (
            <div data-testid="import-options">
              <label style={labelStyle}>{t('import.stepOptions')}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {sourceOptions.map((option) => (
                  <div key={option.key}>
                    <Checkbox
                      checked={optionValues[option.key] ?? option.defaultValue}
                      data-testid={`import-option-${option.key}`}
                      onChange={(e) =>
                        setOptionValues((prev) => ({ ...prev, [option.key]: e.target.checked }))
                      }
                    >
                      {t(`import.options.${option.key}`)}
                    </Checkbox>
                    <p style={{ ...hintStyle, margin: '0 0 0 var(--space-6)' }}>
                      {t(`import.optionHints.${option.key}`)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'analyzing' && (
        <div style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}>
          <h3 style={{ marginBottom: 'var(--space-2)' }}>{t('import.analyzingTitle')}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>{t('import.analyzingBody')}</p>
        </div>
      )}

      {step === 'preview' && plan && (
        <div>
          <h3 style={{ marginBottom: 'var(--space-4)' }}>
            {t('import.previewTitle', { source: sourceName(plan.sourceId, plan.sourceName) })}
          </h3>

          {/*
            What this import cannot carry over belongs HERE, before anything is
            written — a limit that only shows up in the report afterwards is a
            surprise, not information.
          */}
          {[...(plan.warnings ?? []), ...archiveNotes].length > 0 && (
            <div style={{ marginBottom: 'var(--space-4)' }} data-testid="import-warnings">
              <Banner kind="warning" rounded>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {[...(plan.warnings ?? []), ...archiveNotes].map((w, idx) => (
                    <span key={idx}>{w}</span>
                  ))}
                </div>
              </Banner>
            </div>
          )}

          {/* An import into a connected vault is a bulk UPLOAD (BS1). */}
          {target === 'subfolder' && syncProvider && plan.totalNotes > 0 && (
            <div style={{ marginBottom: 'var(--space-4)' }} data-testid="import-sync-warning">
              <Banner kind="info" rounded>
                {t('import.syncUploadHint', {
                  n: plan.totalNotes,
                  provider: t(PROVIDER_LABEL_KEY[syncProvider] ?? 'settings.provider'),
                })}
              </Banner>
            </div>
          )}

          {plan.totalNotes >= LARGE_IMPORT_NOTES && (
            <div style={{ marginBottom: 'var(--space-4)' }} data-testid="import-large-hint">
              <Banner kind="info" rounded>
                {t('import.largeImportHint', { n: plan.totalNotes })}
              </Banner>
            </div>
          )}

          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            lineHeight: '1.8',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <FileText size={ICON.ui} />
              <span><strong>{t('import.statNotes')}:</strong> {plan.totalNotes}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Database size={ICON.ui} />
              <span><strong>{t('import.statDatabases')}:</strong> {plan.totalDatabases}</span>
            </div>
            {/*
              Attachments and checklists only when the source actually has some:
              a row of zeroes is noise, a missing count would be dishonest.
            */}
            {plan.totalAttachments > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }} data-testid="import-stat-attachments">
                <Paperclip size={ICON.ui} />
                <span><strong>{t('import.statAttachments')}:</strong> {plan.totalAttachments}</span>
              </div>
            )}
            {plan.totalChecklists > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }} data-testid="import-stat-checklists">
                <ListChecks size={ICON.ui} />
                <span><strong>{t('import.statChecklists')}:</strong> {plan.totalChecklists}</span>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Folder size={ICON.ui} />
              <span><strong>{t('import.statTarget')}:</strong> <code>{targetPathLabel()}</code></span>
            </div>
          </div>

          <p style={hintStyle}>{t('import.neverOverwrites')}</p>
        </div>
      )}

      {step === 'importing' && (
        <div style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}>
          <h3 style={{ marginBottom: 'var(--space-4)' }}>{t('import.importingTitle', { percent: progressPct })}</h3>
          <div style={{
            height: 'var(--space-2)',
            background: 'var(--border-color)',
            borderRadius: 'var(--radius-xs)',
            overflow: 'hidden',
            margin: 'var(--space-4) 0'
          }}>
            <div style={{
              height: '100%',
              width: `${progressPct}%`,
              background: 'var(--accent-color)',
              transition: 'width var(--dur-progress)'
            }} />
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>{statusMsg}</p>
        </div>
      )}

      {step === 'report' && report && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            {incompleteCount > 0
              ? <AlertTriangle size={ICON.head} style={{ color: 'var(--warning-text)' }} />
              : <CheckCircle2 size={ICON.head} style={{ color: 'var(--accent-color)' }} />}
            <h3 style={{ margin: 0 }}>
              {incompleteCount > 0 ? t('import.reportTitlePartial') : t('import.reportTitleDone')}
            </h3>
          </div>

          <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
            {t('import.reportSummary', {
              notes: report.importedNotesCount,
              databases: report.importedDatabasesCount,
            })}
          </p>

          {incompleteCount > 0 && (
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--warning-bg)',
              border: '1px solid var(--warning-text)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--warning-text)',
              fontSize: 'var(--text-sm)',
              marginBottom: 'var(--space-4)',
              lineHeight: '1.5',
            }}>
              {t('import.reportIncomplete', {
                degraded: report.degradedCount,
                skipped: report.skippedCount,
              })}
            </div>
          )}

          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            fontSize: 'var(--text-sm)'
          }}>
            {t('import.reportPath')} <code>{report.reportPath}</code>
          </div>

          {/* The undo is a folder, and the moment to say so is now (BS8). */}
          <p style={hintStyle} data-testid="import-undo-hint">
            {target === 'newVault'
              ? t('import.undoVault')
              : t('import.undoFolder', { folder: resolvedTarget().subfolder })}
          </p>
        </div>
      )}
    </Modal>
  );
};
