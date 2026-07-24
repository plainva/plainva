import React, { useState, useRef } from 'react';
import { Modal, Button, Select } from '@plainva/ui';
import { defaultImportRegistry, type ImportPlan, type ImportReport, type ImportSourceId } from '@plainva/core';

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
  const [selectedSourceId, setSelectedSourceId] = useState<ImportSourceId>('generic_markdown');
  const [subfolder, setSubfolder] = useState<string>('Import Notizen');
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
      case 'notion_api':
        return 'Exportiere Deine Notion-Workspace unter Einstellungen -> Exportieren als HTML/Markdown (ZIP).';
      case 'evernote':
        return 'Wähle Deine in Evernote exportierten .enex Dateien aus (Notizbuch -> Exportieren als ENEX).';
      case 'google_keep':
        return 'Exportiere Deine Keep-Notizen über Google Takeout (JSON-Format) und wähle die entpackten Dateien/Ordner aus.';
      case 'logseq':
        return 'Wähle Deinen Logseq Graph-Ordner (enthält /journals und /pages).';
      case 'simplenote':
        return 'Exportiere Deine Notizen in Simplenote als JSON-Datei und wähle die .json Datei aus.';
      case 'generic_markdown':
      default:
        return 'Wähle einen Ordner oder ZIP-Archiv mit Markdown-Dateien (.md) und Bildern/Anhängen aus.';
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
      // Fallback for Web / Dev mode without Tauri native dialogs
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
        return [{ name: 'Evernote Export', extensions: ['enex'] }];
      case 'google_keep':
      case 'simplenote':
        return [{ name: 'JSON / Takeout', extensions: ['json', 'zip'] }];
      case 'notion_file':
      case 'notion_api':
        return [{ name: 'Notion Export', extensions: ['zip', 'md', 'csv'] }];
      case 'generic_markdown':
      default:
        return [{ name: 'Markdown / ZIP', extensions: ['md', 'markdown', 'zip', 'txt'] }];
    }
  };

  const handleAnalyze = async () => {
    if (selectedFiles.length === 0 && !selectedFolderPath) {
      setErrorMsg('Bitte wähle zuerst mindestens eine Datei oder einen Quell-Ordner aus.');
      return;
    }

    setStep('analyzing');
    setErrorMsg('');

    try {
      const source = defaultImportRegistry.get(selectedSourceId);
      if (!source) throw new Error('Unbekannter Importer');

      let inputPayload: any[] = [];
      if (selectedFiles.length > 0 && selectedFiles[0].file) {
        const readProms = selectedFiles.map(async (f) => {
          const text = f.file ? await f.file.text() : '';
          return { relativePath: f.name, content: text, contentXml: text };
        });
        inputPayload = await Promise.all(readProms);
      } else if (selectedFiles.length > 0 && selectedFiles[0].path) {
        inputPayload = selectedFiles.map(f => ({ relativePath: f.name, path: f.path, content: '' }));
      }

      const analyzedPlan = await source.analyze(inputPayload, {
        targetVaultPath,
        targetSubfolder: subfolder,
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

      let inputPayload: any[] = [];
      if (selectedFiles.length > 0 && selectedFiles[0].file) {
        const readProms = selectedFiles.map(async (f) => {
          const text = f.file ? await f.file.text() : '';
          return { relativePath: f.name, content: text, contentXml: text };
        });
        inputPayload = await Promise.all(readProms);
      } else if (selectedFiles.length > 0 && selectedFiles[0].path) {
        inputPayload = selectedFiles.map(f => ({ relativePath: f.name, path: f.path, content: '' }));
      }

      const executedReport = await source.run(
        inputPayload,
        { targetVaultPath, targetSubfolder: subfolder },
        (pct: number, msg: string) => {
          setProgressPct(pct);
          setStatusMsg(msg);
        }
      );

      setReport(executedReport);
      setStep('report');
    } catch (e) {
      console.error('Import execution failed', e);
      setErrorMsg('Fehler beim Ausführen des Imports: ' + (e instanceof Error ? e.message : String(e)));
      setStep('preview');
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="📥 Aus anderer App importieren"
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
          padding: 'var(--pv-space-3)',
          background: 'var(--pv-color-danger-subtle, rgba(239, 68, 68, 0.1))',
          border: '1px solid var(--pv-color-danger, #ef4444)',
          borderRadius: 'var(--pv-radius-md, 6px)',
          color: 'var(--pv-color-danger, #ef4444)',
          fontSize: 'var(--pv-font-size-sm)',
          marginBottom: 'var(--pv-space-4)',
        }}>
          ⚠️ {errorMsg}
        </div>
      )}

      {step === 'select' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pv-space-4)' }}>
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--pv-space-2)', fontWeight: 600 }}>
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
              options={sources.map((s) => ({ value: s.id, label: `${s.name} (${s.family.toUpperCase()})` }))}
            />
            <p style={{ fontSize: 'var(--pv-font-size-xs)', color: 'var(--pv-text-muted)', marginTop: 'var(--pv-space-2)' }}>
              ℹ️ {getSourceHint(selectedSourceId)}
            </p>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 'var(--pv-space-2)', fontWeight: 600 }}>
              2. Dateien oder Ordner auswählen
            </label>
            <div style={{ display: 'flex', gap: 'var(--pv-space-3)', alignItems: 'center' }}>
              <Button variant="secondary" onClick={handleSelectFilesNative}>
                📁 Dateien / Ordner wählen...
              </Button>
              <span style={{ fontSize: 'var(--pv-font-size-sm)', color: 'var(--pv-text-muted)' }}>
                {selectedFolderPath
                  ? `Ordner: ${selectedFolderPath}`
                  : selectedFiles.length > 0
                    ? `${selectedFiles.length} Datei(en) ausgewählt (${selectedFiles.map(f => f.name).join(', ')})`
                    : 'Noch keine Dateien gewählt'}
              </span>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 'var(--pv-space-2)', fontWeight: 600 }}>
              3. Ziel-Unterordner im Vault
            </label>
            <input
              type="text"
              className="pv-field"
              value={subfolder}
              onChange={(e) => setSubfolder(e.target.value)}
              style={{ width: '100%', padding: 'var(--pv-space-2) var(--pv-space-3)' }}
              placeholder="z.B. Import Keep"
            />
          </div>
        </div>
      )}

      {step === 'analyzing' && (
        <div style={{ textAlign: 'center', padding: 'var(--pv-space-6) 0' }}>
          <h3>🔍 Analysiere Import-Dateien...</h3>
          <p style={{ color: 'var(--pv-text-muted)', fontSize: 'var(--pv-font-size-sm)' }}>
            Dateistruktur, Notizen & Anhänge werden gescannt.
          </p>
        </div>
      )}

      {step === 'preview' && plan && (
        <div>
          <h3 style={{ marginBottom: 'var(--pv-space-3)' }}>Import-Vorschau: {plan.sourceName}</h3>
          <div style={{
            background: 'var(--pv-color-bg-subtle, rgba(0,0,0,0.03))',
            borderRadius: 'var(--pv-radius-md, 6px)',
            padding: 'var(--pv-space-4)',
            lineHeight: '1.8'
          }}>
            <div>📝 <strong>Notizen:</strong> {plan.totalNotes}</div>
            <div>📎 <strong>Anhänge:</strong> {plan.totalAttachments}</div>
            <div>📊 <strong>Datenbanken (.base):</strong> {plan.totalDatabases}</div>
            <div>📁 <strong>Zielordner:</strong> <code>{targetVaultPath}/{subfolder}</code></div>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div style={{ textAlign: 'center', padding: 'var(--pv-space-6) 0' }}>
          <h3 style={{ marginBottom: 'var(--pv-space-3)' }}>⏳ Import läuft... {progressPct}%</h3>
          <div style={{
            height: '8px',
            background: 'var(--pv-color-bg-subtle, #eee)',
            borderRadius: '4px',
            overflow: 'hidden',
            margin: 'var(--pv-space-4) 0'
          }}>
            <div style={{
              height: '100%',
              width: `${progressPct}%`,
              background: 'var(--pv-color-primary, #0d9488)',
              transition: 'width 0.3s ease'
            }} />
          </div>
          <p style={{ color: 'var(--pv-text-muted)', fontSize: 'var(--pv-font-size-sm)' }}>{statusMsg}</p>
        </div>
      )}

      {step === 'report' && report && (
        <div>
          <h3 style={{ marginBottom: 'var(--pv-space-3)', color: 'var(--pv-color-success, #10b981)' }}>
            ✅ Import erfolgreich abgeschlossen!
          </h3>
          <p style={{ color: 'var(--pv-text-muted)', marginBottom: 'var(--pv-space-4)' }}>
            Insgesamt wurden <strong>{report.importedNotesCount} Notizen</strong> und <strong>{report.importedAttachmentsCount} Anhänge</strong> importiert.
          </p>
          <div style={{
            background: 'var(--pv-color-bg-subtle, rgba(0,0,0,0.03))',
            borderRadius: 'var(--pv-radius-md, 6px)',
            padding: 'var(--pv-space-3)',
            fontSize: 'var(--pv-font-size-xs)'
          }}>
            📋 Ausführlicher Bericht abgelegt unter: <code>{report.reportPath}</code>
          </div>
        </div>
      )}
    </Modal>
  );
};
