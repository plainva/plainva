import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_LABELS,
  OpmlOutlinerImporter,
  StandardNotesImporter,
  TriliumImporter,
  outlineToMarkdown,
  parseOpml,
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

const opts = (vaultAdapter: ReturnType<typeof fakeVault>) => ({
  targetVaultPath: '/v',
  targetSubfolder: 'Import',
  vaultAdapter,
  labels: DEFAULT_IMPORT_LABELS,
});

const standardNotesBackup = JSON.stringify({
  items: [
    {
      uuid: 'n1',
      content_type: 'Note',
      created_at: '2023-01-02T03:04:05.000Z',
      updated_at: '2023-02-03T04:05:06.000Z',
      content: { title: 'Grocery list', text: 'Milk\nBread' },
    },
    {
      uuid: 't1',
      content_type: 'Tag',
      content: { title: 'errands', references: [{ uuid: 'n1', content_type: 'Note' }] },
    },
    { uuid: 's1', content_type: 'SN|UserPreferences', content: { theme: 'dark' } },
  ],
});

describe('Standard Notes — only the notes are notes', () => {
  it('imports a note with its tag and dates, and leaves the settings item alone', async () => {
    const vault = fakeVault();
    const report = await new StandardNotesImporter().run(
      [{ relativePath: 'backup.json', content: standardNotesBackup }],
      opts(vault)
    );

    const note = vault.files.get('Import/Grocery list.md') ?? '';
    expect(note).toContain('- errands');
    expect(note).toContain('Milk');
    expect(note).toContain('created: 2023-01-02T03:04:05.000Z');
    // A preferences item is not a note and must not become one.
    expect(report.importedNotesCount).toBe(1);
  });

  it('refuses an encrypted backup instead of writing ciphertext into the vault', async () => {
    const vault = fakeVault();
    const encrypted = JSON.stringify({
      items: [{ uuid: 'x', content_type: 'Note', content: '003:abcdef:ghijkl' }],
    });

    const report = await new StandardNotesImporter().run(
      [{ relativePath: 'backup.json', content: encrypted }],
      opts(vault)
    );

    expect(report.importedNotesCount).toBe(0);
    expect(report.summaryMarkdown).toContain('encrypted');
    expect([...vault.files.keys()].filter((k) => !k.endsWith('Import report.md'))).toHaveLength(0);
  });

  it('recognises a backup and not a random JSON file', async () => {
    const importer = new StandardNotesImporter();
    expect(await importer.detect([{ relativePath: 'backup.json', content: standardNotesBackup }])).toBe(true);
    expect(await importer.detect([{ relativePath: 'x.json', content: '{"notes":[]}' }])).toBe(false);
  });
});

const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>export</title></head>
  <body>
    <outline text="Projects">
      <outline text="Kitchen">
        <outline text="Tiles"/>
      </outline>
      <outline text="Garden"/>
    </outline>
    <outline text="Someday"/>
  </body>
</opml>`;

describe('Workflowy / Dynalist — an outline becomes bullets', () => {
  it('reads a nested outline including a single child', () => {
    const roots = parseOpml(opml);
    expect(roots).toHaveLength(2);
    expect(roots[0].text).toBe('Projects');
    // One child and several children must arrive in the same shape.
    expect(roots[0].children[0].children[0].text).toBe('Tiles');
  });

  it('indents children under their parent', () => {
    const roots = parseOpml(opml);
    const md = outlineToMarkdown(roots[0].children[0]);
    expect(md).toBe('- Kitchen\n  - Tiles');
  });

  it('writes one note per top-level item', async () => {
    const vault = fakeVault();
    const report = await new OpmlOutlinerImporter().run(
      [{ relativePath: 'workflowy.opml', content: opml }],
      opts(vault)
    );

    expect(vault.files.get('Import/Projects.md')).toContain('- Kitchen\n  - Tiles');
    expect(vault.files.has('Import/Someday.md')).toBe(true);
    expect(report.importedNotesCount).toBe(2);
  });

  it('keeps two documents apart when several are selected', async () => {
    const vault = fakeVault();
    await new OpmlOutlinerImporter().run(
      [
        { relativePath: 'a.opml', content: opml },
        { relativePath: 'b.opml', content: opml },
      ],
      opts(vault)
    );

    expect(vault.files.has('Import/a/Projects.md')).toBe(true);
    expect(vault.files.has('Import/b/Projects.md')).toBe(true);
  });
});

describe('Trilium — the manifest is not a note', () => {
  it('recognises the export by its manifest and converts the HTML notes', async () => {
    const vault = fakeVault();
    const files = [
      { relativePath: '!!!meta.json', content: '{"files":[]}' },
      { relativePath: 'Work/Plan.html', content: '<h1>Plan</h1><p>First <strong>step</strong>.</p>' },
      { relativePath: 'Work/Notes.md', content: '# Notes\n\nAlready Markdown.' },
    ];

    expect(await new TriliumImporter().detect(files)).toBe(true);
    const report = await new TriliumImporter().run(files, opts(vault));

    const converted = vault.files.get('Import/Work/Plan.md') ?? '';
    expect(converted).toContain('# Plan');
    expect(converted).toContain('**step**');
    expect(vault.files.has('Import/Work/Notes.md')).toBe(true);
    // The manifest describes the export and is not one of the notes.
    expect(vault.files.has('Import/!!!meta.json')).toBe(false);
    expect(report.importedNotesCount).toBe(2);
  });
});
