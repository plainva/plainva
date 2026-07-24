import React from 'react';
import { Button } from '@plainva/ui';
import { getLatestWhatsNew } from '../../services/whatsNew.js';

interface WhatsNewModalProps {
  onClose: () => void;
}

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ onClose }) => {
  const latest = getLatestWhatsNew();

  return (
    <div className="pv-overlay">
      <div className="pv-modal pv-modal--md">
        <div className="pv-modal-header">
          <h2 className="pv-modal-heading">✨ Was gibt's Neues in v{latest.version}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>

        <div className="pv-modal-body">
          <ul style={{ paddingLeft: 'var(--pv-space-5)', lineHeight: '1.6' }}>
            {latest.highlights.map((h, i) => (
              <li key={i} style={{ marginBottom: 'var(--pv-space-2)' }}>{h}</li>
            ))}
          </ul>
        </div>

        <div className="pv-modal-footer">
          {latest.blogUrl && (
            <Button variant="outline" onClick={() => window.open(latest.blogUrl, '_blank')}>
              Blogpost lesen
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            Verstanden
          </Button>
        </div>
      </div>
    </div>
  );
};
