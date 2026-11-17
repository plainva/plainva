/**
 * The writes of this window still on their way (A7, A3).
 *
 * The way out of the app waits for them: a field that was just left, an
 * editor that was just told to save, start a write and return — and a window
 * that says "done" while it is in flight takes it along. Every write of a
 * window goes through its vault adapter (the chain's top in the central
 * window, the bus in another one), so that is where they are counted.
 */

/** Calls that change something; everything else an adapter does is a read. */
const WRITES = /^(write|update|create|rename|delete|remove|move|copy|trash|append)/;

let inflight = 0;
/** Grows with every write that starts: a quiet moment is one in which it stood still. */
let started = 0;
const idle = new Set<() => void>();

function settled(): void {
  inflight -= 1;
  if (inflight > 0) return;
  for (const wake of [...idle]) wake();
}

/** The adapter, counting its writes. Its methods run on the adapter itself, as before. */
export function countWrites<T extends object>(adapter: T): T {
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
          result.then(settled, settled);
        }
        return result;
      };
    },
  });
}

/**
 * Resolves once no counted write is on its way and none started for `quietMs`
 * — a write that a finished one leads to (an editor's next save) is waited for
 * too. The caller bounds the whole: a write that hangs is not waited out here.
 */
export async function settleInflightWrites(quietMs: number): Promise<void> {
  for (;;) {
    if (inflight > 0) await new Promise<void>((resolve) => {
      const wake = () => {
        idle.delete(wake);
        resolve();
      };
      idle.add(wake);
    });
    const before = started;
    await new Promise((resolve) => setTimeout(resolve, quietMs));
    if (inflight === 0 && started === before) return;
  }
}

/** Test seam — the app never resets this. */
export function resetInflightWritesForTest(): void {
  inflight = 0;
  started = 0;
  idle.clear();
}
