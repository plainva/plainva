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
const { initializeSchema, SqlWorkspaceStateStore, SyncStateRepository } = await import("@plainva/core");
type SqlStatements = import("@plainva/core").SqlStatements;

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
  /** A row, through a transaction's handle — or, without one, sent to the adapter itself. */
  const put = (key: string, on: SqlStatements = adapter) => on.execute("INSERT INTO t (k) VALUES (?)", [key]);
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
    const first = adapter.transaction((tx) => put("the sync marks an upload done", tx));
    await held.opened;
    const second = adapter.transaction((tx) => put("a save's entry in the queue", tx));
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
      adapter.transaction((tx) => put("one", tx)),
      adapter.transaction(async (tx) => {
        await put("two", tx);
        throw new Error("the pass could not read its file");
      }),
      adapter.transaction((tx) => put("three", tx)),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(phoneSqlite.log).toEqual(["begin", "run", "commit", "begin", "run", "rollback", "begin", "run", "commit"]);
    expect(await keys()).toEqual(["one", "three"]);
  });

  it.each(PLATFORMS)("a transaction whose BEGIN fails gives its turn back (%s)", async (platform) => {
    const { adapter, put, keys } = await open(platform);
    phoneSqlite.failNext("begin");
    const failed = adapter.transaction((tx) => put("never", tx));
    const next = adapter.transaction((tx) => put("next", tx));
    await expect(failed).rejects.toThrow("disk I/O error");
    await next;
    expect(await keys()).toEqual(["next"]);
  });

  it.each(PLATFORMS)("a COMMIT that fails ends that transaction — nothing of it rides into the next one (%s)", async (platform) => {
    const { adapter, put, keys } = await open(platform);
    phoneSqlite.failNext("commit");
    await expect(adapter.transaction((tx) => put("not committed", tx))).rejects.toThrow("disk I/O error");
    expect(phoneSqlite.inTransaction(DATABASE)).toBe(false);
    // What the index does next: a full scan flushes a batch inside its
    // transaction. The adapter used to count its open transactions, counted
    // this one down twice, and from then on took every scan's batch for one
    // outside a transaction — it was refused, each time, until the app restarted.
    await adapter.transaction((tx) => tx.runBatch!([{ sql: "INSERT INTO t (k) VALUES (?)", params: ["the next scan"] }]));
    expect(phoneSqlite.counts.refused).toBe(0);
    expect(await keys()).toEqual(["the next scan"]);
  });

  it.each(PLATFORMS)("a single write sent while a transaction is open waits for it, and stays when that one goes back (%s)", async (platform) => {
    // Datensicherheit D3: it used to run in the open transaction and was
    // rolled back with it — a statement of a flow that knew nothing of it.
    const { adapter, put, keys } = await open(platform);
    const held = phoneSqlite.holdNextTransaction();
    const failing = adapter.transaction(async (tx) => {
      await put("inside", tx);
      await hops(12);
      throw new Error("the pass could not read its file");
    });
    await held.opened;
    held.release();
    await hops(4);
    const elsewhere = put("a statement from elsewhere");
    await expect(failing).rejects.toThrow("could not read");
    await elsewhere;
    expect(phoneSqlite.log).toEqual(["begin", "run", "rollback", "run"]);
    expect(await keys()).toEqual(["a statement from elsewhere"]);
  });

  it("a read takes no turn: it is answered while a transaction is open, and sees what that one wrote so far", async () => {
    // A search must not wait for a full scan. Nothing of a read is rolled back.
    const { adapter, put, keys } = await open();
    const held = phoneSqlite.holdNextTransaction();
    let release!: () => void;
    const body = new Promise<void>((resolve) => { release = resolve; });
    const open_ = adapter.transaction(async (tx) => {
      await put("inside", tx);
      await body;
    });
    await held.opened;
    held.release();
    await hops(8);
    expect(await keys()).toEqual(["inside"]);
    release();
    await open_;
  });

  it("a body that sends a write to the adapter instead of its handle is told so, with where it was opened — under the tests, in seconds", async () => {
    const { adapter, put, keys } = await open();
    const outcome = await adapter.transaction(async () => {
      await put("to the adapter, from inside");
    }).then(() => "ran", (error: Error) => error.message);
    expect(outcome).toMatch(/waited \d+ ms for the transaction opened .*capacitorSqliteTurns\.test\.ts/);
    expect(outcome).toMatch(/instead of its handle \(tx\) waits for itself/);
    // It was never run, and the body went back: nothing of it is in.
    expect(await keys()).toEqual([]);
  }, 10_000);

  it("a handle is good for its body only: used after the body ended, it throws instead of running outside any turn", async () => {
    const { adapter, put, keys } = await open();
    let kept: SqlStatements | null = null;
    await adapter.transaction(async (tx) => { kept = tx; });
    await expect(put("late", kept!)).rejects.toThrow("This transaction is over");
    expect(await keys()).toEqual([]);
  });
});

