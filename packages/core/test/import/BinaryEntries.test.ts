import { describe, expect, it } from 'vitest';
import {
  GenericMarkdownImporter,
  LogseqImporter,
  isTextEntry,
  type UnpackedFile,
} from '../../src/import/index.js';

/**
 * Archives are unpacked natively now, so entries that are not text reach the
 * importers for the first time. Nothing writes their bytes into a vault yet,
 * so the only correct behaviour is to record them — writing them out would
 * plant an empty file over the attachment's name.
 */

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

const binary = (relativePath: string, byteSize = 2048): UnpackedFile => ({
  relativePath,
  content: '',
  isText: false,
  byteSize,
  sourcePath: `/tmp/plainva-import/1-2/${relativePath}`,
});

describe('isTextEntry', () => {
  it('treats a hand-built payload as text', () => {
    expect(isTextEntry({ isText: undefined })).toBe(true);
  });

  it('only rejects an entry that is explicitly flagged', () => {
    expect(isTextEntry({ isText: false })).toBe(false);
    expect(isTextEntry({ isText: true })).toBe(true);
  });
});

describe('GenericMarkdownImporter with unpacked attachments', () => {
  it('records a binary entry instead of writing an empty file', async () => {
    const vaultAdapter = fakeVault();
    const importer = new GenericMarkdownImporter();
    const input: UnpackedFile[] = [
      { relativePath: 'Note.md', content: '# Note' },
      binary('Images/Logo.png'),
    ];

    const report = await importer.run(input, {
      targetVaultPath: '/v',
      targetSubfolder: 'Imported',
      vaultAdapter,
    });

    expect(vaultAdapter.files.has('Imported/Images/Logo.png')).toBe(false);
    expect(report.importedNotesCount).toBe(1);
    expect(report.importedAttachmentsCount).toBe(0);
    expect(report.skippedCount).toBe(1);
    expect(report.items).toContainEqual(
      expect.objectContaining({ path: 'Images/Logo.png', status: 'skipped' })
    );
  });

  it('still writes a non-Markdown text file as an attachment', async () => {
    const vaultAdapter = fakeVault();
    const importer = new GenericMarkdownImporter();

    const report = await importer.run(
      [{ relativePath: 'notes.txt', content: 'plain text', isText: true }],
      { targetVaultPath: '/v', targetSubfolder: 'Imported', vaultAdapter }
    );

    expect(vaultAdapter.files.get('Imported/notes.txt')).toBe('plain text');
    expect(report.importedAttachmentsCount).toBe(1);
    expect(report.skippedCount).toBe(0);
  });

  it('sizes the preview from the entry bytes, not the decoded text', async () => {
    const importer = new GenericMarkdownImporter();

    const plan = await importer.analyze(
      [{ relativePath: 'Note.md', content: '# Note' }, binary('a.png', 5000)],
      { targetVaultPath: '/v' }
    );

    expect(plan.totalNotes).toBe(1);
    expect(plan.totalAttachments).toBe(1);
    expect(plan.requiredSpaceBytes).toBe(5000 + '# Note'.length);
  });
});

describe('archive entries the extractor refused', () => {
  it('names them in the report, not just in the wizard preview', async () => {
    const vaultAdapter = fakeVault();
    const importer = new GenericMarkdownImporter();

    const report = await importer.run([{ relativePath: 'Note.md', content: '# Note' }], {
      targetVaultPath: '/v',
      targetSubfolder: 'Imported',
      vaultAdapter,
      archiveSkipped: [{ relativePath: 'link', reason: 'symbolic link' }],
    });

    expect(report.skippedCount).toBe(1);
    expect(report.summaryMarkdown).toContain('link');
    expect(report.summaryMarkdown).toContain('symbolic link');
  });
});

describe('LogseqImporter with unpacked attachments', () => {
  it('records a binary asset instead of writing an empty file', async () => {
    const vaultAdapter = fakeVault();
    const importer = new LogseqImporter();

    const report = await importer.run(
      [
        { relativePath: 'pages/Home.md', content: '- hello' },
        binary('assets/diagram.pdf'),
      ],
      { targetVaultPath: '/v', targetSubfolder: 'Imported', vaultAdapter }
    );

    expect(vaultAdapter.files.has('Imported/assets/diagram.pdf')).toBe(false);
    expect(report.importedNotesCount).toBe(1);
    expect(report.skippedCount).toBe(1);
  });
});
