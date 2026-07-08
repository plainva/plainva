/**
 * Single source of truth for the on-disk backup naming grammar under
 * `.plainva/backups/`. Two shapes exist:
 *
 * 1. Per-file snapshots written by `BackupVaultAdapter`:
 *    `.plainva/backups/<originalPath>.<unix-ms>.bak`
 * 2. Batch folders written by explicit operations (index.md regenerate,
 *    OKF conversion): `.plainva/backups/<op>-<iso-stamp>/<originalPath>`
 *    where <iso-stamp> = `new Date().toISOString().replace(/[:.]/g, "-")`.
 *
 * Directory mtimes from the desktop adapter are placeholders, so batch-folder
 * age must be derived from the stamp in the folder name, never from mtime.
 */

export const BACKUPS_ROOT = ".plainva/backups";

/** Unix-ms today is 13 digits; accept 10–17 to stay tolerant of clock extremes. */
const BAK_FILE_RE = /^(.+)\.(\d{10,17})\.bak$/;

const BATCH_FOLDER_RE = /^(index-md|okf-conversion)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)$/;

export interface ParsedBackupName {
  /** Basename of the original file, e.g. "Note v2.1.md". */
  originalName: string;
  /** Unix timestamp in milliseconds embedded in the backup filename. */
  timestamp: number;
}

/** Parses a per-file backup basename. Anchored at the end, so dots in the original name are safe. */
export function parseBackupFileName(name: string): ParsedBackupName | null {
  const m = BAK_FILE_RE.exec(name);
  if (!m) return null;
  const timestamp = Number(m[2]);
  if (!Number.isFinite(timestamp)) return null;
  return { originalName: m[1], timestamp };
}

/** Parses a full backup path into the original vault path + timestamp. */
export function parseBackupPath(backupPath: string): { originalPath: string; timestamp: number } | null {
  const norm = backupPath.replace(/\\/g, "/");
  const prefix = `${BACKUPS_ROOT}/`;
  if (!norm.startsWith(prefix)) return null;
  const rel = norm.slice(prefix.length);
  const lastSlash = rel.lastIndexOf("/");
  const dir = lastSlash >= 0 ? rel.slice(0, lastSlash + 1) : "";
  const parsed = parseBackupFileName(lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel);
  if (!parsed) return null;
  return { originalPath: dir + parsed.originalName, timestamp: parsed.timestamp };
}

export function makeBackupPath(originalPath: string, timestamp: number): string {
  return `${BACKUPS_ROOT}/${originalPath}.${timestamp}.bak`;
}

/** Directory under BACKUPS_ROOT that holds the snapshots of the given original path. */
export function backupDirFor(originalPath: string): string {
  const norm = originalPath.replace(/\\/g, "/");
  const lastSlash = norm.lastIndexOf("/");
  const dir = lastSlash >= 0 ? norm.slice(0, lastSlash) : "";
  return dir ? `${BACKUPS_ROOT}/${dir}` : BACKUPS_ROOT;
}

export function isBatchBackupFolderName(name: string): boolean {
  return BATCH_FOLDER_RE.test(name);
}

/** Recovers the creation time (unix ms) from a batch folder name, or null if it does not match. */
export function parseBatchFolderStamp(folderName: string): number | null {
  const m = BATCH_FOLDER_RE.exec(folderName);
  if (!m) return null;
  const s = m[2];
  // 2026-07-05T14-30-45-123Z -> 2026-07-05T14:30:45.123Z
  const iso = `${s.slice(0, 10)}T${s.slice(11, 13)}:${s.slice(14, 16)}:${s.slice(17, 19)}.${s.slice(20, 23)}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** True for paths inside the app-internal `.plainva` tree (never backed up themselves). */
export function isPlainvaInternalPath(path: string): boolean {
  const norm = path.replace(/\\/g, "/");
  return norm === ".plainva" || norm.startsWith(".plainva/");
}
