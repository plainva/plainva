import { describe, expect, it } from 'vitest';
import {
  AmplenoteImporter,
  BearImporter,
  CapacitiesImporter,
  DEFAULT_IMPORT_LABELS,
  JoplinImporter,
  NotesnookImporter,
  defaultImportRegistry,
  frontmatterTimes,
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

/** A Joplin "Markdown + Front Matter" export, as its documentation describes. */
const joplinExport = [
  {
    relativePath: 'Work/Meeting.md',
    content: '---\nTitle: Meeting\nCreated: 2023-05-01T09:00:00Z\nUpdated: 2023-06-02T10:00:00Z\n---\n\nNotes here. ![](../_resources/plan.png)',
  },
  { relativePath: '_resources/plan.png', content: '', isText: false, sourcePath: '/tmp/plan.png' },
];

describe('Markdown family — detection only on a real signature', () => {
  it('recognises Joplin by its _resources folder', async () => {
    expect(await new JoplinImporter().detect(joplinExport)).toBe(true);
    expect(await new JoplinImporter().detect([{ relativePath: 'Note.md', content: '# x' }])).toBe(false);
  });

  it('recognises Bear by its TextBundle folders', async () => {
    const bear = [{ relativePath: 'Trip.textbundle/text.markdown', content: '# Trip' }];
    expect(await new BearImporter().detect(bear)).toBe(true);
    expect(await new BearImporter().detect([{ relativePath: 'Trip.md', content: '# Trip' }])).toBe(false);
  });

  it('recognises Notesnook by the hash it puts in front of every image', async () => {
    const notesnook = [
      { relativePath: 'Ideas/Note.md', content: '# Note' },
      { relativePath: 'Ideas/0123456789abcdef-photo.png', content: '', isText: false },
    ];
    expect(await new NotesnookImporter().detect(notesnook)).toBe(true);
    expect(
      await new NotesnookImporter().detect([
        { relativePath: 'Ideas/Note.md', content: '# Note' },
        { relativePath: 'Ideas/photo.png', content: '', isText: false },
      ])
    ).toBe(false);
  });

  it('claims nothing for the exports that leave no fingerprint', async () => {
    // Capacities and Amplenote both write Markdown with frontmatter in a ZIP,
    // which is what half a dozen apps write. Guessing here would mean claiming
    // somebody else's export; these are picked from the tile instead.
    const plain = [{ relativePath: 'Note.md', content: '---\ntitle: x\n---\n' }];
    expect(await new CapacitiesImporter().detect(plain)).toBe(false);
    expect(await new AmplenoteImporter().detect(plain)).toBe(false);
  });

  it('registers all ten so the wizard can offer them', () => {
    const ids = defaultImportRegistry.list().map((s) => s.id);
    for (const id of [
      'joplin', 'bear', 'notesnook', 'capacities', 'amplenote',
      'supernotes', 'heptabase', 'upnote', 'craft', 'anytype',
    ]) {
      expect(ids).toContain(id);
    }
  });
});

describe('Markdown family — the dates come from the note, not the ZIP', () => {
  it('reads created and updated in the spellings these apps use', () => {
    expect(frontmatterTimes('---\nCreated: 2023-05-01T09:00:00Z\n---\n')?.createdMs).toBe(
      Date.parse('2023-05-01T09:00:00Z')
    );
    expect(frontmatterTimes('---\ncreatedAt: 2023-05-01\nupdatedAt: 2023-06-01\n---\n')?.modifiedMs).toBe(
      Date.parse('2023-06-01')
    );
    expect(frontmatterTimes('# no frontmatter')).toBeUndefined();
    expect(frontmatterTimes('---\ntitle: only a title\n---\n')).toBeUndefined();
  });

  it('stamps a Joplin note with its own dates instead of the export time', async () => {
    const vault = fakeVault();
    await new JoplinImporter().run(joplinExport, {
      ...opts(vault),
      readSourceBytes: async () => new Uint8Array([1]),
    });

    const note = vault.files.get('Import/Work/Meeting.md') ?? '';
    expect(note).toContain('created: 2023-05-01T09:00:00.000Z');
    expect(note).toContain('updated: 2023-06-02T10:00:00.000Z');
    // The picture keeps its place, so the note's relative link still finds it.
    expect(vault.binaries.has('Import/_resources/plan.png')).toBe(true);
  });
});

describe('Bear — a TextBundle becomes a note with its pictures beside it', () => {
  it('unwraps the bundle and repoints its asset links', async () => {
    const vault = fakeVault();
    const bundle = [
      {
        relativePath: 'Trip.textbundle/text.markdown',
        content: '# Trip\n\n![](assets/beach.png)',
      },
      {
        relativePath: 'Trip.textbundle/assets/beach.png',
        content: '',
        isText: false,
        sourcePath: '/tmp/beach.png',
      },
      { relativePath: 'Trip.textbundle/info.json', content: '{"version":2}' },
    ];

    await new BearImporter().run(bundle, {
      ...opts(vault),
      readSourceBytes: async () => new Uint8Array([9, 9]),
    });

    expect(vault.files.get('Import/Trip.md')).toContain('![](Trip/assets/beach.png)');
    expect(vault.binaries.has('Import/Trip/assets/beach.png')).toBe(true);
    // The bundle's own bookkeeping is not a note.
    expect(vault.files.has('Import/Trip.textbundle/info.json')).toBe(false);
  });
});

describe('Notesnook — a note in two notebooks is one note', () => {
  it('imports the repeat once and names where it went', async () => {
    const vault = fakeVault();
    const body = '# Shared\n\nSame text in both notebooks.';
    const report = await new NotesnookImporter().run(
      [
        { relativePath: 'Work/Shared.md', content: body },
        { relativePath: 'Personal/Shared.md', content: body },
        { relativePath: 'Work/Other.md', content: '# Other' },
      ],
      opts(vault)
    );

    expect(vault.files.has('Import/Work/Shared.md')).toBe(true);
    expect(vault.files.has('Import/Personal/Shared.md')).toBe(false);
    expect(report.importedNotesCount).toBe(2);
    expect(report.summaryMarkdown).toContain(DEFAULT_IMPORT_LABELS.skippedDuplicate);
    expect(report.summaryMarkdown).toContain('Import/Work/Shared.md');
  });
});

describe('Capacities and Amplenote — plain, and honest about it', () => {
  it('imports the notes and leaves a collection CSV as the file it is', async () => {
    const vault = fakeVault();
    await new CapacitiesImporter().run(
      [
        { relativePath: 'Pages/Idea.md', content: '---\ntitle: Idea\ncreatedAt: 2024-03-01\n---\n\nText.' },
        { relativePath: 'Collections/Books.csv', content: 'Title,Author\nDune,Herbert\n' },
      ],
      opts(vault)
    );

    const note = vault.files.get('Import/Pages/Idea.md') ?? '';
    expect(note).toContain('created: 2024-03-01');
    // Turning a collection into a database would mean guessing which folder it
    // belongs to — but the CSV is the user's data and comes across as a file.
    expect(vault.files.get('Import/Collections/Books.csv')).toContain('Dune,Herbert');
  });

  it('imports an Amplenote export with its frontmatter intact', async () => {
    const vault = fakeVault();
    const report = await new AmplenoteImporter().run(
      [{ relativePath: 'Daily.md', content: '---\ntitle: Daily\nupdated: 2024-04-05\n---\n\nToday.' }],
      opts(vault)
    );

    expect(vault.files.get('Import/Daily.md')).toContain('title: Daily');
    expect(report.importedNotesCount).toBe(1);
  });
});
