import { describe, expect, it } from 'vitest';
import {
  GenericMarkdownImporter,
  GoogleKeepImporter,
  SimplenoteImporter,
} from '../../src/import/index.js';

/**
 * One bad entry out of eight hundred used to cost the whole import: no adapter
 * caught per entry, so the throw unwound past `finish()` and no report was
 * written at all — the files already on disk had no record of what happened.
 */

function vaultFailingOn(badPath: string) {
  const files = new Map<string, string>();
  return {
    files,
    async exists(path: string) {
      return files.has(path);
    },
    async writeTextFile(path: string, content: string) {
      if (path === badPath) throw new Error('disk said no');
      files.set(path, content);
    },
    async createFolder() {
      /* implicit */
    },
  };
}

describe('one entry failing does not cost the run', () => {
  it('keeps importing and names the casualty in the report', async () => {
    const vaultAdapter = vaultFailingOn('Imported/Broken.md');

    const report = await new GenericMarkdownImporter().run(
      [
        { relativePath: 'First.md', content: '# First' },
        { relativePath: 'Broken.md', content: '# Broken' },
        { relativePath: 'Last.md', content: '# Last' },
      ],
      { targetVaultPath: '/v', targetSubfolder: 'Imported', vaultAdapter }
    );

    // The entries after the failure still arrived.
    expect(vaultAdapter.files.has('Imported/First.md')).toBe(true);
    expect(vaultAdapter.files.has('Imported/Last.md')).toBe(true);
    expect(report.importedNotesCount).toBe(2);

    expect(report.skippedCount).toBe(1);
    expect(report.items).toContainEqual(
      expect.objectContaining({ path: 'Broken.md', status: 'skipped' })
    );
    expect(report.summaryMarkdown).toContain('disk said no');
  });

  it('still writes a report when a source note is malformed', async () => {
    // Keep builds its frontmatter as a raw string from unchecked label text; a
    // label containing YAML punctuation makes the frontmatter unparseable.
    const vaultAdapter = vaultFailingOn('never');

    const report = await new GoogleKeepImporter().run(
      [
        { title: 'Fine', textContent: 'ok' },
        { title: 'Odd', textContent: 'x', labels: [{ name: 'a: [b' }] },
      ],
      { targetVaultPath: '/v', targetSubfolder: 'Imported', vaultAdapter }
    );

    expect(report.reportPath).toBe('Imported/Import report.md');
    expect(report.importedNotesCount + report.skippedCount).toBe(2);
  });
});

describe('the report exists even when the run stops early', () => {
  it('records the abort instead of losing everything written so far', async () => {
    const files = new Map<string, string>();
    let written = 0;
    const vaultAdapter = {
      files,
      async exists(path: string) {
        return files.has(path);
      },
      async writeTextFile(path: string, content: string) {
        // Fail the report write too? No — the report must still get through.
        written += 1;
        if (written === 2) {
          // Simulate something the per-entry catch cannot see, e.g. the whole
          // volume disappearing mid-run.
          const fatal = new Error('volume disappeared');
          (fatal as any).fatal = true;
          throw fatal;
        }
        files.set(path, content);
      },
      async createFolder() {
        /* implicit */
      },
    };

    const report = await new SimplenoteImporter().run(
      {
        activeNotes: [
          { id: '1', content: 'One' },
          { id: '2', content: 'Two' },
        ],
      },
      { targetVaultPath: '/v', targetSubfolder: 'Imported', vaultAdapter }
    );

    expect(files.has('Imported/One.md')).toBe(true);
    expect(report.summaryMarkdown).toContain('volume disappeared');
    expect(report.reportPath).toBe('Imported/Import report.md');
  });
});
