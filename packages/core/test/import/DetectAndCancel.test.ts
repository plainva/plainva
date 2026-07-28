import { describe, expect, it } from 'vitest';
import {
  GoogleKeepImporter,
  ImportAbortedError,
  defaultImportRegistry,
} from '../../src/index.js';

/**
 * Auto-detection and cancelling: the two things the wizard needs from the core
 * before it can offer "pick a file and Plainva works out where it came from"
 * and "stop this".
 */

function fakeVault() {
  const files = new Map<string, string>();
  return {
    files,
    async exists(path: string) {
      return files.has(path);
    },
    async writeTextFile(path: string, content: string) {
      files.set(path, content);
    },
    async createFolder() {
      /* implicit */
    },
  };
}

const md = (relativePath: string, content = '# Note') => ({ relativePath, content });

describe('auto-detection picks the source that actually fits', () => {
  const detect = (input: unknown) => defaultImportRegistry.detect(input);

  it('probes the specific sources before the Markdown fallback', () => {
    const order = defaultImportRegistry.probeOrder().map((s) => s.id);
    // Whatever else moves, the catch-all has to stay last: it accepts what
    // every other source also looks like once its own signature is missing.
    expect(order[order.length - 1]).toBe('generic_markdown');
    expect(order.indexOf('notion_api')).toBeLessThan(order.indexOf('generic_markdown'));
  });

  it('reads a plain Markdown folder as plain Markdown', async () => {
    const source = await detect([md('Notes/One.md'), md('Notes/Two.md')]);
    expect(source?.id).toBe('generic_markdown');
  });

  it('recognises a Notion export by the id in its paths', async () => {
    const source = await detect([
      md('Parent abcdef01234567890123456789012345.md'),
      md('Parent abcdef01234567890123456789012345/Child fedcba09876543210987654321098765.md'),
    ]);
    expect(source?.id).toBe('notion_file');
  });

  it('recognises a Logseq graph by its folders, not by having Markdown', async () => {
    expect((await detect([md('journals/2026_07_28.md'), md('pages/Home.md')]))?.id).toBe('logseq');
    // A folder of notes is NOT a Logseq graph — this used to match both, and
    // which one won depended on registration order.
    expect((await detect([md('Home.md'), md('Ideas.md')]))?.id).toBe('generic_markdown');
  });

  it('tells a Keep export from a Simplenote export', async () => {
    const keep = await detect([
      { relativePath: 'Note.json', content: JSON.stringify({ title: 'A', textContent: 'x', isPinned: false }) },
    ]);
    expect(keep?.id).toBe('google_keep');

    const simplenote = await detect([
      {
        relativePath: 'notes.json',
        content: JSON.stringify({ activeNotes: [{ id: '1', content: 'hello' }] }),
      },
    ]);
    expect(simplenote?.id).toBe('simplenote');
  });

  it('recognises an ENEX document', async () => {
    const source = await detect([
      {
        relativePath: 'export.enex',
        content: '<en-export><note><title>A</title><content>x</content></note></en-export>',
      },
    ]);
    expect(source?.id).toBe('evernote');
  });

  it('recognises a Notion token', async () => {
    expect((await detect([{ notionToken: 'secret_abc' }]))?.id).toBe('notion_api');
  });

  it('says nothing rather than guessing on an empty selection', async () => {
    expect(await detect([])).toBeNull();
  });
});

describe('a running import can be stopped', () => {
  const opts = (vaultAdapter: unknown, signal?: AbortSignal) => ({
    targetVaultPath: '/v',
    targetSubfolder: 'Imported',
    vaultAdapter,
    signal,
  });

  it('stops between notes and still writes a report', async () => {
    const vaultAdapter = fakeVault();
    const controller = new AbortController();
    const notes = Array.from({ length: 5 }, (_, i) => ({ title: `N${i}`, textContent: 'x' }));

    const report = await new GoogleKeepImporter().run(
      notes,
      opts(vaultAdapter, controller.signal),
      (pct) => {
        // Stop once the run is clearly under way.
        if (pct >= 40) controller.abort();
      }
    );

    expect(report.importedNotesCount).toBeGreaterThan(0);
    expect(report.importedNotesCount).toBeLessThan(5);
    // The report exists and says the run was stopped — the folder is the undo.
    expect(report.summaryMarkdown).toContain('you stopped the import');
    expect(vaultAdapter.files.has(report.reportPath)).toBe(true);
  });

  it('leaves an unaborted run completely untouched', async () => {
    const vaultAdapter = fakeVault();
    const controller = new AbortController();
    const report = await new GoogleKeepImporter().run(
      [{ title: 'A', textContent: 'x' }],
      opts(vaultAdapter, controller.signal)
    );

    expect(report.importedNotesCount).toBe(1);
    expect(report.summaryMarkdown).not.toContain('you stopped the import');
  });

  it('stops before writing anything when the signal is already aborted', async () => {
    const vaultAdapter = fakeVault();
    const controller = new AbortController();
    controller.abort();

    const report = await new GoogleKeepImporter().run(
      [{ title: 'A', textContent: 'x' }],
      opts(vaultAdapter, controller.signal)
    );

    expect(report.importedNotesCount).toBe(0);
    // Only the report itself was written.
    expect([...vaultAdapter.files.keys()]).toEqual([report.reportPath]);
  });

  it('exposes the abort as its own error type', () => {
    expect(new ImportAbortedError()).toBeInstanceOf(Error);
    expect(new ImportAbortedError().name).toBe('ImportAbortedError');
  });
});
