import { closeWaitNoteName, parkClosingSyncPlace, reportingTo, waitWithDeadline, type CloseWaitStep, type SyncStateBinding } from "@plainva/ui";
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
  /**
   * What is owed to the sync queue (`chain.queueing`): an entry that could not
   * be made at once is tried again a moment later. It gets its last attempt
   * while the runtime may still write — before the call-off, or it would meet
   * a fenced database and be gone.
   */
  owed?: { flush(): Promise<void> } | null;
  /** The folder its sync used: the end is parked under it too, so another vault's sync there waits (text 8). */
  syncPlace?: SyncStateBinding | null;
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
  const { path, worker, settingsOnly, indexer, indexQueue, fence, owed, syncPlace } = runtime;
  // The owed entries' last attempt, once (bounded by the queue itself), and the call-off only after it.
  let owedFlushed: Promise<void> | null = null;
  const flushOwed = () => (owedFlushed ??= (owed?.flush() ?? Promise.resolve()).catch(reportingTo("sync:owed-before-call-off")));
  const callOffAfterOwed = () => flushOwed().then(() => fence?.callOff());
  let step = { kind: "saving", names: [] } as CloseWaitStep;
  const drain = (async () => {
    if (path) await deps.flushDrafts(path).catch(() => {});
    if (path) deps.forgetDraftMemory(path);
    if (path) {
      step = { kind: "saving", names: deps.pendingWritePaths(path).map(closeWaitNoteName) };
      await deps.settlePendingWrites(path);
    }
    // Only what really runs is named: without a sync there is no sync step to wait for (texts 2 and 5).
    if (worker || settingsOnly) {
      step = { kind: "sync", vault: path ? deps.vaultLabel(path) : "" };
      await worker?.stopAndDrain();
      await settingsOnly?.stopAndDrain();
    }
    // The index's last step: its scan was called off with the load's signal, so it ends at once — said nowhere.
    step = { kind: "index" };
    await indexer?.whenIdle?.();
    await indexQueue?.whenIdle();
  })();
  const saving = (): CloseWaitStep => (step.kind === "saving" && path ? { kind: "saving", names: deps.pendingWritePaths(path).map(closeWaitNoteName) } : step);
  const closed = (async () => {
    // Given up in the sync step: the runtime is called off right after the owed entries' last attempt, so the step
    // stops at its next call; the person does not wait for it. Given up on a save: it finishes in the background
    // (text 4) — a local write is never overtaken — and the runtime goes after it.
    if ((await waitWithDeadline(drain, saving)) === "gave-up" && step.kind !== "saving") void callOffAfterOwed();
  })();
  const ended = (async () => {
    await drain.catch(() => undefined);
    // Through: what is owed to the sync queue has had its last attempt, then nothing of this runtime may write any
    // more, and the next open waits until none of its calls is open.
    await callOffAfterOwed();
    await fence?.ended();
  })();
  if (path) noteVaultTeardown(path, ended);
  parkClosingSyncPlace(syncPlace, path ? deps.vaultLabel(path) : "", ended);
  return { closed, ended };
}
