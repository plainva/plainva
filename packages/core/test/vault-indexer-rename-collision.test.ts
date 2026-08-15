import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { SyncQueue } from "../src/sync/SyncQueue.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";

/**
 * Issue #34: deleting a folder failed with
 * `UNIQUE constraint failed: files.path`, and the folder stayed in the tree.
 *
 * The collision is only observable against a database that actually ENFORCES the
 * constraint, so this runs on real SQLite (node:sqlite, Node >= 22.5) rather
 * than the query-recording mock — a fake adapter would happily accept the
 * duplicate row and the bug would test green.
 */
class NodeSqliteAdapter implements IDatabaseAdapter {
  constructor(private db: any) {}
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = this.db.prepare(sql).all(...(params as never[])) as T[];
    return rows[0] ?? null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

async function harness(prefix: string) {
  const { DatabaseSync } = (await import("node:sqlite")) as any;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const vaultAdapter = new LocalVaultAdapter(tmpDir);
  await vaultAdapter.initialize();
  const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
  await initializeSchema(db);
  const indexer = new VaultIndexer(vaultAdapter, db);
  const queue = new SyncQueue(db);
  return {
    tmpDir,
    vaultAdapter,
    db,
    indexer,
    queue,
    async dispose() {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

describe("re-indexing a renamed folder (issue #34)", () => {
  it("replaces rows whose id no longer matches their path instead of colliding", async () => {
    const h = await harness("plainva-rename-collision-");
    try {
      await h.vaultAdapter.createDir("Orph");
      await h.vaultAdapter.writeTextFile("Orph/note.md", "# Note");
      await h.indexer.indexVaultFull();

      // What an in-app folder rename does: move it on disk, then tell the queue.
      // queueRename rewrites `files.path` but deliberately leaves `files.id`
      // alone (id is the cascade parent of links/tags/properties), so the row is
      // now id=sha256("Orph/note.md") at path="Renamed/note.md".
      await h.vaultAdapter.renameItem("Orph", "Renamed");
      await h.queue.queueRename("Orph", "Renamed");

      const stale = await h.db.queryOne<{ id: string }>(`SELECT id FROM files WHERE path = ?`, [
        "Renamed/note.md",
      ]);
      const expectedId = await (h.indexer as any).generateFileId("Renamed/note.md");
      expect(stale?.id, "precondition: the row carries the OLD id").not.toBe(expectedId);

      // Before the fix this threw (the DELETE keyed on the new id matched
      // nothing, the INSERT hit the UNIQUE path) and — because the desktop
      // batches the scan atomically — rolled back the entire scan, permanently.
      await expect(h.indexer.indexVaultFull()).resolves.toBeDefined();

      const rows = await h.db.query<{ id: string; path: string }>(
        `SELECT id, path FROM files WHERE path = ?`,
        ["Renamed/note.md"],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(expectedId);
    } finally {
      await h.dispose();
    }
  });

  it("leaves rows of a same-named sibling alone when the folder name contains LIKE wildcards", async () => {
    const h = await harness("plainva-rename-like-");
    try {
      // "50%" makes `%` a wildcard in an unescaped LIKE prefix, so the rename
      // of "50%" would also rewrite paths under "50-off" and "50x".
      await h.vaultAdapter.createDir("50%");
      await h.vaultAdapter.writeTextFile("50%/a.md", "# A");
      await h.vaultAdapter.createDir("50-off");
      await h.vaultAdapter.writeTextFile("50-off/b.md", "# B");
      await h.indexer.indexVaultFull();

      await h.vaultAdapter.renameItem("50%", "Half");
      await h.queue.queueRename("50%", "Half");

      const untouched = await h.db.queryOne<{ path: string }>(
        `SELECT path FROM files WHERE path = ?`,
        ["50-off/b.md"],
      );
      expect(untouched?.path, "the unrelated sibling keeps its path").toBe("50-off/b.md");

      const moved = await h.db.queryOne<{ path: string }>(`SELECT path FROM files WHERE path = ?`, [
        "Half/a.md",
      ]);
      expect(moved?.path).toBe("Half/a.md");
    } finally {
      await h.dispose();
    }
  });

  /**
   * The other half of #34: the INSERT path was hardened, the DELETE path was not.
   * De-indexing keyed on sha256(path) — which is exactly the value a row loses
   * when its folder is renamed.
   */
  it("de-indexes a row whose id no longer matches its path", async () => {
    const h = await harness("plainva-rename-orphan-");
    try {
      await h.vaultAdapter.createDir("Orph");
      await h.vaultAdapter.writeTextFile("Orph/note.md", "# Note");
      await h.indexer.indexVaultFull();

      await h.vaultAdapter.renameItem("Orph", "Renamed");
      await h.queue.queueRename("Orph", "Renamed");

      // Now delete the note. Before the fix the DELETE keyed on
      // sha256("Renamed/note.md") matched nothing, and — unlike the insert path —
      // nothing followed to repair it: the file was gone from disk while the tree
      // and the search index still listed it, until some later full scan.
      await h.vaultAdapter.deleteItem("Renamed/note.md");
      await h.indexer.removePathFromIndex("Renamed/note.md");

      const left = await h.db.query<{ path: string }>(`SELECT path FROM files WHERE path = ?`, [
        "Renamed/note.md",
      ]);
      expect(left, "the deleted note leaves no orphan row behind").toHaveLength(0);
    } finally {
      await h.dispose();
    }
  });

  it("de-indexes only the given path, not a note that merely carries its old id", async () => {
    const h = await harness("plainva-rename-overreach-");
    try {
      await h.vaultAdapter.writeTextFile("a.md", "# A");
      await h.indexer.indexVaultFull();

      // After the move the row sits at b.md but still carries sha256("a.md") —
      // so de-indexing "a.md" by id would reach across and delete a note that
      // exists, on disk and in the tree.
      await h.vaultAdapter.renameItem("a.md", "b.md");
      await h.queue.queueRename("a.md", "b.md");
      await h.indexer.removePathFromIndex("a.md");

      const survivor = await h.db.queryOne<{ path: string }>(
        `SELECT path FROM files WHERE path = ?`,
        ["b.md"],
      );
      expect(survivor?.path, "the renamed note is untouched").toBe("b.md");
    } finally {
      await h.dispose();
    }
  });
});
