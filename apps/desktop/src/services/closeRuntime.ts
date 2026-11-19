import { closeWaitNoteName, waitWithDeadline, type CloseWaitStep } from "@plainva/ui";
import type { VaultCallOff } from "@plainva/core";
import { flushDrafts, forgetDraftMemory } from "./draftJournal";
import { pendingWritePaths, settlePendingWrites } from "./pendingWrites";
import { noteVaultTeardown } from "./vaultTeardown";
import { vaultLabel } from "./vaultNames";

/** What of a vault's runtime is still running when it closes. */
export interface ClosingRuntime {
  path: string | null;
  worker: { stopAndDrain(): Promise<void> } | null;
  settingsOnly: { stopAndDrain(): Promise<void> } | null;
  indexer: { whenIdle?(): Promise<void> } | null;
  indexQueue: { whenIdle(): Promise<void> } | null;
  fence: VaultCallOff | null;
}

/** Stand-ins for the tests; the defaults are the shell's own. */
export interface CloseRuntimeDeps {
  flushDrafts: (path: string) => Promise<void>;
  forgetDraftMemory: (path: string) => void;
  settlePendingWrites: (path: string) => Promise<void>;
  pendingWritePaths: (path: string) => string[];
  vaultLabel: (path: string) => string;
}

const DEFAULTS: CloseRuntimeDeps = { flushDrafts, forgetDraftMemory, settlePendingWrites, pendingWritePaths, vaultLabel };

/**
 * Closes a vault's runtime, in this order: what the draft journal still
 * buffers goes to disk (bounded), the pending saves land, then the sync step,
 * the settings-only sync and the index finish. `closed` is what the person
 * waits for: within one deadline for the whole close (texts 1, 2, 4, 5), after
 * which the runtime is called off and the app goes on — to another vault or
 * to the start. `ended` is what the same vault waits for before it opens
 * again (`awaitVaultTeardown`, text 7): the whole close through, the runtime
 * called off, and none of its calls open any more. Never two runtimes at one
 * vault. Both the close (`teardownVault`) and a reload of the same vault
 * (`loadVault`) go this way.
 */
export function closeVaultRuntime(runtime: ClosingRuntime, deps: CloseRuntimeDeps = DEFAULTS): { closed: Promise<void>; ended: Promise<void> } {
  const { path, worker, settingsOnly, indexer, indexQueue, fence } = runtime;
  let step = { kind: "saving", names: [] } as CloseWaitStep;
  const drain = (async () => {
    if (path) await deps.flushDrafts(path).catch(() => {});
    if (path) deps.forgetDraftMemory(path);
    if (path) {
      step = { kind: "saving", names: deps.pendingWritePaths(path).map(closeWaitNoteName) };
      await deps.settlePendingWrites(path);
    }
    step = { kind: "sync", vault: path ? deps.vaultLabel(path) : "" };
    await worker?.stopAndDrain();
    await settingsOnly?.stopAndDrain();
    await indexer?.whenIdle?.();
    await indexQueue?.whenIdle();
  })();
  const saving = (): CloseWaitStep => (step.kind === "saving" && path ? { kind: "saving", names: deps.pendingWritePaths(path).map(closeWaitNoteName) } : step);
  const closed = (async () => {
    // Given up in the sync step: the runtime is called off at once, so the step stops at its next call. Given up on a
    // save: it finishes in the background (text 4) — a local write is never overtaken — and the runtime goes after it.
    if ((await waitWithDeadline(drain, saving)) === "gave-up" && step.kind === "sync") fence?.callOff();
  })();
  const ended = (async () => {
    await drain.catch(() => undefined);
    // Through: nothing of this runtime may write any more, and the next open waits until none of its calls is open.
    fence?.callOff();
    await fence?.ended();
  })();
  if (path) noteVaultTeardown(path, ended);
  return { closed, ended };
}
