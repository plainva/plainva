import { describe, expect, it } from 'vitest';
import {
  classifyArchiveEntry,
  DEFAULT_EXTRACT_LIMITS,
  isSafeArchivePath,
  isTextPath,
} from '../../src/import/archiveExtract.ts';

/**
 * The extraction rules both shells obey (S40). The desktop unpacks through
 * Rust and the phone through fflate, so these decisions are only worth
 * anything if they cannot drift — hence the assertions on the exact ceilings.
 */
describe('import archive rules', () => {
  it('decodes the text formats the importers read, and nothing else', () => {
    for (const path of ['a.md', 'A.MARKDOWN', 'x/y.enex', 'n.json', 't.csv', 'p.html', 'r.org', 'q.txt']) {
      expect(isTextPath(path), path).toBe(true);
    }
    // Attachments must stay bytes: decoding a PNG as text is how an importer
    // ends up writing mojibake into a note.
    for (const path of ['photo.png', 'a.pdf', 'b.mp3', 'archive.zip', 'noext']) {
      expect(isTextPath(path), path).toBe(false);
    }
  });

  it('refuses every shape of escaping path (Zip-Slip)', () => {
    for (const bad of [
      '../secret',
      'a/../../secret',
      '/etc/passwd',
      'C:/Windows/x',
      '..\\..\\secret', // written on Windows, still an escape
      'a\\..\\..\\b',
      '',
      'folder/', // a directory entry, not a file
    ]) {
      expect(isSafeArchivePath(bad), bad).toBe(false);
    }
    for (const good of ['a.md', 'Notes/a.md', 'deep/a/b/c.png', 'Notes\\a.md']) {
      expect(isSafeArchivePath(good), good).toBe(true);
    }
    // "..." and "..data" are ordinary names, not traversal.
    expect(isSafeArchivePath('a/.../b.md')).toBe(true);
    expect(isSafeArchivePath('a/..data/b.md')).toBe(true);
  });

  it('keeps the ceilings identical to the native extractor', () => {
    expect(DEFAULT_EXTRACT_LIMITS).toEqual({
      maxEntryBytes: 512 * 1024 * 1024,
      maxTotalBytes: 4 * 1024 * 1024 * 1024,
      maxEntries: 200_000,
    });
  });

  it('classifies an entry against what has already been written', () => {
    const fresh = { entries: 0, totalBytes: 0 };
    expect(classifyArchiveEntry({ relativePath: 'a.md', byteSize: 10 }, fresh)).toBeNull();
    expect(classifyArchiveEntry({ relativePath: '../a.md', byteSize: 10 }, fresh)).toBe('unsafe_path');
    expect(classifyArchiveEntry({ relativePath: 'a.md', byteSize: 10, isSymlink: true }, fresh)).toBe('symlink');

    const limits = { maxEntryBytes: 100, maxTotalBytes: 150, maxEntries: 2 };
    expect(classifyArchiveEntry({ relativePath: 'a.md', byteSize: 101 }, fresh, limits)).toBe('too_large');
    // The single entry fits, but it would burst the run's total — a zip bomb
    // is many acceptable entries, so the sum has to be checked too.
    expect(
      classifyArchiveEntry({ relativePath: 'a.md', byteSize: 60 }, { entries: 1, totalBytes: 100 }, limits),
    ).toBe('too_large');
    expect(
      classifyArchiveEntry({ relativePath: 'a.md', byteSize: 10 }, { entries: 2, totalBytes: 0 }, limits),
    ).toBe('too_large');
  });
});
