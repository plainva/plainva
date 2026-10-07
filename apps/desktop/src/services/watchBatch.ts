import { isInternalPath, type WatchEvent } from "@plainva/core";
import { WATCH_RESCAN_MARKER } from "../adapters/TauriVaultAdapter";
import type { EnqueueOptions } from "./incrementalIndexQueue";

/**
 * Collects watcher events across the debounce window and hands them to the
 * index queue as one batch — WITH what happened to each path (issue 122).
 *
 * The window used to keep paths only. That lost the one fact that separates
 * the two things a folder event can mean: Windows reports the parent folder
 * of every file written as "modified" (the app's own atomic save produces
 * three such reports), and a folder that was created, renamed or moved in is
 * reported as exactly that. Without the kind, both looked the same and both
 * ran a full scan of the vault.
 *
 * Per path the STRONGEST kind of the window wins: a path that was modified
 * and also created, renamed, removed or reported without a kind is not
 * "modified only".
 */
export interface WatchBatch {
  /** Every relevant path of the window. "" stands for the rescan marker. */
  paths: string[];
  /** Paths named by a rename or removal (their parent folder gets a look, issue 110). */
  moved: string[];
  /** Paths whose only events were modifications. */
  modifiedOnly: string[];
}

export interface WatchBatchCollector {
  /** Adds one delivery of events; true when any of them is relevant to the index. */
  add(events: WatchEvent[]): boolean;
  /** The collected batch; the collector is empty afterwards. */
  take(): WatchBatch;
}

export function createWatchBatchCollector(): WatchBatchCollector {
  /** path → true while every event for it was a modification. */
  const seen = new Map<string, boolean>();
  const moved = new Set<string>();
  return {
    add(events) {
      let relevant = false;
      for (const e of events) {
        // The rescan marker always passes: it means the adapter could NOT
        // attribute a change, and dropping it would lose the change entirely.
        // It travels as "" — the vault root, which the queue reads as "reconcile
        // everything".
        if (e.path === WATCH_RESCAN_MARKER) {
          seen.set("", false);
          relevant = true;
          continue;
        }
        // Dropped before anything is asked of the disk or the database:
        //  - "" is the vault root itself, a change to the folder, not to a file in it;
        //  - internal paths: `.plainva` (the SQLite db and its -wal/-shm files,
        //    written on every index and sync pass — reacting to them was an
        //    endless re-index → db write → watcher → re-index loop), version
        //    control, tool caches, OS bookkeeping, and the app's own
        //    `.plainva-tmp-…` file of an atomic save.
        if (e.path === "" || isInternalPath(e.path)) continue;
        relevant = true;
        const weak = e.type === "modify";
        seen.set(e.path, (seen.get(e.path) ?? true) && weak);
        if (e.type === "rename" || e.type === "remove") moved.add(e.path);
      }
      return relevant;
    },
    take() {
      const batch: WatchBatch = { paths: [], moved: Array.from(moved), modifiedOnly: [] };
      for (const [path, weak] of seen) (weak ? batch.modifiedOnly : batch.paths).push(path);
      seen.clear();
      moved.clear();
      return batch;
    },
  };
}

/** The batch as the index queue takes it. */
export function toEnqueueArgs(batch: WatchBatch): [string[], EnqueueOptions] {
  return [batch.paths, { moved: batch.moved, modifiedOnly: batch.modifiedOnly, source: "watcher" }];
}
