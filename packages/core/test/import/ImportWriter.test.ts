import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_LABELS,
  EvernoteEnexImporter,
  GenericMarkdownImporter,
  ImportWriter,
  SimplenoteImporter,
} from '../../src/import/index.js';

/** In-memory stand-in for IVaultAdapter, recording every write. */
function fakeVault(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    files,
    async exists(path: string) {
      return files.has(path);
    },
    async writeTextFile(path: string, content: string) {
      files.set(path, content);
    },
    async createFolder() {
      // Folders are implicit in the map.
    },
  };
}

describe('ImportWriter — never overwrites', () => {
  it('numbers a note whose name is already taken in the vault', async () => {
    const vaultAdapter = fakeVault({ 'Imported/Meeting.md': 'PRECIOUS EXISTING CONTENT' });
    const writer = new ImportWriter(
      { targetVaultPath: '/v', targetSubfolder: 'Imported', vaultAdapter },
      DEFAULT_IMPORT_LABELS
    );

    const path = await writer.writeNote('Meeting.md', '# Imported');

    expect(path).toBe('Imported/Meeting (2).md');
    expect(vaultAdapter.files.get('Imported/Meeting.md')).toBe('PRECIOUS EXISTING CONTENT');
    expect(vaultAdapter.files.get('Imported/Meeting (2).md')).toContain('# Imported');
  });

  it('keeps two same-named source notes apart within one run', async () => {
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter(
      { targetVaultPath: '/v', targetSubfolder: 'Imported', vaultAdapter },
      DEFAULT_IMPORT_LABELS
    );

    await writer.writeNote('Note.md', 'first');
    await writer.writeNote('Note.md', 'second');

    expect(vaultAdapter.files.get('Imported/Note.md')).toContain('first');
    expect(vaultAdapter.files.get('Imported/Note (2).md')).toContain('second');
  });

  it('does not replace an earlier import report', async () => {
    const vaultAdapter = fakeVault({ 'Imported/Import report.md': 'EARLIER RUN' });
    const writer = new ImportWriter(
      { targetVaultPath: '/v', targetSubfolder: 'Imported', vaultAdapter },
      DEFAULT_IMPORT_LABELS
    );

    const report = await writer.finish({ id: 'generic_markdown', name: 'Markdown' }, Date.now());

    expect(report.reportPath).toBe('Imported/Import report (2).md');
    expect(vaultAdapter.files.get('Imported/Import report.md')).toBe('EARLIER RUN');
  });
});

describe('ImportWriter — OKF stamping', () => {
  it('stamps imported notes with type and okf_version', async () => {
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);

    await writer.writeNote('A.md', '# Plain note');
    const written = vaultAdapter.files.get('A.md')!;

    expect(written).toMatch(/^---\n/);
    expect(written).toContain('type:');
    expect(written).toContain('okf_version:');
    expect(written).toContain('# Plain note');
  });

  it('keeps frontmatter the source already provided', async () => {
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);

    await writer.writeNote('B.md', '---\ntags:\n  - work\n---\n\n# Body');
    const written = vaultAdapter.files.get('B.md')!;

    expect(written).toContain('- work');
    expect(written).toContain('okf_version:');
  });

  it('leaves generated .base files unstamped', async () => {
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);

    await writer.writeFile('Tasks.base', '{"views":[]}', 'database');

    expect(vaultAdapter.files.get('Tasks.base')).toBe('{"views":[]}');
  });
});

describe('ImportWriter — the report is honest', () => {
  it('counts degraded and skipped separately and names them in the report', async () => {
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);

    await writer.writeNote('Full.md', 'all good');
    await writer.writeNote('Partial.md', 'truncated', { details: 'page was cut off' });
    writer.recordSkipped('Photo.png', 'binary file');

    const report = await writer.finish({ id: 'generic_markdown', name: 'Markdown' }, Date.now());

    expect(report.degradedCount).toBe(1);
    expect(report.skippedCount).toBe(1);
    expect(report.summaryMarkdown).toContain('page was cut off');
    expect(report.summaryMarkdown).toContain('binary file');
    expect(report.summaryMarkdown).toContain(DEFAULT_IMPORT_LABELS.reportIncompleteHeading);
  });

  it('reports a rename so the user can see nothing was replaced', async () => {
    const vaultAdapter = fakeVault({ 'Note.md': 'existing' });
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);

    await writer.writeNote('Note.md', 'imported');
    const report = await writer.finish({ id: 'generic_markdown', name: 'Markdown' }, Date.now());

    expect(report.summaryMarkdown).toContain(DEFAULT_IMPORT_LABELS.renamedToAvoidOverwrite);
  });
});

describe('Adapters report what they cannot carry over', () => {
  it('Evernote counts attachments as lost rather than imported', async () => {
    const importer = new EvernoteEnexImporter();
    const enex = `<note><title>With file</title><content>text</content><resource></resource></note>`;

    const plan = await importer.analyze(enex, { targetVaultPath: '/v' });
    // The old behaviour counted resources as imported attachments; they are not.
    expect(plan.totalAttachments).toBe(0);
    expect(plan.warnings.join(' ')).toContain('Evernote attachments');

    const report = await importer.run(enex, { targetVaultPath: '/v' });
    expect(report.importedAttachmentsCount).toBe(0);
    expect(report.degradedCount).toBe(1);
  });

  it('Simplenote reports trashed notes instead of dropping them silently', async () => {
    const importer = new SimplenoteImporter();
    const payload = {
      activeNotes: [{ id: '1', content: 'Kept' }],
      trashedNotes: [{ id: '2', content: 'Deleted' }],
    };

    const plan = await importer.analyze(payload, { targetVaultPath: '/v' });
    expect(plan.warnings.join(' ')).toContain('trash');

    const report = await importer.run(payload, { targetVaultPath: '/v' });
    expect(report.importedNotesCount).toBe(1);
    expect(report.summaryMarkdown).toContain(DEFAULT_IMPORT_LABELS.reportLimitsHeading);
  });

  it('claims the attachment limit only when an attachment was really lost', async () => {
    const importer = new GenericMarkdownImporter();

    // Nothing but Markdown: nothing was lost, so nothing is claimed. The line
    // used to appear unconditionally, which made it noise rather than news.
    const clean = await importer.run([{ relativePath: 'A.md', content: '# A' }], {
      targetVaultPath: '/v',
    });
    expect(clean.summaryMarkdown).not.toContain(DEFAULT_IMPORT_LABELS.limitBinaryFilesInZip);

    // A picture nobody here can read: named, and the limit stated.
    const lossy = await importer.run(
      [
        { relativePath: 'A.md', content: '# A' },
        { relativePath: 'pic.png', content: '', isText: false, sourcePath: '/tmp/pic.png' },
      ],
      { targetVaultPath: '/v' }
    );
    expect(lossy.summaryMarkdown).toContain(DEFAULT_IMPORT_LABELS.limitBinaryFilesInZip);
    expect(lossy.summaryMarkdown).toContain('pic.png');
  });
});
