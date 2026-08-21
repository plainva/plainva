import { App as CapApp } from "@capacitor/app";
import {
  runTaskSync,
  pendingTaskDeletions,
  taskDeletionsInFlight,
  resolveTaskDeletion,
  initTaskDeletion,
  cancelInFlightTaskDeletion,
  plainvaProducer,
  type TaskDeletionOrder,
} from "@plainva/ui";
import type { PimAccountRow, PimCacheRepository, IPimTarget } from "@plainva/core";
import { getMobileSettings } from "../mobileSettings";
import { firstSyncSettled } from "../syncService";
import type { MobileVault } from "../vaultService";

/**
 * Task <-> note reconciler on the phone (stage 3) — the twin of what the
 * desktop wires inside VaultContext. The reconcile itself is shared
 * (`@plainva/ui`); what lives here is the wiring, and two parts of it are the
 * whole reason this module exists rather than a few lines in pimService.
 *
 * 1. **It hangs on the END OF A CYCLE, not on fresh data.** The core worker
 *    offers `onDataChanged`, which only fires when the provider actually wrote
 *    something. Hanging the reconciler there would mean a task ticked off on
 *    the phone while the provider is quiet never gets pushed — the edit would
 *    sit in the note forever. So the caller drives this from `onStatusChange`
 *    the moment the status leaves `syncing`, exactly as the desktop's
 *    pimRuntime does.
 *
 * 2. **Creating notes is gated on two signals, not one.** A reconcile that
 *    imports while the vault is still filling up produces precisely the
 *    duplicates this whole chain exists to prevent: the anchored note is on its
 *    way but not visible yet, so the task looks new. The desktop waits for the
 *    first sync cycle; the phone waits for that AND for the full index pass,
 *    because a freshly connected container is the normal case here, not the
 *    exception.
 *
 * Single-flight like the desktop: a cycle finishing mid-run queues exactly one
 * follow-up rather than stacking.
 */

interface Wiring {
  vault: MobileVault;
  cache: PimCacheRepository;
  buildTarget: (account: PimAccountRow) => Promise<IPimTarget | null>;
}

let wiring: Wiring | null = null;
let running = false;
let queued = false;

export function startTaskSyncRuntime(w: Wiring): void {
  wiring = w;
  // "Undo" has to hand the note back AND get it re-indexed; the reconciler is
  // poked so the provider deletion happens the moment the window closes rather
  // than waiting for the next poll.
  initTaskDeletion({
    writeTextFile: (path, content) => w.vault.files.writeTextFile(path, content),
    runTaskSync: () => void runMobileTaskSync(),
    onRestored: (paths) => {
      void w.vault.reindexPaths(paths).then(() => window.dispatchEvent(new CustomEvent("m-vault-changed")));
    },
  });
}

export function stopTaskSyncRuntime(): void {
  wiring = null;
  queued = false;
}

/**
 * Runs one reconcile. Safe to call on every cycle end: without a task database,
 * an index or a settled vault it returns immediately.
 */
export async function runMobileTaskSync(): Promise<void> {
  const w = wiring;
  if (!w) return;
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    const taskDbPath = getMobileSettings().taskDatabase.trim();
    if (!taskDbPath) return;
    const query = w.vault.queryService;
    if (!query) return;

    const res = await runTaskSync({
      // Through the sync chain, not the raw adapter: a note written raw would
      // never reach the remote (the import-hardening finding, R2).
      adapter: {
        readTextFile: (p) => w.vault.files.readTextFile(p),
        writeTextFile: (p, c) => w.vault.files.writeTextFile(p, c),
        exists: (p) => w.vault.files.exists(p),
        createDir: (p) => w.vault.files.createDir(p),
      },
      cache: w.cache,
      buildTarget: w.buildTarget,
      taskDbPath,
      noteType: getMobileSettings().defaultNoteType.trim() || "Note",
      allNotePaths: (await query.listNotes()).map((n) => n.path),
      // OKF 0.2 provenance (plan P3b): the same `plainva-task-sync/<version>`
      // actor the desktop writes — one producer name for both shells.
      generatedBy: await plainvaProducer("task-sync"),
      // One query instead of reading every note once per task.
      anchorsByUid: await query.getTaskAnchors(),
      mayCreateNotes: firstSyncSettled() && w.vault.indexSettled(),
      // Deletions the reader confirmed here whose provider task should follow.
      // The reconciler owns the call — it has the target, the etag and the
      // CalDAV href, and it retries next cycle.
      pendingDeletions: pendingTaskDeletions(),
      deletionsInFlight: taskDeletionsInFlight(),
      onDeletionResolved: (intent, outcome) => resolveTaskDeletion(intent as TaskDeletionOrder, outcome),
    });

    const touched = [...res.createdNotes, ...res.changedNotes];
    if (touched.length > 0) {
      await w.vault.reindexPaths(touched);
      window.dispatchEvent(new CustomEvent("m-vault-changed"));
    }
    for (const err of res.errors) console.warn("[mobile] task sync:", err);
    // The task screens listen for this to re-query — the index diff alone is
    // not a reliable refresh signal for them.
    window.dispatchEvent(new CustomEvent("m-task-sync-done"));
  } catch (e) {
    console.warn("[mobile] task sync failed", e);
  } finally {
    running = false;
    if (queued) {
      queued = false;
      void runMobileTaskSync();
    }
  }
}

/**
 * Going into the background CANCELS a running deletion window — the opposite of
 * what mail does on the very same event, and deliberately so.
 *
 * Mail flushes: a message the writer asked to send must not disappear because
 * they switched apps. Here the safe outcome is reversed — a wrongly kept task
 * is a nuisance, a wrongly deleted one is gone at the provider too. The desktop
 * draws the same line at `beforeunload`; the phone only meets the question far
 * more often, because being swept out of the background is the normal case here
 * rather than the exception.
 *
 * Both rules answer one question ("what is the safe outcome?"), so they look
 * inconsistent only from the outside. Do not unify them.
 */
if (typeof document !== "undefined") {
  void CapApp.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) cancelInFlightTaskDeletion();
  });
}

/** Test seam. */
export function __resetTaskSyncRuntimeForTest(): void {
  wiring = null;
  running = false;
  queued = false;
}
