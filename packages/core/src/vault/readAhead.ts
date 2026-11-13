/**
 * Reads the files of a pass ahead of the loop that indexes them (performance
 * plan L2, finding B3).
 *
 * The full scan used to read one file, index it, read the next. On the desktop
 * every read is a round trip into Rust and back (three of them for a note),
 * on the phone one through the plugin bridge, and on every platform the disk
 * waits while the thread parses and the thread waits while the disk reads.
 * Measured in the core on 10 000 notes, reading was 15 of 68 seconds, all of
 * it spent waiting.
 *
 * This keeps a few reads in flight while the loop indexes, and hands each
 * reading out in the order of the items — the loop writes rows in exactly the
 * order it always did. Two bounds hold what is ahead:
 *
 * - `groups` reads at a time, of up to `groupSize` items each, and never more
 *   than `groups × groupSize` items read ahead of the one taken (a host that
 *   reads many files in one call takes groups; every other one single files);
 * - `maxWeight`: the weight of what is read and not yet taken (by default a
 *   file's size). A group never takes an item past it, and nothing new starts
 *   while it is reached — except where nothing is ahead at all, so a file
 *   heavier than the whole bound is read on its own instead of never. Eight
 *   films of 200 MB are not read at once.
 *
 * `stop()` starts nothing more; what is already in flight can still be taken.
 * The full scan reads ahead across its transactions and stops when it ends,
 * however it ends; a reading taken before another pass indexed the same file
 * is not written over that pass's row (`indexedMeanwhile` in VaultIndexer).
 *
 * The reader must not reject: every failure is an answer (`readOrNote`). A
 * reading nobody takes any more (the pass was called off) simply settles.
 */
export interface ReadAheadOptions<T> {
  /** Reads at a time (default 8). */
  groups?: number;
  /** Items per read (default 1). */
  groupSize?: number;
  /** What may be read and not yet taken (default 16 MB). */
  maxWeight?: number;
  /** An item's weight against `maxWeight` (default 0). */
  weightOf?: (item: T) => number;
}

export interface ReadAhead<R> {
  /** The reading of item `index`; takes every item before it as done. Items are taken in order. */
  take(index: number): Promise<R>;
  /** Whether item `index` has been started (and so may still be taken after `stop`). */
  started(index: number): boolean;
  /** Whether the reading of item `index` is in: taking it then waits for nothing. */
  settled(index: number): boolean;
  /**
   * Resolves once the reading of item `index` is in, without taking it (it
   * starts that read if it has not begun). The full scan waits here before it
   * opens a transaction, so that no transaction waits for a read.
   */
  ready(index: number): Promise<void>;
  /** Starts nothing more. */
  stop(): void;
}

export const READ_AHEAD_MAX_WEIGHT = 16 * 1024 * 1024;

export function createReadAhead<T, R>(
  items: readonly T[],
  read: (group: readonly T[]) => Promise<R[]>,
  options: ReadAheadOptions<T> = {},
): ReadAhead<R> {
  const groups = Math.max(1, options.groups ?? 8);
  const groupSize = Math.max(1, options.groupSize ?? 1);
  const maxWeight = options.maxWeight ?? READ_AHEAD_MAX_WEIGHT;
  const weightOf = options.weightOf ?? (() => 0);
  const readings: Array<Promise<R>> = [];
  const inAlready: boolean[] = [];
  /** The weight each started item still holds against the bound, until it is taken. */
  const held: number[] = [];
  let issued = 0;
  let taken = 0;
  let released = 0;
  let inFlight = 0;
  let weightAhead = 0;
  let stopped = false;

  /** Starts one read from the next item on; `forced` passes over every bound (the item a caller waits for). */
  const startGroup = (forced: boolean): boolean => {
    if (issued >= items.length) return false;
    const first = weightOf(items[issued]);
    // Bounded three ways: reads at once, items read and not yet taken (a fast
    // disk would otherwise read the whole list ahead of a slow loop), weight.
    if (!forced && (inFlight >= groups || issued - taken >= groups * groupSize || (weightAhead > 0 && weightAhead + first > maxWeight))) return false;
    const from = issued;
    let to = from + 1;
    let weight = first;
    while (to < items.length && to - from < groupSize) {
      const next = weightOf(items[to]);
      if (weightAhead + weight + next > maxWeight) break;
      weight += next;
      to++;
    }
    for (let i = from; i < to; i++) held[i] = weightOf(items[i]);
    weightAhead += weight;
    issued = to;
    inFlight++;
    const group = items.slice(from, to);
    const answer = Promise.resolve()
      .then(() => read(group))
      .then((results) => {
        if (results.length !== group.length) throw new Error("A read-ahead was answered for another number of files");
        return results;
      });
    void answer.then(() => undefined, () => undefined).then(() => {
      inFlight--;
      fill();
    });
    for (let i = from; i < to; i++) {
      const reading = answer.then((results) => results[i - from]);
      // A reading nobody takes (the pass was called off) settles unseen.
      reading.catch(() => undefined);
      void reading.then(() => { inAlready[i] = true; }, () => { inAlready[i] = true; });
      readings[i] = reading;
    }
    return true;
  };

  const fill = (): void => {
    while (!stopped && startGroup(false)) { /* started one */ }
  };

  return {
    take(index: number): Promise<R> {
      if (index < taken || index >= items.length) throw new Error("A read-ahead hands out each reading once, in order");
      // Everything before `index` is done with: its weight no longer holds the
      // bound. The item taken now holds it until the next take — its reading
      // may still be on its way, and the caller holds it while it works on it.
      for (; released < index; released++) {
        weightAhead -= held[released] ?? 0;
        held[released] = 0;
      }
      taken = index + 1;
      while (index >= issued) startGroup(true);
      const reading = readings[index];
      // Begin the next reads now, while the caller works on this one.
      fill();
      return reading;
    },
    started(index: number): boolean {
      return index < issued;
    },
    settled(index: number): boolean {
      return inAlready[index] === true;
    },
    ready(index: number): Promise<void> {
      if (index < taken || index >= items.length) return Promise.resolve();
      while (index >= issued) startGroup(true);
      return readings[index].then(() => undefined, () => undefined);
    },
    stop(): void {
      stopped = true;
    },
  };
}
