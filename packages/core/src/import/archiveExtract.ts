/**
 * What an import extraction is allowed to contain, and which entries carry
 * text (S40).
 *
 * These are DECISIONS, and until now each shell held its own copy: the text
 * extensions lived in a desktop service, the ceilings and the path guard in
 * the Rust extractor. A phone unpacking the same export therefore had to
 * invent both, and would have decided differently the moment either side
 * changed. Both are answers about the FORMAT, not about a platform, so they
 * live here and each shell only supplies the unpacking.
 *
 * The desktop streams entries to a temp folder through Rust; the phone unzips
 * in the WebView. Neither may accept an entry this module rejects.
 */

/** Extensions whose bytes are decoded into `content` for the importers. */
export const IMPORT_TEXT_EXTENSIONS = [
  '.json',
  '.md',
  '.markdown',
  '.enex',
  '.html',
  '.csv',
  '.txt',
  '.org',
] as const;

export function isTextPath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return IMPORT_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Why an entry was refused. Mirrors the native extractor's reasons. */
export type ExtractSkipReason = 'symlink' | 'unsafe_path' | 'too_large' | 'unreadable';

export interface ExtractLimits {
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxEntries: number;
}

/**
 * Ceilings for one extraction run.
 *
 * A notes export is text plus attachments; anything past these numbers is
 * either hostile or an archive Plainva could not index afterwards anyway.
 * The values match the native extractor's defaults deliberately — a limit
 * that differs per device is a bug report nobody can reproduce.
 */
export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024 * 1024,
  maxEntries: 200_000,
};

/**
 * Whether an archive entry's path may be written inside the extraction root.
 *
 * Rejects absolute paths, Windows drive letters, UNC prefixes and any `..`
 * segment — the Zip-Slip family, where an entry named `../../x` escapes the
 * folder it was supposed to stay in. Backslashes count as separators because
 * archives written on Windows use them and a guard that only knows `/` would
 * wave `..\\..\\x` through.
 */
export function isSafeArchivePath(relativePath: string): boolean {
  if (!relativePath) return false;
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  const segments = normalized.split('/');
  for (const segment of segments) {
    if (segment === '..') return false;
  }
  // A trailing separator is a directory entry, not a file to write.
  return !normalized.endsWith('/');
}

/**
 * Whether one entry may be extracted, given what has been written so far.
 *
 * `null` means "take it". The running total is passed in rather than tracked
 * here so the caller stays in charge of what it has actually written — the
 * declared size in a zip header is a claim, not a fact.
 */
export function classifyArchiveEntry(
  entry: { relativePath: string; byteSize: number; isSymlink?: boolean },
  written: { entries: number; totalBytes: number },
  limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS,
): ExtractSkipReason | null {
  if (entry.isSymlink) return 'symlink';
  if (!isSafeArchivePath(entry.relativePath)) return 'unsafe_path';
  if (entry.byteSize > limits.maxEntryBytes) return 'too_large';
  if (written.entries >= limits.maxEntries) return 'too_large';
  if (written.totalBytes + entry.byteSize > limits.maxTotalBytes) return 'too_large';
  return null;
}
