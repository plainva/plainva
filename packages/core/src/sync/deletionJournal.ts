/**
 * Deletion journal (feedback round 2026-09-01, P1).
 *
 * The problem it ends: a deletion the user confirmed on device A never reached
 * device B as an INTENT — B only saw "these files are missing from the remote
 * listing", which is exactly what a broken listing looks like, so its pull-side
 * guard held the files, kept them locally and uploaded them again. The
 * confirmed deletion came back on every device.
 *
 * The journal carries the intent. It is a small sideband file under
 * `.plainva/sync/` — like settings, secrets, keyfile and comments it travels
 * outside the queue/reconcile/merge path and is written through the RAW vault
 * adapter (never the conflict-aware one: that would create `sync_state` rows and
 * `.CONFLICT` copies for a file that is not a note). Every device merges the
 * remote copy into its own before it reconciles, so a path listed here is an
 * EXPLAINED absence: it is mirrored, and the mass-deletion guard on either side
 * does not count it. What the journal does not know about stays exactly as
 * guarded as before.
 *
 * It is a message, not an archive: entries older than the retention window are
 * dropped on every load and merge. Paths are stored in plaintext because the
 * remote listing already carries every path in plaintext — the content
 * decorator (EncryptingSyncTarget) seals bytes, not names — so the journal
 * reveals nothing the listing did not.
 */
import type { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { ISyncTarget } from "./ISyncTarget.js";
import { DELETIONS_SYNC_PATH } from "../settingsSync/paths.js";

/** Entries older than this are forgotten on load/merge (plan P1: 90 days). */
export const DELETION_JOURNAL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const FORMAT = "plainva-deletions";
const VERSION = 1;

export interface PathDeletionEntry {
  kind: "path";
  /** Vault-relative, forward slashes, no trailing slash. A folder covers its children. */
  path: string;
  /** Wall-clock ms of the confirmation on the deleting device. */
  deletedAt: number;
  deviceId: string;
}

/** A provider task whose note the user deleted (and whose provider copy followed). */
export interface TaskDeletionEntry {
  kind: "task";
  uid: string;
  list: string;
  provider?: string;
  identity?: string;
  deletedAt: number;
  deviceId: string;
}

export type DeletionJournalEntry = PathDeletionEntry | TaskDeletionEntry;

export interface TaskDeletionKey {
  uid: string;
  list: string;
  provider?: string;
  identity?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function normalizeJournalPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").replace(/^\/+/, "");
}

function entryKey(e: DeletionJournalEntry): string {
  return e.kind === "path"
    ? `path:${e.path}`
    : `task:${e.provider ?? ""}|${e.identity ?? ""}|${e.list}|${e.uid}`;
}

function isEntry(v: unknown): v is DeletionJournalEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  if (typeof e.deletedAt !== "number" || !Number.isFinite(e.deletedAt)) return false;
  if (typeof e.deviceId !== "string") return false;
  if (e.kind === "path") return typeof e.path === "string" && e.path.length > 0;
  if (e.kind === "task") return typeof e.uid === "string" && typeof e.list === "string";
  return false;
}

/** Tolerant parse: anything that is not a journal yields no entries (never throws). */
export function parseDeletionJournal(text: string | null | undefined): DeletionJournalEntry[] {
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const doc = parsed as { format?: unknown; entries?: unknown };
  if (!doc || doc.format !== FORMAT || !Array.isArray(doc.entries)) return [];
  const out: DeletionJournalEntry[] = [];
  for (const raw of doc.entries) {
    if (!isEntry(raw)) continue;
    if (raw.kind === "path") {
      const path = normalizeJournalPath(raw.path);
      if (!path) continue;
      out.push({ kind: "path", path, deletedAt: raw.deletedAt, deviceId: raw.deviceId });
    } else {
      out.push({
        kind: "task",
        uid: raw.uid,
        list: raw.list,
        ...(raw.provider ? { provider: raw.provider } : {}),
        ...(raw.identity ? { identity: raw.identity } : {}),
        deletedAt: raw.deletedAt,
        deviceId: raw.deviceId,
      });
    }
  }
  return out;
}

/** Union by identity; the newer `deletedAt` wins for the same path/task. */
export function mergeDeletionEntries(
  ...lists: ReadonlyArray<ReadonlyArray<DeletionJournalEntry>>
): DeletionJournalEntry[] {
  const byKey = new Map<string, DeletionJournalEntry>();
  for (const list of lists) {
    for (const e of list) {
      const k = entryKey(e);
      const prev = byKey.get(k);
      if (!prev || e.deletedAt > prev.deletedAt) byKey.set(k, e);
    }
  }
  return [...byKey.values()].sort((a, b) => a.deletedAt - b.deletedAt || entryKey(a).localeCompare(entryKey(b)));
}

export function pruneDeletionEntries(
  entries: ReadonlyArray<DeletionJournalEntry>,
  now: number,
  retentionMs: number = DELETION_JOURNAL_RETENTION_MS
): DeletionJournalEntry[] {
  const cutoff = now - retentionMs;
  return entries.filter((e) => e.deletedAt >= cutoff);
}

export function serializeDeletionJournal(entries: ReadonlyArray<DeletionJournalEntry>): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, entries }, null, 2) + "\n";
}

/** True when `entry` covers `path` (same path, or `entry.path` is an ancestor folder). */
export function pathEntryCovers(entry: PathDeletionEntry, path: string): boolean {
  return path === entry.path || path.startsWith(entry.path + "/");
}

