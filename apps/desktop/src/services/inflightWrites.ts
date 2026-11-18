/**
 * The writes of this window still on their way (A7, A3).
 *
 * The way out of the app waits for them: a field that was just left, an
 * editor that was just told to save, start a write and return — and a window
 * that says "done" while it is in flight takes it along. Every write of a
 * window goes through its vault adapter (the chain's top in the central
 * window, the bus in another one), so that is where they are counted.
 *
 * Whose they are matters for what the next start says (review 2026-11-17): a
 * write of the person — a note, a field, a remark, anything a surface or
 * another window asked for — that did not land is a reason for "look at the
 * notes you edited last"; a sync pull that ran on is not, the next start pulls
 * again. The central window counts the lowest link as `"background"` and the
 * chain's top, where the surfaces write, as `"person"`.
 */

/** Calls that change something; everything else an adapter does is a read. */
const WRITES = /^(write|update|create|rename|delete|remove|move|copy|trash|append)/;

let inflight = 0;
/** Of those, the person's (`countWrites(…, "person")`). */
let inflightOfPerson = 0;
/** Grows with every write that starts: a quiet moment is one in which it stood still. */
let started = 0;
const idle = new Set<() => void>();
/** Grows with every reset: a write started before one does not count down after it. */
let epoch = 0;

function settled(): void {
  inflight -= 1;
  if (inflight > 0) return;
  for (const wake of [...idle]) wake();
}

/** Whose writes an adapter carries: the person's, or work the next start does again by itself. */
export type WriteOwner = "person" | "background";

/** The adapter, counting its writes. Its methods run on the adapter itself, as before. */
export function countWrites<T extends object>(adapter: T, owner: WriteOwner = "person"): T {
  return new Proxy(adapter, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== "function") return value;
      const method = value as (...args: unknown[]) => unknown;
      if (typeof key !== "string" || !WRITES.test(key)) return method.bind(target);
      return (...args: unknown[]) => {
        const result = method.apply(target, args);
        if (result instanceof Promise) {
          inflight += 1;
          started += 1;
          const counted = epoch;
          if (owner === "person") inflightOfPerson += 1;
          const done = () => {
            if (counted !== epoch) return;
            if (owner === "person") inflightOfPerson -= 1;
            settled();
          };
          result.then(done, done);
        }
        return result;
      };
    },
  });
}

/**
 * Resolves true once no counted write is on its way and none started for
 * `quietMs` — a write that a finished one leads to (an editor's next save) is
 * waited for too. Resolves false at `limitMs` whatever is still going: writes
 * that keep coming (a sync pull) or one that hangs are not waited out.
 */
export async function settleInflightWrites(quietMs: number, limitMs: number): Promise<boolean> {
  let timedOut = false;
  let wakeAtLimit: (() => void) | null = null;
  const limit = setTimeout(() => {
    timedOut = true;
    wakeAtLimit?.();
  }, limitMs);
  try {
    for (;;) {
      if (inflight > 0) {
        await new Promise<void>((resolve) => {
          const wake = () => {
            idle.delete(wake);
            wakeAtLimit = null;
            resolve();
          };
          idle.add(wake);
          wakeAtLimit = wake;
        });
      }
      if (timedOut) return false;
      const before = started;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wakeAtLimit = null;
          resolve();
        }, quietMs);
        wakeAtLimit = () => {
          clearTimeout(timer);
          wakeAtLimit = null;
          resolve();
        };
      });
      if (timedOut) return false;
      if (inflight === 0 && started === before) return true;
    }
  } finally {
    clearTimeout(limit);
  }
}

/** Writes of the person still on their way. */
export function personWritesInFlight(): number {
  return inflightOfPerson;
}

/** Test seam — the app never resets this. */
export function resetInflightWritesForTest(): void {
  epoch += 1;
  inflight = 0;
  inflightOfPerson = 0;
  started = 0;
  idle.clear();
}
