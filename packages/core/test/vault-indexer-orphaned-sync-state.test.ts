import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/**
 * TestFlight feedback Build 91, P1: a freshly created note showed a conflict
 * card. The index still held the sync_state row of a deleted note with the
 * same name ("Notiz 1"), compared the new file against it and reported a
 * foreign change; because the row existed, no baseline was written either.
 */
describe("VaultIndexer — orphaned sync_state rows and own writes", () => {
  let tmpDir: string;
  let vault: LocalVaultAdapter;
  let db: MockDatabaseAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-orphan-"));
    vault = new LocalVaultAdapter(tmpDir);
    await vault.initialize();
    db = new MockDatabaseAdapter();
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("treats a sync_state row without a files row as no row: baseline set, announced as new, no external modification", async () => {
    const external: string[] = [];
    const fresh: string[] = [];
    const indexer = new VaultIndexer(vault, db, {
      onExternalModification: (p) => external.push(p),
      onNewLocalFile: (p) => fresh.push(p),
    });
    await vault.writeTextFile("Inbox/Notiz 1.md", "# Notiz 1\n\nneu");

    // Single-file path (what a save on the phone runs): files row -> none,
    // offline_queue -> none (queryOne), then the STALE sync_state row of the
    // deleted note (getSyncState reads via query).
    db.mockedOneResults.push(null, null);
    db.mockedResults.push([{ path: "Inbox/Notiz 1.md", local_sha256: "hash-of-the-deleted-note", base_text: "# Notiz 1\n\nalt" }]);
    await indexer.indexFile(await vault.getFileInfo("Inbox/Notiz 1.md"));

    expect(external).toEqual([]);
    expect(fresh).toEqual(["Inbox/Notiz 1.md"]);
    const baseline = db.queries.find((q) => q.query.includes("INSERT INTO sync_state") && (q.params as any[])[0] === "Inbox/Notiz 1.md");
    expect(baseline).toBeDefined();
    expect((baseline!.params as any[])[1]).not.toBe("hash-of-the-deleted-note");
    expect((baseline!.params as any[])[2]).toBe("# Notiz 1\n\nneu");
  });

  it("still reports a foreign change for a file the index knows", async () => {
    const external: string[] = [];
    const indexer = new VaultIndexer(vault, db, { onExternalModification: (p) => external.push(p) });
    await vault.writeTextFile("known.md", "changed elsewhere");

    // files row PRESENT this time: the row is not orphaned, the hash differs.
    db.mockedOneResults.push({ sync_state: "synced", ctime: 1 }, null);
    db.mockedResults.push([{ path: "known.md", local_sha256: "what-we-had", base_text: null }]);
    await indexer.indexFile(await vault.getFileInfo("known.md"));

    expect(external).toEqual(["known.md"]);
    expect(db.queries.some((q) => q.query.includes("INSERT INTO sync_state"))).toBe(false);
  });

  it("stays quiet when the adapter says the content is its own write", async () => {
    const external: string[] = [];
    const indexer = new VaultIndexer(vault, db, {
      isOwnWrite: () => true,
      onExternalModification: (p) => external.push(p),
    });
    await vault.writeTextFile("own.md", "v1");
    await indexer.indexVaultFull();

    // Bulk pass (P2.4 query order): known files, files id/state, offline_queue, sync_state.
    db.mockedResults.push([{ path: "own.md", mtime_local: 0 }]);
    db.mockedResults.push([{ id: "x", sync_state: "synced", ctime: 1 }]);
    db.mockedResults.push([]);
    db.mockedResults.push([{ path: "own.md", local_sha256: "not-yet-updated" }]);
    await vault.writeTextFile("own.md", "v2");
    await indexer.indexVaultFull();

    expect(external).toEqual([]);
  });
});
