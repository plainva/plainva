import { replayQueueLedger, type IDatabaseAdapter, type IVaultAdapter, type PermissionedVaultAdapter, type QueueLedgerStore, type QueueLedgerTarget, type SqlWorkspaceStateStore, type SyncQueue } from "@plainva/core";
import { errorText, logDiagnostic, reportVisible } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * The queue a ledger's entries go to once the vault's database opens again
 * (stability plan R5, `QueueLedger`): the plain vault's sync queue as it is.
 */
export function plainLedgerTarget(queue: SyncQueue, db: IDatabaseAdapter, disk: Pick<IVaultAdapter, "exists">): QueueLedgerTarget {
  return {
    exists: (path) => disk.exists(path),
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
 * not allowed is kept beside the vault as a fork and never queued.
 */
export function workspaceLedgerTarget(permissioned: PermissionedVaultAdapter, state: SqlWorkspaceStateStore, disk: Pick<IVaultAdapter, "exists">): QueueLedgerTarget {
  return {
    exists: (path) => disk.exists(path),
    async queueWrite(path) {
      if (await permissioned.authorizeExternalChange(path, true)) await state.enqueue("write", path);
    },
    async queueDeletePaths(paths) {
      for (const path of paths) if (await permissioned.authorizeExternalChange(path, false)) await state.enqueue("delete", path);
    },
    async queueRename(from, to) {
      if (await permissioned.authorizeExternalChange(from, false) && await permissioned.authorizeExternalChange(to, true)) await state.enqueue("rename", from, to);
    },
    async queueMkdir(path) {
      await state.enqueue("mkdir", path);
    },
  };
}

/**
 * Hands the ledger over, before the index pass and the sync. A ledger that
 * cannot be handed over stays for the next start and is said: until then
 * what it holds does not reach the other devices.
 */
export async function replayVaultLedger(store: QueueLedgerStore, target: QueueLedgerTarget): Promise<void> {
  try {
    const handed = await replayQueueLedger(store, target);
    // Counts only, like every line of the export.
    if (handed > 0) logDiagnostic("sync", `${handed} change(s) made while the index database was closed handed to the sync queue`);
  } catch (error) {
    reportVisible("sync:ledger", error, i18n.t("errors.background.ledgerKept", { reason: errorText(error) }));
  }
}
