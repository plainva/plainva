import i18n from "@plainva/ui/i18n";
import { toast } from "@plainva/ui";

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
 * 3. every handle the step uses comes from the runtime on screen at that
 *    moment (`runtime()`), never from what the caller held before: after
 *    "renewed" the old runtime is called off and refuses every write. Where
 *    there is no runtime of the vault — the window left it, or it did not
 *    open again — the step fails, says so, and changes nothing.
 */

/** What a step reaches the vault's runtime through. */
export interface StepPorts<R> {
  /** Takes the vault's sync for the step; the returned function gives it back (and the sync starts again). */
  take(): () => void;
  /** Stops the sync within the deadline; "renewed": the vault was opened anew, `runtime()` is the new one. */
  stopSync(): Promise<"same" | "renewed">;
  /** The runtime on screen now; throws where there is none of this vault. */
  runtime(): R;
}

/** A step found no runtime of its vault: nothing of it ran. */
export class StepNotRunError extends Error {
  constructor(vault: string) {
    super(i18n.t("closing.stepNotRun", { vault }));
    this.name = "StepNotRunError";
  }
}

/**
 * The ports of a step on the vault at `path`, from the shell's own parts:
 * `current()` is the runtime as the last load left it (`runtimeRef`) or null
 * — never a fallback to what the step's caller held.
 */
export function createStepPorts<R>(parts: {
  vault: string;
  take(): () => void;
  stop(): Promise<"same" | "renewed">;
  current(): R | null;
}): StepPorts<R> {
  return {
    take: parts.take,
    stopSync: parts.stop,
    runtime: () => {
      const now = parts.current();
      if (now) return now;
      const error = new StepNotRunError(parts.vault);
      toast.warning(error.message);
      throw error;
    },
  };
}

export async function withSyncStopped<R, T>(ports: StepPorts<R>, run: (on: R) => Promise<T>): Promise<T> {
  const giveBack = ports.take();
  try {
    await ports.stopSync();
    return await run(ports.runtime());
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
    await steps.tearDown(on);
    await steps.markDeparted(on.belowChain as NonNullable<R["belowChain"]>);
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
    await steps.lock(on);
    await steps.reopen();
  } finally {
    giveBack();
  }
}
