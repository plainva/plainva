/**
 * Helpers around sync conflict copies (P3.11). The worker names them
 * `<base>.CONFLICT-<iso-stamp><ext>` (SyncWorker.preserveLocalAsConflict);
 * resolving needs the reverse mapping back to the original path.
 */

export function isConflictCopyPath(path: string): boolean {
  return /\.CONFLICT-[^/\\]*$/.test(path) || /\.CONFLICT-[^/\\]*\.[^./\\]+$/.test(path);
}

/** `Notes/a.CONFLICT-2026-07-05T12-30-00-000Z.md` -> `Notes/a.md`; null if not a conflict copy. */
export function conflictOriginalPath(conflictPath: string): string | null {
  const withExt = conflictPath.match(/^(.*)\.CONFLICT-[^/\\]*?(\.[^./\\]+)$/);
  if (withExt) return `${withExt[1]}${withExt[2]}`;
  const bare = conflictPath.match(/^(.*)\.CONFLICT-[^/\\]*$/);
  if (bare) return bare[1];
  return null;
}

/**
 * Builds a conflict-copy sibling path for `path` — the same grammar the sync
 * worker uses (`<base>.CONFLICT-<iso-stamp><ext>`), so conflictOriginalPath
 * and the conflict banners resolve editor-preserved drafts identically.
 */
export function conflictCopyPath(path: string, now: Date = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const extMatch = path.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1] : "";
  const base = extMatch ? path.substring(0, path.length - ext.length) : path;
  return `${base}.CONFLICT-${timestamp}${ext}`;
}
