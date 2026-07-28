import React from 'react';
import { Modal, Button, ICON } from '@plainva/ui';
import { useTranslation } from 'react-i18next';
import { openUrl } from '@tauri-apps/plugin-opener';
import { FileText, Database, Download, FolderOpen, Plus } from 'lucide-react';
import { userGuideUrl } from '../../services/docsLinks';

interface FirstRunModalProps {
  /** "Later" — leaves the welcome and shows the ordinary splash. */
  onClose: () => void;
  /** Opens an existing vault (local or in a cloud), via the splash's own flow. */
  onOpenVault: () => void;
  /** Creates a new vault, via the splash's own flow. */
  onNewVault: () => void;
  /** Starts the import wizard. */
  onImport: () => void;
}

const WEBSITE_URL = 'https://plainva.com';

/**
 * A miniature of the app, drawn rather than screenshotted.
 *
 * A screenshot would be one language and one theme; this is rendered from the
 * same tokens as the app, so it follows the user's theme and reads in all ten
 * languages. The labels come from the real UI wherever one exists — a preview
 * that names things differently from the app teaches the wrong words.
 */
const MiniPreview: React.FC = () => {
  const { t } = useTranslation();

  const head: React.CSSProperties = {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-faint)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    margin: '0 0 var(--space-1) 0',
  };
  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    padding: '2px 0',
  };
  const dot = (active: boolean): React.CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: 'var(--radius-xs)',
    background: active ? 'var(--accent-color)' : 'var(--border-color)',
    flexShrink: 0,
  });

  return (
    <div
      aria-hidden="true"
      style={{
        display: 'grid',
        gridTemplateColumns: '38% 1fr',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        background: 'var(--bg-card)',
        minHeight: 190,
      }}
    >
      <div style={{ background: 'var(--surface-container-low)', padding: 'var(--space-3)' }}>
        <p style={head}>{t('firstRun.miniAreas')}</p>
        <div style={{ ...row, color: 'var(--text-main)' }}><span style={dot(true)} />{t('sidebar.files')}</div>
        <div style={row}><span style={dot(false)} />{t('rightPanel.calendar')}</div>
        <div style={row}><span style={dot(false)} />{t('database.viewPinboard')}</div>
        <p style={{ ...head, marginTop: 'var(--space-3)' }}>{t('sidebar.databases')}</p>
        <div style={row}><span style={dot(false)} />{t('firstRun.miniDatabase')}</div>
      </div>

      <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ fontSize: 'var(--text-ui)', fontWeight: 600, color: 'var(--text-main)' }}>
          {t('firstRun.miniDocTitle')}
        </div>
        <div style={{ ...row, color: 'var(--text-faint)' }}>
          {/* Only the text is struck through — a struck-through tick reads as
              "not done", which is the opposite of what it says. */}
          <span style={{ color: 'var(--accent-color)' }}>✓</span>
          <span style={{ textDecoration: 'line-through' }}>{t('firstRun.miniDone')}</span>
        </div>
        <div style={row}>
          <span>☐</span>
          {t('firstRun.miniTask')}
        </div>
        <div style={{ ...row, gap: 'var(--space-1)' }}>
          <span>{t('firstRun.miniSee')}</span>
          <span style={{ color: 'var(--accent-color)' }}>[[{t('firstRun.miniLink')}]]</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Shown once, to people opening Plainva for the very first time.
 *
 * It ends in a decision rather than in "next": the three actions are the same
 * ones the splash offers, so the welcome is the entry itself instead of a
 * screen in front of it. That is also where a switcher first sees that
 * importing exists — before this it lived in a menu that needs a vault.
 */
export const FirstRunModal: React.FC<FirstRunModalProps> = ({
  onClose,
  onOpenVault,
  onNewVault,
  onImport,
}) => {
  const { t } = useTranslation();

  const points = [
    { icon: FileText, text: t('firstRun.point1') },
    { icon: Database, text: t('firstRun.point2') },
    { icon: Download, text: t('firstRun.point3') },
  ];

  const linkStyle: React.CSSProperties = {
    color: 'var(--accent-color)',
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    cursor: 'pointer',
  };

  return (
    <Modal
      onClose={onClose}
      title={t('firstRun.title')}
      size="lg"
      footer={
        <>
          {/* "Later" is the way out, not one of the three offers — it sits
              apart from them rather than as a fourth button in the row. */}
          <Button variant="ghost" onClick={onClose} style={{ marginRight: 'auto' }}>
            {t('firstRun.later')}
          </Button>
          <Button
            variant="secondary"
            onClick={onOpenVault}
            data-testid="firstrun-open"
            icon={<FolderOpen size={ICON.ui} />}
          >
            {t('splash.openVault')}
          </Button>
          <Button
            variant="secondary"
            onClick={onNewVault}
            data-testid="firstrun-new"
            icon={<Plus size={ICON.ui} />}
          >
            {t('splash.newVault')}
          </Button>
          <Button
            variant="primary"
            onClick={onImport}
            data-testid="firstrun-import"
            icon={<Download size={ICON.ui} />}
          >
            {t('splash.importVault')}
          </Button>
        </>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-5)',
          alignItems: 'center',
          padding: 'var(--space-2) 0',
        }}
      >
        <div>
          <p style={{ color: 'var(--text-muted)', lineHeight: '1.6', margin: '0 0 var(--space-4) 0' }}>
            {t('firstRun.intro')}
          </p>

          {/* One line per point, not a paragraph: this screen is a decision aid. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {points.map(({ icon: Icon, text }) => (
              <span
                key={text}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  alignSelf: 'flex-start',
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--surface-container-low)',
                  border: '1px solid var(--border-color-light)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-main)',
                }}
              >
                <Icon size={ICON.meta} style={{ flexShrink: 0, color: 'var(--accent-color)' }} />
                {text}
              </span>
            ))}
          </div>

          <p style={{ margin: 'var(--space-4) 0 0 0', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {t('firstRun.moreAt')}{' '}
            <button type="button" style={linkStyle} onClick={() => void openUrl(WEBSITE_URL)}>
              plainva.com
            </button>
            {' · '}
            <button
              type="button"
              style={linkStyle}
              onClick={() => void openUrl(userGuideUrl('Getting_Started.md'))}
            >
              {t('firstRun.guideLink')}
            </button>
          </p>
        </div>

        <MiniPreview />
      </div>
    </Modal>
  );
};
