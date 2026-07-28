import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_LABELS,
  GoogleKeepImporter,
  NotionImporter,
  inferCsvColumns,
  parseCsvTable,
} from '../../src/import/index.js';

function fakeVault() {
  const files = new Map<string, string>();
  const binaries = new Map<string, Uint8Array>();
  return {
    files,
    binaries,
    async exists(path: string) {
      return files.has(path) || binaries.has(path);
    },
    async writeTextFile(path: string, content: string) {
      files.set(path, content);
    },
    async writeBinaryFile(path: string, content: Uint8Array) {
      binaries.set(path, content);
    },
    async createFolder() {},
  };
}

const base = (vaultAdapter: ReturnType<typeof fakeVault>) => ({
  targetVaultPath: '/v',
  targetSubfolder: 'Import',
  vaultAdapter,
  labels: DEFAULT_IMPORT_LABELS,
  serializeBase: (config: any) => JSON.stringify(config),
});

describe('Notion CSV — reading the table', () => {
  it('keeps a quoted field with a comma, a newline and a doubled quote intact', () => {
    const text = 'Name,Note\n"Smith, John","He said ""hi""\nagain"\n';
    const table = parseCsvTable(text);

    expect(table.header).toEqual(['Name', 'Note']);
    expect(table.rows).toEqual([['Smith, John', 'He said "hi"\nagain']]);
  });

  it('reads a type from the values, and stays with text when they do not agree', () => {
    const table = parseCsvTable(
      [
        'Name,Done,Count,Due,Status,Tags,Free',
        'A,Yes,1,2024-01-05,Open,"work, urgent",alpha',
        'B,No,2,2024-02-06,Done,work,beta',
        'C,Yes,3,2024-03-07,Open,"urgent, later",gamma',
      ].join('\n')
    );

    const columns = inferCsvColumns(table);
    const byName = Object.fromEntries(columns.map((c) => [c.name, c]));

    expect(byName.Done.type).toBe('checkbox');
    expect(byName.Count.type).toBe('number');
    expect(byName.Due.type).toBe('date');
    expect(byName.Status.type).toBe('select');
    expect(byName.Status.options).toEqual(['Open', 'Done']);
    expect(byName.Tags.type).toBe('multi_select');
    expect(byName.Tags.options).toEqual(['work', 'urgent', 'later']);
    // Three distinct values across three rows: free text, not a set of choices.
    expect(byName.Free.type).toBe('text');
  });
});

describe('Notion file import — a database is no longer an empty shell', () => {
  it('gives the row pages the values only the CSV has, and the base real columns', async () => {
    const vault = fakeVault();
    const input = [
      {
        relativePath: 'Tasks abcdef01234567890abcdef012345678.csv',
        content:
          'Name,Status,Due\nWrite it up,Open,2024-01-05\nShip it,Done,2024-02-06\nReview it,Open,2024-03-07\n',
      },
      {
        relativePath: 'Tasks abcdef01234567890abcdef012345678/Write it up 1234567890abcdef1234567890abcdef.md',
        content: '# Write it up\n\nSome text.',
      },
      {
        relativePath: 'Tasks abcdef01234567890abcdef012345678/Ship it 234567890abcdef1234567890abcdef1.md',
        content: '# Ship it\n\nMore text.',
      },
    ];

    const report = await new NotionImporter().run(input, base(vault));

    const note = vault.files.get('Import/Tasks/Write it up.md');
    expect(note).toContain('Status: Open');
    expect(note).toContain('Some text.');

    const baseFile = JSON.parse(vault.files.get('Import/Tasks.base') ?? '{}');
    expect(baseFile.columns.Status).toEqual({ input: 'select', options: ['Open', 'Done'] });
    expect(baseFile.columns.Due).toEqual({ input: 'date' });
    expect(baseFile.views.some((v: any) => v.type === 'board' && v.groupBy === 'Status')).toBe(true);

    // The old "databases arrive empty" line must not be claimed any more.
    expect(report.summaryMarkdown).not.toContain(DEFAULT_IMPORT_LABELS.limitNotionFileDatabaseRows);
  });

  it('writes the rows itself when the export has no page for them', async () => {
    const vault = fakeVault();
    const input = [
      {
        relativePath: 'Tasks abcdef01234567890abcdef012345678.csv',
        content: 'Name,Status\nLone row,Open\n',
      },
    ];

    await new NotionImporter().run(input, base(vault));

    const written = vault.files.get('Import/Tasks/Lone row.md');
    expect(written).toContain('Status: Open');
    expect(written).toContain('# Lone row');
  });
});

