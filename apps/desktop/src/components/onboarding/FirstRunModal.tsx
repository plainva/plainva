import React from 'react';
import { Button } from '@plainva/ui';

interface FirstRunModalProps {
  onClose: () => void;
}

export const FirstRunModal: React.FC<FirstRunModalProps> = ({ onClose }) => {
  return (
    <div className="pv-overlay">
      <div className="pv-modal pv-modal--md">
        <div className="pv-modal-header">
          <h2 className="pv-modal-heading">Willkommen bei Plainva 👋</h2>
        </div>
        <div className="pv-modal-body">
          <p style={{ color: 'var(--pv-text-muted)', lineHeight: '1.6' }}>
            Dein persönlicher Knowledge Vault – 100% lokal, verschlüsselt und schnell.
          </p>

          <div style={{ margin: 'var(--pv-space-4) 0', lineHeight: '1.7' }}>
            <div>🔒 <strong>Lokale Markdown-Dateien:</strong> Volle Kontrolle über Deine Notizen & Daten.</div>
            <div>📊 <strong>Datenbanken & Ansichten:</strong> Obsidian-kompatible <code>.base</code>-Ordner mit 8 Ansichten.</div>
            <div>🚀 <strong>Eingebauter Import:</strong> Notizen aus Notion, Evernote, Keep, Logseq & mehr direkt öffnen.</div>
          </div>
        </div>

        <div className="pv-modal-footer">
          <Button variant="primary" onClick={onClose}>
            Los geht's
          </Button>
        </div>
      </div>
    </div>
  );
};
