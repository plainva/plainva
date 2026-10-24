import type { RoutineReady } from "./routineSession";

/**
 * When routines are looked at (plan KI-Harness P8, §20): shortly after the
 * vault opened — that is the catch-up for what was missed while the app was
 * closed —, then at a steady tick while it is open, and whenever the app
 * comes back to the front, because a phone in the background and a laptop
 * asleep fire no timer on time. One implementation for both shells.
 *
 * No exact time is promised and none is pretended: the app has no service in
 * the background. A routine runs at the first look after its moment; what
 * becomes of a moment that passed while the app was closed is the routine's
 * own rule (`dueMoment`). Whether anything is due, and whether something
 * else has the session right now, is the session's to say — a look that
 * finds nothing costs one comparison.
 */
export const ROUTINE_FIRST_LOOK_MS = 20_000;
export const ROUTINE_TICK_MS = 60_000;

export interface RoutineSchedulerOptions {
  firstMs?: number;
  tickMs?: number;
}

/** Starts looking; returns how to stop. `runDue` is the session's `runDueRoutines`. */
export function startRoutineScheduler(runDue: () => Promise<unknown>, options: RoutineSchedulerOptions = {}): () => void {
  let stopped = false;
  let looking = false;
  const look = () => {
    // One look at a time: a run can take minutes, and the tick does not queue behind it.
    if (stopped || looking) return;
    looking = true;
    void runDue()
      .catch(() => undefined)
      .then(() => {
        looking = false;
      });
  };
  const first = setTimeout(look, options.firstMs ?? ROUTINE_FIRST_LOOK_MS);
  const tick = setInterval(look, options.tickMs ?? ROUTINE_TICK_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") look();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(tick);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/**
 * Tells the shell when a run left a note: once per note, however often the
 * state is published. The shell decides how it says so — a toast while its
 * window is in front, the system's notification where it may and the window
 * is not. `subscribe` and `ready` are the session's.
 */
export function watchRoutineReady(source: { subscribe(listener: () => void): () => void; ready(): RoutineReady | null }, onReady: (ready: RoutineReady) => void): () => void {
  let told: string | null = source.ready()?.note ?? null;
  return source.subscribe(() => {
    const ready = source.ready();
    const note = ready?.note ?? null;
    if (note === told) return;
    told = note;
    if (ready) onReady(ready);
  });
}
