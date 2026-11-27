import type { DetachedSync } from "./syncService";

/**
 * The phone's sync as far as it is loaded (performance plan L5: the sync
 * loads with the first vault that syncs, not with the start). A close takes
 * the sync off its vault at once, synchronously, before it waits for
 * anything (`vaultService.settleBeforeClosing`) — which a module still
 * loading cannot be asked for. So the sync registers its detach here as its
 * module loads; before that nothing of it runs, and there is nothing to take
 * off.
 */
let loaded: { detachSync(): DetachedSync } | null = null;

export function registerLoadedSync(sync: { detachSync(): DetachedSync }): void {
  loaded = sync;
}

/** Takes the running sync off at once (`syncService.detachSync`), or answers that nothing ran. */
export function detachLoadedSync(): DetachedSync {
  return loaded?.detachSync() ?? { drain: async () => {}, place: null, running: false };
}
