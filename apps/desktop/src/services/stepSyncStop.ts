import { waitWithDeadline } from "@plainva/ui";
import type { VaultCallOff } from "@plainva/core";
import { noteVaultTeardown } from "./vaultTeardown";

/** What `stopSyncForStep` works with: the shell's own parts of the vault on screen. */
export interface StepSyncStop {
  path: string;
  /** The vault's name for the notices. */
  vault: string;
  worker: { stop(): void; stopAndDrain(): Promise<void> } | null;
  fence: VaultCallOff | null;
  /** The worker it left is no longer the runtime's (the reload's close does not wait for it again). */
  forgetWorker(): void;
  /** Opens the vault anew: a reload, which closes the old runtime in the close's order (`closeVaultRuntime`). */
  reopen(): Promise<void>;
}

/**
 * Stops the vault's sync for a step that then works on the vault — the
 * security wizard, locking, restoring or lifting a workspace — within the
 * close's deadline (texts 2 and 5), never without end. A cycle that does not
 * end in time is left, and the vault opens anew — its sync stays with the
 * step, which took it (`takeVaultSync`) — (`reopen`, a reload): that reload closes the old runtime the way every
 * close does — drafts, the saves, the index, then what is owed to the sync
 * queue, and only then the call-off — so no save is overtaken; the cycle it
 * left is parked like a close, and the new runtime opens once that cycle and
 * the old runtime have ended (`noteVaultTeardown`, text 7). Never two
 * runtimes at one vault. The step goes on with the new runtime and gives
 * the sync back on its way out.
 *
 * Answers whether the vault was opened anew.
 */
export async function stopSyncForStep(parts: StepSyncStop): Promise<"same" | "renewed"> {
  const { path, vault, worker, fence } = parts;
  if (!worker) return "same";
  worker.stop();
  const drain = worker.stopAndDrain();
  if ((await waitWithDeadline(drain, () => ({ kind: "sync", vault }))) === "done") return "same";
  // The cycle it left: the vault's next open waits until it has ended and the runtime is through.
  noteVaultTeardown(path, (async () => {
    await drain.catch(() => undefined);
    await fence?.ended();
  })());
  // The reload's close does not wait for that cycle a second time.
  parts.forgetWorker();
  // The step has taken the vault's sync (`takeVaultSync`): the reopened vault starts none until the step gives it back.
  await parts.reopen();
  return "renewed";
}
