import { beforeEach, describe, expect, it, vi } from "vitest";
import { PimWorker, TRIGGER_COALESCE_MS, type PimCycleInfo } from "../src/pim/PimWorker.ts";
import { PimCacheRepository } from "../src/pim/PimCacheRepository.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import type { IPimTarget } from "../src/pim/types.ts";

/**
 * Finding 2026-09-20: the provider was pulled twice, 14 s apart, for one
 * request. `start()` runs a cycle at once, and the manual trigger that usually
 * follows it (a login finishing, an account being enabled, a view opening right
 * after the vault) found that cycle running and queued a second one. One
 * request is one pull — without turning "refresh" during a LONG cycle into the
 * silent no-op the queue exists to prevent.
 */

const { DatabaseSync } = (await import("node:sqlite")) as any;

class NodeSqliteAdapter implements IDatabaseAdapter {
  constructor(private db: any) {}
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    return ((await this.query<T>(sql, params))[0] ?? null) as T | null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

const boom = async () => {
  throw new Error("not under test");
};

/** A target whose calendar listing waits until the test lets it go. */
function gatedTarget() {
  let release: () => void = () => {};
  let gate = new Promise<void>((resolve) => (release = resolve));
  const listCalendars = vi.fn(async () => {
    await gate;
    return [{ id: "cal1", name: "Privat" }];
  });
  const pullTasks = vi.fn(async () => ({ tasks: [] }));
  const target: IPimTarget = {
    provider: "caldav",
    listCalendars,
    pullEvents: async () => ({ events: [] }),
    listTaskLists: async () => [{ id: "l1", name: "Aufgaben" }],
    pullTasks,
    createEvent: boom,
    updateEvent: boom,
    deleteEvent: boom,
    createTask: boom,
    updateTask: boom,
    deleteTask: boom,
  };
  return {
    target,
    listCalendars,
    release: () => release(),
    /** Closes the gate again for the next cycle. */
    rearm: () => {
      gate = new Promise<void>((resolve) => (release = resolve));
    },
  };
}

describe("PimWorker: one request, one cycle", () => {
  let cache: PimCacheRepository;
  let clock: number;
  let cycles: PimCycleInfo[];

  beforeEach(async () => {
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
    await cache.upsertAccount({ id: "a1", provider: "caldav", label: "NC", config: {}, enabled: true });
    clock = Date.parse("2026-09-20T08:00:00Z");
    cycles = [];
  });

  const workerFor = (target: IPimTarget) =>
    new PimWorker({ cache, buildTarget: async () => target, now: () => clock, intervalMs: 3_600_000, onCycle: (info) => cycles.push(info) });

  it("start() followed by a manual trigger runs ONE cycle, and says so", async () => {
    const t = gatedTarget();
    const worker = workerFor(t.target);
    worker.start();
    await worker.triggerImmediate(); // the pair every login and every opening view produces
    clock += 400;
    await worker.triggerImmediate();
    t.release();
    await vi.waitFor(() => expect(cycles).toHaveLength(1));
    // Give a wrongly queued second cycle the chance to show itself.
    await new Promise((resolve) => setTimeout(resolve, 20));
    worker.stop();

    expect(t.listCalendars).toHaveBeenCalledTimes(1);
    expect(cycles).toEqual([expect.objectContaining({ cause: "start", coalesced: 2, hadError: false })]);
  });

  it("a trigger that arrives LATE in a running cycle is still run afterwards", async () => {
    const t = gatedTarget();
    const worker = workerFor(t.target);
    const first = worker.triggerImmediate();
    await vi.waitFor(() => expect(t.listCalendars).toHaveBeenCalledTimes(1));
    clock += TRIGGER_COALESCE_MS + 1;
    await worker.triggerImmediate(); // the person changed something and asks again
    t.release();
    await first;
    await vi.waitFor(() => expect(cycles).toHaveLength(2));

    expect(cycles.map((c) => c.cause)).toEqual(["manual", "queued"]);
    expect(t.listCalendars).toHaveBeenCalledTimes(2);
  });

  it("an early trigger gives a parked account its go in the SAME cycle", async () => {
    // Parked: the last failure was an answer, and automatic cycles skip it.
    await cache.setScopeState("a1", "account", { lastError: "invalid_grant", lastErrorKind: "fatal", authRevision: null });
    const t = gatedTarget();
    t.release();
    const worker = workerFor(t.target);
    worker.start(); // an automatic cycle: on its own it would skip the account
    await worker.triggerImmediate(); // … but the manual refresh rides along
    await vi.waitFor(() => expect(cycles).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    worker.stop();

    expect(t.listCalendars).toHaveBeenCalledTimes(1);
    expect(cycles).toHaveLength(1);
    expect((await cache.getScopeState("a1", "account"))?.lastError ?? null).toBeNull();
  });

  it("an early trigger AFTER the cycle skipped a parked account is queued, not swallowed", async () => {
    await cache.upsertAccount({ id: "a2", provider: "caldav", label: "Zweit", config: {}, enabled: true });
    await cache.setScopeState("a2", "account", { lastError: "invalid_grant", lastErrorKind: "fatal", authRevision: null });
    const t = gatedTarget();
    const asked: string[] = [];
    const worker = new PimWorker({
      cache,
      buildTarget: async (account) => {
        asked.push(account.id);
        return t.target;
      },
      now: () => clock,
      intervalMs: 3_600_000,
      onCycle: (info) => cycles.push(info),
    });
    worker.start();
    // The cycle is in flight for a1 only — a2 was skipped as parked.
    await vi.waitFor(() => expect(t.listCalendars).toHaveBeenCalledTimes(1));
    expect(asked).toEqual(["a1"]);
    await worker.triggerImmediate(); // still inside the window, but this cycle cannot answer it
    t.release();
    await vi.waitFor(() => expect(cycles).toHaveLength(2));
    worker.stop();

    expect(cycles.map((c) => c.cause)).toEqual(["start", "queued"]);
    expect(asked.sort()).toEqual(["a1", "a1", "a2"]);
  });
});