describe('Archive attachments — the bytes reach the vault', () => {
  it('copies a picture into the import and points the note at it', async () => {
    const vault = fakeVault();
    const pixels = new Uint8Array([137, 80, 78, 71]);
    const input = [
      {
        relativePath: 'Trip abcdef01234567890abcdef012345678.md',
        content: '# Trip\n\n![](Trip%20abcdef01234567890abcdef012345678/pic.png)',
      },
      {
        relativePath: 'Trip abcdef01234567890abcdef012345678/pic.png',
        content: '',
        isText: false,
        sourcePath: '/tmp/x/pic.png',
      },
    ];

    const report = await new NotionImporter().run(input, {
      ...base(vault),
      readSourceBytes: async () => pixels,
    });

    expect(vault.binaries.get('Import/Trip/pic.png')).toEqual(pixels);
    expect(vault.files.get('Import/Trip.md')).toContain('Trip/pic.png');
    expect(report.importedAttachmentsCount).toBe(1);
    expect(report.summaryMarkdown).not.toContain(DEFAULT_IMPORT_LABELS.limitBinaryFilesInZip);
  });

  it('reports a picture it cannot read instead of passing over it', async () => {
    const vault = fakeVault();
    const input = [
      { relativePath: 'Note.md', content: '# Note' },
      { relativePath: 'pic.png', content: '', isText: false, sourcePath: '/tmp/x/pic.png' },
    ];

    const report = await new NotionImporter().run(input, base(vault));

    expect(report.importedAttachmentsCount).toBe(0);
    expect(report.summaryMarkdown).toContain('pic.png');
    expect(report.summaryMarkdown).toContain(DEFAULT_IMPORT_LABELS.limitBinaryFilesInZip);
  });
});

describe('Google Keep — colour and pin do something now', () => {
  it('writes the colour where the note header reads it', async () => {
    const vault = fakeVault();
    const input = [
      { title: 'Yellow one', textContent: 'hello', color: 'YELLOW' },
      { title: 'Plain one', textContent: 'hello', color: 'DEFAULT' },
    ];

    await new GoogleKeepImporter().run(input, base(vault));

    expect(vault.files.get('Import/Yellow one.md')).toContain('header_color: "#c9a227"');
    expect(vault.files.get('Import/Plain one.md')).not.toContain('header_color');
  });

  it('turns pinned notes into a pinboard that actually pins them', async () => {
    const vault = fakeVault();
    const input = [
      { title: 'Pinned one', textContent: 'a', isPinned: true },
      { title: 'Loose one', textContent: 'b' },
    ];

    const report = await new GoogleKeepImporter().run(input, base(vault));

    const board = JSON.parse(vault.files.get('Import/Pinboard.base') ?? '{}');
    expect(board.views[0].type).toBe('pinboard');
    expect(board.views[0].pinboardPinned).toEqual(['Import/Pinned one.md']);
    expect(board.filters.and[0]).toBe('file.folder == "Import"');
    expect(report.importedDatabasesCount).toBe(1);
  });

  it('writes no pinboard when nothing was pinned', async () => {
    const vault = fakeVault();
    await new GoogleKeepImporter().run([{ title: 'Loose', textContent: 'b' }], base(vault));

    expect(vault.files.has('Import/Pinboard.base')).toBe(false);
  });
});
