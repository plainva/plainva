import { beforeEach, describe, expect, it, vi } from "vitest";
import { phoneSqlite, type PhonePlatform } from "../../../packages/core/test/helpers/phoneSqlitePlugin";
import { MemoryVaultAdapter } from "../../../packages/core/test/helpers/memoryVault";

/**
 * The index's full scan on the phone gives the connection back between its
 * transactions (performance plan L4, Sammelplan § 3.179 no. 1).
 *
 * A save's entry in the sync queue, the sync worker marking an upload done and
 * every single write sent to the adapter take a turn on the phone's one
 * connection. The scan held one turn from its first read to its last write, and
 * all of them waited for it - up to a minute on a large vault. Now a write that
 * arrives while the scan runs is through long before the scan is.
 *
 * The shipped adapter, over the stand-in of the native side (`phoneSqlitePlugin.ts`).
 */

vi.mock("@capacitor-community/sqlite", async () => (await import("../../../packages/core/test/helpers/phoneSqlitePlugin")).phoneSqlite.module);

const { CapacitorSqliteAdapter } = await import("./adapters/CapacitorSqliteAdapter");
const { resetDatabasesForTests } = await import("./adapters/sqliteConnections");
const { initializeSchema, VaultIndexer } = await import("@plainva/core");

const PLATFORMS: PhonePlatform[] = ["android", "ios"];

beforeEach(() => {
  resetDatabasesForTests();
});

describe("the full scan and the phone's one connection", () => {
  it.each(PLATFORMS)("a write that arrives during the scan does not wait for its end (%s)", async (platform) => {
    phoneSqlite.reset(platform);
    const db = new CapacitorSqliteAdapter("plainva-scan");
    await db.initialize();
    await initializeSchema(db);
    const vault = new MemoryVaultAdapter(1_700_000_000_000);
    for (let i = 0; i < 30; i++) await vault.writeTextFile(`n${i}.md`, `# Note ${i}\n[[n${(i + 1) % 30}]] #t\n`);

    let scanDone = false;
    let writeBeforeScanEnd: boolean | null = null;
    const indexer = new VaultIndexer(vault, db, {
      scanTransactionMs: 0,
      onProgress: (current) => {
        if (current !== 4) return;
        // A single write sent to the adapter: it takes a turn (Datensicherheit D3).
        void db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('probe', '1')`)
          .then(() => { writeBeforeScanEnd = !scanDone; });
      },
    });
    await indexer.indexVaultFull();
    scanDone = true;
    await new Promise((r) => setTimeout(r, 0));
    expect(writeBeforeScanEnd).toBe(true);
    expect((await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM files`))[0].n).toBe(30);
    // Every transaction was the adapter's own turn: nothing was refused.
    expect(phoneSqlite.counts.refused).toBe(0);
    expect(phoneSqlite.counts.committed).toBeGreaterThan(10);
    await db.close();
  });
});
