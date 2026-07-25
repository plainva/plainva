import React from 'react';
import { Modal, Button } from '@plainva/ui';
import { useTranslation } from 'react-i18next';

interface FirstRunModalProps {
  onClose: () => void;
}

/** Shown once, to people opening Plainva for the very first time. */
export const FirstRunModal: React.FC<FirstRunModalProps> = ({ onClose }) => {
  const { t } = useTranslation();

  const points = [t('firstRun.point1'), t('firstRun.point2'), t('firstRun.point3')];

  return (
    <Modal
      onClose={onClose}
      title={t('firstRun.title')}
      size="md"
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('firstRun.start')}
        </Button>
      }
    >
      <div style={{ padding: 'var(--space-2) 0' }}>
        <p style={{ color: 'var(--text-muted)', lineHeight: '1.6', margin: '0 0 var(--space-4) 0' }}>
          {t('firstRun.intro')}
        </p>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          lineHeight: '1.6',
          fontSize: 'var(--text-ui)',
          color: 'var(--text-main)',
        }}>
          {points.map((point, i) => (
            <div key={i}>{point}</div>
          ))}
        </div>
      </div>
    </Modal>
  );
};
