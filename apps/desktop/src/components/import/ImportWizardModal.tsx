import React, { useState, useRef } from 'react';
import { Modal, Button, Select, ICON } from '@plainva/ui';
import { Download, Folder, AlertTriangle, CheckCircle2, FileText, Database } from 'lucide-react';
import { defaultImportRegistry, unpackZipArchive, type ImportPlan, type ImportReport, type ImportSourceId } from '@plainva/core';
import { useVault } from '../../contexts/VaultContext';

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

  const [selectedSourceId, setSelectedSourceId] = useState<ImportSourceId>('generic_markdown');
  const [subfolder, setSubfolder] = useState<string>('Import Notizen');
  const [notionToken, setNotionToken] = useState<string>('');
  const [selectedFiles, setSelectedFiles] = useState<SelectedFileItem[]>([]);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>('');
  const [step, setStep] = useState<'select' | 'analyzing' | 'preview' | 'importing' | 'report'>('select');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sources = defaultImportRegistry.list();

  const getSourceHint = (id: ImportSourceId): string => {
    switch (id) {
      case 'notion_file':
        return 'Wähle Deinen Notion ZIP-Export oder entpackten Ordner mit Markdown/CSV-Dateien aus.';
      case 'notion_api':
        return 'Gib Deinen Notion Integration Token ein, um freigegebene Notizen & Datenbanken direkt per API zu laden.';
      case 'evernote':
        return 'Wähle Deine in Evernote exportierten .enex Dateien aus (Notizbuch -> Exportieren als ENEX).';
      case 'google_keep':
        return 'Wähle den Google Takeout ZIP-Export oder die entpackten .json Dateien aus.';
      case 'logseq':
        return 'Wähle Deinen Logseq Graph-Ordner (enthält /journals und /pages).';
      case 'simplenote':
        return 'Wähle die .json Export-Datei aus Simplenote aus.';
      case 'generic_markdown':
      default:
        return 'Wähle einen Ordner oder Dateien mit Markdown (.md) und Anhängen aus.';
    }
  };

  const handleSelectFilesNative = async () => {
    setErrorMsg('');
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
  };

  const getFiltersForSource = (id: ImportSourceId) => {
    switch (id) {
      case 'evernote':
        return [{ name: 'Evernote Export', extensions: ['enex', 'zip'] }];
      case 'google_keep':
      case 'simplenote':
        return [{ name: 'JSON / Takeout', extensions: ['json', 'zip'] }];
      case 'notion_file':
        return [{ name: 'Notion Export', extensions: ['zip', 'md', 'csv'] }];
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

    for (const f of selectedFiles) {
      const isZip = f.name.toLowerCase().endsWith('.zip');

      if (f.file) {
        if (isZip) {
          try {
            const buffer = await f.file.arrayBuffer();
            const extracted = await unpackZipArchive(buffer);
            payload.push(...extracted);
          } catch (e) {
            console.error('ZIP extraction failed', e);
          }
        } else {
          const text = await f.file.text();
          payload.push({ relativePath: f.name, content: text, contentXml: text });
        }
      } else if (f.path) {
        if (isZip) {
          try {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const binary = await readFile(f.path);
            const extracted = await unpackZipArchive(binary);
            payload.push(...extracted);
          } catch (e) {
            console.error('Tauri ZIP extraction failed', e);
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

    return payload;
  };

  const handleAnalyze = async () => {
    if (selectedSourceId !== 'notion_api' && selectedFiles.length === 0 && !selectedFolderPath) {
      setErrorMsg('Bitte wähle zuerst mindestens eine Datei oder einen Quell-Ordner aus.');
      return;
    }
    if (selectedSourceId === 'notion_api' && !notionToken.trim()) {
      setErrorMsg('Bitte gib Deinen Notion Integration Token ein.');
      return;
    }

    setStep('analyzing');
    setErrorMsg('');

    try {
      const source = defaultImportRegistry.get(selectedSourceId);
      if (!source) throw new Error('Unbekannter Importer');

      let httpFetch: typeof fetch = globalThis.fetch;
      try {
        const tauriHttp = await import('@tauri-apps/plugin-http');
        if (typeof tauriHttp.fetch === 'function') httpFetch = tauriHttp.fetch;
      } catch {}

      const inputPayload = await loadInputPayload();
      const analyzedPlan = await source.analyze(inputPayload, {
        targetVaultPath,
        targetSubfolder: subfolder,
        vaultAdapter,
        httpFetch,
      });

      setPlan(analyzedPlan);
      setStep('preview');
    } catch (e) {
      console.error('Import analyse failed', e);
      setErrorMsg('Fehler bei der Analyse der Dateien: ' + (e instanceof Error ? e.message : String(e)));
      setStep('select');
    }
  };

  const handleRunImport = async () => {
    setStep('importing');
    setProgressPct(10);
    setStatusMsg('Bereite Notizen vor...');

    try {
      const source = defaultImportRegistry.get(selectedSourceId);
      if (!source) throw new Error('Unbekannter Importer');

      let httpFetch: typeof fetch = globalThis.fetch;
      try {
        const tauriHttp = await import('@tauri-apps/plugin-http');
        if (typeof tauriHttp.fetch === 'function') httpFetch = tauriHttp.fetch;
      } catch {}

      const inputPayload = await loadInputPayload();
      const executedReport = await source.run(
        inputPayload,
        { targetVaultPath, targetSubfolder: subfolder, vaultAdapter, httpFetch },
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
      setErrorMsg('Fehler beim Ausführen des Imports: ' + (e instanceof Error ? e.message : String(e)));
      setStep('preview');
    }
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 'var(--text-ui, 13px)',
    fontWeight: 600,
    color: 'var(--text-main)',
    marginBottom: 'var(--space-2, 8px)',
  };

  const hintStyle: React.CSSProperties = {
    fontSize: 'var(--text-sm, 12px)',
    color: 'var(--text-muted)',
    marginTop: 'var(--space-2, 8px)',
    lineHeight: '1.5',
    margin: 'var(--space-2, 8px) 0 0 0',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: '34px',
    padding: '0 var(--space-3, 12px)',
    fontSize: 'var(--text-ui, 13px)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-card)',
    color: 'var(--text-main)',
    boxSizing: 'border-box',
  };

  return (
    <Modal
      onClose={onClose}
      title="Aus anderer App importieren"
      icon={<Download size={ICON.head} style={{ color: 'var(--accent-color)' }} />}
      size="md"
      footer={
        <>
          {step === 'select' && (
            <>
              <Button variant="secondary" onClick={onClose}>Abbrechen</Button>
              <Button variant="primary" onClick={handleAnalyze}>Weiter zur Analyse</Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="secondary" onClick={() => setStep('select')}>Zurück</Button>
              <Button variant="primary" onClick={handleRunImport}>Import jetzt starten</Button>
            </>
          )}
          {step === 'report' && (
            <Button variant="primary" onClick={onClose}>Schließen</Button>
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
          fontSize: 'var(--text-sm, 12px)',
          marginBottom: 'var(--space-5, 20px)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}>
          <AlertTriangle size={ICON.ui} style={{ flexShrink: 0 }} />
          <span>{errorMsg}</span>
        </div>
      )}

      {step === 'select' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5, 20px)', padding: 'var(--space-2) 0' }}>
          <div>
            <label style={labelStyle}>
              1. Quell-App auswählen
            </label>
            <Select<ImportSourceId>
              value={selectedSourceId}
              onChange={(val) => {
                setSelectedSourceId(val);
                setSelectedFiles([]);
                setSelectedFolderPath('');
                setErrorMsg('');
              }}
              ariaLabel="Quell-App auswählen"
              options={sources.map((s) => ({ value: s.id, label: s.name }))}
            />
            <p style={hintStyle}>
              {getSourceHint(selectedSourceId)}
            </p>
          </div>

          {selectedSourceId === 'notion_api' ? (
            <div>
              <label style={labelStyle}>
                2. Notion Integration Token
              </label>
              <input
                type="password"
                value={notionToken}
                onChange={(e) => setNotionToken(e.target.value)}
                style={inputStyle}
                placeholder="secret_..."
              />
              <p style={hintStyle}>
                Erstelle unter <code>notion.so/my-integrations</code> den Token. Klicke in Notion auf Deiner Seite oben rechts auf <strong>„...“ &rarr; „Verbindungen“ („Connections“)</strong> und füge Deine Verbindung hinzu.
              </p>
            </div>
          ) : (
            <div>
              <label style={labelStyle}>
                2. Dateien oder Ordner auswählen
              </label>
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                <Button variant="secondary" onClick={handleSelectFilesNative}>
                  <Folder size={ICON.ui} style={{ marginRight: '6px' }} />
                  Dateien / Ordner wählen...
                </Button>
                <span style={{ fontSize: 'var(--text-sm, 12px)', color: 'var(--text-muted)' }}>
                  {selectedFolderPath
                    ? `Ordner: ${selectedFolderPath}`
                    : selectedFiles.length > 0
                      ? `${selectedFiles.length} Datei(en) ausgewählt (${selectedFiles.map(f => f.name).join(', ')})`
                      : 'Noch keine Dateien gewählt'}
                </span>
              </div>
            </div>
          )}

          <div>
            <label style={labelStyle}>
              3. Ziel-Unterordner im Vault
            </label>
            <input
              type="text"
              value={subfolder}
              onChange={(e) => setSubfolder(e.target.value)}
              style={inputStyle}
              placeholder="z.B. Import Keep"
            />
          </div>
        </div>
      )}

      {step === 'analyzing' && (
        <div style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}>
          <h3 style={{ marginBottom: 'var(--space-2)' }}>Analysiere Import-Dateien...</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            Dateistruktur, Notizen & Anhänge werden gescannt.
          </p>
        </div>
      )}

      {step === 'preview' && plan && (
        <div>
          <h3 style={{ marginBottom: 'var(--space-4)' }}>Import-Vorschau: {plan.sourceName}</h3>

          {plan.warnings && plan.warnings.length > 0 && (
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--warning-bg)',
              border: '1px solid var(--warning-text)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--warning-text)',
              fontSize: 'var(--text-sm)',
              marginBottom: 'var(--space-4)',
              lineHeight: '1.5'
            }}>
              {plan.warnings.map((w, idx) => (
                <div key={idx}>⚠️ {w}</div>
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
              <span><strong>Notizen:</strong> {plan.totalNotes}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Folder size={ICON.ui} />
              <span><strong>Anhänge:</strong> {plan.totalAttachments}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Database size={ICON.ui} />
              <span><strong>Datenbanken (.base):</strong> {plan.totalDatabases}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Folder size={ICON.ui} />
              <span><strong>Zielordner:</strong> <code>{targetVaultPath ? `${targetVaultPath}/${subfolder}` : subfolder}</code></span>
            </div>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}>
          <h3 style={{ marginBottom: 'var(--space-4)' }}>Import läuft... {progressPct}%</h3>
          <div style={{
            height: '8px',
            background: 'var(--border-color)',
            borderRadius: 'var(--radius-xs)',
            overflow: 'hidden',
            margin: 'var(--space-4) 0'
          }}>
            <div style={{
              height: '100%',
              width: `${progressPct}%`,
              background: 'var(--accent-color)',
              transition: 'width var(--transition-fast)'
            }} />
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>{statusMsg}</p>
        </div>
      )}

      {step === 'report' && report && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <CheckCircle2 size={ICON.head} style={{ color: 'var(--accent-color)' }} />
            <h3 style={{ margin: 0 }}>Import erfolgreich abgeschlossen!</h3>
          </div>
          <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-5)' }}>
            Insgesamt wurden <strong>{report.importedNotesCount} Notizen</strong> und <strong>{report.importedAttachmentsCount} Anhänge</strong> importiert.
          </p>
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            fontSize: 'var(--text-sm)'
          }}>
            Ausführlicher Bericht abgelegt unter: <code>{report.reportPath}</code>
          </div>
        </div>
      )}
    </Modal>
  );
};
