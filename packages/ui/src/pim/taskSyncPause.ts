/**
 * Holding the task reconciler still while notes move under it (plan Befunde
 * 2026-09-24, E12).
 *
 * The reconciler finds a task's note by the path it stored
 * (`pim_task_state.note_path`), and by the anchor index when that path is
 * gone. A rename that lands between the two — file moved, index not yet
 * updated, stored path still old — reads as "note deleted here", and a deleted
 * note tombstones its task: never imported again. Anything that renames task
 * notes in bulk therefore runs inside `withTaskSyncPaused`.
 *
 * Both shells call the SAME `runTaskSync`, so the rule lives there: while a
 * pause holds, a reconcile returns at once with `paused: true` and does
 * nothing. A runner that met a pause asks to be called again once it lifts
 * (`afterTaskSyncResume`), so nothing a cycle wanted to push is lost.
 */

let holds = 0;
const inFlight = new Set<Promise<unknown>>();
const resumers = new Set<() => void>();

export function taskSyncPaused(): boolean {
  return holds > 0;
}

/** Called by `runTaskSync` around its work, so a pause can wait for it. */
export function trackTaskSync<T>(run: Promise<T>): Promise<T> {
  inFlight.add(run);
  const done = () => void inFlight.delete(run);
  run.then(done, done);
  return run;
}

/**
 * Runs `work` with the reconciler held: no reconcile starts, and one already
 * running is waited for first. Pauses nest. When the last one lifts, every
 * runner that was turned away is called once.
 */
export async function withTaskSyncPaused<T>(work: () => Promise<T>): Promise<T> {
  holds++;
  try {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    return await work();
  } finally {
    holds--;
    if (holds === 0) {
      const again = [...resumers];
      resumers.clear();
      for (const run of again) {
        try {
          run();
        } catch (e) {
          console.warn("[taskSyncPause] resuming a reconcile failed", e);
        }
      }
    }
  }
}

/** A runner that met a pause: call `run` once the pause lifts (deduplicated). */
export function afterTaskSyncResume(run: () => void): void {
  if (holds === 0) run();
  else resumers.add(run);
}

/** Test seam. */
export function __resetTaskSyncPauseForTest(): void {
  holds = 0;
  inFlight.clear();
  resumers.clear();
}
