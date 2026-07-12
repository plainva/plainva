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
