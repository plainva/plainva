import React from 'react';
import { Modal, Button, ICON, WhatsNewIcon } from '@plainva/ui';
import { useTranslation } from 'react-i18next';
import { getAppVersion, getLatestWhatsNew } from '../../services/whatsNew';

interface WhatsNewModalProps {
  onClose: () => void;
}

/**
 * What changed in this release — weighted, not listed.
 *
 * It used to be five two-sentence bullets in one card: a wall of text where the
 * biggest feature looked exactly like the smallest. Now the lead highlight gets
 * a headline and a stage of its own and everything else is a compact icon row
 * with one sentence — scannable in the few seconds anyone gives a dialog that
 * stands between them and their notes.
 *
 * The catalog says which icon each highlight carries and which one is the lead;
 * the words live in i18n so they exist in ten languages.
 */
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
    void getAppVersion().then(setVersion);
  }, []);

  const items = latest.highlights.map((h, i) => ({
    ...h,
    title: t(`whatsNew.highlight${i + 1}Title`, { defaultValue: '' }),
    text: t(`whatsNew.highlight${i + 1}`, { defaultValue: '' }),
  }));
  const [lead, ...rest] = items;

  const handleOpenBlog = async () => {
    if (!latest.blogUrl) return;
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(latest.blogUrl);
    } catch {
      window.open(latest.blogUrl, '_blank');
    }
  };

  /** The pill. It replaces the word "(experimental)" inside a sentence, which
      readers skip and translators drop. */
  const experimentalPill = (
    <span
      style={{
        marginLeft: 'var(--space-2)',
        padding: '1px var(--space-2)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--warning-bg)',
        color: 'var(--warning-text)',
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {t('whatsNew.experimental')}
    </span>
  );

  return (
    <Modal
      onClose={onClose}
      title={t('whatsNew.title', { version })}
      size="lg"
      footer={
        <>
          {latest.blogUrl && (
            <Button variant="ghost" onClick={handleOpenBlog} style={{ marginRight: 'auto' }}>
              {t('whatsNew.readBlog')}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            {t('whatsNew.understand')}
          </Button>
        </>
      }
    >
      <div style={{ padding: 'var(--space-2) 0', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {lead && (
          <div
            data-testid="whatsnew-lead"
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: 'var(--space-4)',
              alignItems: 'center',
              border: '1px solid var(--border-color-light)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--accent-container)',
              padding: 'var(--space-4) var(--space-5)',
            }}
          >
            {/* The stage is the icon at size, not a drawing of the feature: a
                per-release illustration is upkeep no release checklist can
                carry, and the icon is already the thing this row is about. */}
            <div
              aria-hidden="true"
              style={{
                width: 64,
                height: 64,
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color-light)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--accent-color)',
              }}
            >
              <WhatsNewIcon name={lead.icon} size={ICON.empty} />
            </div>
            <div>
              <p
                style={{
                  margin: '0 0 var(--space-1) 0',
                  fontSize: 'var(--text-xs)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontWeight: 700,
                  color: 'var(--accent-color)',
                }}
              >
                {t('whatsNew.lead')}
              </p>
              <p
                style={{
                  margin: '0 0 var(--space-1) 0',
                  fontSize: 'var(--text-md)',
                  fontWeight: 600,
                  color: 'var(--on-accent-container)',
                }}
              >
                {lead.title}
                {lead.experimental && experimentalPill}
              </p>
              <p style={{ margin: 0, fontSize: 'var(--text-sm)', lineHeight: '1.55', color: 'var(--on-accent-container)' }}>
                {lead.text}
              </p>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {rest.map((h, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: 'var(--space-3)',
                alignItems: 'start',
                border: '1px solid var(--border-color-light)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-container-low)',
                padding: 'var(--space-3) var(--space-4)',
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-card)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--accent-color)',
                }}
              >
                <WhatsNewIcon name={h.icon} size={ICON.ui} />
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 'var(--text-ui)', fontWeight: 600, color: 'var(--text-main)' }}>
                  {h.title}
                  {h.experimental && experimentalPill}
                </p>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', lineHeight: '1.5', color: 'var(--text-muted)' }}>
                  {h.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};
