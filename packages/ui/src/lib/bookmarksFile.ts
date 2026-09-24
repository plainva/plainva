/** Typed, device-local bookmark file, shared by both shells. Historical mobile
 * string arrays and Obsidian file/folder groups remain readable. */
import { sameStoredValue } from "@plainva/core";
import { VaultFileNotFoundError } from "@plainva/core";

export interface BookmarkEntry { type: "file" | "folder"; path: string }
export interface BookmarksFile {
  entries: BookmarkEntry[];
  /** File-only compatibility projection for older settings-profile clients. */
  paths: string[];
  existed: boolean;
}
export const bookmarkKey = (entry: BookmarkEntry) => `${entry.type}:${entry.path.normalize("NFC")}`;
export function validBookmarkPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 4096
    && !/^(?:[/\\]|[a-z]:)/i.test(path) && !Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && !path.split(/[/\\]/).some((part) => part === ".." || part === "." || !part);
}
export function deduplicateBookmarks(entries: readonly (BookmarkEntry | string)[]): BookmarkEntry[] {
  const seen = new Set<string>(), next: BookmarkEntry[] = [];
  for (const raw of entries) {
    const entry: BookmarkEntry = typeof raw === "string" ? { type: "file", path: raw } : raw;
    if (!entry || (entry.type !== "file" && entry.type !== "folder") || !validBookmarkPath(entry.path)) continue;
    const clean = { ...entry, path: entry.path.replace(/\\/g, "/") };
    const key = bookmarkKey(clean); if (seen.has(key)) continue;
    seen.add(key); next.push(clean);
  }
  return next;
}
export function parseBookmarksFile(raw: string): BookmarksFile {
  try {
    const parsed: unknown = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && "items" in parsed ? parsed.items : null;
    if (Array.isArray(items)) {
      const entries: (BookmarkEntry | string)[] = [];
      const walk = (items: unknown[], depth: number) => {
        if (depth > 32) return;
        for (const item of items) {
          if (typeof item === "string") entries.push(item);
          else if (item && typeof item === "object") {
            const value = item as { type?: unknown; path?: unknown; items?: unknown };
            if (value.type === "group" && Array.isArray(value.items)) walk(value.items, depth + 1);
            else if (typeof value.path === "string" && (value.type === "file" || value.type === "folder" || value.type === undefined))
              entries.push({ type: value.type === "folder" ? "folder" : "file", path: value.path.replace(/\/$/, "") });
          }
        }
      };
      walk(Array.isArray(parsed) ? items.filter((item) => typeof item === "string") : items, 0);
      const normalized = deduplicateBookmarks(entries);
      return { entries: normalized, paths: normalized.filter((e) => e.type === "file").map((e) => e.path), existed: true };
    }
  } catch { /* Unreadable data never authorizes overwriting the file. */ }
  return { entries: [], paths: [], existed: false };
}
export function serializeBookmarksFile(entries: readonly (BookmarkEntry | string)[]): string {
  return JSON.stringify({ items: deduplicateBookmarks(entries) }, null, 2);
}
export interface BookmarksIO {
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
}
export async function readBookmarksOnDisk(io: Pick<BookmarksIO, "readTextFile">): Promise<BookmarkEntry[]> {
  let raw: string;
  try { raw = await io.readTextFile(BOOKMARKS_FILE); }
  catch (error) {
    if (error instanceof VaultFileNotFoundError || (error as { code?: string })?.code === "ENOENT") return [];
    throw error;
  }
  const parsed = parseBookmarksFile(raw);
  if (!parsed.existed) throw new Error("Unreadable bookmarks document");
  return parsed.entries;
}
export function toggleBookmarkOnDisk(io: BookmarksIO, path: string, type: BookmarkEntry["type"] = "file"): Promise<BookmarkEntry[]> {
  if (!validBookmarkPath(path) || (type !== "file" && type !== "folder")) return Promise.reject(new Error("Invalid bookmark path"));
  const entry = { path, type }, key = bookmarkKey(entry);
  return updateBookmarksOnDisk(io, (current) => current.some((e) => bookmarkKey(e) === key)
    ? current.filter((e) => bookmarkKey(e) !== key) : [...current, entry]);
}
export function removeBookmarksOnDisk(io: BookmarksIO, paths: readonly string[]): Promise<BookmarkEntry[]> {
  const gone = new Set(paths); return updateBookmarksOnDisk(io, (current) => current.filter((e) => !gone.has(e.path)));
}
export function mergeBookmarksOnDisk(io: BookmarksIO, entries: readonly (BookmarkEntry | string)[]): Promise<BookmarkEntry[]> {
  return updateBookmarksOnDisk(io, (current) => [...current, ...deduplicateBookmarks(entries)]);
}
export function renameBookmarksOnDisk(io: BookmarksIO, from: string, to: string): Promise<BookmarkEntry[]> {
  if (!validBookmarkPath(from) || !validBookmarkPath(to)) return Promise.reject(new Error("Invalid bookmark move"));
  return updateBookmarksOnDisk(io, (current) => current.map((e) => e.path === from || e.path.startsWith(from + "/")
    ? { ...e, path: to + e.path.slice(from.length) } : e));
}
/** Automatic import is additive and shares the mutation lane with star clicks.
 * The source is always read-only; removing a bookmark does not edit Obsidian. */
