import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_LABELS,
  ReflectImporter,
  RoamImporter,
  indexRoamBlocks,
  resolveBlockRefs,
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

const roamExport = [
  {
    title: 'Reading',
    'create-time': 1600000000000,
    'edit-time': 1610000000000,
    children: [
      { uid: 'src01', string: 'Attention is a currency' },
      {
        uid: 'top01',
        string: 'Notes',
        heading: 2,
        children: [{ uid: 'ref01', string: 'As ((src01)) puts it, focus is scarce.' }],
      },
    ],
  },
  {
    title: 'Inbox',
    children: [{ uid: 'miss1', string: 'Points at ((nothere)) which is not in the export.' }],
  },
];

describe('Roam — block references become the words they pointed at', () => {
  it('indexes every block by uid, however deep', () => {
    const byUid = indexRoamBlocks(roamExport);
    expect(byUid.get('src01')).toBe('Attention is a currency');
    expect(byUid.get('ref01')).toContain('((src01))');
  });

  it('resolves a reference and leaves an unresolvable one visible', () => {
    const byUid = indexRoamBlocks(roamExport);

    const hit = resolveBlockRefs('As ((src01)) puts it', byUid);
    expect(hit.text).toBe('As Attention is a currency puts it');
    expect(hit.resolved).toBe(1);

    // Inventing text for a missing target would be worse than showing the gap.
    const miss = resolveBlockRefs('Points at ((nothere))', byUid);
    expect(miss.text).toBe('Points at ((nothere))');
    expect(miss.unresolved).toBe(1);
  });

  it('writes a page as bullets and says that the references are gone', async () => {
    const vault = fakeVault();
    const report = await new RoamImporter().run(roamExport, opts(vault));

    const note = vault.files.get('Import/Reading.md') ?? '';
    expect(note).toContain('- Attention is a currency');
    // A heading at the top level is a heading; deeper down it is a bullet.
    expect(note).toContain('## Notes');
    expect(note).toContain('As Attention is a currency puts it');
    expect(note).toContain('created: 2020-09-13');

    expect(report.summaryMarkdown).toContain(DEFAULT_IMPORT_LABELS.degradedRoamBlockRefs);
    expect(report.importedNotesCount).toBe(2);
  });

  it('recognises a Roam export and not any other JSON array', async () => {
    const importer = new RoamImporter();
    expect(await importer.detect([{ relativePath: 'roam.json', content: JSON.stringify(roamExport) }])).toBe(true);
    expect(await importer.detect([{ relativePath: 'x.json', content: '[1,2,3]' }])).toBe(false);
  });
});

describe('Roam — uploads are fetched, the rest of the web is not', () => {
  it('downloads from Roam storage and repoints the link', async () => {
    const vault = fakeVault();
    const asked: string[] = [];
    const httpFetch = (async (url: any) => {
      asked.push(String(url));
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    }) as unknown as typeof fetch;

    const pages = [
      {
        title: 'Trip',
        children: [
          {
            uid: 'b1',
            string:
              'Photo ![](https://firebasestorage.googleapis.com/v0/b/x/o/beach.png?alt=media) and a link [docs](https://example.com/page)',
          },
        ],
      },
    ];

    const report = await new RoamImporter().run(pages, { ...opts(vault), httpFetch });

    expect(vault.binaries.get('Import/Attachments/beach.png')).toEqual(new Uint8Array([1, 2, 3]));
    expect(vault.files.get('Import/Trip.md')).toContain('Import/Attachments/beach.png');
    // An ordinary web link is a link, not an attachment: following it would
    // turn the import into a crawler.
    expect(asked.some((u) => u.includes('example.com'))).toBe(false);
    expect(report.importedAttachmentsCount).toBe(1);
  });
});

describe('Reflect — the plain path is the whole mapping', () => {
  it('imports its Markdown and claims no detection', async () => {
    const vault = fakeVault();
    const importer = new ReflectImporter();

    expect(await importer.detect([{ relativePath: 'Note.md', content: '# Note' }])).toBe(false);

    await importer.run([{ relativePath: 'Daily/2024-05-01.md', content: '# Monday\n\n[[Project]]' }], opts(vault));
    expect(vault.files.get('Import/Daily/2024-05-01.md')).toContain('[[Project]]');
  });
});
