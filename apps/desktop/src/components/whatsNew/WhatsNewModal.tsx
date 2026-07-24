import React from 'react';
import { Modal, Button } from '@plainva/ui';
import { useTranslation } from 'react-i18next';
import { getLatestWhatsNew } from '../../services/whatsNew';

interface WhatsNewModalProps {
  onClose: () => void;
}

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const latest = getLatestWhatsNew();

  const highlights = [
    t('whatsNew.highlight1', latest.highlights[0]),
    t('whatsNew.highlight2', latest.highlights[1]),
    t('whatsNew.highlight3', latest.highlights[2]),
    t('whatsNew.highlight4', latest.highlights[3]),
  ];

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
      title={`✨ ${t('whatsNew.title', "Was gibt's Neues in Plainva")}`}
      size="md"
      footer={
        <>
          {latest.blogUrl && (
            <Button variant="secondary" onClick={handleOpenBlog}>
              {t('whatsNew.readBlog', 'Blogpost lesen')}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            {t('whatsNew.understand', 'Verstanden')}
          </Button>
        </>
      }
    >
      <div style={{ padding: 'var(--pv-space-2) 0' }}>
        <div style={{
          background: 'var(--pv-color-bg-subtle, var(--bg-card))',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4) var(--space-5)',
          margin: 'var(--space-2) 0'
        }}>
          <ul style={{
            margin: 0,
            paddingLeft: 'var(--pv-space-5, 20px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--pv-space-3, 12px)',
            listStyleType: 'disc'
          }}>
            {highlights.map((h, i) => (
              <li key={i} style={{ fontSize: 'var(--pv-font-size-md, 14px)', lineHeight: '1.6', color: 'var(--pv-color-text-main, var(--text-main))' }}>
                {h}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
};
