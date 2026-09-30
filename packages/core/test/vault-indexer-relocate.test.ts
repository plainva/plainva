import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";

/**
 * Issue 113, second half of the chain: after a move in the app the shells
 * told the index that the OLD path was deleted (`removePathFromIndex`), and
 * the index told the sync layer — a remote DELETE queued next to the MOVE.
 * And the new path, whose row `queueRename` had moved without changing its
 * id, looked like a brand-new file: baseline overwritten, a write queued.
 * The index now follows a move as what it is.
 */

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function harness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-relocate-"));
  const db: IDatabaseAdapter = await realSqlite();
  cleanups.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const vault = new LocalVaultAdapter(root);
  await vault.initialize();
  const deleted: string[] = [];
  const created: string[] = [];
  const indexer = new VaultIndexer(vault, db, {
    onLocalFileDeleted: (p) => void deleted.push(p),
    onNewLocalFile: (p) => void created.push(p),
  });
  const queue = new SyncQueue(db);
  const rows = async (table: "files" | "fts_notes") =>
    (await db.query<{ path: string }>(`SELECT path FROM ${table} ORDER BY path`)).map((r) => r.path);
  const baseText = async (p: string) =>
    (await db.queryOne<{ base_text: string | null }>(`SELECT base_text FROM sync_state WHERE path = ?`, [p]))?.base_text ?? null;
  return { vault, db, indexer, queue, deleted, created, rows, baseText };
}

describe("the index follows an in-app move (issue 113)", () => {
  it("re-keys a moved note without reporting a deletion", async () => {
    const h = await harness();
    await h.vault.writeTextFile("A/note.md", "# Note\n");
    await h.indexer.indexVaultFull();
    h.created.length = 0;

    await h.vault.renameItem("A/note.md", "B/note.md");
    await h.indexer.relocatePathInIndex("A/note.md", "B/note.md");
    await h.indexer.indexPath("B/note.md");

    expect(h.deleted, "no DELETE for the old path").toEqual([]);
    expect(await h.rows("files")).toEqual(["B/note.md"]);
    expect(await h.rows("fts_notes")).toEqual(["B/note.md"]);
  });

  it("recognises a row queueRename already moved, and keeps its merge base", async () => {
    const h = await harness();
    await h.vault.writeTextFile("A/note.md", "# Note\n");
    await h.indexer.indexVaultFull();
    h.created.length = 0;
    // An edit that has not reached the remote yet: the base must stay the
    // last agreed text, not become this one.
    await h.vault.writeTextFile("A/note.md", "# Note\n\nunsynced\n");

    await h.vault.renameItem("A/note.md", "B/note.md");
    await h.queue.queueRename("A/note.md", "B/note.md");
    await h.indexer.relocatePathInIndex("A/note.md", "B/note.md");
    await h.indexer.indexPath("B/note.md");

    expect(h.deleted, "no DELETE for the old path").toEqual([]);
    expect(h.created, "not a new file: no second upload queued").toEqual([]);
    expect(await h.baseText("B/note.md"), "the merge base survives").toBe("# Note\n");
    expect(await h.rows("files")).toEqual(["B/note.md"]);
    expect(await h.rows("fts_notes"), "search finds it at the new place only").toEqual(["B/note.md"]);
  });

  it("relocates a whole folder, leaving a look-alike sibling alone", async () => {
    const h = await harness();
    await h.vault.writeTextFile("Projekt/a.md", "# a\n");
    await h.vault.writeTextFile("Projekt/sub/b.md", "# b\n");
    await h.vault.writeTextFile("Projekte/c.md", "# c\n");
    await h.indexer.indexVaultFull();
    h.created.length = 0;

    await h.vault.renameItem("Projekt", "Archiv/Projekt");
    await h.indexer.relocatePathInIndex("Projekt", "Archiv/Projekt");
    await h.indexer.indexVaultFull();

    expect(h.deleted).toEqual([]);
    expect(await h.rows("files")).toEqual(["Archiv/Projekt/a.md", "Archiv/Projekt/sub/b.md", "Projekte/c.md"]);
    expect(await h.rows("fts_notes")).toEqual(["Archiv/Projekt/a.md", "Archiv/Projekt/sub/b.md", "Projekte/c.md"]);
  });

  it("replaces a stale row that sat at the destination", async () => {
    const h = await harness();
    await h.vault.writeTextFile("keep.md", "# keep\n");
    await h.vault.writeTextFile("taken.md", "# taken\n");
    await h.indexer.indexVaultFull();
    await h.vault.deleteItem("taken.md");

    await h.vault.renameItem("keep.md", "taken.md");
    await h.indexer.relocatePathInIndex("keep.md", "taken.md");
    await h.indexer.indexPath("taken.md");

    expect(await h.rows("files")).toEqual(["taken.md"]);
    expect(await h.rows("fts_notes")).toEqual(["taken.md"]);
    const fts = await h.db.queryOne<{ content: string }>(`SELECT content FROM fts_notes WHERE path = ?`, ["taken.md"]);
    expect(fts?.content, "the destination row describes the moved note").toBe("# keep\n");
  });
});
