/**
 * Shared on-disk contract for `.plainva/recents.json` (plan Mobile M3E
 * 2026-07-12, package B): the device-local most-recently-OPENED notes list —
 * real MRU semantics, unlike a vault-wide mtime sort (which surfaces files
 * that merely synced). Lives next to bookmarks.json under `.plainva/`, which
 * never syncs, so the list stays per device by design. Both shells can
 * consume this; the desktop recents strip migrates in a later step.
 */

export interface RecentEntry {
  path: string;
  /** Epoch ms of the last open. */
  openedAt: number;
}

export const RECENTS_MAX = 20;

/** Parse tolerantly; foreign/broken JSON yields an empty list. */
export function parseRecentsFile(raw: string): RecentEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : [];
    const out: RecentEntry[] = [];
    for (const item of items) {
      if (item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string") {
        const openedAt = (item as { openedAt?: unknown }).openedAt;
        out.push({ path: (item as { path: string }).path, openedAt: typeof openedAt === "number" ? openedAt : 0 });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeRecentsFile(entries: RecentEntry[]): string {
  return JSON.stringify({ items: entries.map(({ path, openedAt }) => ({ path, openedAt })) }, null, 2);
}

/** Move/insert `path` to the front; dedupe; cap at `max`. Pure. */
export function pushRecentEntry(
  entries: RecentEntry[],
  path: string,
  openedAt: number,
  max = RECENTS_MAX,
): RecentEntry[] {
  return [{ path, openedAt }, ...entries.filter((e) => e.path !== path)].slice(0, max);
}

/** Drop entries whose path a rename/delete made stale. Pure. */
export function dropRecentEntry(entries: RecentEntry[], path: string): RecentEntry[] {
  return entries.filter((e) => e.path !== path);
}
