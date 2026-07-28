import { describe, expect, it } from 'vitest';
import {
  EvernoteEnexImporter,
  GenericMarkdownImporter,
  GoogleKeepImporter,
  SimplenoteImporter,
  msFromEnexStamp,
  msFromIso,
  msFromMicroseconds,
  timesFromFile,
} from '../../src/import/index.js';

/**
 * An import used to date every note "today", which quietly destroyed the time
 * axis of a collection grown over years. These pin that each source's own
 * dates arrive — and that a source without dates says so instead of guessing.
 */

function fakeVault() {
  const files = new Map<string, string>();
  const stamped: Array<{ path: string; times: { createdMs?: number; modifiedMs?: number } }> = [];
  return {
    files,
    stamped,
    async exists(path: string) {
      return files.has(path);
    },
    async writeTextFile(path: string, content: string) {
      files.set(path, content);
    },
    async createFolder() {
      /* implicit */
    },
    async setFileTimes(path: string, times: { createdMs?: number; modifiedMs?: number }) {
      stamped.push({ path, times });
    },
  };
}

describe('normalizing the shapes the sources state their dates in', () => {
  it('reads ISO instants', () => {
    expect(msFromIso('2019-03-14T09:26:53.000Z')).toBe(1_552_555_613_000);
    expect(msFromIso('not a date')).toBeUndefined();
    expect(msFromIso(undefined)).toBeUndefined();
    expect(msFromIso('')).toBeUndefined();
  });

  it('reads microseconds, as Google Keep states them', () => {
    expect(msFromMicroseconds(1_552_555_613_000_000)).toBe(1_552_555_613_000);
    expect(msFromMicroseconds('1552555613000000')).toBe(1_552_555_613_000);
    expect(msFromMicroseconds(0)).toBeUndefined();
    expect(msFromMicroseconds('abc')).toBeUndefined();
  });

  it('reads the compact ENEX stamp including its time', () => {
    // The old parser kept the date and dropped the time, collapsing a whole
    // day of notes onto midnight.
    expect(msFromEnexStamp('20190314T092653Z')).toBe(1_552_555_613_000);
    expect(msFromEnexStamp('20190314T092653')).toBe(1_552_555_613_000);
    expect(msFromEnexStamp('2019-03-14')).toBeUndefined();
  });

  it('treats a missing file date as unknown rather than zero', () => {
    expect(timesFromFile({ mtimeMs: 1_552_555_613_000 })).toEqual({ modifiedMs: 1_552_555_613_000 });
    expect(timesFromFile({})).toBeUndefined();
    expect(timesFromFile({ mtimeMs: Number.NaN })).toBeUndefined();
  });
});

describe('the dates reach the note and the file', () => {
  const opts = (vaultAdapter: ReturnType<typeof fakeVault>) => ({
    targetVaultPath: '/v',
    targetSubfolder: 'Imported',
    vaultAdapter,
  });

  it('Simplenote carries creationDate and lastModified', async () => {
    const vaultAdapter = fakeVault();
    await new SimplenoteImporter().run(
      {
        activeNotes: [
          {
            id: '1',
            content: 'Kept',
            creationDate: '2019-03-14T09:26:53.000Z',
            lastModified: '2020-06-01T12:00:00.000Z',
          },
        ],
      },
      opts(vaultAdapter)
    );

    const note = vaultAdapter.files.get('Imported/Kept.md')!;
    expect(note).toContain('created: 2019-03-14T09:26:53.000Z');
    expect(note).toContain('updated: 2020-06-01T12:00:00.000Z');
    expect(vaultAdapter.stamped[0].times.modifiedMs).toBe(1_591_012_800_000);
  });

  it('Google Keep converts its microsecond stamps', async () => {
    const vaultAdapter = fakeVault();
    await new GoogleKeepImporter().run(
      [
        {
          title: 'Shopping',
          textContent: 'milk',
          createdTimestampUsec: 1_552_555_613_000_000,
          userEditedTimestampUsec: 1_591_012_800_000_000,
        },
      ],
      opts(vaultAdapter)
    );

    const note = vaultAdapter.files.get('Imported/Shopping.md')!;
    expect(note).toContain('created: 2019-03-14T09:26:53.000Z');
    expect(note).toContain('updated: 2020-06-01T12:00:00.000Z');
  });

  it('Evernote keeps the time of day it used to discard', async () => {
    const vaultAdapter = fakeVault();
    await new EvernoteEnexImporter().run(
      [
        {
          title: 'Meeting',
          contentXml: 'notes',
          created: '20190314T092653Z',
          updated: '20200601T120000Z',
        },
      ],
      opts(vaultAdapter)
    );

    const note = vaultAdapter.files.get('Imported/Meeting.md')!;
    expect(note).toContain('created: 2019-03-14T09:26:53.000Z');
    expect(note).not.toMatch(/created: 2019-03-14\n/);
  });

  it('a Markdown file carries its own modification time', async () => {
    const vaultAdapter = fakeVault();
    await new GenericMarkdownImporter().run(
      [{ relativePath: 'Note.md', content: '# Note', mtimeMs: 1_552_555_613_000 }],
      opts(vaultAdapter)
    );

    expect(vaultAdapter.files.get('Imported/Note.md')).toContain('updated: 2019-03-14T09:26:53.000Z');
    expect(vaultAdapter.stamped).toEqual([
      { path: 'Imported/Note.md', times: { modifiedMs: 1_552_555_613_000 } },
    ]);
  });

  it('writes no date at all when the source has none', async () => {
    const vaultAdapter = fakeVault();
    await new GenericMarkdownImporter().run(
      [{ relativePath: 'Note.md', content: '# Note' }],
      opts(vaultAdapter)
    );

    const note = vaultAdapter.files.get('Imported/Note.md')!;
    expect(note).not.toContain('created:');
    expect(note).not.toContain('updated:');
    expect(vaultAdapter.stamped).toEqual([]);
  });

  it('honours preserveTimestamps: false', async () => {
    const vaultAdapter = fakeVault();
    await new GenericMarkdownImporter().run(
      [{ relativePath: 'Note.md', content: '# Note', mtimeMs: 1_552_555_613_000 }],
      { ...opts(vaultAdapter), preserveTimestamps: false }
    );

    expect(vaultAdapter.files.get('Imported/Note.md')).not.toContain('updated:');
    expect(vaultAdapter.stamped).toEqual([]);
  });

  it('survives an adapter that cannot stamp file times', async () => {
    const vaultAdapter = fakeVault();
    vaultAdapter.setFileTimes = async () => {
      throw new Error('read-only volume');
    };

    const report = await new GenericMarkdownImporter().run(
      [{ relativePath: 'Note.md', content: '# Note', mtimeMs: 1_552_555_613_000 }],
      opts(vaultAdapter)
    );

    // The frontmatter is the portable carrier; a failed stamp is not a failed
    // import.
    expect(report.importedNotesCount).toBe(1);
    expect(report.skippedCount).toBe(0);
    expect(vaultAdapter.files.get('Imported/Note.md')).toContain('updated:');
  });
});