const imported = new WeakMap<BookmarksIO, Promise<void>>();
export async function importObsidianBookmarks(io: BookmarksIO): Promise<BookmarkEntry[]> {
  let pending = imported.get(io);
  if (!pending) {
    pending = importOnce(io); imported.set(io, pending);
    void pending.catch(() => { if (imported.get(io) === pending) imported.delete(io); });
  }
  await pending; return readBookmarksOnDisk(io);
}
async function importOnce(io: BookmarksIO): Promise<void> {
  let entries: BookmarkEntry[] = [];
  try { entries = parseBookmarksFile(await io.readTextFile(".obsidian/bookmarks.json")).entries; } catch { /* no import source */ }
  if (entries.length) await mergeBookmarksOnDisk(io, entries);
}
export function validBookmarkPaths(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(validBookmarkPath);
}
/** New clients retain folders when an old profile has no folder channel.
 * An explicit empty folder array is a deletion; malformed channels are preserved. */
export function applyBookmarkProfileOnDisk(io: BookmarksIO, values: Record<string, unknown>, preserve: ReadonlySet<string> = new Set()): Promise<BookmarkEntry[]> {
  return updateBookmarksOnDisk(io, (current) => {
    const next: BookmarkEntry[] = [];
    for (const [field, type] of [["bookmarks", "file"], ["bookmarkFolders", "folder"]] as const) {
      const raw = values[field];
      if (preserve.has(field) || (raw !== undefined && !validBookmarkPaths(raw)) || (field === "bookmarkFolders" && raw === undefined))
        next.push(...current.filter((e) => e.type === type));
      else next.push(...(raw as string[] | undefined ?? []).map((path) => ({ path, type })));
    }
    return next;
  });
}

const laneScopes = new WeakMap<BookmarksIO, string>();
export function setBookmarksLaneScope(io: BookmarksIO, scope: string) { laneScopes.set(io, scope); }
const lanes = new Map<BookmarksIO | string, Promise<unknown>>();
async function updateBookmarksOnDisk(io: BookmarksIO, change: (current: BookmarkEntry[]) => BookmarkEntry[]): Promise<BookmarkEntry[]> {
  // All desktop clients delegate mutations to the same owner adapter. The
  // whole read-modify-write must share a lane, not just the final file write.
  const lane = laneScopes.get(io) ?? io;
  const run = (lanes.get(lane) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const current = await readBookmarksOnDisk(io);
    const next = deduplicateBookmarks(change(current));
    if (!sameStoredValue(current, next)) await io.writeTextFile(BOOKMARKS_FILE, serializeBookmarksFile(next));
    return next;
  });
  lanes.set(lane, run);
  void run.finally(() => { if (lanes.get(lane) === run) lanes.delete(lane); }).catch(() => {});
  return run;
}

/** Where the list lives; carried by the settings profile, never note sync. */
export const BOOKMARKS_FILE = ".plainva/bookmarks.json";
