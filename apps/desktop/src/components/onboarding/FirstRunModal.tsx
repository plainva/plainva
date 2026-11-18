import React from 'react';
import { Modal, Banner, Button, ICON } from '@plainva/ui';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Sparkles } from 'lucide-react';
import { openExternalUrl as openUrl } from '../../services/openExternal';
import { userGuideUrl } from '../../services/docsLinks';

const WEBSITE_URL = 'https://plainva.com';

/** A link-styled action inside a sentence — the welcome's four quieter ways. */
const TextLink: React.FC<{ onClick: () => void; disabled?: boolean; testId?: string; children: React.ReactNode }> = ({ onClick, disabled, testId, children }) => (
  <button type="button" className="pv-linkbtn" onClick={onClick} disabled={disabled} data-testid={testId}>
    {children}
  </button>
);

/** Where the tour is: not started, being written, or refused where it was to go. */
export type TourProgress = { kind: 'idle' } | { kind: 'busy' } | { kind: 'failed'; place: string };

interface FirstRunModalProps {
  /** "Later" and the ✕ — leave the welcome and show the ordinary splash. */
  onClose: () => void;
  /** The main action: makes the tour vault in one click and opens it. */
  onTour: () => void;
  /** After a refused place: the tour, in a folder the person picks. */
  onTourElsewhere: () => void;
  /** Opens a folder that already holds notes (an Obsidian vault, a folder of Markdown). */
  onOpenFolder: () => void;
  /** Makes a new, empty vault, via the splash's own flow. */
  onNewEmpty: () => void;
  /** Starts the import wizard. */
  onImport: () => void;
  /** Where the tour will go — a path only, worked out without looking into it. */
  tourFolder: string | null;
  tour: TourProgress;
}

/**
 * Shown once, to people opening Plainva for the very first time (plan
 * Oberfläche, O8 / D3 / E5, mockup M8).
 *
 * Show rather than explain: the tour is the main action, because sentences
 * about what Plainva can do are worth less than a vault in which it does it.
 * Beside it the one other common first step — a folder of notes the user
 * already has. Starting empty and importing from another app stay one click
 * away as links: they are real ways in, not the first suggestion. "Later" is
 * the way out and sits apart from the offers, with the website and the guide
 * for whoever wants to read first.
 *
 * While the tour is written the welcome stays and says so, and nothing in it
 * can be pressed twice. Where the place is refused (macOS asks before an app
 * may look into "Documents"), it says so in words and offers another place —
 * never the system's raw message (review of O8, 2026-11-17).
 *
 * The welcome used to lead with the import, and the tour sat three clicks
 * deep under "New vault" (finding D3, review 2026-11-10).
 */
export const FirstRunModal: React.FC<FirstRunModalProps> = ({
  onClose,
  onTour,
  onTourElsewhere,
  onOpenFolder,
  onNewEmpty,
  onImport,
  tourFolder,
  tour,
}) => {
  const { t } = useTranslation();
  const busy = tour.kind === 'busy';
  const close = () => { if (!busy) onClose(); };

  return (
    <Modal
      onClose={close}
      title={t('firstRun.title')}
      size="lg"
      testId="firstrun-dialog"
      footer={
        <Button variant="ghost" onClick={close} disabled={busy} data-testid="firstrun-later" style={{ marginRight: 'auto' }}>
          {t('firstRun.later')}
        </Button>
      }
    >
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

          {tour.kind === 'failed' && (
            <Banner
              kind="warning"
              rounded
              testId="firstrun-tour-failed"
              actions={
                <Button variant="secondary" onClick={onTourElsewhere} data-testid="firstrun-tour-elsewhere">
                  {t('firstRun.tourElsewhere')}
                </Button>
              }
            >
              {t('firstRun.tourFailed', { place: tour.place })}
            </Banner>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <Button
              variant="primary"
              onClick={onTour}
              disabled={busy}
              aria-busy={busy}
              data-testid="firstrun-tour"
              icon={<Sparkles size={ICON.ui} />}
            >
              {busy ? t('firstRun.tourBusy') : t('firstRun.tour')}
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
            <TextLink onClick={onNewEmpty} disabled={busy} testId="firstrun-new">
              {t('firstRun.newEmpty')}
            </TextLink>
            {' · '}
            <TextLink onClick={onImport} disabled={busy} testId="firstrun-import">
              {t('firstRun.importLink')}
            </TextLink>
          </p>

          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }} data-testid="firstrun-more">
            {t('firstRun.moreAt')}{' '}
            <TextLink onClick={() => void openUrl(WEBSITE_URL)}>plainva.com</TextLink>
            {' · '}
            <TextLink onClick={() => void openUrl(userGuideUrl('Getting_Started.md'))}>
              {t('firstRun.guideLink')}
            </TextLink>
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