describe("a batch on the phone's one connection", () => {
  it.each(PLATFORMS)("sent while a transaction is being opened, it waits for that transaction (%s)", async (platform) => {
    const { adapter, put, keys } = await open(platform);
    // Sent in the same moment: the transaction's `beginTransaction` is on its
    // way when the batch — a calendar being replaced — asks for a transaction
    // of its own.
    const entry = adapter.transaction(async (tx) => {
      await put("queue entry", tx);
      await put("its file's state", tx);
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
    const scan = adapter.transaction(async (tx) => {
      await put("a row of the scan", tx);
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

  it("sent through a transaction's handle, it runs in that transaction", async () => {
    const { adapter, keys } = await open();
    const rows = (...names: string[]) => names.map((name) => ({ sql: "INSERT INTO t (k) VALUES (?)", params: [name] }));
    // The indexer's full scan flushes its writes this way.
    await adapter.transaction((tx) => tx.runBatch!(rows("a", "b")));
    expect(phoneSqlite.log).toEqual(["begin", "run", "run", "commit"]);
    await expect(
      adapter.transaction(async (tx) => {
        await tx.runBatch!(rows("c"));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await keys()).toEqual(["a", "b"]);
  });
});

describe("closing the phone's database", () => {
  it("waits for the transactions asked for before it, and what is asked for afterwards finds it closed", async () => {
    const { adapter, put } = await open();
    const held = phoneSqlite.holdNextTransaction();
    const scan = adapter.transaction((tx) => put("the scan", tx));
    await held.opened;
    // An upload the index announced, waiting for the scan — and the vault is switched.
    const announced = adapter.transaction((tx) => put("an entry that waited", tx));
    const closing = adapter.close();
    const late = adapter.transaction((tx) => put("too late", tx)).then(() => "ran", (error: Error) => error.message);
    held.release();
    await Promise.all([scan, announced, closing]);
    expect(await late).toBe("database not initialized");
    expect(phoneSqlite.log).toEqual(["begin", "run", "commit", "begin", "run", "commit", "close"]);
  });
});

/**
 * What used to go down with somebody else's transaction (Datensicherheit D3):
 * the writers that send one statement to the adapter, while a transaction of
 * another flow — a full scan, a calendar, a queue entry — is open and then
 * fails. Over the shipped adapter and the vault's real schema.
 */
describe("a write of its own is not rolled back with a transaction of another flow", () => {
  async function vault(platform: PhonePlatform) {
    phoneSqlite.reset(platform);
    resetDatabasesForTests();
    const adapter = new CapacitorSqliteAdapter(DATABASE);
    await adapter.initialize();
    await initializeSchema(adapter);
    phoneSqlite.log.length = 0;
    /** A transaction of another flow that writes a row and then fails, once the write from outside has been sent. */
    const failingScan = async (during: () => Promise<void>) => {
      const held = phoneSqlite.holdNextTransaction();
      const scan = adapter.transaction(async (tx) => {
        await tx.execute("INSERT INTO meta (key, value) VALUES ('scan-row', '1')");
        await hops(12);
        throw new Error("the scan could not read a file");
      });
      await held.opened;
      held.release();
      await hops(4);
      const outside = during();
      await expect(scan).rejects.toThrow("could not read");
      await outside;
      expect(await adapter.queryOne("SELECT value FROM meta WHERE key = 'scan-row'")).toBeNull();
    };
    return { adapter, failingScan };
  }

  it.each(PLATFORMS)("a sync row deleted from elsewhere stays deleted (%s)", async (platform) => {
    const { adapter, failingScan } = await vault(platform);
    const repo = new SyncStateRepository(adapter);
    await repo.updateLocalHash("a.md", "hash-a");
    await failingScan(() => repo.deleteSyncState("a.md"));
    expect(await repo.getSyncState("a.md")).toBeNull();
  });

  it.each(PLATFORMS)("a merge base the sync recorded stays recorded (%s)", async (platform) => {
    const { adapter, failingScan } = await vault(platform);
    const repo = new SyncStateRepository(adapter);
    await failingScan(() => repo.recordSyncedBase("a.md", { sha256: "base-hash", etag: "e1", text: "the base" }));
    const row = await repo.getSyncState("a.md");
    expect(row?.base_sha256).toBe("base-hash");
    expect(row?.base_text).toBe("the base");
  });

  it.each(PLATFORMS)("an entry of the encrypted workspace's queue stays queued (%s)", async (platform) => {
    const { adapter, failingScan } = await vault(platform);
    const state = new SqlWorkspaceStateStore(adapter);
    await failingScan(async () => { await state.enqueue("write", "a.md"); });
    expect((await state.listQueue()).map((entry) => [entry.operation, entry.path])).toEqual([["write", "a.md"]]);
  });
});
