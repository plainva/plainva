import type { SqlStatements } from "../db/IDatabaseAdapter.js";
import { isTwinSpelling } from "./pathIdentity.js";
import { isInternalPath } from "../vault/internalPath.js";
import { outsideWorkspaceNamespaceSql } from "../workspace/path.js";

/**
 * What the index decided and committed, and the queue never heard of
 * (stability plan R22).
 *
 * The index tells the host what it found — a file that went, one another
 * program changed — once its transaction is through, and the host queues the
 * remote deletion or the upload in a transaction of its own. An app that ends
 * in between leaves the decision in the index and nothing in the queue: the
 * next pass finds the index as the last one left it and has nothing to say.
 *
 * So the index writes down what it decided, in the transaction that decides
 * it, and the first cycle of the next sync queues what is written down:
 *
 *  - a deletion: `index_removed`, one row per file the index removed AND
 *    reports (`VaultIndexer.markRemoved`). Queueing the deletion takes the row
 *    off (`SyncQueue.queueDeletePaths`, the workspace's `enqueue`); this sweep
 *    takes off every row it has dealt with. It rests on that record and on
 *    nothing inferred: a path that merely has a sync row and no index row is
 *    not owed anything — the index never held it (an internal folder, a
 *    sidecar), or the app keeps the sync row on purpose (a held mass
 *    deletion's restore, a mirrored remote deletion, a forgotten vault). A
 *    build without the record (v0.8.7) removes rows unmarked: what it left
 *    owed stays as inert as it always was;
 *  - a change: the row's `local_ahead`, set in the transaction that writes its
 *    new hash (performance plan L4). The plain sync's sweep has queued those
 *    since L4 (`SyncQueue.enqueueLocalOnlyFiles`); the encrypted workspace's
 *    queue never looked at the mark nor took it off. It does now: an entry
 *    that commits the content the row holds takes it off (`consumedMarks` in
 *    workspace/state.ts), and this sweep offers each marked change once.
 *
 * The hosts run the sweep at the first cycle of their sync, through the same
 * handlers the index's callbacks use (a workspace's permission check
 * included). Whether a file is gone is asked of the disk last (`stillGone`),
 * and only while the vault itself is there before and after the looks: a
 * folder that is away answers "missing" for every file in it, and those
 * marks wait for the next start.
 */

/** The table of the index's reported removals (db/Schema.ts). */
export const INDEX_REMOVED_TABLE = "index_removed";

/**
 * Whether a change or a deletion of `path` is queued for the remote at all:
 * the one rule of both hosts' queueing and of this sweep (review F3). Internal
 * paths go by whole segments (`isInternalPath`): `notes.plainva.md` is a note.
 * Conflict copies stay on the device.
 */
export function queuesForTheRemote(path: string): boolean {
  return !isInternalPath(path) && !path.includes(".CONFLICT");
}

/** A path the sync never carries, or carries only as a device's own. */
function notForTheRemote(path: string): boolean {
  return !queuesForTheRemote(path) || isTwinSpelling(path) || path === ".pvws" || path.startsWith(".pvws/");
}

/**
 * A deletion or a rename AWAY from the path is queued, for it or for a folder
 * it lies in (review F2). A queued write settles nothing: the engine retires
 * a write whose file is gone, and the deletion would never be sent.
 */
const QUEUED_PLAIN = `EXISTS (
  SELECT 1 FROM offline_queue q
   WHERE q.operation IN ('delete', 'rename')
     AND (q.file_path = r.path OR substr(r.path, 1, length(q.file_path) + 1) = q.file_path || '/'))`;
const deletionQueuedInWorkspace = (column: string) => `EXISTS (
  SELECT 1 FROM workspace_queue q
   WHERE q.operation IN ('delete', 'rename')
     AND (q.path = ${column} OR substr(${column}, 1, length(q.path) + 1) = q.path || '/'))`;
/** Anything is queued for the path or a folder around it: a marked change is then owed nothing more. */
const queuedWorkspace = (column: string) => `EXISTS (
  SELECT 1 FROM workspace_queue q
   WHERE q.path = ${column} OR q.new_path = ${column}
      OR substr(${column}, 1, length(q.path) + 1) = q.path || '/'
      OR (q.new_path IS NOT NULL AND substr(${column}, 1, length(q.new_path) + 1) = q.new_path || '/'))`;

