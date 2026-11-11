import { replayQueueLedger, type IDatabaseAdapter, type IVaultAdapter, type PermissionedVaultAdapter, type QueueLedgerStore, type QueueLedgerTarget, type SqlWorkspaceStateStore, type SyncQueue } from "@plainva/core";
import { errorText, logDiagnostic, reportBackground, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * The queue a ledger's entries go to once the vault's database opens again
 * (stability plan R5, `QueueLedger`): the plain vault's sync queue as it is.
 */
export function plainLedgerTarget(queue: SyncQueue, db: IDatabaseAdapter, disk: Pick<IVaultAdapter, "exists">): QueueLedgerTarget {
  return {
    exists: (path) => disk.exists(path),
    knownRemote: async (path) =>
      !!(await db.queryOne<{ remote_etag: string | null }>("SELECT remote_etag FROM sync_state WHERE path = ? AND remote_etag IS NOT NULL", [path])),
    queueWrite: (path) => queue.queueWrite(path),
    queueDeletePaths: (paths, confirmation) => queue.queueDeletePaths(paths, confirmation),
    queueRename: (from, to) => queue.queueRename(from, to),
    queueMkdir: (path) => queue.queueMkdir(path),
    hasQueuedRename: async (from, to) =>
      !!(await db.queryOne<{ id: number }>(
        "SELECT id FROM offline_queue WHERE operation = 'rename' AND file_path = ? AND new_path = ? LIMIT 1",
        [from, to],
      )),
  };
}

/**
 * The encrypted workspace's queue. Without its database the phone wrote with
 * no permission check (the rules live in it): each entry is asked now, as a
 * change made outside the app is (`authorizeExternalChange`) — one that is
 * not allowed is kept beside the vault as a fork and never queued, once: it
 * leaves the ledger like any entry handed over. A workspace whose runtime is
 * not open (locked, not joined, its secret missing) cannot tell the two
 * apart: the ledger stays for a start that can (`ready`).
 */
export function workspaceLedgerTarget(
  permissioned: PermissionedVaultAdapter,
  state: SqlWorkspaceStateStore,
  disk: Pick<IVaultAdapter, "exists">,
  runtimeOpen: () => boolean,
  onDenied: (path: string) => void,
): QueueLedgerTarget {
  const allowed = async (path: string, exists: boolean) => {
    if (await permissioned.authorizeExternalChange(path, exists)) return true;
    onDenied(path);
    return false;
  };
  return {
    ready: runtimeOpen,
    exists: (path) => disk.exists(path),
    async queueWrite(path) {
      if (await allowed(path, true)) await state.enqueue("write", path);
    },
    async queueDeletePaths(paths) {
      for (const path of paths) if (await allowed(path, false)) await state.enqueue("delete", path);
    },
    async queueRename(from, to) {
      if (await allowed(from, false) && await allowed(to, true)) await state.enqueue("rename", from, to);
    },
    async queueMkdir(path) {
      await state.enqueue("mkdir", path);
    },
  };
}

/**
 * Hands the ledger over: called by the sync after the pull of its first clean
 * cycle, before it queues what the index owes (`syncService`). Whatever does
 * not go is said, with what it means for the other devices; the counts go
 * into the diagnostics, never a path.
 */
export async function replayVaultLedger(store: QueueLedgerStore, target: QueueLedgerTarget, binding: string): Promise<number> {
  let handed = 0;
  try {
    const result = await replayQueueLedger(store, target, { binding });
    handed = result.handed;
    if (handed > 0) logDiagnostic("sync", `${handed} change(s) made while the index database was closed handed to the sync queue`);
    if (result.setAside) {
      logDiagnostic("sync", `the queue ledger was set aside (${result.setAside}); nothing of it was sent`);
      toast.warning(i18n.t("errors.background.ledgerSetAside"));
    }
    if (result.skipped.length > 0) {
      logDiagnostic("sync", `${result.skipped.length} deletion(s) or rename(s) from the queue ledger not sent: the file came back with the pull`);
      toast.warning(i18n.t("errors.background.ledgerSkipped", { count: result.skipped.length }));
    }
    if (result.dropped.length > 0) {
      reportBackground("sync:ledger", result.stoppedBy);
      toast.error(i18n.t("errors.background.ledgerDropped", { count: result.dropped.length, reason: errorText(result.stoppedBy) }));
    } else if (result.stoppedBy) {
      reportBackground("sync:ledger", result.stoppedBy);
      toast.error(i18n.t("errors.background.ledgerKept", { reason: errorText(result.stoppedBy) }));
    }
  } catch (error) {
    // The ledger could not even be read: it stays, nothing of it was handed.
    reportBackground("sync:ledger", error);
    toast.error(i18n.t("errors.background.ledgerKept", { reason: errorText(error) }));
  }
  return handed;
}
