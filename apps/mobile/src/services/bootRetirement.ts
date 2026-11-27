/**
 * What becomes of a boot that a switch, a reload or a delete stops
 * (`vaultService.ts`, `retireBoot`).
 *
 * A boot that has its answer already is handed back as it is: its vault is
 * open, its index runs, and the caller decides what to do with it. A boot
 * still running is called off — its index's signal stops the scan, answers
 * every read of it at once and lets it write nothing more
 * (`VaultIndexerOptions.scanSignal`) — and given a moment. Whatever it brings
 * after that is closed, in time or late, and never handed back: a vault
 * whose index was called off and left open — a switch that failed afterwards
 * and resumed it, a reload waiting behind someone's input — ran its sync and
 * took edits with an index that refused every write. The caller boots the
 * vault anew when it is to stay, with an index of its own.
 */
export interface RetirableVault {
  dispose(): Promise<void>;
}

export async function retiredBoot<V extends RetirableVault>(
  pending: Promise<V>,
  settled: boolean,
  callOff: () => void,
  waitMs: number,
  /**
   * A retired start is still a runtime at its vault until it has closed: told
   * the closing (`left`, which resolves to the vault once it is closed, or
   * rejects when the start opened nothing), the caller parks its end, and the
   * next start of the vault waits for it.
   */
  leaving: (left: Promise<V>) => void = () => {},
): Promise<V | null> {
  if (settled) return pending.catch(() => null);
  callOff();
  const late = Symbol("late");
  const outcome = await Promise.race([
    pending.catch(() => null),
    new Promise<typeof late>((resolve) => setTimeout(() => resolve(late), waitMs)),
  ]);
  if (outcome === late) {
    const left = pending.then(async (vault) => {
      await vault.dispose().catch(() => {});
      return vault;
    });
    left.catch(() => {});
    leaving(left);
    return null;
  }
  if (outcome) {
    const left = outcome.dispose().catch(() => {}).then(() => outcome);
    leaving(left);
    await left;
  }
  return null;
}
