import React from 'react';
import { Modal, Button } from '@plainva/ui';

interface FirstRunModalProps {
  onClose: () => void;
}

export const FirstRunModal: React.FC<FirstRunModalProps> = ({ onClose }) => {
  return (
    <Modal
      onClose={onClose}
      title="Willkommen bei Plainva 👋"
      size="md"
      footer={
        <Button variant="primary" onClick={onClose}>
          Los geht's
        </Button>
      }
    >
      <div style={{ padding: 'var(--pv-space-2) 0' }}>
        <p style={{ color: 'var(--pv-text-muted)', lineHeight: '1.6', marginBottom: 'var(--pv-space-4)' }}>
          Dein persönlicher Knowledge Vault – 100% lokal, verschlüsselt und schnell.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pv-space-3)', lineHeight: '1.6' }}>
          <div>🔒 <strong>Lokale Markdown-Dateien:</strong> Volle Kontrolle über Deine Notizen & Daten.</div>
          <div>📊 <strong>Datenbanken & Ansichten:</strong> Obsidian-kompatible <code>.base</code>-Ordner mit 8 Ansichten.</div>
          <div>🚀 <strong>Eingebauter Import:</strong> Notizen aus Notion, Evernote, Keep, Logseq & mehr direkt öffnen.</div>
        </div>
      </div>
    </Modal>
  );
};
