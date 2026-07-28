import React from 'react';
import { Modal, Button } from '@plainva/ui';
import { useTranslation } from 'react-i18next';
import { getAppVersion, getLatestWhatsNew } from '../../services/whatsNew';

interface WhatsNewModalProps {
  onClose: () => void;
}

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const latest = getLatestWhatsNew();

  // The title names the version the user is actually running, not the catalog's.
  // The two diverge on purpose: the shells ship on separate version lines (the
  // phone was at 0.5.12 when the desktop released 0.5.1), and a dialog that
  // announces a version nobody installed reads like a bug. The catalog value is
  // the fallback, which is what this showed before.
  const [version, setVersion] = React.useState(latest.version);
  React.useEffect(() => {
    let cancelled = false;
    void getAppVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    return () => { cancelled = true; };
  }, []);

  // The catalog states how many highlights this release has; the texts come
  // from i18n so they exist in every language.
  const highlights = Array.from({ length: latest.highlightCount }, (_, i) =>
    t(`whatsNew.highlight${i + 1}`, { defaultValue: '' })
  ).filter(Boolean);

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
      title={t('whatsNew.title', { version })}
      size="md"
      footer={
        <>
          {latest.blogUrl && (
            <Button variant="secondary" onClick={handleOpenBlog}>
              {t('whatsNew.readBlog')}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            {t('whatsNew.understand')}
          </Button>
        </>
      }
    >
      <div style={{ padding: 'var(--space-2) 0' }}>
        <p style={{ color: 'var(--text-muted)', lineHeight: '1.6', margin: '0 0 var(--space-4) 0' }}>
          {t('whatsNew.subtitle')}
        </p>
        <div style={{
          background: 'var(--surface-container-low)',
          border: '1px solid var(--border-color-light)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-4) var(--space-5)',
        }}>
          <ul style={{
            margin: 0,
            paddingLeft: 'var(--space-5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            listStyleType: 'disc',
          }}>
            {highlights.map((h, i) => (
              <li key={i} style={{ fontSize: 'var(--text-ui)', lineHeight: '1.6', color: 'var(--text-main)' }}>
                {h}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
};
