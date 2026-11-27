import { describe, expect, it } from "vitest";
import { createVaultCallOff, isCalledOffError } from "../../src/index.js";
import type { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.js";

/**
 * The fence counts what a called-off runtime still has open — the call that
 * runs AND every call that waits for its turn inside the adapter — and
 * `ended` resolves only once none is open: the same vault opens again only
 * then. Never two runtimes at one vault.
 */

/** A database that runs one call at a time, as the shells' adapters do: the others wait for their turn. */
function serialDatabase() {
  let tail: Promise<unknown> = Promise.resolve();
  const gates: Array<() => void> = [];
  const ran: string[] = [];
  const turn = (sql: string) => {
    const mine = tail.then(() => new Promise<void>((resolve) => {
      ran.push(sql);
      gates.push(resolve);
    }));
    tail = mine.catch(() => undefined);
    return mine;
  };
  const db = {
    execute: (sql: string) => turn(sql).then(() => ({ rowsAffected: 1 })),
    query: async () => [],
    queryOne: async () => null,
    runBatch: async () => undefined,
    transaction: async <T>(work: () => Promise<T>) => work(),
  } as unknown as IDatabaseAdapter;
  return { db, ran, answerNext: () => gates.shift()?.() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the fence of a called-off runtime", () => {
  it("counts the calls waiting for a turn, and ends only once the last of them has ended", async () => {
    const fence = createVaultCallOff();
    const s = serialDatabase();
    const db = fence.database(s.db);
    const first = db.execute("UPDATE a");
    const waiting = db.execute("UPDATE b");
    await tick();
    expect(s.ran, "the second waits for its turn").toEqual(["UPDATE a"]);
    expect(fence.open).toBe(2);

    fence.callOff();
    let ended = false;
    const done = fence.ended().then(() => { ended = true; });
    await expect(db.execute("UPDATE c")).rejects.toSatisfy(isCalledOffError);

    s.answerNext();
    await first;
    await tick();
    expect(ended, "the waiting turn is still open").toBe(false);
    expect(fence.open).toBe(1);

    s.answerNext();
    await waiting;
    await done;
    expect(ended).toBe(true);
    expect(fence.open).toBe(0);
  });

  it("does not end before it is called off, however idle it is", async () => {
    const fence = createVaultCallOff();
    let ended = false;
    void fence.ended().then(() => { ended = true; });
    await tick();
    expect(ended).toBe(false);
    fence.callOff();
    await tick();
    expect(ended).toBe(true);
  });

  it("counts a write past the fence that is tracked, and a step past it asks first", async () => {
    const fence = createVaultCallOff();
    let finish!: () => void;
    void fence.track(new Promise<void>((r) => (finish = r)));
    expect(fence.allows()).toBe(true);
    fence.callOff();
    expect(fence.allows(), "a late answer must not overwrite what the next runtime set").toBe(false);
    let ended = false;
    const done = fence.ended().then(() => { ended = true; });
    await tick();
    expect(ended).toBe(false);
    finish();
    await done;
    expect(ended).toBe(true);
  });
});
