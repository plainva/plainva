import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A turn on the phone's database that never ends (decision E14 of the
 * bug-clearing plan, Sammelplan § 3.89 Nr. 3).
 *
 * Transactions take turns on the one connection. A body that never ended - a
 * native read that hangs - held every later transaction and every write
 * through the vault's chain behind it for as long as the app ran: nothing
 * failed, nothing was said. A turn now waits at most 60 s, then gives up with
 * an error and a line in the diagnostics naming the turn that held.
 */
const diagnostics: string[] = [];
vi.mock("../../../../packages/ui/src/services/diagnosticsLog", () => ({ logDiagnostic: (_area: string, line: string) => diagnostics.push(line) }));

// The turns live in the shared UI package since the desktop takes them too (stability plan R1).
const { TransactionTurns, TransactionTurnTimeout, TURN_WAIT_MS } = await import("../../../../packages/ui/src/lib/transactionTurns");

afterEach(() => {
  vi.useRealTimers();
  diagnostics.length = 0;
});

describe("transaction turns on the phone's one connection", () => {
  it("run one after the other, in the order they were asked for", async () => {
    const turns = new TransactionTurns();
    const order: string[] = [];
    let release!: () => void;
    const first = turns.take(() => new Promise<void>((r) => { release = r; }).then(() => { order.push("first"); }));
    const second = turns.take(async () => { order.push("second"); });
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("give up after 60 s behind a turn that never ends, with an error and a diagnostics line - and the next one is not held for ever", async () => {
    vi.useFakeTimers();
    expect(TURN_WAIT_MS).toBe(60_000);
    const turns = new TransactionTurns();
    // A body whose native read hangs.
    void turns.take(() => new Promise<void>(() => {}), "transaction");
    const ran = vi.fn(async () => "written");
    const waiting = turns.take(ran, "batch");
    const failed = waiting.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(ran).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await failed;
    expect(error).toBeInstanceOf(TransactionTurnTimeout);
    expect(String((error as Error).message)).toMatch(/busy for 60 s/);
    // Never run: it would have met the transaction that is still open.
    expect(ran).not.toHaveBeenCalled();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatch(/batch waited, transaction held the connection for 60 s/);
  });

  it("do not give up behind a turn that ends in time", async () => {
    vi.useFakeTimers();
    const turns = new TransactionTurns();
    void turns.take(() => new Promise<void>((r) => setTimeout(r, 30_000)));
    const second = turns.take(async () => "written");
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(second).resolves.toBe("written");
    expect(diagnostics).toEqual([]);
  });

  it("go on after a turn that gave up, once the one in front of it has ended", async () => {
    vi.useFakeTimers();
    const turns = new TransactionTurns();
    let release!: () => void;
    void turns.take(() => new Promise<void>((r) => { release = r; }));
    const gaveUp = turns.take(async () => "never").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await gaveUp).toBeInstanceOf(TransactionTurnTimeout);
    const later = turns.take(async () => "later");
    release();
    await vi.advanceTimersByTimeAsync(0);
    await expect(later).resolves.toBe("later");
  });

  it("let reads asked for together share one turn, and make what comes after them wait for the last", async () => {
    expect.hasAssertions();
    const turns = new TransactionTurns();
    const order: string[] = [];
    let releaseTx!: () => void;
    void turns.take(() => new Promise<void>((r) => { releaseTx = r; }).then(() => { order.push("tx"); }));
    const ends: Array<() => void> = [];
    const read = (name: string) => turns.read(() => new Promise<void>((r) => { order.push(`${name} begins`); ends.push(() => { order.push(`${name} ends`); r(); }); }));
    const a = read("a");
    const b = read("b");
    const after = turns.take(async () => { order.push("after"); });
    const c = read("c");
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([]);
    releaseTx();
    await new Promise((r) => setTimeout(r, 0));
    // a and b run side by side; c, asked for after a transaction, waits for it.
    expect(order).toEqual(["tx", "a begins", "b begins"]);
    ends[1]();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).not.toContain("after");
    ends[0]();
    await Promise.all([a, b, after]);
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["tx", "a begins", "b begins", "b ends", "a ends", "after", "c begins"]);
    ends[2]();
    await c;
  });

  it("give a read up after its wait, without running it", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const turns = new TransactionTurns();
    void turns.take(() => new Promise<void>(() => {}), "transaction");
    const ran = vi.fn(async () => []);
    const failed = turns.read(ran).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await failed).toBeInstanceOf(TransactionTurnTimeout);
    expect(ran).not.toHaveBeenCalled();
  });

  it("let each read keep its own limit: one that joins a waiting shared turn late does not inherit the wait before it", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const turns = new TransactionTurns();
    let release!: () => void;
    void turns.take(() => new Promise<void>((r) => { release = r; }), "transaction");
    const early = turns.read(async () => "early").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(55_000);
    const late = turns.read(async () => "late");
    await vi.advanceTimersByTimeAsync(5_000);
    // The early one waited its 60 s and gave up, with a read's message.
    const error = await early;
    expect(error).toBeInstanceOf(TransactionTurnTimeout);
    expect(String((error as Error).message)).toMatch(/busy for 60 s .*this read was not answered/);
    expect(diagnostics[0]).toMatch(/read waited, transaction held the connection for 60 s/);
    // The late one waits on, within its own 60 s, and is answered once the transaction ends.
    await vi.advanceTimersByTimeAsync(20_000);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await expect(late).resolves.toBe("late");
  });
});
