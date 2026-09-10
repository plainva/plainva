import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_LABELS,
  EvernoteEnexImporter,
  GenericMarkdownImporter,
  ImportWriter,
  SimplenoteImporter,
} from '../../src/import/index.js';
import { readFrontmatterPath } from '../../src/frontmatter-surgical.js';

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
  const numbered = (name: string, n: number) => n === 1 ? `${name}.md` : `${name} (${n}).md`;

  it('checks the thousandth candidate and preserves every occupied file', async () => {
    const seed = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [numbered('A', i + 1), `old ${i}`]));
    const vaultAdapter = fakeVault(seed);
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);
    await expect(writer.writeNote('A.md', 'new')).rejects.toThrow(DEFAULT_IMPORT_LABELS.noAvailableName);
    expect(Object.fromEntries(vaultAdapter.files)).toEqual(seed);
  });

  it('uses the thousandth candidate when it is actually free', async () => {
    const vaultAdapter = fakeVault(Object.fromEntries(Array.from({ length: 999 }, (_, i) => [numbered('A', i + 1), 'old'])));
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);
    expect(await writer.writeNote('A.md', 'new')).toBe('A (1000).md');
    expect(vaultAdapter.files.get('A (999).md')).toBe('old');
    expect(vaultAdapter.files.get('A (1000).md')).toContain('new');
  });

  it('serializes concurrent reservations and writes without losing their assigned names', async () => {
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);
    const reserved = await Promise.all(Array.from({ length: 12 }, () => writer.reserve('A.md')));
    expect(new Set(reserved).size).toBe(12);
    const written = await Promise.all(Array.from({ length: 13 }, (_, i) => writer.writeNote('A.md', `body ${i}`)));
    expect(written.slice(0, 12)).toEqual(reserved);
    expect(written[12]).toBe('A (13).md');
    for (let i = 0; i < written.length; i++) expect(vaultAdapter.files.get(written[i])).toContain(`body ${i}`);
  });

  it('coordinates a reservation racing a direct write', async () => {
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);
    const [written, reserved] = await Promise.all([writer.writeNote('A.md', 'direct'), writer.reserve('A.md')]);
    expect(written).toBe('A.md');
    expect(reserved).toBe('A (2).md');
    expect(await writer.writeNote('A.md', 'reserved')).toBe(reserved);
    expect(vaultAdapter.files.get(written)).toContain('direct');
  });

  it('consumes an occupied reservation without overwriting it or shifting the next item', async () => {
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);
    await writer.reserve('A.md');
    await writer.reserve('A.md');
    vaultAdapter.files.set('A.md', 'arrived since reservation');
    await expect(writer.writeNote('A.md', 'first')).rejects.toThrow(DEFAULT_IMPORT_LABELS.reservedPathOccupied);
    expect(await writer.writeNote('A.md', 'second')).toBe('A (2).md');
    expect(vaultAdapter.files.get('A.md')).toBe('arrived since reservation');
  });

  it('preserves an earlier reservation when allocating the next one fails', async () => {
    const vaultAdapter = fakeVault();
    const exists = vaultAdapter.exists;
    vaultAdapter.exists = async path => { if (path === 'A (2).md') throw new Error('access denied'); return exists(path); };
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);
    await writer.reserve('A.md');
    await expect(writer.reserve('A.md')).rejects.toThrow('access denied');
    expect(await writer.writeNote('A.md', 'first')).toBe('A.md');
  });

  it('reports an unreadable target and continues with the next source entry', async () => {
    const vaultAdapter = fakeVault({ 'Bad.md': 'private old note' });
    const exists = vaultAdapter.exists;
    vaultAdapter.exists = async path => { if (path === 'Bad.md') throw new Error('access denied'); return exists(path); };
    const report = await new GenericMarkdownImporter().run([
      { relativePath: 'Bad.md', content: 'new' }, { relativePath: 'Good.md', content: 'healthy' },
    ], { targetVaultPath: '/v', vaultAdapter });
    expect(report.skippedCount).toBe(1);
    expect(report.importedNotesCount).toBe(1);
    expect(report.summaryMarkdown).toContain('access denied');
    expect(vaultAdapter.files.get('Bad.md')).toBe('private old note');
    expect(vaultAdapter.files.get('Good.md')).toContain('healthy');
  });

  it('never overwrites any of a thousand reports when the report name is exhausted', async () => {
    const seed = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [numbered('Import report', i + 1), `report ${i}`]));
    const vaultAdapter = fakeVault(seed);
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);
    await expect(writer.finish({ id: 'generic_markdown', name: 'Markdown' }, Date.now())).rejects.toThrow(DEFAULT_IMPORT_LABELS.noAvailableName);
    expect(Object.fromEntries(vaultAdapter.files)).toEqual(seed);
  });

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
  it('stamps imported notes with an OKF type and never a per-note okf_version', async () => {
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);

    await writer.writeNote('A.md', '# Plain note');
    const written = vaultAdapter.files.get('A.md')!;

    expect(written).toMatch(/^---\n/);
    expect(written).toContain('type:');
    expect(written).not.toContain('okf_version:'); // OKF v0.2: the bundle version lives in the root index.md only
    expect(written).toContain('# Plain note');
  });

  it('keeps frontmatter the source already provided', async () => {
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter({ targetVaultPath: '/v', vaultAdapter }, DEFAULT_IMPORT_LABELS);

    await writer.writeNote('B.md', '---\ntags:\n  - work\n---\n\n# Body');
    const written = vaultAdapter.files.get('B.md')!;

    expect(written).toContain('- work');
    expect(written).toContain('type:');
    expect(written).not.toContain('okf_version:');
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

describe('ImportWriter — provenance (OKF 0.2, plan P3b)', () => {
  const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

  it('stamps generated.by/at and the given sources when the run names its actor', async () => {
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter(
      { targetVaultPath: '/v', vaultAdapter, generatedBy: 'plainva-import/0.6.7' },
      DEFAULT_IMPORT_LABELS
    );

    await writer.writeNote('A.md', '# A', {
      sources: [{ resource: 'https://example.org/page', title: 'Page' }],
    });

    const written = vaultAdapter.files.get('A.md')!;
    expect(readFrontmatterPath(written, ['type'])).toBe('note');
    expect(readFrontmatterPath(written, ['generated', 'by'])).toBe('plainva-import/0.6.7');
    expect(String(readFrontmatterPath(written, ['generated', 'at']))).toMatch(ISO_SECONDS);
    expect(readFrontmatterPath(written, ['sources'])).toEqual([
      { resource: 'https://example.org/page', title: 'Page' },
    ]);
  });

  it('gives every note of a run - and the report - the same instant', async () => {
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter(
      { targetVaultPath: '/v', vaultAdapter, generatedBy: 'plainva-import/0.6.7' },
      DEFAULT_IMPORT_LABELS
    );
    await writer.writeNote('A.md', '# A');
    await writer.writeNote('B.md', '# B');
    const report = await writer.finish({ id: 'generic_markdown', name: 'Markdown' }, Date.now());

    const atA = readFrontmatterPath(vaultAdapter.files.get('A.md')!, ['generated', 'at']);
    const atB = readFrontmatterPath(vaultAdapter.files.get('B.md')!, ['generated', 'at']);
    expect(String(atA)).toMatch(ISO_SECONDS);
    expect(atB).toBe(atA);

    const reportDoc = vaultAdapter.files.get(report.reportPath)!;
    expect(readFrontmatterPath(reportDoc, ['generated', 'by'])).toBe('plainva-import/0.6.7');
    expect(readFrontmatterPath(reportDoc, ['generated', 'at'])).toBe(atA);
  });

  it('stamps no generated/sources without an actor, and none at all with stampOkfMetadata off', async () => {
    const silent = fakeVault();
    const plain = new ImportWriter({ targetVaultPath: '/v', vaultAdapter: silent }, DEFAULT_IMPORT_LABELS);
    await plain.writeNote('A.md', '# A', { sources: [{ resource: 'https://example.org/page' }] });
    const quiet = silent.files.get('A.md')!;
    expect(readFrontmatterPath(quiet, ['generated']) ?? null).toBeNull();
    // A source without a producer is still a fact about the note — it is kept.
    expect(readFrontmatterPath(quiet, ['sources'])).toEqual([{ resource: 'https://example.org/page' }]);

    const raw = fakeVault();
    const off = new ImportWriter(
      { targetVaultPath: '/v', vaultAdapter: raw, generatedBy: 'plainva-import/0.6.7', stampOkfMetadata: false },
      DEFAULT_IMPORT_LABELS
    );
    await off.writeNote('A.md', '# A', { sources: [{ resource: 'https://example.org/page' }] });
    expect(raw.files.get('A.md')).toBe('# A');
  });
});
