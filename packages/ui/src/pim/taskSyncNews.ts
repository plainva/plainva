import type { PimCacheRepository } from "@plainva/core";
import type { TaskSyncResult } from "./taskSync";

/**
 * Whether a finished task reconcile is news for the views (F21).
 *
 * Both shells run the reconcile at the end of EVERY provider cycle - it has
 * to, a tick made here must reach the provider while the provider is quiet -
 * and both used to announce every run ("task sync done"). The task views, the
 * calendar's due tasks, the account page and the phone's widgets reloaded on
 * that every two minutes with nothing new. The worker learned to stay quiet
 * on a quiet cycle; this is the same rule one step later.
 *
 * News is any of:
 * - the reconcile did something (a note made, changed, adopted or removed, a
 *   tick pushed, a conflict, a provider task deleted);
 * - the provider cycle before it changed data (`markTaskSyncInputChanged`,
 *   from `onDataChanged`): views that only listen for the reconcile read that
 *   data too;
 * - what the views say about sync problems changed - a line that came or went,
 *   including the ones the reconcile itself writes (a missing task database,
 *   changes that could not be carried into notes);
 * - the first run for a cache.
 *
 * Kept per cache object, in memory: each vault's runtime has its own.
 */
const lastSaid = new WeakMap<PimCacheRepository, string>();
const inputChanged = new WeakSet<PimCacheRepository>();

/** The provider cycle changed data: the next reconcile is news whatever it does. */
export function markTaskSyncInputChanged(cache: PimCacheRepository): void {
  inputChanged.add(cache);
}

export async function taskSyncHasNews(cache: PimCacheRepository, res: TaskSyncResult | null): Promise<boolean> {
  const input = inputChanged.delete(cache);
  const acted =
    res !== null &&
    (res.createdNotes.length > 0 ||
      res.changedNotes.length > 0 ||
      res.adoptedNotes.length > 0 ||
      res.deletedNotes.length > 0 ||
      res.pushed > 0 ||
      res.conflicts > 0 ||
      res.deletedRemote > 0);
  let problems: string;
  try {
    problems = JSON.stringify(await cache.listSyncProblems());
  } catch {
    // Unknown is news: a reload too many costs a moment, one too few a stale line.
    lastSaid.delete(cache);
    return true;
  }
  const said = JSON.stringify([problems, res?.blocked ?? null, res?.notApplied ?? 0, res?.errors ?? []]);
  const before = lastSaid.get(cache);
  lastSaid.set(cache, said);
  return input || acted || before !== said;
}
