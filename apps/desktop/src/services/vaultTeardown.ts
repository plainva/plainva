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

/** Parks a teardown so the next open of this vault can wait for it. */
export function noteVaultTeardown(vaultPath: string, run: Promise<void>): void {
  const settled = run.catch(() => undefined).then(() => {
    if (inFlight.get(vaultPath) === settled) inFlight.delete(vaultPath);
  });
  inFlight.set(vaultPath, settled);
}

/** Resolves once no teardown of this vault is running (immediately if none is). */
export async function awaitVaultTeardown(vaultPath: string): Promise<void> {
  const run = inFlight.get(vaultPath);
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
