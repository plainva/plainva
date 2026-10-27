import type { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";

/**
 * Files the provider will never hand out here (device finding and review
 * 2026-10-27): Google Drive refuses the bytes of a file it flagged as abusive,
 * or of one with nothing to download. The sync skips such a file, names it and
 * goes on - and remembers it, next to the sync state of the vault, so that:
 *
 * - nothing uploads over it: not the local-only sweep, not a queued write,
 *   not a rename onto its name - the remote copy is the only one, and this
 *   device never had its bytes;
 * - it does not keep the vault on full listings: the cursor is adopted with
 *   it skipped, and the file alone is asked for again, spaced out;
 * - the status keeps naming it until a download succeeds, which clears it.
 *
 * Stored in the vault database's `meta` table, one row per path. A sync to
 * another folder starts without them (`SyncStateRepository.clearAll`).
 */
export interface UnsyncableEntry {
  path: string;
  /** The provider's reason, as it gave it. */
  reason: string;
  /** The remote marker the file had when it was refused; asked for again with it. */
  etag: string;
  /** Downloads refused so far. */
  attempts: number;
  /** Not asked for again before this time (ms). */
  retryAt: number;
}

export const UNSYNCABLE_KEY_PREFIX = "sync-unsyncable:v1:";

/** First retry after a minute, doubling, at most every six hours. */
const RETRY_FIRST_MS = 60_000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;

export function nextUnsyncableRetry(attempts: number, now: number): number {
  return now + Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.max(0, attempts - 1));
}

function decode(value: string): UnsyncableEntry | null {
  try {
    const entry = JSON.parse(value) as Partial<UnsyncableEntry>;
    if (typeof entry.path !== "string" || !entry.path) return null;
    return {
      path: entry.path,
      reason: typeof entry.reason === "string" ? entry.reason : "",
      etag: typeof entry.etag === "string" ? entry.etag : "",
      attempts: typeof entry.attempts === "number" ? entry.attempts : 1,
      retryAt: typeof entry.retryAt === "number" ? entry.retryAt : 0,
    };
  } catch {
    return null;
  }
}

export async function listUnsyncablePaths(db: IDatabaseAdapter): Promise<UnsyncableEntry[]> {
  const rows = await db.query<{ value: string }>("SELECT value FROM meta WHERE key LIKE ? ORDER BY key", [UNSYNCABLE_KEY_PREFIX + "%"]);
  return rows.map((row) => decode(row.value)).filter((entry): entry is UnsyncableEntry => entry !== null);
}

/** Records a refusal: a new entry, or one more attempt of a known one. */
export async function markUnsyncablePath(db: IDatabaseAdapter, path: string, reason: string, etag: string, now: number): Promise<UnsyncableEntry> {
  const row = await db.queryOne<{ value: string }>("SELECT value FROM meta WHERE key = ?", [UNSYNCABLE_KEY_PREFIX + path]);
  const known = row ? decode(row.value) : null;
  const attempts = (known?.attempts ?? 0) + 1;
  const entry: UnsyncableEntry = { path, reason, etag, attempts, retryAt: nextUnsyncableRetry(attempts, now) };
  await db.execute(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [UNSYNCABLE_KEY_PREFIX + path, JSON.stringify(entry)],
  );
  return entry;
}

export async function clearUnsyncablePath(db: IDatabaseAdapter, path: string): Promise<void> {
  await db.execute("DELETE FROM meta WHERE key = ?", [UNSYNCABLE_KEY_PREFIX + path]);
}

export async function clearAllUnsyncablePaths(db: IDatabaseAdapter): Promise<void> {
  await db.execute("DELETE FROM meta WHERE key LIKE ?", [UNSYNCABLE_KEY_PREFIX + "%"]);
}

/**
 * The name local content at an unsyncable path goes up under: a sibling that
 * says it is a conflicting copy and syncs like any note - never `.CONFLICT`,
 * which stays on the device.
 */
export function unsyncableCopyPath(path: string, now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "-");
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const split = dot > slash + 1 ? dot : path.length;
  return `${path.slice(0, split)} (conflict ${stamp})${path.slice(split)}`;
}
