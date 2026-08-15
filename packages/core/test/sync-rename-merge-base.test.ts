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
 * Issue #48: renaming a note and then editing it produced a `.CONFLICT` copy
 * instead of a merge.
 *
 * `sync_state` is keyed by path, exactly like `files` — but only `files` moved
 * when a path moved. The merge base (base_sha256/base_text) stayed stranded
 * under the OLD key, so the new path looked like a brand-new file to the
 * indexer, which then recorded local content with no base at all. With no
 * common ancestor, `reconcilePulledFile` cannot fast-forward and cannot merge:
 * it preserves the local version as a `.CONFLICT` copy and takes the remote.
 *
 * Latent while the content still matches on both sides — which is why it hits
 * the first note someone reorganises AND edits, not the tenth. Providers that
 * return an identifier for a move mask it; many WebDAV servers do not.
 *
 * Real SQLite (node:sqlite, Node >= 22.5) rather than the recording mock: the
 * point of these tests is which ROW survives a path move, and a fake adapter
 * would happily answer whatever it was told last.
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

interface StateRow {
  path: string;
  base_sha256: string | null;
  base_text: string | null;
  base_etag: string | null;
  remote_id: string | null;
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

  /** What a completed push leaves behind: a common ancestor to merge against. */
  async function giveMergeBase(p: string, sha: string, etag: string, remoteId: string) {
    await db.execute(
      `UPDATE sync_state SET base_sha256 = ?, base_etag = ?, remote_id = ? WHERE path = ?`,
      [sha, etag, remoteId, p],
    );
  }

  async function state(p: string): Promise<StateRow | null> {
    return db.queryOne<StateRow>(
      `SELECT path, base_sha256, base_text, base_etag, remote_id FROM sync_state WHERE path = ?`,
      [p],
    );
  }

  return {
    tmpDir,
    vaultAdapter,
    db,
    indexer,
    queue,
    giveMergeBase,
    state,
    async dispose() {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

describe("renaming carries the merge base (issue #48)", () => {
  it("keeps base_sha256 when a single note is renamed", async () => {
    const h = await harness("plainva-rename-base-");
    try {
      await h.vaultAdapter.writeTextFile("note.md", "# Note");
      await h.indexer.indexVaultFull();
      await h.giveMergeBase("note.md", "base-sha-1", '"etag-1"', "remote-1");

      // What an in-app rename does: move it on disk, tell the queue, re-index
      // the two paths (apps/desktop/src/services/fileActions.ts reindexAfterRename).
      await h.vaultAdapter.renameItem("note.md", "renamed.md");
      await h.queue.queueRename("note.md", "renamed.md");
      await h.indexer.removePathFromIndex("note.md");
      await h.indexer.indexPath("renamed.md");

      const moved = await h.state("renamed.md");
      // Before the fix this was null: the indexer saw no state at the new path,
      // treated the note as newly discovered and wrote local content with no base.
      expect(moved?.base_sha256, "the merge base travels with the file").toBe("base-sha-1");
      expect(moved?.base_etag).toBe('"etag-1"');
      expect(moved?.remote_id, "the remote identity travels too").toBe("remote-1");
      expect(moved?.base_text, "the ancestor text survives for 3-way merges").toBe("# Note");

      const left = await h.state("note.md");
      expect(left, "no stale row is left under the old path").toBeNull();
    } finally {
      await h.dispose();
    }
  });

  it("keeps the base of every note inside a renamed folder", async () => {
    const h = await harness("plainva-rename-base-folder-");
    try {
      await h.vaultAdapter.createDir("Projects");
      await h.vaultAdapter.writeTextFile("Projects/a.md", "# A");
      await h.vaultAdapter.writeTextFile("Projects/b.md", "# B");
      await h.indexer.indexVaultFull();
      await h.giveMergeBase("Projects/a.md", "base-a", '"etag-a"', "remote-a");
      await h.giveMergeBase("Projects/b.md", "base-b", '"etag-b"', "remote-b");

      await h.vaultAdapter.renameItem("Projects", "Work");
      await h.queue.queueRename("Projects", "Work");

      expect((await h.state("Work/a.md"))?.base_sha256).toBe("base-a");
      expect((await h.state("Work/b.md"))?.base_sha256).toBe("base-b");
      expect(await h.state("Projects/a.md")).toBeNull();
      expect(await h.state("Projects/b.md")).toBeNull();
    } finally {
      await h.dispose();
    }
  });

  it("leaves the state of an unrelated sibling alone when the name contains LIKE wildcards", async () => {
    const h = await harness("plainva-rename-base-like-");
    try {
      // Same trap as the files table: an unescaped `%` would reach beyond the
      // folder being renamed and move a stranger's merge base.
      await h.vaultAdapter.createDir("50%");
      await h.vaultAdapter.writeTextFile("50%/a.md", "# A");
      await h.vaultAdapter.createDir("50-off");
      await h.vaultAdapter.writeTextFile("50-off/b.md", "# B");
      await h.indexer.indexVaultFull();
      await h.giveMergeBase("50-off/b.md", "base-stranger", '"etag-s"', "remote-s");

      await h.vaultAdapter.renameItem("50%", "Half");
      await h.queue.queueRename("50%", "Half");

      const stranger = await h.state("50-off/b.md");
      expect(stranger?.base_sha256, "the unrelated sibling keeps its base").toBe("base-stranger");
    } finally {
      await h.dispose();
    }
  });

  it("replaces a state row already sitting at the target path", async () => {
    const h = await harness("plainva-rename-base-collision-");
    try {
      // A note that once lived at the target and was deleted leaves its
      // sync_state behind on purpose (the remote delete must still be pushed).
      // The row that arrives with the rename is the one carrying the truth.
      await h.vaultAdapter.writeTextFile("keep.md", "# Keep");
      await h.vaultAdapter.writeTextFile("taken.md", "# Taken");
      await h.indexer.indexVaultFull();
      await h.giveMergeBase("keep.md", "base-keep", '"etag-keep"', "remote-keep");
      await h.giveMergeBase("taken.md", "base-taken", '"etag-taken"', "remote-taken");
      await h.vaultAdapter.deleteItem("taken.md");
      await h.indexer.removePathFromIndex("taken.md");

      await h.vaultAdapter.renameItem("keep.md", "taken.md");
      await expect(h.queue.queueRename("keep.md", "taken.md")).resolves.toBeUndefined();

      const rows = await h.db.query<StateRow>(
        `SELECT path, base_sha256 FROM sync_state WHERE path = ?`,
        ["taken.md"],
      );
      expect(rows, "exactly one state row survives at the target").toHaveLength(1);
      expect(rows[0].base_sha256).toBe("base-keep");
    } finally {
      await h.dispose();
    }
  });
});
