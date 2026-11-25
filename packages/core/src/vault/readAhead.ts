/**
 * Reads the files of a pass ahead of the loop that indexes them.
 *
 * The full scan read one file, indexed it, read the next. On the desktop
 * every read is a round trip into Rust and back (three of them for a note),
 * on the phone one through the plugin bridge, and on every platform the disk
 * waits while the thread parses and the thread waits while the disk reads.
 *
 * This keeps a few reads in flight while the loop works, and hands each
 * reading out in the order of the items — the loop writes rows in exactly
 * the order it always did, so the index it writes is the same. Two bounds
 * hold what is ahead:
 *
 * - `groups` reads at a time, of up to `groupSize` items each (a host that
 *   reads many files in one call takes groups; every other one single files);
 * - `maxWeight`: the weight of what is read or being read and not yet taken
 *   (a file's size). A group never takes an item past it, and nothing new
 *   starts while it is reached — except where nothing is ahead at all, so a
 *   file heavier than the whole bound is read on its own instead of never.
 *   Eight films of 200 MB are not read at once.
 *
 * `take` honours the pass's signal: once it is aborted, a take ends at once,
 * however long a read it waits for still runs (a hung network drive); what
 * is in flight settles unseen. `stop()` starts nothing more; what is already
 * in flight can still be taken.
 *
 * The reader must not reject for a file: every failure of one file is an
 * answer for that file (`readOrLeaveOut`). A group whose read rejects as a
 * whole rejects each of its items.
 */
export interface ReadAheadOptions<T, R = unknown> {
  /** Reads at a time (default 8). */
  groups?: number;
  /** Items per read (default 1). */
  groupSize?: number;
  /** What may be read and not yet taken (default 16 MB). */
  maxWeight?: number;
  /** An item's weight against `maxWeight` before it is read (default 0): what the listing says. */
  weightOf?: (item: T) => number;
  /**
   * A reading's weight once it is in, where it may differ from the listing's
   * (a file that grew, a placeholder listed with no size): from then on it
   * holds the bound with that weight until it is taken.
   */
  weighResult?: (reading: R) => number;
  /**
   * A reading handed out keeps its weight against the bound (default false:
   * it gives it back once it is in). For a caller that holds every reading
   * until it is done with all of them — the full scan holds a transaction's
   * readings until the transaction writes —, the bound is then one on all
   * that was read.
   */
  holdTaken?: boolean;
  /** Ends a waiting `take` at once when aborted. */
  signal?: AbortSignal;
}

export interface ReadAhead<R> {
  /** The reading of item `index`. Items are taken in order, each once. */
  take(index: number): Promise<R>;
  /** Whether item `index` has been started (and so may still be taken after `stop`). */
  started(index: number): boolean;
  /** Starts nothing more. */
  stop(): void;
}

export const READ_AHEAD_MAX_WEIGHT = 16 * 1024 * 1024;

/** A promise that ends with the signal's reason as soon as it is aborted. */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

export function createReadAhead<T, R>(
  items: readonly T[],
  read: (group: readonly T[]) => Promise<R[]>,
  options: ReadAheadOptions<T, R> = {},
): ReadAhead<R> {
  const groups = Math.max(1, options.groups ?? 8);
  const groupSize = Math.max(1, options.groupSize ?? 1);
  const maxWeight = options.maxWeight ?? READ_AHEAD_MAX_WEIGHT;
  const weightOf = options.weightOf ?? (() => 0);
  const weighResult = options.weighResult;
  const readings: Array<Promise<R>> = [];
  /** The weight each started item holds against the bound, until it is taken. */
  const held: number[] = [];
  let issued = 0;
  let taken = 0;
  let inFlight = 0;
  let weightAhead = 0;
  let stopped = false;

  /** Starts one read from the next item on; `forced` passes over every bound (the item a caller waits for). */
  const startGroup = (forced: boolean): boolean => {
    if (issued >= items.length) return false;
    const first = Math.max(0, weightOf(items[issued]));
    if (!forced && (inFlight >= groups || (weightAhead > 0 && weightAhead + first > maxWeight))) return false;
    const from = issued;
    let to = from + 1;
    let weight = first;
    held[from] = first;
    while (to < items.length && to - from < groupSize) {
      const next = Math.max(0, weightOf(items[to]));
      if (weightAhead + weight + next > maxWeight) break;
      held[to] = next;
      weight += next;
      to++;
    }
    weightAhead += weight;
    issued = to;
    inFlight++;
    const group = items.slice(from, to);
    const answer = Promise.resolve()
      .then(() => read(group))
      .then((results) => {
        if (results.length !== group.length) throw new Error("A read-ahead was answered for another number of files");
        // What was read holds the bound from now on, while it is still held —
        // weighed as the answer comes in, before anything new may start.
        if (weighResult) {
          for (let i = from; i < to; i++) {
            // A reading taken already gives its weight back once it is in —
            // unless the caller holds it (`holdTaken`): then it counts as read.
            if (i < taken && !options.holdTaken) continue;
            const real = Math.max(0, weighResult(results[i - from]));
            weightAhead += real - (held[i] ?? 0);
            held[i] = real;
          }
        }
        return results;
      });
    for (let i = from; i < to; i++) {
      const reading = answer.then((results) => results[i - from]);
      // A reading nobody takes (the pass was called off) settles unseen.
      reading.catch(() => undefined);
      readings[i] = reading;
    }
    void answer.then(() => undefined, () => undefined).then(() => {
      inFlight--;
      fill();
    });
    return true;
  };

  const fill = (): void => {
    while (!stopped && startGroup(false)) { /* started one */ }
  };

  return {
    take(index: number): Promise<R> {
      if (index !== taken || index >= items.length) throw new Error("A read-ahead hands out each reading once, in order");
      taken = index + 1;
      while (index >= issued) startGroup(true);
      const reading = readings[index];
      // Its weight no longer holds the bound once its reading is here and handed out —
      // unless the caller holds what it takes (`holdTaken`).
      if (!options.holdTaken) {
        void reading.then(() => undefined, () => undefined).then(() => {
          weightAhead -= held[index] ?? 0;
          held[index] = 0;
          fill();
        });
      }
      // Begin the next reads now, while the caller works on this one.
      fill();
      return untilAborted(reading, options.signal);
    },
    started(index: number): boolean {
      return index < issued;
    },
    stop(): void {
      stopped = true;
    },
  };
}
