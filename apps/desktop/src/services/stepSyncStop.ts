import { reportingTo, waitWithDeadline } from "@plainva/ui";
import type { VaultCallOff } from "@plainva/core";
import { noteVaultTeardown } from "./vaultTeardown";

/** What `stopSyncForStep` works with: the shell's own parts of the vault on screen. */
export interface StepSyncStop {
  path: string;
  /** The vault's name for the notices. */
  vault: string;
  worker: { stop(): void; stopAndDrain(): Promise<void> } | null;
  owed: { flush(): Promise<void> } | null;
  fence: VaultCallOff | null;
  /** The worker it left is no longer the runtime's (the reload's close does not wait for it again). */
  forgetWorker(): void;
  /** Holds the sync of the vault's next load (`syncHeldRef`): the step's own reload starts it. */
  holdSync(): void;
  /** Opens the vault anew. */
  reopen(): Promise<void>;
}

/**
 * Stops the vault's sync for a step that then works on the vault — the
 * security wizard, locking, restoring or lifting a workspace — within the
 * close's deadline (texts 2 and 5), never without end. A cycle that does not
 * end in time is left: what is owed to the sync queue gets its last attempt,
 * the runtime is called off, and the vault opens anew with its sync held; the
 * step goes on with the new runtime and starts the sync with its own reload.
 * Never two runtimes at one vault: the new one opens once the old one and the
 * cycle it left have ended (`noteVaultTeardown`, text 7).
 *
 * Answers whether the vault was opened anew.
 */
export async function stopSyncForStep(parts: StepSyncStop): Promise<"same" | "renewed"> {
  const { path, vault, worker, owed, fence } = parts;
  if (!worker) return "same";
  worker.stop();
  const drain = worker.stopAndDrain();
  if ((await waitWithDeadline(drain, () => ({ kind: "sync", vault }))) === "done") return "same";
  const calledOff = (owed?.flush() ?? Promise.resolve()).catch(reportingTo("sync:owed-before-call-off")).then(() => fence?.callOff());
  // The cycle it left is parked like a close: the vault opens anew once that cycle and the runtime have ended.
  noteVaultTeardown(path, (async () => {
    await drain.catch(() => undefined);
    await calledOff;
    await fence?.ended();
  })());
  // Nothing of the old runtime writes any more before the vault opens anew (bounded: the queue's last attempt is).
  await calledOff;
  parts.forgetWorker();
  parts.holdSync();
  await parts.reopen();
  return "renewed";
}
