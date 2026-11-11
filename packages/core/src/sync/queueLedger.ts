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
  /** Moves the ledger out of the way under another name, kept for a bug report; never read again. */
  setAside(): Promise<void>;
}

const VERSION = 2;

/** The ledger's file: the remote it was written for, and its entries. */
interface LedgerFile {
  binding: string;
  entries: QueueLedgerEntry[];
}

/** A ledger text this version cannot read: never taken for an empty one. */
export class UnreadableQueueLedgerError extends Error {
  constructor(reason: string) {
    super(`queue ledger: ${reason}`);
    this.name = "UnreadableQueueLedgerError";
  }
}

/**
 * The sync queue of a vault whose database did not open (stability plan R5,
 * finding S6).
 *
 * The phone opens a vault whose index database fails: without search, tags,
 * databases and the sync, but with the notes. The sync queue lives in that
 * database, so a note deleted, renamed or created meanwhile was queued
 * nowhere, and a deletion or a rename never reached the other devices.
 *
 * The ledger takes the queue's place in the chain for that time: the same
 * entries `QueueingVaultAdapter` would have queued, in their order, in a file
 * outside the vault, bound to the remote the vault synced with when they were
 * made (`binding`: provider and root folder). The sync's first clean cycle of
 * a later start hands them over (`replayQueueLedger`) — after its pull, so
 * that a file another device changed meanwhile has come back first and is
 * not deleted on a decision made before that change.
 *
 * Every append reads the file afresh: an appender never writes back entries
 * that a replay has handed over and removed. A write adds nothing where the
 * ledger already holds one for that path with no structural entry after it,
 * so the file stays as long as the list of things changed, however long the
 * outage lasts.
 *
 * A failure to record is never the failure of the save that made it: the
 * note is on disk, and refusing it would lose more than the entry. It goes to
 * `onFailure`, which the shell says once.
 */
export class QueueLedger implements SyncQueueEntries {
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: QueueLedgerStore,
    private readonly binding: string,
    private readonly options: { onFailure?: (error: unknown) => void } = {},
  ) {}

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

  /** One append at a time, each on top of what the file holds now. */
  private append(entry: QueueLedgerEntry): Promise<void> {
    const run = this.chain.then(async () => {
      try {
        let file: LedgerFile;
        try {
          file = parseLedgerFile(await this.store.load()) ?? { binding: this.binding, entries: [] };
        } catch (error) {
          if (!(error instanceof UnreadableQueueLedgerError)) throw error;
          // Kept aside for a bug report, and a new ledger begins: what it held
          // cannot be read, and refusing every later entry would lose those too.
          await this.store.setAside();
          this.options.onFailure?.(error);
          file = { binding: this.binding, entries: [] };
        }
        // A ledger of another remote (the sync was moved to another folder
        // while the database stayed closed) is never mixed with this one.
        if (file.binding !== this.binding) {
          await this.store.setAside();
          file = { binding: this.binding, entries: [] };
        }
        if (addsNothing(file.entries, entry)) return;
        await this.store.save(serializeLedgerFile({ binding: file.binding, entries: [...file.entries, entry] }));
      } catch (error) {
        this.options.onFailure?.(error);
      }
    });
    this.chain = run;
    return run;
  }
}

function touches(entry: QueueLedgerEntry, path: string): boolean {
  const under = (p: string) => p === path || path.startsWith(`${p}/`) || p.startsWith(`${path}/`);
  switch (entry.op) {
    case "write":
    case "mkdir": return entry.path === path;
    case "delete": return entry.paths.some(under);
    case "rename": return under(entry.from) || under(entry.to);
  }
}

/** A write for a path the ledger already holds a write for, with nothing structural about the path after it. */
function addsNothing(entries: readonly QueueLedgerEntry[], entry: QueueLedgerEntry): boolean {
  if (entry.op !== "write" && entry.op !== "mkdir") return false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const earlier = entries[i]!;
    if (!touches(earlier, entry.path)) continue;
    return earlier.op === entry.op;
  }
  return false;
}

export function serializeQueueLedger(binding: string, entries: readonly QueueLedgerEntry[]): string {
  return serializeLedgerFile({ binding, entries: [...entries] });
}