interface Mark {
  path: string;
  /** The remote still has the file (plain: a sync row with a remote version; workspace: a live object). */
  remote: number;
  /** The index holds the path again. */
  indexed: number;
  /** Its deletion, or a rename away from it, is queued. */
  queued: number;
}

async function marks(db: SqlStatements, workspace: boolean): Promise<Mark[]> {
  const remote = workspace
    ? `EXISTS (SELECT 1 FROM workspace_object o WHERE o.path = r.path AND o.deleted = 0 AND o.current_revision_id IS NOT NULL AND o.content_kind <> 'directory')`
    : `EXISTS (SELECT 1 FROM sync_state s WHERE s.path = r.path AND s.remote_etag IS NOT NULL)`;
  return db.query<Mark>(
    `SELECT r.path AS path,
            CASE WHEN ${remote} THEN 1 ELSE 0 END AS remote,
            CASE WHEN EXISTS (SELECT 1 FROM files f WHERE f.path = r.path) THEN 1 ELSE 0 END AS indexed,
            CASE WHEN ${workspace ? deletionQueuedInWorkspace("r.path") : QUEUED_PLAIN} THEN 1 ELSE 0 END AS queued
       FROM ${INDEX_REMOVED_TABLE} r
      ORDER BY r.path`,
  );
}

async function clearMarks(db: SqlStatements, paths: readonly string[]): Promise<void> {
  for (const path of paths) await db.execute(`DELETE FROM ${INDEX_REMOVED_TABLE} WHERE path = ?`, [path]);
}

/** Encrypted workspace: the marked changes its queue is owed, before anything is asked. */
export async function workspaceChangesOwed(db: SqlStatements): Promise<string[]> {
  const rows = await db.query<{ path: string }>(
    `SELECT f.path FROM files f
       LEFT JOIN workspace_object o ON o.path = f.path AND o.deleted = 0
      WHERE f.sync_state = 'local_ahead'
        AND f.path NOT LIKE '%.CONFLICT%' AND ${outsideWorkspaceNamespaceSql("f.path")}
        AND NOT ${queuedWorkspace("f.path")}
        AND (o.object_id IS NULL OR o.plaintext_sha256 IS NULL OR f.sha256 IS NULL OR o.plaintext_sha256 <> f.sha256)
      ORDER BY f.path`,
  );
  return rows.map((row) => row.path).filter((path) => !notForTheRemote(path));
}

/**
 * The `local_ahead` rows of an encrypted workspace whose content IS the
 * object's current one: nothing is owed for them, and the mark goes (an index
 * that marked them before the queue took marks off, R22).
 */
export async function clearWorkspaceMarksAlreadyUp(db: SqlStatements): Promise<void> {
  await db.execute(
    `UPDATE files SET sync_state = 'synced'
      WHERE sync_state = 'local_ahead'
        AND EXISTS (SELECT 1 FROM workspace_object o WHERE o.path = files.path AND o.deleted = 0
                     AND o.plaintext_sha256 IS NOT NULL AND o.plaintext_sha256 = files.sha256)
        AND NOT EXISTS (SELECT 1 FROM workspace_queue q WHERE q.path = files.path OR q.new_path = files.path)`,
  );
}

/**
 * What a host's queueing did with a path (review F1): `queued` — the entry is
 * made; `refused` — nothing is owed (a workspace's policy refused it and kept
 * a fork, the path is not for the remote, the file is back); `failed` — the
 * entry could not be made, and whatever recorded the debt must keep it.
 */
export type OwedOutcome = "queued" | "refused" | "failed";

export interface OwedSweepHandlers {
  /** The vault's own folder is reachable: without it, every file looks gone. */
  vaultIsThere: () => Promise<boolean>;
  /** The file is not on disk. A look that fails answers false. */
  stillGone: (path: string) => Promise<boolean>;
  /** Queues the deletion the way the index's `onLocalFileDeleted` does, and says what came of it. */
  remove: (path: string) => Promise<OwedOutcome>;
  /**
   * Queues several deletions in one transaction, where the host can (the
   * plain queue): a cycle that reads the queue meanwhile sees all of them or
   * none, so the mass-deletion question is never asked of a slice (review F4).
   */
  removeAll?: (paths: readonly string[]) => Promise<OwedOutcome>;
  /** Queues the change the way the index's `onExternalModification` does (workspace only). */
  write?: (path: string) => Promise<OwedOutcome>;
}

