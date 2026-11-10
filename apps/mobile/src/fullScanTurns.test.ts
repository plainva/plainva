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
const { initializeSchema, SyncQueue, VaultIndexer } = await import("@plainva/core");

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

  it.each(PLATFORMS)("a foreign change a committed transaction found reaches the sync after the app was ended mid-scan (%s)", async (platform) => {
    phoneSqlite.reset(platform);
    const db = new CapacitorSqliteAdapter("plainva-ended");
    await db.initialize();
    await initializeSchema(db);
    const vault = new MemoryVaultAdapter(1_700_000_000_000);
    const notes = Array.from({ length: 20 }, (_, i) => `n${String(i).padStart(2, "0")}.md`);
    for (const name of notes) await vault.writeTextFile(name, `# ${name}\n`);
    await new VaultIndexer(vault, db).indexVaultFull();
    // Synced once: the remote confirmed every file.
    await db.execute(`UPDATE sync_state SET remote_etag = 'etag-1', base_sha256 = local_sha256`);
    await db.execute(`UPDATE files SET sync_state = 'synced'`);
    for (const name of notes) await vault.writeTextFile(name, `# ${name}\nchanged in another app\n`);

    // The app is ended after four transactions of the scan: no catch, no flush.
    const own = db.transaction.bind(db);
    let transactions = 0;
    let ended!: () => void;
    const endedNow = new Promise<void>((resolve) => { ended = resolve; });
    db.transaction = <T,>(fn: Parameters<typeof own>[0]) => {
      if (++transactions > 4) {
        ended();
        return new Promise<T>(() => {});
      }
      return own(fn) as Promise<T>;
    };
    const foreign: string[] = [];
    void new VaultIndexer(vault, db, { scanTransactionMs: 0, onExternalModification: (p) => foreign.push(p) }).indexVaultFull();
    await endedNow;
    expect(foreign).toEqual([]);

    // The next start, on the same database.
    const next = new CapacitorSqliteAdapter("plainva-ended");
    await next.initialize();
    await new VaultIndexer(vault, next, { scanTransactionMs: 0 }).indexVaultFull();
    await new SyncQueue(next).enqueueLocalOnlyFiles();
    const queued = (await next.query<{ file_path: string }>(`SELECT file_path FROM offline_queue WHERE operation = 'write' ORDER BY file_path`)).map((r) => r.file_path);
    expect(queued).toEqual(notes);
  });
});
