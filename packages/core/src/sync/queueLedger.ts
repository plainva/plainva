import type { DeletionConfirmation } from "../vault/IVaultAdapter.js";
import type { OwedStructure } from "../vault/owedQueueEntries.js";

/**
 * What a vault's chain hands the sync queue (`QueueingVaultAdapter`): the four
 * kinds of entry, after the change is on disk. `SyncQueue` is one; the
 * `QueueLedger` below is the other.
 */
export interface SyncQueueEntries {
  queueWrite(path: string): Promise<void>;
  queueDeletePaths(paths: ReadonlyArray<string>, confirmation?: DeletionConfirmation): Promise<void>;
  queueRename(oldPath: string, newPath: string): Promise<void>;
  queueMkdir(path: string): Promise<void>;
  /** The sync queue answers for entries still owed (`SyncQueue.consultOwedEntries`); a ledger has no worker to tell. */
  consultOwedEntries?(owed: OwedStructure): () => void;
}

/** One entry of the ledger, in the order the changes were made. */
export type QueueLedgerEntry =
  | { op: "write"; path: string }
  | { op: "delete"; paths: string[]; confirmed?: true }
  | { op: "rename"; from: string; to: string }
  | { op: "mkdir"; path: string };

/** Where a ledger is kept: a file outside the vault, written whole and atomically. */
export interface QueueLedgerStore {
  /** The ledger's text, or null when there is none. */
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
  /** Already gone is fine; a ledger left in place must throw. */
  clear(): Promise<void>;
}

const VERSION = 1;

/**
 * The sync queue of a vault whose database did not open (stability plan R5,
 * finding S6).
 *
 * The phone opens a vault whose index database fails: without search, tags,
 * databases and the sync, but with the notes. The sync queue lives in that
 * database, so a note deleted, renamed or created meanwhile was queued
 * nowhere. Once the database opened again, the next index pass found an
 * edited note by its hash, but a deletion or a rename only reached the queue
 * when the sync happened to be switched on before the pass came by — the
 * remote kept the deleted note and the old name of a renamed one, and the
 * other devices with it.
 *
 * The ledger takes the queue's place in the chain for that time: the same
 * entries `QueueingVaultAdapter` would have queued, in their order, in a file
 * outside the vault. The next start with the database hands them to the real
 * queue (`replayQueueLedger`) before anything reads it — before the index
 * pass and before the sync starts.
 *
 * Kill points: an entry reaches the file before the write that made it is
 * done (QueueingVaultAdapter fails the write otherwise, as for the real queue).
 * A start that ends while it replays does it again next time: writes and
 * deletions are taken once by the queue, a rename is skipped when the sync
 * queue already holds it (`hasQueuedRename`).
 */
export class QueueLedger implements SyncQueueEntries {
  private entries: QueueLedgerEntry[] | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly store: QueueLedgerStore) {}

  queueWrite(path: string): Promise<void> {
    return this.append({ op: "write", path });
  }

  queueDeletePaths(paths: ReadonlyArray<string>, confirmation?: DeletionConfirmation): Promise<void> {
    return this.append({ op: "delete", paths: [...paths], ...(confirmation?.confirmed ? { confirmed: true as const } : {}) });
  }

  queueRename(oldPath: string, newPath: string): Promise<void> {
    return this.append({ op: "rename", from: oldPath, to: newPath });
  }

  queueMkdir(path: string): Promise<void> {
    return this.append({ op: "mkdir", path });
  }

  /** One append at a time, each on top of what the file held: a second start without the database adds to the first one's ledger. */
  private append(entry: QueueLedgerEntry): Promise<void> {
    const run = this.chain.then(async () => {
      const entries = this.entries ?? parseQueueLedger(await this.store.load());
      const next = [...entries, entry];
      await this.store.save(serializeQueueLedger(next));
      this.entries = next;
    });
    this.chain = run.catch(() => {
      // silent: the failure is the caller's (the write that queued it fails); the next append reads the file again.
      this.entries = null;
    });
    return run;
  }
}

export function serializeQueueLedger(entries: readonly QueueLedgerEntry[]): string {
  return JSON.stringify({ version: VERSION, entries });
}

/** The entries of a ledger's text; a text this version cannot read is refused, never taken for an empty ledger. */
export function parseQueueLedger(text: string | null): QueueLedgerEntry[] {
  if (text === null || text === "") return [];
  const parsed = JSON.parse(text) as { version?: unknown; entries?: unknown };
  if (parsed.version !== VERSION || !Array.isArray(parsed.entries)) {
    throw new Error(`queue ledger: unknown format (version ${String(parsed.version)})`);
  }
  return parsed.entries.map((raw) => {
    const e = raw as Record<string, unknown>;
    const str = (v: unknown) => {
      if (typeof v !== "string" || v === "") throw new Error("queue ledger: an entry without a path");
      return v;
    };
    switch (e.op) {
      case "write": return { op: "write", path: str(e.path) };
      case "mkdir": return { op: "mkdir", path: str(e.path) };
      case "rename": return { op: "rename", from: str(e.from), to: str(e.to) };
      case "delete": {
        if (!Array.isArray(e.paths) || e.paths.length === 0) throw new Error("queue ledger: a deletion without paths");
        return { op: "delete", paths: e.paths.map(str), ...(e.confirmed === true ? { confirmed: true as const } : {}) };
      }
      default: throw new Error(`queue ledger: unknown entry "${String(e.op)}"`);
    }
  });
}

/** The real queue, as the replay needs it. */
export interface QueueLedgerTarget extends SyncQueueEntries {
  /** Whether the queue already holds this rename (a replay that ended early is done again). */
  hasQueuedRename?(from: string, to: string): Promise<boolean>;
  /**
   * Whether the path is on disk now. The ledger says what happened then; the
   * disk says whether it still holds: a version that knows no ledger may have
   * opened the vault in between and brought a deleted note back, and a
   * deletion queued for a file that is there would take it from every device.
   */
  exists(path: string): Promise<boolean>;
}

/**
 * Hands a ledger's entries to the real queue, in their order, and removes the
 * ledger. Answers how many entries it handed over. A ledger it cannot read
 * stays where it is and the failure goes to the caller: dropping it would be
 * losing exactly what it is there to keep.
 */
export async function replayQueueLedger(store: QueueLedgerStore, target: QueueLedgerTarget): Promise<number> {
  const entries = parseQueueLedger(await store.load());
  if (entries.length === 0) return 0;
  for (const entry of entries) {
    switch (entry.op) {
      case "write": await target.queueWrite(entry.path); break;
      case "mkdir": await target.queueMkdir(entry.path); break;
      case "delete": {
        const gone: string[] = [];
        for (const path of entry.paths) if (!(await target.exists(path))) gone.push(path);
        if (gone.length > 0) await target.queueDeletePaths(gone, entry.confirmed ? { confirmed: true } : undefined);
        break;
      }
      case "rename":
        // Not one whose old name is back on disk. The new name may be gone: a
        // later entry of the ledger (a deletion, another rename) says where it went.
        if (await target.hasQueuedRename?.(entry.from, entry.to)) break;
        if (await target.exists(entry.from)) break;
        await target.queueRename(entry.from, entry.to);
        break;
    }
  }
  await store.clear();
  return entries.length;
}
