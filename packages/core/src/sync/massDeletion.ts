/**
 * The mass-deletion guard's rule, once for every queue that carries a
 * deletion to the other devices: the plain file sync (`SyncWorker`) and the
 * encrypted workspace (`EncryptedWorkspaceWorker`, release 0.9.0 A4 — until
 * then the workspace had no guard at all, and an emptied or unmounted vault
 * folder went out as one signed deletion per object).
 *
 * A local mass deletion — the vault folder emptied, moved or its drive
 * unmounted while the app knows the vault — floods the queue with deletions;
 * executing them would wipe every other copy. When more than MIN queued
 * deletions nobody confirmed ALSO exceed SHARE of what is synced, the worker
 * holds all of them until the person explicitly confirms (or discards) them.
 * Small, plausible deletions are never held, and neither is a deletion the
 * person confirmed in the app (`DeletionConfirmation.confirmed`).
 */
export const MASS_DELETE_MIN = 10;
export const MASS_DELETE_SHARE = 0.2;

/**
 * Drops paths that are covered by another path in the list acting as their
 * folder ancestor (and exact duplicates). A folder deletion enqueues the folder
 * AND one op per contained file; counting the children again inflated the
 * mass-deletion guard's share and tripped it on ordinary folder deletions.
 * O(n · depth) via ancestor-prefix probes against a set.
 */
export function dropCoveredDeletePaths(paths: string[]): string[] {
  const unique = [...new Set(paths)];
  const set = new Set(unique);
  return unique.filter((p) => {
    let idx = p.lastIndexOf("/");
    while (idx > 0) {
      if (set.has(p.substring(0, idx))) return false;
      idx = p.lastIndexOf("/", idx - 1);
    }
    return true;
  });
}

/**
 * Whether the unconfirmed deletions are a mass deletion: counted without the
 * paths a deleted folder already covers, against what is synced. The plain
 * sync's rule. Its queue gets a folder only from the app, together with one
 * entry per file in it (`QueueingVaultAdapter.deleteItem`); what vanished
 * outside the app reaches it file by file (`onLocalFileDeleted`), so its
 * paths are its files. The encrypted workspace counts files instead
 * (`vanishingFiles`).
 */
export function isMassDeletion(unconfirmedPaths: string[], syncedTotal: number): boolean {
  const unexplained = dropCoveredDeletePaths(unconfirmedPaths).length;
  return unexplained > MASS_DELETE_MIN && unexplained > syncedTotal * MASS_DELETE_SHARE;
}

/**
 * How many of `files` go with the deletions: a file named by one, or lying
 * in a folder named by one. The encrypted workspace keeps folders as objects
 * of their own, and its start-up reconcile queues a vanished folder next to
 * every file in it; counted by path, two emptied folders were two deletions
 * and fifty files went without a question (review of release 0.9.0 A4).
 * What disappears is the files.
 */
export function vanishingFiles(deletedPaths: readonly string[], files: readonly string[]): number {
  const deleted = new Set(deletedPaths);
  let count = 0;
  for (const file of files) {
    if (deleted.has(file)) { count += 1; continue; }
    for (let idx = file.lastIndexOf("/"); idx > 0; idx = file.lastIndexOf("/", idx - 1)) {
      if (deleted.has(file.substring(0, idx))) { count += 1; break; }
    }
  }
  return count;
}

/** The guard's rule for a count of files that go, against the files synced. */
export function isMassFileDeletion(vanishing: number, filesTotal: number): boolean {
  return vanishing > MASS_DELETE_MIN && vanishing > filesTotal * MASS_DELETE_SHARE;
}
