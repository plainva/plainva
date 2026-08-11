// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { WhatsNewIcon, WHATS_NEW_CATALOG } from '@plainva/ui';

/**
 * Every icon a release entry names must have a branch in WhatsNewIcon.
 *
 * The union type catches the other direction — a catalog entry naming an icon
 * that does not exist will not compile. It cannot catch a name that IS in the
 * union but has no branch in the mapping: that one falls through to Sparkles,
 * so the release ships the wrong glyph and nothing goes red. Adding an icon
 * means touching two files, which is exactly where that drift happens — 0.6.3
 * added four at once.
 *
 * lucide-react stamps the glyph name into the class list, so the rendered
 * element identifies itself.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("what's new icons", () => {
  it('has a glyph for every icon the catalog names', () => {
    const names = [...new Set(WHATS_NEW_CATALOG.flatMap((e) => e.highlights.map((h) => h.icon)))];
    expect(names.length).toBeGreaterThan(0);

    const fellThrough: string[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      act(() => root.render(<WhatsNewIcon name={name} size={18} />));
      const svg = host.querySelector('svg');
      if (!svg) missing.push(name);
      // The fallback: "sparkles" is deliberately not a member of the union, so
      // no catalog name may render it.
      else if (svg.getAttribute('class')?.includes('lucide-sparkles')) fellThrough.push(name);
      act(() => root.unmount());
      host.remove();
    }

    expect(missing, 'icon names that rendered nothing').toEqual([]);
    expect(fellThrough, 'icon names with no branch in WhatsNewIcon').toEqual([]);
  });
});