function serializeLedgerFile(file: LedgerFile): string {
  return JSON.stringify({ version: VERSION, binding: file.binding, entries: file.entries });
}

function parseLedgerFile(text: string | null): LedgerFile | null {
  if (text === null || text === "") return null;
  let parsed: { version?: unknown; binding?: unknown; entries?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new UnreadableQueueLedgerError("not JSON (a torn write, or another program's file)");
  }
  if (parsed.version !== VERSION || typeof parsed.binding !== "string" || !Array.isArray(parsed.entries)) {
    throw new UnreadableQueueLedgerError(`unknown format (version ${String(parsed.version)})`);
  }
  const str = (v: unknown) => {
    if (typeof v !== "string" || v === "") throw new UnreadableQueueLedgerError("an entry without a path");
    return v;
  };
  const entries = parsed.entries.map((raw): QueueLedgerEntry => {
    const e = raw as Record<string, unknown>;
    switch (e.op) {
      case "write": return { op: "write", path: str(e.path) };
      case "mkdir": return { op: "mkdir", path: str(e.path) };
      case "rename": return { op: "rename", from: str(e.from), to: str(e.to) };
      case "delete": {
        if (!Array.isArray(e.paths) || e.paths.length === 0) throw new UnreadableQueueLedgerError("a deletion without paths");
        return { op: "delete", paths: e.paths.map(str), ...(e.confirmed === true ? { confirmed: true as const } : {}) };
      }
      default: throw new UnreadableQueueLedgerError(`unknown entry "${String(e.op)}"`);
    }
  });
  return { binding: parsed.binding, entries };
}

/** The entries of a ledger's text (tests and the shells' look at what a ledger holds). */
export function parseQueueLedger(text: string | null): { binding: string; entries: QueueLedgerEntry[] } | null {
  return parseLedgerFile(text);
}

/**
 * The paths a ledger still owes a deletion or a rename for. The shell's index
 * pass leaves them alone until the ledger is handed over: it would otherwise
 * queue the deletion itself, before the pull could bring back a version
 * another device made meanwhile. An unreadable ledger owes nothing.
 */
export function heldLedgerPaths(text: string | null): Set<string> {
  const held = new Set<string>();
  let file: LedgerFile | null;
  try {
    file = parseLedgerFile(text);
  } catch {
    return held;
  }
  for (const entry of file?.entries ?? []) {
    if (entry.op === "delete") for (const path of entry.paths) held.add(path);
    if (entry.op === "rename") { held.add(entry.from); held.add(entry.to); }
  }
  return held;
}

/** The real queue, as the replay needs it. */
export interface QueueLedgerTarget extends SyncQueueEntries {
  /**
   * Whether the queue can decide now. An encrypted workspace whose runtime is
   * not loaded cannot tell an allowed change from a denied one: the replay
   * stops, and the ledger stays for a start that can.
   */
  ready?(): boolean;
  /** Whether the queue already holds this rename (a replay that stopped is done again). */
  hasQueuedRename?(from: string, to: string): Promise<boolean>;
  /** Whether the remote is known to hold this path (its sync state names a remote version). */
  knownRemote?(path: string): Promise<boolean>;
  /** Whether the path is on disk now, after the pull of this cycle. */
  exists(path: string): Promise<boolean>;
}

export interface QueueLedgerReplay {
  /** Entries handed to the queue. */
  handed: number;
  /** Deletions and renames not sent: the file is on disk again (the pull brought another device's version back), so they stand on a decision the remote has moved past. */
  skipped: string[];
  /** Entries taken off the ledger whose hand-over then failed: not sent, and said. */
  dropped: QueueLedgerEntry[];
  /** The ledger could not be used (unreadable, or written for another remote) and was set aside. */
  setAside?: "unreadable" | "other-remote";
  /** The failure that stopped the replay; what was not reached stays on the ledger. */
  stoppedBy?: unknown;
}

/** How many entries one step takes off the ledger before it hands them over. */
export const LEDGER_REPLAY_STEP = 50;

