import { describe, expect, it } from "vitest";
import { createReadAhead } from "../src/vault/readAhead.js";

/**
 * The full scan reads its files ahead of the loop that indexes them
 * (performance plan L2). What the read-ahead must hold, whatever order the
 * reads come back in: each reading is handed out for its own item and in the
 * order asked; never more reads at once than allowed, nor more weight ahead
 * than allowed — and an item heavier than the whole bound is still read, on
 * its own; after `stop` nothing new starts.
 */

/** A reader whose answers the test releases one by one, in any order. */
function controlledReader() {
  const pending: Array<{ group: number[]; resolve: (r: string[]) => void }> = [];
  let inFlight = 0;
  let most = 0;
  const read = (group: readonly number[]) => {
    inFlight++;
    most = Math.max(most, inFlight);
    return new Promise<string[]>((resolve) => {
      pending.push({ group: [...group], resolve: (r) => { inFlight--; resolve(r); } });
    });
  };
  const answer = (index = 0) => {
    const [call] = pending.splice(index, 1);
    call.resolve(call.group.map((i) => `read ${i}`));
  };
  return { read, pending, answer, most: () => most, inFlight: () => inFlight };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("createReadAhead", () => {
  it("hands each item its own reading, in order, while answers come back out of order", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const reader = controlledReader();
    const ahead = createReadAhead(items, reader.read, { groups: 4 });
    const taken: Array<Promise<string>> = [];
    taken.push(ahead.take(0));
    await flush();
    expect(reader.pending.length).toBe(4);
    // Answers in reverse order of asking.
    while (reader.pending.length > 0) {
      reader.answer(reader.pending.length - 1);
      await flush();
    }
    for (let i = 1; i < items.length; i++) {
      taken.push(ahead.take(i));
      await flush();
      while (reader.pending.length > 0) {
        reader.answer(reader.pending.length - 1);
        await flush();
      }
    }
    expect(await Promise.all(taken)).toEqual(items.map((i) => `read ${i}`));
    expect(reader.most()).toBe(4);
  });

  it("never has more than `groups` reads at once, of at most `groupSize` items", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const sizes: number[] = [];
    let inFlight = 0;
    let most = 0;
    const ahead = createReadAhead(items, async (group) => {
      sizes.push(group.length);
      inFlight++;
      most = Math.max(most, inFlight);
      await flush();
      inFlight--;
      return group.map(String);
    }, { groups: 2, groupSize: 8 });
    const out: string[] = [];
    for (let i = 0; i < items.length; i++) out.push(await ahead.take(i));
    expect(out).toEqual(items.map(String));
    expect(most).toBeLessThanOrEqual(2);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(8);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(items.length);
  });

  it("bounds what is ahead by weight, and reads an item heavier than the bound on its own", async () => {
    const MB = 1024 * 1024;
    // Four films of 200 MB between small notes.
    const weights = [1, 200 * MB, 1, 200 * MB, 200 * MB, 1, 1, 200 * MB, 1];
    const items = weights.map((w, i) => ({ i, w }));
    const reader = controlledReader();
    const ahead = createReadAhead(items.map((x) => x.i), reader.read, { groups: 8, maxWeight: 16 * MB, weightOf: (i) => weights[i] });
    const started = new Set<number>();
    const out: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const reading = ahead.take(i);
      await flush();
      // What has been started and not yet taken never holds two films: past
      // the bound only where it is a single item.
      const aheadOfTaken = reader.pending.flatMap((c) => c.group).filter((x) => x > i);
      for (const x of reader.pending.flatMap((c) => c.group)) started.add(x);
      const weightAhead = aheadOfTaken.reduce((sum, x) => sum + weights[x], 0);
      expect(weightAhead <= 16 * MB || aheadOfTaken.length === 1).toBe(true);
      while (reader.pending.length > 0) {
        reader.answer(0);
        await flush();
      }
      out.push(await reading);
    }
    expect(out).toEqual(items.map((x) => `read ${x.i}`));
    expect(started.size).toBe(items.length);
  });

  it("starts nothing more after stop, and still hands out what it began", async () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const reader = controlledReader();
    const ahead = createReadAhead(items, reader.read, { groups: 4 });
    const first = ahead.take(0);
    await flush();
    expect(reader.pending.length).toBe(4);
    ahead.stop();
    while (reader.pending.length > 0) {
      reader.answer(0);
      await flush();
    }
    expect(await first).toBe("read 0");
    let i = 1;
    for (; i < items.length && ahead.started(i); i++) expect(await ahead.take(i)).toBe(`read ${i}`);
    await flush();
    expect(i).toBe(4);
    expect(reader.pending.length).toBe(0);
  });

  it("stop resolves only once the reads in flight have settled (third review of 11.11.)", async () => {
    const reader = controlledReader();
    const ahead = createReadAhead(Array.from({ length: 10 }, (_, i) => i), reader.read, { groups: 3 });
    void ahead.take(0);
    await flush();
    expect(reader.pending.length).toBe(3);
    let stopped = false;
    const stopping = ahead.stop().then(() => { stopped = true; });
    reader.answer(0);
    reader.answer(0);
    await flush();
    expect(stopped).toBe(false);
    reader.answer(0);
    await stopping;
    expect(stopped).toBe(true);
    expect(reader.inFlight()).toBe(0);
    // With nothing in flight it resolves at once.
    await ahead.stop();
    expect(reader.pending.length).toBe(0);
  });

  it("weighs a reading by what was read once it is in, not by the listing (third review of 11.11., K3)", async () => {
    const MB = 1024 * 1024;
    // The listing says nothing; each file read is 20 MB, more than the bound.
    const reader = { pending: [] as Array<{ group: number[]; resolve: (r: number[]) => void }> };
    const read = (group: readonly number[]) => new Promise<number[]>((resolve) => reader.pending.push({ group: [...group], resolve }));
    const ahead = createReadAhead(Array.from({ length: 20 }, (_, i) => i), read, {
      groups: 4, maxWeight: 16 * MB, weightOf: () => 0, weighResult: (bytes: number) => bytes,
    });
    void ahead.take(0);
    await flush();
    // The listing weighs nothing: four reads start, the count bound.
    expect(reader.pending.flatMap((c) => c.group)).toEqual([0, 1, 2, 3]);
    for (const call of reader.pending.splice(0)) call.resolve(call.group.map(() => 20 * MB));
    await flush();
    await flush();
    // What came in holds the bound with its real weight: nothing more starts
    // while readings beyond the bound are ahead.
    expect(reader.pending.length).toBe(0);
    const takenNext = ahead.take(1);
    await flush();
    await takenNext;
    expect(reader.pending.length).toBe(0);
  });

  it("a reading taken after stop that was never begun is read all the same", async () => {
    const ahead = createReadAhead([0, 1], async (group) => group.map(String), { groups: 1 });
    ahead.stop();
    expect(await ahead.take(0)).toBe("0");
    expect(await ahead.take(1)).toBe("1");
  });

  it("hands each reading out once, in order", async () => {
    const ahead = createReadAhead([0, 1, 2], async (group) => group.map(String));
    await ahead.take(1);
    expect(() => ahead.take(0)).toThrow(/once, in order/);
    expect(() => ahead.take(3)).toThrow(/once, in order/);
  });

  it("a read that answers for another number of items fails the readings of that group", async () => {
    const ahead = createReadAhead([0, 1], async () => ["only one"], { groupSize: 2 });
    await expect(ahead.take(0)).rejects.toThrow(/another number/);
  });
});