/** What a sweep queued, for the diagnostics. Counts only. */
export interface OwedSweepReport {
  deletions: number;
  writes: number;
  /** Entries that could not be made: their marks wait for the next start. */
  failed: number;
}

/**
 * The marked deletions: each is handed to the host once, or found settled
 * (its deletion queued, indexed again, nothing left on the remote, not for
 * the remote at all, the file back on disk). A mark goes when its deletion is
 * queued or refused; one whose entry failed waits for the next start. While
 * the vault's folder is away nothing is decided and every mark waits.
 */
async function sweepRemovals(db: SqlStatements, workspace: boolean, h: OwedSweepHandlers): Promise<{ queued: number; failed: number }> {
  const none = { queued: 0, failed: 0 };
  const all = await marks(db, workspace);
  if (all.length === 0) return none;
  const settled: string[] = [];
  const candidates: string[] = [];
  for (const mark of all) {
    if (notForTheRemote(mark.path) || Number(mark.indexed) || !Number(mark.remote) || Number(mark.queued)) settled.push(mark.path);
    else candidates.push(mark.path);
  }
  await clearMarks(db, settled);
  if (candidates.length === 0 || !(await h.vaultIsThere())) return none;
  const gone: string[] = [];
  const back: string[] = [];
  for (const path of candidates) ((await h.stillGone(path).catch(() => false)) ? gone : back).push(path);
  // Asked once more after the looks: a share that dropped in between proves nothing.
  if (!(await h.vaultIsThere())) return none;
  // A file that is back is the next pass's to judge, not a deletion.
  await clearMarks(db, back);
  if (gone.length === 0) return none;
  if (h.removeAll) {
    const outcome = await h.removeAll(gone).catch((): OwedOutcome => "failed");
    if (outcome === "failed") return { queued: 0, failed: gone.length };
    await clearMarks(db, gone);
    return { queued: outcome === "queued" ? gone.length : 0, failed: 0 };
  }
  let queued = 0;
  let failed = 0;
  for (const path of gone) {
    const outcome = await h.remove(path).catch((): OwedOutcome => "failed");
    if (outcome === "failed") {
      failed += 1;
      continue;
    }
    if (outcome === "queued") queued += 1;
    await clearMarks(db, [path]);
  }
  return { queued, failed };
}

/** Plain sync: queues the deletions the index marked and an ended app never queued. */
export async function sweepPlainOwed(db: SqlStatements, h: OwedSweepHandlers): Promise<OwedSweepReport> {
  const removals = await sweepRemovals(db, false, h);
  return { deletions: removals.queued, writes: 0, failed: removals.failed };
}

/**
 * Encrypted workspace: queues the changes and deletions its queue is owed.
 * A change is offered until it is queued or refused: where the workspace's
 * policy refused it (and kept the file as a fork), its mark goes, so that no
 * later start makes another fork of it (review M2); where the entry failed,
 * the mark is the change's only record and stays (review F1b).
 */
export async function sweepWorkspaceOwed(db: SqlStatements, h: OwedSweepHandlers): Promise<OwedSweepReport> {
  await clearWorkspaceMarksAlreadyUp(db);
  let writes = 0;
  let failed = 0;
  if (h.write) {
    for (const path of await workspaceChangesOwed(db)) {
      const outcome = await h.write(path).catch((): OwedOutcome => "failed");
      if (outcome === "queued") writes += 1;
      else if (outcome === "failed") failed += 1;
      else await db.execute(`UPDATE files SET sync_state = 'synced' WHERE path = ? AND sync_state = 'local_ahead'`, [path]);
    }
  }
  const removals = await sweepRemovals(db, true, h);
  return { deletions: removals.queued, writes, failed: failed + removals.failed };
}