/** The entry as the queue should get it now, or null when it is not to be sent. */
async function decide(entry: QueueLedgerEntry, target: QueueLedgerTarget, skipped: string[]): Promise<QueueLedgerEntry | null> {
  switch (entry.op) {
    case "write":
    case "mkdir":
      return entry;
    case "delete": {
      const gone: string[] = [];
      for (const path of entry.paths) {
        if (await target.exists(path)) skipped.push(path);
        else gone.push(path);
      }
      return gone.length > 0 ? { ...entry, paths: gone } : null;
    }
    case "rename": {
      if (await target.hasQueuedRename?.(entry.from, entry.to)) return null;
      // The old name is back: another device changed it meanwhile, and the pull brought that version.
      if (await target.exists(entry.from)) {
        skipped.push(entry.from);
        return null;
      }
      // The new name exists on the remote already (another device made it): no
      // move over it. The old name goes; the file under the new name was met by
      // the pull as any file both sides have.
      if (await target.knownRemote?.(entry.to)) return { op: "delete", paths: [entry.from] };
      return entry;
    }
  }
}

async function hand(entry: QueueLedgerEntry, target: QueueLedgerTarget): Promise<void> {
  switch (entry.op) {
    case "write": return target.queueWrite(entry.path);
    case "mkdir": return target.queueMkdir(entry.path);
    case "delete": return target.queueDeletePaths(entry.paths, entry.confirmed ? { confirmed: true } : undefined);
    case "rename": return target.queueRename(entry.from, entry.to);
  }
}

/**
 * Hands a ledger's entries to the real queue, in their order: called by the
 * sync after the pull of its first clean cycle, before it queues what the
 * index owes.
 *
 * An entry is handed over at most once, whatever fails and however often the
 * app starts: each step first takes its entries off the ledger — durably, in
 * the file — and only then hands them to the queue. A step whose shortened
 * ledger cannot be written hands nothing and stops; one whose hand-over
 * fails has its entries reported as dropped (`dropped`), never kept for a
 * second hand-over that could delete a file restored meanwhile. A ledger
 * handed over completely is empty before it is removed, so one whose removal
 * fails is never replayed.
 *
 * A ledger written for another remote (`binding`) or one this version cannot
 * read is set aside, never replayed into the remote that is there now.
 */
export async function replayQueueLedger(
  store: QueueLedgerStore,
  target: QueueLedgerTarget,
  options: { binding: string; step?: number },
): Promise<QueueLedgerReplay> {
  const result: QueueLedgerReplay = { handed: 0, skipped: [], dropped: [] };
  let file: LedgerFile | null;
  try {
    file = parseLedgerFile(await store.load());
  } catch (error) {
    if (!(error instanceof UnreadableQueueLedgerError)) throw error;
    await store.setAside();
    return { ...result, setAside: "unreadable" };
  }
  if (!file) return result;
  if (file.binding !== options.binding) {
    await store.setAside();
    return { ...result, setAside: "other-remote" };
  }
  if (target.ready && !target.ready()) {
    return { ...result, stoppedBy: new Error("the queue cannot decide yet (the workspace is not open)") };
  }
  const step = Math.max(1, options.step ?? LEDGER_REPLAY_STEP);
  let remaining = file.entries;
  try {
    while (remaining.length > 0) {
      const batch = remaining.slice(0, step);
      // Decided before anything leaves the ledger: a check that fails stops here with nothing handed.
      const decided: QueueLedgerEntry[] = [];
      for (const entry of batch) {
        const now = await decide(entry, target, result.skipped);
        if (now) decided.push(now);
      }
      const rest = remaining.slice(batch.length);
      // Off the ledger first: from here on, these are never handed again.
      await store.save(serializeLedgerFile({ binding: file.binding, entries: rest }));
      remaining = rest;
      for (let i = 0; i < decided.length; i++) {
        try {
          await hand(decided[i]!, target);
          result.handed++;
        } catch (error) {
          result.dropped.push(...decided.slice(i));
          throw error;
        }
      }
    }
  } catch (error) {
    return { ...result, stoppedBy: error };
  }
  try {
    await store.clear();
  } catch {
    // silent: the ledger is empty on disk already; an empty ledger is never replayed.
  }
  return result;
}
