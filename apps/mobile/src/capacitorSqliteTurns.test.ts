import { beforeEach, describe, expect, it, vi } from "vitest";
import { phoneSqlite, type PhonePlatform } from "../../../packages/core/test/helpers/phoneSqlitePlugin";

/**
 * Two transactions on the phone's one connection take turns (finding
 * 2026-10-12).
 *
 * The phone's index database is a single native connection, and its plugin
 * refuses a second transaction while one is open. The adapter sent every
 * `beginTransaction` as it came; whichever flow came second — a save's entry
 * in the sync queue, the index following a file, the sync marking an upload
 * done, a calendar being replaced — was refused, and what that cost was the
 * caller's problem. They wait for one another now.
 *
 * What runs here is the shipped adapter. Stood in for is the native side only
 * (`phoneSqlitePlugin.ts`: one connection over a real SQLite, served call by
 * call the way the bridge serves the plugin, answering as the plugin's sources
 * say Android and iOS do). Nothing of this was watched on a device.
 */

vi.mock("@capacitor-community/sqlite", async () => (await import("../../../packages/core/test/helpers/phoneSqlitePlugin")).phoneSqlite.module);

const { CapacitorSqliteAdapter } = await import("./adapters/CapacitorSqliteAdapter");
const { resetDatabasesForTests } = await import("./adapters/sqliteConnections");