export function taskEntryMatches(entry: TaskDeletionEntry, key: TaskDeletionKey): boolean {
  if (entry.uid !== key.uid || entry.list !== key.list) return false;
  if (entry.provider && key.provider && entry.provider !== key.provider) return false;
  if (entry.identity && key.identity && entry.identity !== key.identity) return false;
  return true;
}

export interface DeletionJournalOptions {
  now?: () => number;
  retentionMs?: number;
}

/**
 * The per-vault journal: a local file the hosts append confirmed deletions to,
 * merged with its remote twin at the start of every sync cycle.
 */
export class DeletionJournal {
  private entries: DeletionJournalEntry[] = [];
  private loaded = false;
  private readonly now: () => number;
  private readonly retentionMs: number;

  constructor(
    /** RAW adapter (the worker's own), never the queueing/conflict-aware chain. */
    private readonly vault: IVaultAdapter,
    private readonly deviceId: string,
    options: DeletionJournalOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now());
    this.retentionMs = options.retentionMs ?? DELETION_JOURNAL_RETENTION_MS;
  }

  /** Reads the local file once; later calls are no-ops. Safe to call repeatedly. */
  async load(): Promise<void> {
    if (this.loaded) return;
    let text: string | null = null;
    try {
      if (await this.vault.exists(DELETIONS_SYNC_PATH)) text = await this.vault.readTextFile(DELETIONS_SYNC_PATH);
    } catch (e) {
      console.warn("[DeletionJournal] could not read the local journal; starting empty", e);
    }
    this.entries = pruneDeletionEntries(parseDeletionJournal(text), this.now(), this.retentionMs);
    this.loaded = true;
  }

  /** Snapshot of the current entries (already pruned). */
  list(): ReadonlyArray<DeletionJournalEntry> {
    return this.entries;
  }

  /** Records deletions the user confirmed here. A folder path covers its children. */
  async recordPaths(paths: ReadonlyArray<string>): Promise<void> {
    await this.load();
    const at = this.now();
    const fresh: PathDeletionEntry[] = [];
    for (const p of paths) {
      const path = normalizeJournalPath(p);
      if (!path || path.startsWith(".plainva")) continue;
      fresh.push({ kind: "path", path, deletedAt: at, deviceId: this.deviceId });
    }
    if (fresh.length === 0) return;
    await this.adopt(mergeDeletionEntries(this.entries, fresh));
  }

  /** Records a provider task whose note was deleted here and whose provider copy followed. */
  async recordTask(key: TaskDeletionKey): Promise<void> {
    await this.load();
    const entry: TaskDeletionEntry = {
      kind: "task",
      uid: key.uid,
      list: key.list,
      ...(key.provider ? { provider: key.provider } : {}),
      ...(key.identity ? { identity: key.identity } : {}),
      deletedAt: this.now(),
      deviceId: this.deviceId,
    };
    await this.adopt(mergeDeletionEntries(this.entries, [entry]));
  }

  /**
   * The entry that explains why `path` is gone — if any. `since` (ms) lets the
   * caller ignore an entry older than its own last confirmation of the file: a
   * note deleted, recreated and confirmed again is not explained by the old entry.
   */
  explainsPath(path: string, since: number | null = null): PathDeletionEntry | null {
    const p = normalizeJournalPath(path);
    let best: PathDeletionEntry | null = null;
    for (const e of this.entries) {
      if (e.kind !== "path" || !pathEntryCovers(e, p)) continue;
      if (since !== null && e.deletedAt < since) continue;
      if (!best || e.deletedAt > best.deletedAt) best = e;
    }
    return best;
  }

  findTask(key: TaskDeletionKey): TaskDeletionEntry | null {
    for (const e of this.entries) {
      if (e.kind === "task" && taskEntryMatches(e, key)) return e;
    }
    return null;
  }

  /**
   * Merges the remote journal into the local one and publishes the union when
   * it differs from what the remote holds. Errors propagate — the worker wraps
   * the call so a journal hiccup never stops the file sync (the local journal
   * still counts).
   */
  async sync(target: ISyncTarget): Promise<void> {
    await this.load();
    const remoteBytes = await target.download(DELETIONS_SYNC_PATH);
    const remoteText = remoteBytes ? decoder.decode(remoteBytes as BufferSource) : null;
    const remote = parseDeletionJournal(remoteText);
    const merged = pruneDeletionEntries(mergeDeletionEntries(this.entries, remote), this.now(), this.retentionMs);
    const mergedText = serializeDeletionJournal(merged);
    const localChanged = mergedText !== serializeDeletionJournal(this.entries);
    if (localChanged) await this.adopt(merged);
    const remoteNormalized = serializeDeletionJournal(pruneDeletionEntries(remote, this.now(), this.retentionMs));
    if (merged.length > 0 && mergedText !== remoteNormalized) {
      await target.push({
        id: 0,
        file_path: DELETIONS_SYNC_PATH,
        operation: "write",
        content: encoder.encode(mergedText),
        retry_count: 0,
        next_retry_at: 0,
        queued_at: 0,
      });
    }
  }

  private async adopt(entries: DeletionJournalEntry[]): Promise<void> {
    this.entries = entries;
    await this.vault.writeTextFile(DELETIONS_SYNC_PATH, serializeDeletionJournal(entries));
  }
}
