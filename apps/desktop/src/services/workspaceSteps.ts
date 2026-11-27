import { isCalledOffError } from "@plainva/core";
import { stepInterrupted, stepNotRun } from "@plainva/ui";

/**
 * The steps on a vault's workspace that stop its sync first — activating,
 * locking, resuming, restoring, lifting and decommissioning — in one order
 * (`withSyncStopped`):
 *
 * 1. the step takes the vault's sync for its whole length (`take`, see
 *    `syncGate.ts`): no start of it runs meanwhile, also not one that still
 *    waited for the folder, and on every way out — an error included — the
 *    sync is given back and starts again;
 * 2. the sync stops within the close's deadline (`stopSyncForStep`); a cycle
 *    that does not end in time is left, and the vault opens anew ("renewed");
 * 3. every handle the step uses comes from the very runtime the step was
 *    begun on (`runtime()`) — the one on screen when it took the sync, or,
 *    after "renewed", the one its own reopen opened — never from what the
 *    caller held before, and never from a runtime another reload opened
 *    meanwhile: after "renewed" the old runtime is called off and refuses
 *    every write. Where that runtime is not on screen any more — the window
 *    left the vault, another reload replaced it, or it did not open again —
 *    the step fails, says so, and changes nothing.
 */

/** What a step reaches the vault's runtime through. */
export interface StepPorts<R> {
  /** Takes the vault's sync for the step; the returned function gives it back (and the sync starts again). */
  take(): () => void;
  /** Stops the sync within the deadline; "renewed": the vault was opened anew, `runtime()` is the new one. */
  stopSync(): Promise<"same" | "renewed">;
  /** The step's runtime, while it is on screen; throws where it is not (`stepNotRun`). */
  runtime(): R;
  /**
   * The step's runtime gets nothing of its sync back: from here on the step
   * tears down what that sync works on (the workspace), and the vault opens
   * anew — or, where that fails, stays without its sync.
   */
  retire(): void;
  /**
   * What a failure of the step's work is said as: a call refused because the
   * runtime was called off while the step ran — the vault was closed — is
   * that the step did not finish (`stepInterrupted`), never a raw error.
   */
  failed(error: unknown): unknown;
}

/**
 * The ports of a step on the vault at `path`, from the shell's own parts:
 * `current()` is the runtime as the last load left it (`runtimeRef`) with
 * that load (one per load), or null — never a fallback to what the step's
 * caller held. The step keeps the load it began on; its stop reopens the
 * vault only through `step.reopen`, which opens anew only the step's own
 * runtime (`mine`) and makes the load it opened the step's.
 */
export function createStepPorts<R>(parts: {
  vault: string;
  take(): () => void;
  /**
   * Stops the sync. `mine`: whether the runtime on screen is still the
   * step's; `reopen(load)`: opens the vault anew with `load` — only where it
   * is (one another reload replaced is not left for the step) — and makes the
   * load that opened the step's from there on.
   */
  stop(step: { mine(): boolean; reopen(load: () => Promise<boolean | void>): Promise<void> }): Promise<"same" | "renewed">;
  current(): { load: AbortSignal; runtime: R } | null;
  retire(load: AbortSignal): void;
}): StepPorts<R> {
  let mine: AbortSignal | null = null;
  return {
    take: () => {
      mine = parts.current()?.load ?? null;
      return parts.take();
    },
    stopSync: () => {
      const own = () => mine !== null && parts.current()?.load === mine;
      return parts.stop({
        mine: own,
        reopen: async (load) => {
          if (!own()) return;
          const before = parts.current()?.load ?? null;
          // Only a load this reopen opened is the step's (review B2, round 7, H4): where the vault was loading
          // already, `loadVault` skips the call (false) and what comes is another load's — the step did not run.
          const opened = await load();
          const now = parts.current()?.load ?? null;
          mine = opened !== false && now !== null && now !== before && !now.aborted ? now : null;
        },
      });
    },
    runtime: () => {
      const now = parts.current();
      if (now && mine !== null && now.load === mine) return now.runtime;
      throw stepNotRun(parts.vault);
    },
    retire: () => {
      if (mine) parts.retire(mine);
    },
    failed: (error) => (isCalledOffError(error) ? stepInterrupted(parts.vault) : error),
  };
}

export async function withSyncStopped<R, T>(ports: StepPorts<R>, run: (on: R) => Promise<T>): Promise<T> {
  const giveBack = ports.take();
  try {
    await ports.stopSync();
    const on = ports.runtime();
    try {
      return await run(on);
    } catch (error) {
      throw ports.failed(error);
    }
  } finally {
    giveBack();
  }
}

/**
 * Leaving the workspace — decommissioning it, or lifting its encryption: the
 * workspace's local state goes, the vault notes what the folder is now
 * through the runtime's own lowest link (`markDeparted`), and the vault opens
 * anew without the workspace. Without a runtime of the vault nothing of it
 * is torn down.
 */
export async function leaveWorkspace<R extends { belowChain: unknown }>(
  ports: StepPorts<R>,
  steps: { tearDown(on: R): Promise<void>; markDeparted(belowChain: NonNullable<R["belowChain"]>): Promise<void>; reopen(): Promise<void> },
): Promise<void> {
  await withSyncStopped(ports, async (on) => {
    if (!on.belowChain) throw new Error("workspace-no-connection");
    // The teardown begins: nothing of the workspace's sync starts again on this runtime — a reconcile or a worker the
    // step stopped would run anew once the sync is given back, on a workspace half gone. Whether the vault then opens
    // anew or not.
    ports.retire();
    try {
      await steps.tearDown(on);
      await steps.markDeparted(on.belowChain as NonNullable<R["belowChain"]>);
    } catch (error) {
      // The vault opens anew instead (its load sees the workspace as far as it is gone), and the failure is said by
      // the caller. An open that fails says so on the vault itself (its load's error); the runtime torn down gets
      // its sync back either way never (`retire` above).
      await steps.reopen();
      throw error;
    }
    await steps.reopen();
  });
}

/**
 * Locking the workspace: closed for every app from the moment the lock
 * begins, while the sync still drains with the keys; undone where the sync
 * could not be stopped or no runtime of the vault is left to lock.
 */
export async function lockWorkspaceStep<R>(
  ports: StepPorts<R>,
  steps: { begin(): { undo(): void }; lock(on: R): Promise<void>; reopen(): Promise<void> },
): Promise<void> {
  const giveBack = ports.take();
  try {
    const lock = steps.begin();
    let on: R;
    try {
      await ports.stopSync();
      on = ports.runtime();
    } catch (error) {
      lock.undo();
      throw error;
    }
    try {
      await steps.lock(on);
    } catch (error) {
      throw ports.failed(error);
    }
    await steps.reopen();
  } finally {
    giveBack();
  }
}

/**
 * In a teardown that reads what it can and goes on: a call refused because
 * the runtime was called off is not "nothing to read" — it ends the teardown
 * there, before anything of the keychain goes, and the step says it did not
 * finish (`failed`). Any other failure is passed by (the caller reports it).
 */
export function rethrowCalledOff(error: unknown): void {
  if (isCalledOffError(error)) throw error;
}
