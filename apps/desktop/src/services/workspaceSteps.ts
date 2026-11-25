/**
 * The steps on a vault's workspace that stop its sync first — activating,
 * locking, resuming, restoring, lifting and decommissioning — in one order
 * (`withSyncStopped`):
 *
 * 1. the sync stops within the close's deadline (`stopSyncForStep`); a cycle
 *    that does not end in time is left, and the vault opens anew with its
 *    sync held ("renewed");
 * 2. every handle the step uses — adapter, state store, target — comes from
 *    the runtime on screen at that moment (`runtime()`), never from what the
 *    caller held before: after "renewed" the old runtime is called off and
 *    refuses every write;
 * 3. the hold of the sync ends on every way out — the step's own reopen, an
 *    error, a refusal (`endHold`): the vault never stays without its sync.
 */

/** What a step reaches the vault's runtime through. */
export interface StepPorts<R> {
  /** Stops the sync within the deadline; "renewed": the vault was opened anew, `runtime()` is the new one. */
  stopSync(): Promise<"same" | "renewed">;
  /** The runtime on screen now. */
  runtime(): R;
  /** Ends the hold of the sync where it still stands (the step left without opening the vault anew): the sync starts. */
  endHold(): void;
}

export async function withSyncStopped<R, T>(ports: StepPorts<R>, run: (on: R) => Promise<T>): Promise<T> {
  try {
    await ports.stopSync();
    return await run(ports.runtime());
  } finally {
    ports.endHold();
  }
}

/**
 * Leaving the workspace — decommissioning it, or lifting its encryption: the
 * workspace's local state goes, the vault notes what the folder is now
 * through the runtime's own lowest link (`markDeparted`), and the vault opens
 * anew without the workspace.
 */
export async function leaveWorkspace<R extends { belowChain: unknown }>(
  ports: StepPorts<R>,
  steps: { tearDown(on: R): Promise<void>; markDeparted(belowChain: NonNullable<R["belowChain"]>): Promise<void>; reopen(): Promise<void> },
): Promise<void> {
  await withSyncStopped(ports, async (on) => {
    await steps.tearDown(on);
    if (on.belowChain) await steps.markDeparted(on.belowChain as NonNullable<R["belowChain"]>);
    await steps.reopen();
  });
}

/**
 * Locking the workspace: closed for every app from the moment the lock
 * begins, while the sync still drains with the keys; undone only where the
 * sync could not be stopped.
 */
export async function lockWorkspaceStep<R>(
  ports: StepPorts<R>,
  steps: { begin(): { undo(): void }; lock(on: R): Promise<void>; reopen(): Promise<void> },
): Promise<void> {
  const lock = steps.begin();
  try {
    await ports.stopSync();
  } catch (error) {
    lock.undo();
    ports.endHold();
    throw error;
  }
  try {
    await steps.lock(ports.runtime());
    await steps.reopen();
  } finally {
    ports.endHold();
  }
}
