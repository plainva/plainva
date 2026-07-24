import React, { useState } from 'react';
import { Button, Select } from '@plainva/ui';
import { defaultImportRegistry, type ImportPlan, type ImportReport, type ImportSourceId } from '@plainva/core';

interface ImportWizardModalProps {
  targetVaultPath: string;
  onClose: () => void;
}

export const ImportWizardModal: React.FC<ImportWizardModalProps> = ({ targetVaultPath, onClose }) => {
  const [selectedSourceId, setSelectedSourceId] = useState<ImportSourceId>('generic_markdown');
  const [subfolder, setSubfolder] = useState<string>('Import Notizen');
  const [step, setStep] = useState<'select' | 'analyzing' | 'preview' | 'importing' | 'report'>('select');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [statusMsg, setStatusMsg] = useState<string>('');

  const sources = defaultImportRegistry.list();

  const handleAnalyze = async () => {
    setStep('analyzing');
    const source = defaultImportRegistry.get(selectedSourceId);
    if (!source) return;

    const mockPlan = await source.analyze([], { targetVaultPath, targetSubfolder: subfolder });
    setPlan(mockPlan);
    setStep('preview');
  };

  const handleRunImport = async () => {
    setStep('importing');
    const source = defaultImportRegistry.get(selectedSourceId);
    if (!source) return;

    const mockReport = await source.run([], { targetVaultPath, targetSubfolder: subfolder }, (pct: number, msg: string) => {
      setProgressPct(pct);
      setStatusMsg(msg);
    });

    setReport(mockReport);
    setStep('report');
  };

  return (
    <div className="pv-overlay">
      <div className="pv-modal pv-modal--md">
        <div className="pv-modal-header">
          <h2 className="pv-modal-heading">📥 Aus anderer App importieren</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>

        <div className="pv-modal-body">
          {step === 'select' && (
            <div>
              <div style={{ marginBottom: 'var(--pv-space-4)' }}>
                <label style={{ display: 'block', marginBottom: 'var(--pv-space-2)', fontWeight: 600 }}>
                  Quell-App auswählen
                </label>
                <Select<ImportSourceId>
                  value={selectedSourceId}
                  onChange={(val) => setSelectedSourceId(val)}
                  ariaLabel="Quell-App auswählen"
                  options={sources.map((s) => ({ value: s.id, label: `${s.name} (${s.description})` }))}
                />
              </div>

              <div style={{ marginBottom: 'var(--pv-space-4)' }}>
                <label style={{ display: 'block', marginBottom: 'var(--pv-space-2)', fontWeight: 600 }}>
                  Ziel-Unterordner im Vault
                </label>
                <input
                  type="text"
                  className="pv-field"
                  value={subfolder}
                  onChange={(e) => setSubfolder(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}

          {step === 'preview' && plan && (
            <div>
              <h3>Import-Vorschau ({plan.sourceName})</h3>
              <ul>
                <li>Erkannte Notizen: {plan.totalNotes}</li>
                <li>Erkannte Anhänge: {plan.totalAttachments}</li>
                <li>Erkannte Datenbanken (.base): {plan.totalDatabases}</li>
              </ul>
            </div>
          )}

          {step === 'importing' && (
            <div style={{ textAlign: 'center', padding: 'var(--pv-space-6) 0' }}>
              <h3>Import läuft... {progressPct}%</h3>
              <p>{statusMsg}</p>
            </div>
          )}

          {step === 'report' && report && (
            <div>
              <h3>✅ Import erfolgreich abgeschlossen!</h3>
              <p>Ein ausführlicher Bericht wurde unter <code>{report.reportPath}</code> abgelegt.</p>
            </div>
          )}
        </div>

        <div className="pv-modal-footer">
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
        </div>
      </div>
    </div>
  );
};
