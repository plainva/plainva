import React from 'react';
import { Modal, Button, ICON } from '@plainva/ui';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Sparkles } from 'lucide-react';

interface FirstRunModalProps {
  /** The ✕ — leaves the welcome and shows the ordinary splash. */
  onClose: () => void;
  /** The main action: makes the tour vault in one click and opens it. */
  onTour: () => void;
  /** Opens a folder that already holds notes (an Obsidian vault, a folder of Markdown). */
  onOpenFolder: () => void;
  /** Makes a new, empty vault, via the splash's own flow. */
  onNewEmpty: () => void;
  /** Starts the import wizard. */
  onImport: () => void;
  /** Where the tour will be made, once known — named before the click. */
  tourFolder: string | null;
  /** True while the tour is being written; the actions wait. */
  busy?: boolean;
}

/**
 * Shown once, to people opening Plainva for the very first time (plan
 * Oberfläche, O8 / D3 / E5, mockup M8).
 *
 * Show rather than explain: the tour is the main action, because twelve
 * sentences about what Plainva can do are worth less than a vault in which
 * it does it. Beside it the one other common first step — a folder of notes
 * the user already has. Starting empty and importing from another app stay
 * one click away as links: they are real ways in, not the first suggestion.
 *
 * The welcome used to lead with the import, and the tour sat three clicks
 * deep under "New vault" (finding D3, review 2026-11-10).
 */
export const FirstRunModal: React.FC<FirstRunModalProps> = ({
  onClose,
  onTour,
  onOpenFolder,
  onNewEmpty,
  onImport,
  tourFolder,
  busy = false,
}) => {
  const { t } = useTranslation();

  return (
    <Modal onClose={onClose} title={t('firstRun.title')} size="lg" testId="firstrun-dialog">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 'var(--space-5)',
          alignItems: 'start',
          padding: 'var(--space-2) 0',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--text-headline)', color: 'var(--text-main)' }}>
            {t('firstRun.heading')}
          </h3>
          <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: '1.6' }}>
            {t('firstRun.body')}
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <Button
              variant="primary"
              onClick={onTour}
              disabled={busy}
              data-testid="firstrun-tour"
              icon={<Sparkles size={ICON.ui} />}
            >
              {t('firstRun.tour')}
            </Button>
            <Button
              variant="secondary"
              onClick={onOpenFolder}
              disabled={busy}
              data-testid="firstrun-open"
              icon={<FolderOpen size={ICON.ui} />}
            >
              {t('firstRun.openFolder')}
            </Button>
          </div>

          {/* Two real ways in, one click away — but not the first suggestion. */}
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            <button type="button" className="pv-linkbtn" onClick={onNewEmpty} disabled={busy} data-testid="firstrun-new">
              {t('firstRun.newEmpty')}
            </button>
            {' · '}
            <button type="button" className="pv-linkbtn" onClick={onImport} disabled={busy} data-testid="firstrun-import">
              {t('firstRun.importLink')}
            </button>
          </p>
        </div>

        <div
          data-testid="firstrun-tour-card"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color-light)',
            background: 'var(--surface-container-low)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <strong style={{ color: 'var(--text-main)' }}>{t('firstRun.tourCardTitle')}</strong>
          <span style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('firstRun.tourCardBody')}</span>
          {tourFolder && (
            <span style={{ color: 'var(--text-faint)', overflowWrap: 'anywhere' }} data-testid="firstrun-tour-where">
              {t('firstRun.tourCardWhere', { path: tourFolder })}
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
};
