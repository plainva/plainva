/**
 * Shared on-disk contract for `.plainva/recents.json` (plan Mobile M3E
 * 2026-07-12, package B): the device-local most-recently-OPENED notes list —
 * real MRU semantics, unlike a vault-wide mtime sort (which surfaces files
 * that merely synced). Lives under `.plainva/`, which never syncs, in a
 * file of each device's own (`deviceOwnFiles.ts`): a vault folder that a file
 * service carries between devices used to carry ONE list for all of them, and
 * whoever opened a note last had it (decision E7). Both shells read and write
 * it through the functions at the end of this file.
 */

import { isHiddenPath, type IVaultAdapter } from "@plainva/core";
import { onDeviceFileLane, ownDeviceFilePath, readDeviceOwnText } from "./deviceOwnFiles";

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

/* ---- On disk: one file per device (decision E7, Sammelplan § 3.127 Nr. 3) ---- */

/**
 * This device's list as it lies on disk: its own `recents.<device>.json`, or —
 * while it has none — the shared `recents.json` of older versions, which is
 * where every device's list starts. Missing or unreadable: an empty list.
 */
export async function readRecentsOnDisk(adapter: Pick<IVaultAdapter, "readTextFile" | "exists">): Promise<RecentEntry[]> {
  try {
    // What the list SHOWS: a hidden file (E8), opened through a link, is not offered again here.
    return parseRecentsFile((await readDeviceOwnText(adapter, "recents")).text).filter((e) => !isHiddenPath(e.path));
  } catch {
    return [];
  }
}

/**
 * Changes this device's list and writes it to the device's own file — never to
 * the shared one, which an older version on another device may still use. One
 * change at a time per file, so two opens in the same moment both land.
 */
export async function updateRecentsOnDisk(
  adapter: Pick<IVaultAdapter, "readTextFile" | "writeTextFile" | "exists" | "createDir">,
  change: (entries: RecentEntry[]) => RecentEntry[],
): Promise<RecentEntry[]> {
  const own = await ownDeviceFilePath("recents");
  return onDeviceFileLane(adapter, own, async () => {
    let current: RecentEntry[] = [];
    try {
      current = parseRecentsFile((await readDeviceOwnText(adapter, "recents", own)).text);
    } catch {
      /* first use */
    }
    const next = change(current);
    try {
      await adapter.createDir(".plainva");
    } catch {
      /* already there */
    }
    await adapter.writeTextFile(own, serializeRecentsFile(next));
    return next;
  });
}

/** `path` was opened: to the front of this device's list. */
export function pushRecentOnDisk(
  adapter: Pick<IVaultAdapter, "readTextFile" | "writeTextFile" | "exists" | "createDir">,
  path: string,
  openedAt: number,
): Promise<RecentEntry[]> {
  return updateRecentsOnDisk(adapter, (entries) => pushRecentEntry(entries, path, openedAt));
}

/** "Remove from list": drops `path` from this device's list (never the file). */
export function forgetRecentOnDisk(
  adapter: Pick<IVaultAdapter, "readTextFile" | "writeTextFile" | "exists" | "createDir">,
  path: string,
): Promise<RecentEntry[]> {
  return updateRecentsOnDisk(adapter, (entries) => dropRecentEntry(entries, path));
}
