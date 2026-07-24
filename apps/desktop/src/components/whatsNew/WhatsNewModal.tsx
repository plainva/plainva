import React from 'react';
import { Modal, Button } from '@plainva/ui';
import { getLatestWhatsNew } from '../../services/whatsNew';

interface WhatsNewModalProps {
  onClose: () => void;
}

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ onClose }) => {
  const latest = getLatestWhatsNew();

  const handleOpenBlog = async () => {
    if (!latest.blogUrl) return;
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(latest.blogUrl);
    } catch {
      window.open(latest.blogUrl, '_blank');
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={`✨ Was gibt's Neues in v${latest.version}`}
      size="md"
      footer={
        <>
          {latest.blogUrl && (
            <Button variant="secondary" onClick={handleOpenBlog}>
              Blogpost lesen
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            Verstanden
          </Button>
        </>
      }
    >
      <div style={{ padding: 'var(--pv-space-2) 0' }}>
        <p style={{ color: 'var(--pv-text-muted)', marginBottom: 'var(--pv-space-3)', fontSize: 'var(--pv-font-size-sm)' }}>
          {latest.title} ({latest.releaseDate}):
        </p>
        <ul style={{ paddingLeft: 'var(--pv-space-5)', lineHeight: '1.7', margin: 0 }}>
          {latest.highlights.map((h, i) => (
            <li key={i} style={{ marginBottom: 'var(--pv-space-2)', fontSize: 'var(--pv-font-size-md)' }}>
              {h}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
};