const DATABASE = "plainva-index";
const PLATFORMS: PhonePlatform[] = ["android", "ios"];
/** Lets what is on its way cross the bridge: long enough for a refusal to come back, if there were one. */
const hops = async (n: number) => {
  for (let i = 0; i < n; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

async function open(platform: PhonePlatform = "android") {
  phoneSqlite.reset(platform);
  resetDatabasesForTests();
  const adapter = new CapacitorSqliteAdapter(DATABASE);
  await adapter.initialize();
  await adapter.execute("CREATE TABLE t (k TEXT PRIMARY KEY)");
  phoneSqlite.log.length = 0;
  const put = (key: string) => adapter.execute("INSERT INTO t (k) VALUES (?)", [key]);
  const keys = async () => (await adapter.query<{ k: string }>("SELECT k FROM t ORDER BY k")).map((row) => row.k);
  return { adapter, put, keys };
}

beforeEach(() => {
  phoneSqlite.reset();
  resetDatabasesForTests();
});

describe("transactions on the phone's one connection", () => {
  it.each(PLATFORMS)("a second transaction waits for the first instead of being refused (%s)", async (platform) => {
    const { adapter, put, keys } = await open(platform);
    const held = phoneSqlite.holdNextTransaction();
    const first = adapter.transaction(() => put("the sync marks an upload done"));
    await held.opened;
    const second = adapter.transaction(() => put("a save's entry in the queue"));
    await hops(6);
    held.release();
    // It used to be refused here: "Already in transaction" on Android, SQLite's own words on iOS.
    await Promise.all([first, second]);
    expect(phoneSqlite.counts.refused).toBe(0);
    expect(phoneSqlite.log).toEqual(["begin", "run", "commit", "begin", "run", "commit"]);
    expect(await keys()).toEqual(["a save's entry in the queue", "the sync marks an upload done"]);
  });

  it("they run in the order they were asked for, whatever the one before them did", async () => {
    const { adapter, put, keys } = await open();
    const outcomes = await Promise.allSettled([
      adapter.transaction(() => put("one")),
      adapter.transaction(async () => {
        await put("two");
        throw new Error("the pass could not read its file");
      }),
      adapter.transaction(() => put("three")),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(phoneSqlite.log).toEqual(["begin", "run", "commit", "begin", "run", "rollback", "begin", "run", "commit"]);
    expect(await keys()).toEqual(["one", "three"]);
  });

  it.each(PLATFORMS)("a transaction whose BEGIN fails gives its turn back (%s)", async (platform) => {
    const { adapter, put, keys } = await open(platform);
    phoneSqlite.failNext("begin");
    const failed = adapter.transaction(() => put("never"));
    const next = adapter.transaction(() => put("next"));
    await expect(failed).rejects.toThrow("disk I/O error");
    await next;
    expect(await keys()).toEqual(["next"]);
  });

  it.each(PLATFORMS)("a COMMIT that fails ends that transaction — nothing of it rides into the next one (%s)", async (platform) => {
    const { adapter, put, keys } = await open(platform);
    phoneSqlite.failNext("commit");
    await expect(adapter.transaction(() => put("not committed"))).rejects.toThrow("disk I/O error");
    expect(phoneSqlite.inTransaction(DATABASE)).toBe(false);
    // What the index does next: a full scan flushes a batch inside its
    // transaction. The adapter used to count its open transactions, counted
    // this one down twice, and from then on took every scan's batch for one
    // outside a transaction — it was refused, each time, until the app restarted.
    await adapter.transaction(() => adapter.runBatch([{ sql: "INSERT INTO t (k) VALUES (?)", params: ["the next scan"] }], { inOpenTransaction: true }));
    expect(phoneSqlite.counts.refused).toBe(0);
    expect(await keys()).toEqual(["the next scan"]);
  });

  it("what taking turns does NOT do: a single statement sent while a transaction is open runs in it, and goes with it", async () => {
    // Pinned so that nobody reads more into the turns than they give. A flow
    // that needs its write to stand by itself opens a transaction for it.
    const { adapter, put, keys } = await open();
    const held = phoneSqlite.holdNextTransaction();
    const failing = adapter.transaction(async () => {
      await put("inside");
      await hops(12);
      throw new Error("the pass could not read its file");
    });
    await held.opened;
    held.release();
    await hops(4);
    await put("a statement from elsewhere");
    expect(await keys()).toEqual(["a statement from elsewhere", "inside"]);
    await expect(failing).rejects.toThrow("could not read");
    expect(await keys()).toEqual([]);
  });
});

describe("a batch on the phone's one connection", () => {
  it.each(PLATFORMS)("sent while a transaction is being opened, it waits for that transaction (%s)", async (platform) => {
    const { adapter, put, keys } = await open(platform);
    // Sent in the same moment: the transaction's `beginTransaction` is on its
    // way when the batch — a calendar being replaced — asks for a transaction
    // of its own.
    const entry = adapter.transaction(async () => {
      await put("queue entry");
      await put("its file's state");
    });
    const calendar = adapter.runBatch([{ sql: "INSERT INTO t (k) VALUES (?)", params: ["calendar"] }]);
    // It used to be refused — and on Android the plugin rolled the OTHER
    // flow's transaction back for it: that flow wrote on outside any
    // transaction and failed at its COMMIT ("No transaction active").
    await Promise.all([entry, calendar]);
    expect(phoneSqlite.counts.refused).toBe(0);
    expect(phoneSqlite.counts.rolledBackAnother).toBe(0);
    expect(phoneSqlite.log).toEqual(["begin", "run", "run", "commit", "executeSet+tx"]);
    expect(await keys()).toEqual(["calendar", "its file's state", "queue entry"]);
  });

  it("from elsewhere, while a transaction's body runs: still one call, after it — and it does not go down with it", async () => {
    const { adapter, put, keys } = await open();
    const held = phoneSqlite.holdNextTransaction();
    const scan = adapter.transaction(async () => {
      await put("a row of the scan");
      await hops(12);
      throw new Error("the scan could not read a file");
    });
    await held.opened;
    held.release();
    await hops(4);
    const calendar = adapter.runBatch([
      { sql: "DELETE FROM t WHERE k LIKE 'event %'" },
      { sql: "INSERT INTO t (k) VALUES (?)", params: ["event 1"] },
    ]);
    await expect(scan).rejects.toThrow("could not read");
    await calendar;
    // It used to run statement by statement in the scan's transaction — a
    // reader in between saw the calendar without its events — and was rolled
    // back with the scan, its caller none the wiser.
    expect(phoneSqlite.log).toEqual(["begin", "run", "rollback", "executeSet+tx"]);
    expect(await keys()).toEqual(["event 1"]);
  });

  it("sent from inside its caller's own transaction, and saying so, it runs in that transaction", async () => {
    const { adapter, keys } = await open();
    const rows = (...names: string[]) => names.map((name) => ({ sql: "INSERT INTO t (k) VALUES (?)", params: [name] }));
    // The indexer's full scan flushes its writes this way.
    await adapter.transaction(() => adapter.runBatch(rows("a", "b"), { inOpenTransaction: true }));
    expect(phoneSqlite.log).toEqual(["begin", "run", "run", "commit"]);
    await expect(
      adapter.transaction(async () => {
        await adapter.runBatch(rows("c"), { inOpenTransaction: true });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await keys()).toEqual(["a", "b"]);
  });

  it("the word alone does not make a transaction: said outside any, the batch is one call of its own", async () => {
    const { adapter, keys } = await open();
    await adapter.runBatch([{ sql: "INSERT INTO t (k) VALUES (?)", params: ["a"] }], { inOpenTransaction: true });
    expect(phoneSqlite.log).toEqual(["executeSet+tx"]);
    expect(await keys()).toEqual(["a"]);
  });
});

describe("closing the phone's database", () => {
  it("waits for the transactions asked for before it, and what is asked for afterwards finds it closed", async () => {
    const { adapter, put } = await open();
    const held = phoneSqlite.holdNextTransaction();
    const scan = adapter.transaction(() => put("the scan"));
    await held.opened;
    // An upload the index announced, waiting for the scan — and the vault is switched.
    const announced = adapter.transaction(() => put("an entry that waited"));
    const closing = adapter.close();
    const late = adapter.transaction(() => put("too late")).then(() => "ran", (error: Error) => error.message);
    held.release();
    await Promise.all([scan, announced, closing]);
    expect(await late).toBe("database not initialized");
    expect(phoneSqlite.log).toEqual(["begin", "run", "commit", "begin", "run", "commit", "close"]);
  });
});
