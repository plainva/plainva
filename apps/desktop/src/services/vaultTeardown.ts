/**
 * In-flight vault teardowns (stage D).
 *
 * Closing a vault now DRAINS instead of merely stopping: pending writes settle
 * and a running sync cycle finishes before the runtime counts as gone. That
 * takes time, and the provider that starts it is unmounting — a React cleanup
 * cannot await. So the promise is parked here, and whoever builds a runtime for
 * the same vault waits for it first.
 *
 * Without that wait, draining would have created the very race it prevents:
 * close a vault and reopen it a moment later (a window switching back and
 * forth is one click) and the new worker would start while the old cycle was
 * still writing. All runtimes live in the owner window, so one module-level map
 * covers the whole app.
 */

const inFlight = new Map<string, Promise<void>>();

/**
 * One key per folder, however its path is written: separators, a trailing
 * one, and the case — the desktop's file systems mostly ignore it, and two
 * spellings of one folder are one vault. Where two different folders differ
 * only in case (a case-sensitive file system), the next open waits needlessly
 * for the other's close: safe, and short.
 */
export function vaultPlaceKey(vaultPath: string): string {
  let key = vaultPath.replace(/\\/g, "/");
  while (key.length > 1 && key.endsWith("/")) key = key.slice(0, -1);
  return key.toLowerCase();
}

/** Parks a teardown so the next open of this vault can wait for it. */
export function noteVaultTeardown(vaultPath: string, run: Promise<void>): void {
  // Another teardown of the same vault may still be running - a load that was
  // called off parks one too (loadStarts.ts) - so the next open waits for both.
  const key = vaultPlaceKey(vaultPath);
  const before = inFlight.get(key);
  const settled = Promise.all([before, run.catch(() => undefined)]).then(() => {
    if (inFlight.get(key) === settled) inFlight.delete(key);
  });
  inFlight.set(key, settled);
}

/** Resolves once no teardown of this vault is running (immediately if none is). */
export async function awaitVaultTeardown(vaultPath: string): Promise<void> {
  const run = inFlight.get(vaultPlaceKey(vaultPath));
  if (run) await run;
}

/** Tests only. */
export function pendingVaultTeardowns(): string[] {
  return [...inFlight.keys()];
}

/** Tests only. */
export function resetVaultTeardownsForTests(): void {
  inFlight.clear();
}
