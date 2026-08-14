/**
 * The "recently opened" strip, on the shared contract (C12/S20).
 *
 * The list itself is unchanged — same MRU order, same cap, same entries. What
 * changed is where it lives: `.plainva/recents.json` through
 * `packages/ui/src/lib/recentsFile.ts`, the file the mobile shell has written
 * since M3E, instead of a desktop-only `localStorage` key holding bare strings.
 * Both are device-local (`.plainva/` never syncs), so nothing about the
 * list's reach changes; only the second grammar for the same list is gone.
 *
 * Two desktop specifics survive the move on purpose:
 *
 * - **Virtual tabs belong in the strip.** `plainva://graph` and
 *   `plainva://tasks` have no file behind them, so the existence filter must
 *   skip them rather than quietly drop them — the maintainer asked for those
 *   entries to be visible, and three E2E pin it.
 * - **Everything the user opens counts**, including attachments. The mobile
 *   push filters to `.md`; imposing that here would silently change what the
 *   strip shows.
 *
 * A first read migrates the old `localStorage` list and then clears it, so the
 * move costs nobody their history. Writes are best-effort: a strip that cannot
 * be persisted is not worth failing an open over.
 */

import { parseRecentsFile, serializeRecentsFile, pushRecentEntry, dropRecentEntry, RECENTS_MAX } from "@plainva/ui";
import type { IVaultAdapter } from "@plainva/core";
import { isVirtualPath } from "../components/graph/virtualPaths";

const RECENTS_FILE = ".plainva/recents.json";

/** The legacy per-vault key; read once for the migration, then removed. */
export function legacyRecentsKey(vaultPath: string): string {
  return `recentPaths-${vaultPath}`;
}

async function readEntries(adapter: IVaultAdapter): Promise<ReturnType<typeof parseRecentsFile>> {
  try {
    return parseRecentsFile(await adapter.readTextFile(RECENTS_FILE));
  } catch {
    return [];
  }
}

async function writeEntries(adapter: IVaultAdapter, entries: ReturnType<typeof parseRecentsFile>): Promise<void> {
  try {
    await adapter.createDir(".plainva");
  } catch {
    /* already there */
  }
  await adapter.writeTextFile(RECENTS_FILE, serializeRecentsFile(entries));
}

/**
 * Loads the strip for a vault, migrating a legacy `localStorage` list on the
 * first read. Entries whose file is gone drop out — except virtual tabs, which
 * have no file to check.
 */
export async function loadRecents(adapter: IVaultAdapter, vaultPath: string, now = Date.now()): Promise<string[]> {
  let entries = await readEntries(adapter);
  const legacyKey = legacyRecentsKey(vaultPath);
  const legacyRaw = typeof localStorage !== "undefined" ? localStorage.getItem(legacyKey) : null;
  if (legacyRaw) {
    // Only when the file has nothing yet: a file that already exists is the
    // newer truth, and merging two orderings would invent an order neither
    // side had.
    if (entries.length === 0) {
      try {
        const paths: unknown = JSON.parse(legacyRaw);
        if (Array.isArray(paths)) {
          // Oldest first so the push order reproduces the stored MRU order.
          for (const p of [...paths].reverse()) {
            if (typeof p === "string") entries = pushRecentEntry(entries, p, now);
          }
          await writeEntries(adapter, entries);
        }
      } catch {
        /* unreadable legacy value — the strip simply starts empty */
      }
    }
    try {
      localStorage.removeItem(legacyKey);
    } catch {
      /* private mode / no storage */
    }
  }

  const out: string[] = [];
  for (const e of entries) {
    if (isVirtualPath(e.path)) {
      out.push(e.path);
      continue;
    }
    // A note the user renamed or deleted stops being offered rather than
    // opening into nothing.
    try {
      if (await adapter.exists(e.path)) out.push(e.path);
    } catch {
      /* cannot tell — keep it rather than lose it */
      out.push(e.path);
    }
  }
  return out.slice(0, RECENTS_MAX);
}

/** Moves `path` to the front and persists. Returns the new list. */
export async function pushRecent(adapter: IVaultAdapter, path: string, now = Date.now()): Promise<string[]> {
  const entries = pushRecentEntry(await readEntries(adapter), path, now);
  await writeEntries(adapter, entries);
  return entries.map((e) => e.path);
}

/** Removes `path` ("forget this entry") and persists. Returns the new list. */
export async function forgetRecent(adapter: IVaultAdapter, path: string): Promise<string[]> {
  const entries = dropRecentEntry(await readEntries(adapter), path);
  await writeEntries(adapter, entries);
  return entries.map((e) => e.path);
}
