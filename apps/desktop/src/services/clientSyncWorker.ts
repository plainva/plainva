import { getWindowBus } from "./windowBus";
import type { VaultSyncWorker } from "../contexts/VaultContext";

/**
 * The sync worker an auxiliary window gets (multi-window C3).
 *
 * There is exactly one worker per vault and it lives in the central window —
 * that is the whole point of the owner/client split, and the reason the sync
 * hardening of July still reasons about a single writer. So this is not a
 * worker: it is the client's END of the one that runs elsewhere.
 *
 * Without it a client's `syncWorker` stays null, and the shell reads that as
 * "this vault does not sync": the status bar says LOCAL for a vault that syncs,
 * the retry button never renders, and — the part that actually loses something
 * — a folder deleted in this window arrives at the owner with no record that a
 * human asked for it. The owner's mass-deletion guard then stops the cycle and
 * asks the CENTRAL window about deletions the user made over here, where the
 * question never appears.
 *
 * Three of the methods are honest no-ops rather than delegations:
 *
 * - `start`/`stop`/`stopAndDrain` are lifecycle. They are called where a vault
 *   is opened, switched or closed, and all three of those belong to the owner
 *   (plan E7). A client that could stop the worker would stop it for everyone.
 * - `listPendingOperations` feeds the queue view in the settings, and the
 *   settings open in the central window (C2). It returns an empty queue rather
 *   than throwing so that a future caller degrades instead of crashing.
 *
 * `fullResync` is deliberately absent: "reload vault" in a client already
 * travels to the owner through the `reindex` RPC, which runs the owner's own
 * full resync. Providing it here would run the cloud step twice.
 */
export function createClientSyncWorker(): VaultSyncWorker {
  const send = (what: "now" | "retry" | "note-deletions", paths?: string[]) => {
    void (async () => {
      try {
        const bus = await getWindowBus();
        await bus.request("sync-control", { what, ...(paths ? { paths } : {}) });
      } catch (e) {
        console.warn("[clientSyncWorker] the central window did not answer", e);
      }
    })();
  };

  return {
    start: () => {},
    stop: () => {},
    stopAndDrain: async () => {},
    triggerImmediate: () => send("now"),
    retryFailed: () => send("retry"),
    noteUserInitiatedDeletion: (paths) => send("note-deletions", paths),
    listPendingOperations: async () => ({ total: 0, items: [] }),
  };
}
