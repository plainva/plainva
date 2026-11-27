/**
 * The holds of a vault's sync, counted, by vault: every step that stops the
 * sync to work on the vault holds one of its own for its whole length — a
 * step on the workspace, the remote folder, a sign-in — and gives it back on
 * every way out; so does a reload that waits behind someone's input for the
 * runtime it is to replace, and a delete while it removes the vault. While
 * one is held, no start and no restart of that vault's sync does anything,
 * and the sync's status says it is paused; with the last release the sync
 * starts once, through the one start, on the vault's runtime open on screen
 * then (where none is open, the start after its boot does it). A hold is the
 * vault's, not a runtime's: it lasts the step, also across a switch away and
 * back — the step's own body may still reach the vault's folder.
 *
 * Apart from the sync (`syncService.ts`), which loads on demand: a transition
 * of the runtime on screen holds and asks synchronously, whether the sync has
 * loaded or not (performance plan L5). The sync tells this module what to do
 * at a hold and at the last release once it has loaded (`registerSyncHolds`);
 * before that, nothing of it runs that a hold or a release could change.
 */
const holds = new Map<string, number>();
const waiting = new Map<string, Array<() => void>>();
let told: { held(vaultId: string): void; released(vaultId: string): void } | null = null;

/** The sync's part: what a hold says, and what the last release starts. */
export function registerSyncHolds(sync: { held(vaultId: string): void; released(vaultId: string): void }): void {
  told = sync;
}

/** Whether something holds the vault's sync now. */
export function vaultSyncHeld(vaultId: string): boolean {
  return (holds.get(vaultId) ?? 0) > 0;
}

/** Holds the vault's sync; the returned function gives the hold back (once, however often it is called). */
export function holdVaultSync(vaultId: string): () => void {
  holds.set(vaultId, (holds.get(vaultId) ?? 0) + 1);
  told?.held(vaultId);
  let given = false;
  return () => {
    if (given) return;
    given = true;
    const left = (holds.get(vaultId) ?? 1) - 1;
    if (left > 0) {
      holds.set(vaultId, left);
      return;
    }
    holds.delete(vaultId);
    const waiters = waiting.get(vaultId) ?? [];
    waiting.delete(vaultId);
    for (const go of waiters) go();
    told?.released(vaultId);
  };
}

/** Resolves once nothing holds the vault's sync (at once where nothing does). */
export function syncReleased(vaultId: string): Promise<void> {
  if (!vaultSyncHeld(vaultId)) return Promise.resolve();
  return new Promise<void>((go) => waiting.set(vaultId, [...(waiting.get(vaultId) ?? []), go]));
}

/** Tests only: forgets every hold — one a test ends with must not hold the next test's sync. */
export function resetSyncHoldsForTests(): void {
  holds.clear();
  waiting.clear();
}