/** The queues a host hands its local changes to. */
export interface LocalQueueingTargets {
  /** Whether this vault queues local changes at all (a sync target, its files running). */
  queuesChanges: () => boolean;
  /** An encrypted workspace's permission check, where it has one; false refuses and keeps a fork. */
  permission?: () => ((path: string, isChange: boolean) => Promise<boolean>) | null;
  /** The encrypted workspace's queue, where the vault is one. */
  workspace?: () => { enqueue(operation: "write" | "delete", path: string): Promise<unknown> } | null;
  /** The plain sync's queue. */
  plain?: () => { queueWrite(path: string): Promise<unknown>; queueDeletePaths(paths: readonly string[]): Promise<unknown> } | null;
  /** Without a sync target: what a deletion still does (the desktop drops the stale sync row). */
  withoutTarget?: (path: string) => Promise<void>;
  /**
   * Makes an entry: the desktop calls it, the phone hands it to its announcer
   * (which tries twice). `stillDue` is asked before each attempt where given.
   * Answers `not-due` where the entry was no longer due, `failed` where it
   * could not be made.
   */
  run?: (entry: () => Promise<unknown>, stillDue?: () => Promise<boolean>) => Promise<"queued" | "not-due" | "failed">;
  /** For a deletion: the file is still gone. */
  stillGone?: (path: string) => Promise<boolean>;
  /** Told after an entry is made. */
  onQueued?: () => void;
  /** Told when an entry or a permission check fails. */
  onError?: (what: string, error: unknown) => void;
}

export interface LocalQueueing {
  deletion(path: string): Promise<OwedOutcome>;
  deletions(paths: readonly string[]): Promise<OwedOutcome>;
  change(path: string): Promise<OwedOutcome>;
}

/**
 * How a host queues a file another program changed or removed — the index's
 * callbacks and the sweep of what an ended app left owed both come here, in
 * both shells — and what it answers (review F1). Nothing is swallowed into a
 * "done": a failed permission check or entry answers `failed`.
 */
export function createLocalQueueing(t: LocalQueueingTargets): LocalQueueing {
  const direct = async (entry: () => Promise<unknown>, stillDue?: () => Promise<boolean>): Promise<"queued" | "not-due" | "failed"> => {
    if (stillDue && !(await stillDue().catch(() => true))) return "not-due";
    try {
      await entry();
      return "queued";
    } catch (error) {
      t.onError?.("entry", error);
      return "failed";
    }
  };
  const run = t.run ?? direct;
  const asked = async (path: string, isChange: boolean): Promise<boolean | "failed"> => {
    const check = t.permission?.() ?? null;
    if (!check) return true;
    try {
      return await check(path, isChange);
    } catch (error) {
      t.onError?.("permission", error);
      return "failed";
    }
  };
  const answer = (made: "queued" | "not-due" | "failed"): OwedOutcome => {
    if (made === "queued") t.onQueued?.();
    return made === "queued" ? "queued" : made === "not-due" ? "refused" : "failed";
  };
  const stillDue = (path: string) => (t.stillGone ? () => t.stillGone!(path) : undefined);
  const deletion = async (path: string): Promise<OwedOutcome> => {
    if (!queuesForTheRemote(path)) return "refused";
    if (!t.queuesChanges()) {
      await t.withoutTarget?.(path).catch(() => {});
      return "refused";
    }
    const allowed = await asked(path, false);
    if (allowed !== true) return allowed === "failed" ? "failed" : "refused";
    const workspace = t.workspace?.() ?? null;
    if (workspace) return answer(await run(() => workspace.enqueue("delete", path), stillDue(path)));
    const plain = t.plain?.() ?? null;
    if (!plain) return "failed";
    return answer(await run(() => plain.queueDeletePaths([path]), stillDue(path)));
  };
  return {
    deletion,
    async deletions(paths) {
      const workspace = t.workspace?.() ?? null;
      const plain = t.plain?.() ?? null;
      const ours = paths.filter(queuesForTheRemote);
      if (t.permission?.() || workspace || !plain || !t.queuesChanges() || ours.length !== paths.length) {
        // One by one: a permission check per path, or nothing to batch.
        let worst: OwedOutcome = "refused";
        for (const path of paths) {
          const outcome = await deletion(path);
          if (outcome === "failed") return "failed";
          if (outcome === "queued") worst = "queued";
        }
        return worst;
      }
      // One transaction for all of them (review F4); the queue skips a path asked again.
      return answer(await run(() => plain.queueDeletePaths(paths)));
    },
    async change(path) {
      if (!queuesForTheRemote(path) || !t.queuesChanges()) return "refused";
      const allowed = await asked(path, true);
      if (allowed !== true) return allowed === "failed" ? "failed" : "refused";
      const workspace = t.workspace?.() ?? null;
      if (workspace) return answer(await run(() => workspace.enqueue("write", path)));
      const plain = t.plain?.() ?? null;
      if (!plain) return "failed";
      return answer(await run(() => plain.queueWrite(path)));
    },
  };
}
