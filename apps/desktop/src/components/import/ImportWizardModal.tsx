import React, { useState, useRef, useEffect } from 'react';
import { Modal, Button, Select, ICON, serializeBaseConfig } from '@plainva/ui';
import { useTranslation } from 'react-i18next';
import { Download, Folder, AlertTriangle, CheckCircle2, FileText, Database } from 'lucide-react';
import { defaultImportRegistry, type ImportPlan, type ImportReport, type ImportSourceId } from '@plainva/core';
import { useVault } from '../../contexts/VaultContext';
import { buildImportLabels } from './importLabels';
import { extractArchive, discardExtractedArchive, type ExtractedArchive } from '../../services/importArchive';

interface ImportWizardModalProps {
  targetVaultPath: string;
  onClose: () => void;
}

interface SelectedFileItem {
  name: string;
  path?: string;
  file?: File;
}

export const ImportWizardModal: React.FC<ImportWizardModalProps> = ({ targetVaultPath, onClose }) => {
  const { vaultAdapter, triggerFileTreeUpdate } = useVault();
  const { t } = useTranslation();

  const [selectedSourceId, setSelectedSourceId] = useState<ImportSourceId>('generic_markdown');
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sources = defaultImportRegistry.list();

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

      if (typeof res === 'string') {
        setSelectedFolderPath(res);
        setSelectedFiles([{ name: res.split(/[/\\]/).pop() || res, path: res }]);
      } else if (Array.isArray(res)) {
        setSelectedFolderPath('');
        const pathsList = res as string[];
        setSelectedFiles(pathsList.map((p: string) => ({ name: p.split(/[/\\]/).pop() || p, path: p })));
      }
    } catch {
      fileInputRef.current?.click();
    }
  };

  const handleWebFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const filesList = Array.from(e.target.files);
    setSelectedFolderPath('');
    setSelectedFiles(filesList.map(f => ({ name: f.name, file: f })));
    setErrorMsg('');
    setArchiveNotes([]);
    clearExtracted();
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

  const loadInputPayload = async (): Promise<any[]> => {
    if (selectedSourceId === 'notion_api') {
      return [{ notionToken }];
    }

    if (selectedFiles.length === 0 && !selectedFolderPath) {
      return [];
    }

    const payload: Array<{ relativePath: string; content: string; contentXml?: string }> = [];
    const notes: string[] = [];
    const skips: Array<{ relativePath: string; reason: string }> = [];

    for (const f of selectedFiles) {
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
            const { readTextFile } = await import('@tauri-apps/plugin-fs');
            const text = await readTextFile(f.path);
            payload.push({ relativePath: f.name, content: text, contentXml: text });
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

  /**
   * Options shared by analyze and run.
   *
   * `serializeBase` hands the core the app's canonical `.base` writer so an
   * imported database is byte-identical to one created in Plainva.
   */
  const buildOptions = (httpFetch: typeof fetch) => ({
    targetVaultPath,
    targetSubfolder: subfolder,
    vaultAdapter,
    httpFetch,
    labels: buildImportLabels(t),
    archiveSkipped: archiveSkipsRef.current,
    serializeBase: (config: any) => serializeBaseConfig(config),
  });

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

    try {
      const source = defaultImportRegistry.get(selectedSourceId);
      if (!source) throw new Error(t('import.errUnknownImporter'));

      const httpFetch = await resolveHttpFetch();
      const inputPayload = await loadInputPayload();
      const executedReport = await source.run(
        inputPayload,
        buildOptions(httpFetch),
        (pct: number, msg: string) => {
          setProgressPct(pct);
          setStatusMsg(msg);
        }
      );

      triggerFileTreeUpdate();
      setReport(executedReport);
      setStep('report');
    } catch (e) {
      console.error('Import execution failed', e);
      setErrorMsg(`${t('import.errRun')} ${e instanceof Error ? e.message : String(e)}`);
      setStep('preview');
    }
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
              <Button variant="primary" onClick={handleAnalyze}>{t('import.next')}</Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="ghost" onClick={() => setStep('select')}>{t('import.back')}</Button>
              <Button variant="primary" onClick={handleRunImport}>{t('import.start')}</Button>
            </>
          )}
          {step === 'report' && (
            <Button variant="primary" onClick={onClose}>{t('common.close')}</Button>
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
              options={sources.map((s) => ({ value: s.id, label: sourceName(s.id, s.name) }))}
            />
            <p style={hintStyle}>{getSourceHint(selectedSourceId)}</p>
          </div>

          {selectedSourceId === 'notion_api' ? (
            <div>
              <label style={labelStyle}>{t('import.step2Token')}</label>
              <input
                type="password"
                value={notionToken}
                onChange={(e) => setNotionToken(e.target.value)}
                style={inputStyle}
                placeholder="secret_..."
              />
              <p style={hintStyle}>{t('import.tokenHint')}</p>
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
                      ? t('import.chosenFiles', { count: selectedFiles.length })
                      : t('import.noFilesChosen')}
                </span>
              </div>
            </div>
          )}

          <div>
            <label style={labelStyle}>{t('import.step3')}</label>
            <input
              type="text"
              value={subfolder}
              onChange={(e) => setSubfolder(e.target.value)}
              style={inputStyle}
              placeholder={t('import.defaultSubfolder')}
            />
            <p style={hintStyle}>{t('import.step3Hint')}</p>
          </div>
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

          {[...(plan.warnings ?? []), ...archiveNotes].length > 0 && (
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--warning-bg)',
              border: '1px solid var(--warning-text)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--warning-text)',
              fontSize: 'var(--text-sm)',
              marginBottom: 'var(--space-4)',
              lineHeight: '1.5',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}>
              {[...(plan.warnings ?? []), ...archiveNotes].map((w, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <AlertTriangle size={ICON.meta} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <span>{w}</span>
                </div>
              ))}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Folder size={ICON.ui} />
              <span><strong>{t('import.statTarget')}:</strong> <code>{targetVaultPath ? `${targetVaultPath}/${subfolder}` : subfolder}</code></span>
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
        </div>
      )}
    </Modal>
  );
};
