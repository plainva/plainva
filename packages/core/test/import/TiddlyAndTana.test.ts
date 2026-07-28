import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_LABELS,
  RemNoteImporter,
  TanaPasteImporter,
  TiddlyWikiImporter,
  parseTiddlyDate,
  parseTiddlyTags,
} from '../../src/import/index.js';

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
    async writeBinaryFile() {},
    async createFolder() {},
  };
}

const opts = (vaultAdapter: ReturnType<typeof fakeVault>) => ({
  targetVaultPath: '/v',
  targetSubfolder: 'Import',
  vaultAdapter,
  labels: DEFAULT_IMPORT_LABELS,
});

describe('TiddlyWiki — its own date and tag notation', () => {
  it('reads a seventeen-digit timestamp rather than passing it through', () => {
    expect(parseTiddlyDate('20240301120000000')).toBe(Date.parse('2024-03-01T12:00:00.000Z'));
    expect(parseTiddlyDate('not a date')).toBeUndefined();
  });

  it('keeps a quoted tag together', () => {
    // Four words, two tags.
    expect(parseTiddlyTags('[[Getting Things Done]] work')).toEqual(['Getting Things Done', 'work']);
    expect(parseTiddlyTags(undefined)).toEqual([]);
  });
});

describe('TiddlyWiki — the wiki is not all notes', () => {
  const tiddlers = [
    {
      title: 'Reading list',
      text: 'Some !!WikiText here.',
      tags: '[[Getting Things Done]] work',
      created: '20240301120000000',
      modified: '20240402130000000',
    },
    { title: '$:/config/Theme', text: 'dark' },
    { title: 'logo.png', text: 'AAAA', type: 'image/png' },
  ];

  it('imports the writing and names what it left behind', async () => {
    const vault = fakeVault();
    const report = await new TiddlyWikiImporter().run(
      [{ relativePath: 'tiddlers.json', content: JSON.stringify(tiddlers) }],
      opts(vault)
    );

    const note = vault.files.get('Import/Reading list.md') ?? '';
    expect(note).toContain('- Getting_Things_Done');
    expect(note).toContain('created: 2024-03-01T12:00:00.000Z');
    // WikiText is not Markdown, and converting it would mean guessing.
    expect(note).toContain('!!WikiText');

    expect(report.importedNotesCount).toBe(1);
    expect(report.summaryMarkdown).toContain('$:/config/Theme');
    expect(report.summaryMarkdown).toContain('logo.png');
    expect(report.summaryMarkdown).toContain(DEFAULT_IMPORT_LABELS.skippedTiddlyNonNote);
  });

  it('recognises a tiddler export and not any other JSON array', async () => {
    const importer = new TiddlyWikiImporter();
    expect(await importer.detect([{ relativePath: 't.json', content: JSON.stringify(tiddlers) }])).toBe(true);
    expect(await importer.detect([{ relativePath: 'x.json', content: '[{"a":1}]' }])).toBe(false);
  });
});

describe('Tana Paste — the header is the signature', () => {
  const paste = ['%%tana%%', '- Project Alpha #project', '  - Kick-off on Monday', '  - Budget:: 4000', '- Reading'].join('\n');

  it('claims the paste format and nothing else', async () => {
    const importer = new TanaPasteImporter();
    expect(await importer.detect([{ relativePath: 'paste.txt', content: paste }])).toBe(true);
    expect(await importer.detect([{ relativePath: 'x.txt', content: '- just a list' }])).toBe(false);
  });

  it('writes one note per top-level node and keeps the children as bullets', async () => {
    const vault = fakeVault();
    const report = await new TanaPasteImporter().run([{ relativePath: 'paste.txt', content: paste }], opts(vault));

    const note = vault.files.get('Import/Project Alpha #project.md') ?? '';
    expect(note).toContain('  - Kick-off on Monday');
    // A field stays text: it is not a property until somebody says which
    // database it belongs to.
    expect(note).toContain('Budget:: 4000');
    expect(vault.files.has('Import/Reading.md')).toBe(true);
    expect(report.importedNotesCount).toBe(2);
  });
});

describe('RemNote — the plain path', () => {
  it('imports its Markdown and claims no detection', async () => {
    const vault = fakeVault();
    const importer = new RemNoteImporter();

    expect(await importer.detect([{ relativePath: 'Doc.md', content: '# Doc' }])).toBe(false);
    await importer.run([{ relativePath: 'Doc.md', content: '# Doc\n\n- rem\n  - nested rem' }], opts(vault));
    expect(vault.files.get('Import/Doc.md')).toContain('  - nested rem');
  });
});
