// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { WhatsNewItem } from '@plainva/ui';

/**
 * The release dialog's shape (P3.2).
 *
 * The lead highlight is rendered large and the rest as rows — a weighting the
 * catalog decides, not the component. And the "Experimental" pill has to come
 * from the DATA: as a word inside a sentence it was the first thing a reader
 * skipped and the first thing a translator dropped. Nothing in 0.5.1 is
 * experimental, so without this test the pill would be built once and never
 * exercised until the release that needs it.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const catalogEntry: WhatsNewItem = {
  version: '1.2.3',
  releaseDate: '2026-01-01',
  highlights: [{ icon: 'import' }, { icon: 'lock', experimental: true }, { icon: 'sync' }],
  blogUrl: 'https://example.test/blog',
};

vi.mock('../../services/whatsNew', () => ({
  getLatestWhatsNew: () => catalogEntry,
  getAppVersion: async () => '1.2.3',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'whatsNew.title') return `What's new in ${opts?.version}`;
      if (key === 'whatsNew.lead') return 'Biggest change';
      if (key === 'whatsNew.experimental') return 'Experimental';
      if (key === 'whatsNew.readBlog') return 'Read the blog post';
      if (key === 'whatsNew.understand') return 'Got it';
      return key.replace('whatsNew.', ''); // highlight1Title, highlight1, ...
    },
  }),
}));

import { WhatsNewModal } from './WhatsNewModal';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(el: ReactElement) {
  act(() => root.render(el));
}

describe('WhatsNewModal', () => {
  it('renders the first highlight as the lead and the rest as rows', () => {
    render(<WhatsNewModal onClose={() => {}} />);

    const leads = document.querySelectorAll('[data-testid="whatsnew-lead"]');
    expect(leads).toHaveLength(1);
    expect(leads[0].textContent).toContain('Biggest change');
    expect(leads[0].textContent).toContain('highlight1Title');

    // Everything after the first is a row — and outside the lead.
    expect(leads[0].textContent).not.toContain('highlight2Title');
    expect(document.body.textContent).toContain('highlight2Title');
    expect(document.body.textContent).toContain('highlight3Title');
  });

  it('marks an experimental highlight with the pill — and only that one', () => {
    render(<WhatsNewModal onClose={() => {}} />);

    const pills = Array.from(document.querySelectorAll('span')).filter(
      (s) => s.textContent === 'Experimental'
    );
    expect(pills).toHaveLength(1);
    // It belongs to the highlight the catalog marked, not to a neighbour.
    expect(pills[0].parentElement?.textContent).toContain('highlight2Title');
  });

  it('names the running version, not the catalog entry', async () => {
    render(<WhatsNewModal onClose={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(document.body.textContent).toContain("What's new in 1.2.3");
  });
});
