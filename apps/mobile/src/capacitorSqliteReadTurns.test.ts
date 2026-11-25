import { beforeEach, describe, expect, it, vi } from "vitest";
import { phoneSqlite, type PhonePlatform } from "../../../packages/core/test/helpers/phoneSqlitePlugin";
import { MemoryVaultAdapter } from "../../../packages/core/test/helpers/memoryVault";

/**
 * A read on the phone never sees an index pass half-way.
 *
 * The phone's index is one native connection. A read used to be sent at
 * once, and when a transaction of the index was open it ran IN that
 * transaction: a note's row in `files` was there, its properties not yet, and
 * the answer had the note without its values (an assistant's query sorted by
 * a property came back in another order). The desktop's reads go to the pool
 * and see only what was committed; here a read now waits for the transaction
 * that is open — and only for that one: a full scan still gives the
 * connection back between its transactions, and reads asked for together run
 * side by side.
 *
 * The shipped adapter, over the stand-in of the native side (`phoneSqlitePlugin.ts`).
 */

vi.mock("@capacitor-community/sqlite", async () => (await import("../../../packages/core/test/helpers/phoneSqlitePlugin")).phoneSqlite.module);

const { CapacitorSqliteAdapter } = await import("./adapters/CapacitorSqliteAdapter");
const { resetDatabasesForTests } = await import("./adapters/sqliteConnections");
const { initializeSchema, VaultIndexer } = await import("@plainva/core");

const PLATFORMS: PhonePlatform[] = ["android", "ios"];
const NOTES = 32;

beforeEach(() => {
  resetDatabasesForTests();
});

const ROWS_WITHOUT_VALUES = `
  SELECT f.path AS path FROM files f
  WHERE f.path LIKE 'n%.md'
    AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.file_id = f.id AND p.key = 'rank')`;

describe("reads on the phone's one connection", () => {
  it.each(PLATFORMS)("never see a note's row without its properties while the index writes it (%s)", async (platform) => {
    expect.hasAssertions();
    phoneSqlite.reset(platform);
    const db = new CapacitorSqliteAdapter("plainva-reads");
    await db.initialize();
    await initializeSchema(db);
    const vault = new MemoryVaultAdapter(1_700_000_000_000);
    for (let i = 0; i < NOTES; i++) await vault.writeTextFile(`n${String(i).padStart(2, "0")}.md`, `---\nrank: ${i}\n---\n# Note ${i}\n`);

    // An assistant asks again and again while the index is written: one query after the other.
    const seen: string[][] = [];
    let indexing = true;
    const asking = (async () => {
      while (indexing) seen.push((await db.query<{ path: string }>(ROWS_WITHOUT_VALUES)).map((r) => r.path));
    })();
    // Every file a transaction of its own, so that the reads meet many of them.
    await new VaultIndexer(vault, db, { scanTransactionMs: 0 }).indexVaultFull();
    indexing = false;
    await asking;
    expect(seen.length).toBeGreaterThanOrEqual(NOTES);
    expect(seen.filter((paths) => paths.length > 0)).toEqual([]);
    expect((await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM properties WHERE key = 'rank'`))[0].n).toBe(NOTES);
    await db.close();
  });

  it.each(PLATFORMS)("wait for the transaction in front of them and see what it committed, never what it wrote so far (%s)", async (platform) => {
    expect.hasAssertions();
    phoneSqlite.reset(platform);
    const db = new CapacitorSqliteAdapter("plainva-reads-side");
    await db.initialize();
    await initializeSchema(db);
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const tx = db.transaction(async (handle) => {
      await handle.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('probe', 'half')`);
      await held;
      await handle.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('probe', 'whole')`);
      order.push("tx");
    });
    const read = () => db.queryOne<{ value: string }>(`SELECT value FROM meta WHERE key = 'probe'`).then((row) => { order.push(`read:${row?.value}`); });
    const reads = [read(), read(), read()];
    await new Promise((r) => setTimeout(r, 20));
    // Nothing read the half-written value. (That reads asked together run side by side is held in adapters/transactionTurns.test.ts.)
    expect(order).toEqual([]);
    release();
    await Promise.all([tx, ...reads]);
    expect(order).toEqual(["tx", "read:whole", "read:whole", "read:whole"]);
    await db.close();
  });
});
