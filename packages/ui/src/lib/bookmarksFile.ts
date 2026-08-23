/**
 * Shared on-disk contract for `.plainva/bookmarks.json` (plan Mobile M3E 2026-07-12,
 * package A5). Historically the two shells wrote INCOMPATIBLE shapes into the same
 * device-local file: desktop `{ "items": [{ "type": "file", "path": "..." }] }`,
 * mobile a bare `["path", ...]` array. `.plainva/` never syncs, so no data was
 * lost — but any future export/import path would clash. Both shells now parse
 * BOTH shapes and write the single canonical desktop-compatible object form
 * (which also matches the Obsidian bookmarks plugin's `items` layout).
 */

export interface BookmarksFile {
  /** Bookmarked note paths in user order. */
  paths: string[];
  /** True when the raw text was a readable bookmarks document (either shape). */
  existed: boolean;
}

/** Parse either historical shape; unreadable/foreign JSON yields `existed: false`. */
export function parseBookmarksFile(raw: string): BookmarksFile {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Legacy mobile shape: a bare array of paths.
      return { paths: parsed.filter((p): p is string => typeof p === "string"), existed: true };
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)) {
      const items = (parsed as { items: unknown[] }).items;
      const paths: string[] = [];
      for (const item of items) {
        if (typeof item === "string") paths.push(item);
        else if (item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string") {
          paths.push((item as { path: string }).path);
        }
      }
      return { paths, existed: true };
    }
  } catch {
    /* fall through */
  }
  return { paths: [], existed: false };
}

/** Serialize to the canonical `{ items: [{ type: "file", path }] }` shape. */
export function serializeBookmarksFile(paths: string[]): string {
  return JSON.stringify({ items: paths.map((p) => ({ type: "file", path: p })) }, null, 2);
}

/**
 * Adds or removes one bookmark, reading the file first (multi-window C1).
 *
 * The list is read back from disk rather than taken from the caller's state
 * because that state can be stale: since stage C two windows draw the same
 * bookmark list, and writing a whole file from a snapshot means the second
 * window's toggle silently drops the first window's. It is the shape
 * `pushRecent` has always had, for the same reason — and it also stops an
 * external edit of the file from being clobbered by the next star click.
 *
 * Returns the new list so the caller can show it without a second read.
 */
export async function toggleBookmarkOnDisk(io: BookmarksIO, path: string): Promise<string[]> {
  return updateBookmarksOnDisk(io, (current) =>
    current.includes(path) ? current.filter((p) => p !== path) : [...current, path],
  );
}

/**
 * Drops bookmarks whose file is gone (cascade delete). Same read-modify-write
 * for the same reason: without it a deletion in one window puts back the
 * bookmarks another window had just removed.
 */
export async function removeBookmarksOnDisk(io: BookmarksIO, paths: readonly string[]): Promise<string[]> {
  const gone = new Set(paths);
  return updateBookmarksOnDisk(io, (current) => current.filter((p) => !gone.has(p)));
}

export interface BookmarksIO {
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
}

async function updateBookmarksOnDisk(io: BookmarksIO, change: (current: string[]) => string[]): Promise<string[]> {
  let current: string[] = [];
  try {
    current = parseBookmarksFile(await io.readTextFile(BOOKMARKS_FILE)).paths;
  } catch {
    /* not there yet — the first bookmark creates it */
  }
  const next = change(current);
  await io.writeTextFile(BOOKMARKS_FILE, serializeBookmarksFile(next));
  return next;
}

/** Where the list lives; device-local, never synced. */
export const BOOKMARKS_FILE = ".plainva/bookmarks.json";
