import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("VaultIndexer", () => {
  let tmpDir: string;
  let vaultAdapter: LocalVaultAdapter;
  let db: MockDatabaseAdapter;
  let indexer: VaultIndexer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-indexer-"));
    vaultAdapter = new LocalVaultAdapter(tmpDir);
    await vaultAdapter.initialize();

    db = new MockDatabaseAdapter();
    await db.initialize();

    indexer = new VaultIndexer(vaultAdapter, db);
  });

  afterEach(async () => {
    await db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("indexes a vault full of markdown files", async () => {
    await vaultAdapter.writeTextFile("note1.md", "---\ntitle: Note 1\n---\n# Note 1\nLink to [[note2]] #urgent");
    await vaultAdapter.writeTextFile("folder/note2.md", "This is note 2.");
    
    await indexer.indexVaultFull();

    const insertFileQueries = db.queries.filter(q => q.query.includes("INSERT INTO files"));
    expect(insertFileQueries.length).toBe(2);

    const insertLinksQueries = db.queries.filter(q => q.query.includes("INSERT INTO links"));
    expect(insertLinksQueries.length).toBe(1);
    expect((insertLinksQueries[0].params as any[])[1]).toBe("note2"); // target_path

    const insertTagsQueries = db.queries.filter(q => q.query.includes("INTO tags"));
    expect(insertTagsQueries.length).toBe(1);
    expect((insertTagsQueries[0].params as any[])[1]).toBe("urgent"); // tag name
  });

  it("indexes frontmatter wiki-links with their property key", async () => {
    await vaultAdapter.writeTextFile(
      "task.md",
      '---\nprojekt: "[[Projekt X]]"\nrefs:\n  - "[[A]]"\n  - "[[B#h|Alias]]"\nnote: "see [[Inline]] here"\n---\nBody [[BodyTarget]]'
    );

    await indexer.indexVaultFull();

    // All links of one file land in ONE multi-row INSERT (P2.4). Split the
    // flat parameter list back into 6-column rows for the assertions.
    const linkInserts = db.queries.filter(q => q.query.includes("INSERT INTO links"));
    expect(linkInserts.length).toBe(1);
    const flat = linkInserts[0].params as any[];
    expect(flat.length % 6).toBe(0);
    const rows: any[][] = [];
    for (let i = 0; i < flat.length; i += 6) rows.push(flat.slice(i, i + 6));
    // 1 body link + projekt + 2 refs; the embedded-in-text link is not a relation value
    expect(rows.length).toBe(4);

    const body = rows.find(r => r[1] === "BodyTarget");
    expect(body).toBeDefined();
    expect(body![5]).toBeNull(); // property_key null = body link

    const projekt = rows.find(r => r[1] === "Projekt X");
    expect(projekt).toBeDefined();
    expect(projekt![5]).toBe("projekt");
    expect(projekt![3]).toBe("wikilink");

    const anchored = rows.find(r => r[1] === "B");
    expect(anchored).toBeDefined();
    expect(anchored![2]).toBe("B#h"); // target_raw keeps the anchor
    expect(anchored![4]).toBe("#h");
    expect(anchored![5]).toBe("refs");
  });

  it("stores ctime with adapter birthtime > stored value > mtime fallback", async () => {
    await vaultAdapter.writeTextFile("timed.md", "# timed");
    const base = {
      path: "timed.md",
      name: "timed.md",
      isDirectory: false,
      mtime: 5000,
      size: 7,
    };

    // 1) Adapter provides a birthtime -> it wins.
    db.mockedOneResults.push({ sync_state: "synced", ctime: 111 }); // existing files row
    db.mockedOneResults.push(null); // no queue op
    await indexer.indexFile({ ...base, ctime: 222 });
    let insert = db.queries.filter((q) => q.query.includes("INSERT INTO files")).at(-1)!;
    expect(insert.query).toContain("ctime");
    expect((insert.params as any[])[5]).toBe(222); // (id,path,title,sha,mtime,ctime,...)

    // 2) No adapter birthtime -> the stored ctime survives the re-index.
    db.clear();
    db.mockedOneResults.push({ sync_state: "synced", ctime: 111 });
    db.mockedOneResults.push(null);
    await indexer.indexFile({ ...base });
    insert = db.queries.filter((q) => q.query.includes("INSERT INTO files")).at(-1)!;
    expect((insert.params as any[])[5]).toBe(111);

    // 3) Neither -> first-seen lower bound = the file's mtime.
    db.clear();
    db.mockedOneResults.push(null);
    db.mockedOneResults.push(null);
    await indexer.indexFile({ ...base });
    insert = db.queries.filter((q) => q.query.includes("INSERT INTO files")).at(-1)!;
    expect((insert.params as any[])[5]).toBe(5000);
  });

  it("handles unparseable markdown files gracefully", async () => {
    await vaultAdapter.writeTextFile("broken.md", "");
    await indexer.indexVaultFull();

    const insertFileQueries = db.queries.filter(q => q.query.includes("INSERT INTO files") || q.query.includes("INSERT OR REPLACE INTO files"));
    expect(insertFileQueries.some(q => q.params.includes("broken.md"))).toBe(true);
  });

  it("keeps files local_ahead when a pending queue operation exists", async () => {
    await vaultAdapter.writeTextFile("queued.md", "Queued local change");
    // Bulk-pass lookups (P2.4): #1 known files, #2 files id/state,
    // #3 offline_queue, #4 sync_state.
    db.mockedResults.push([]); // SELECT path, mtime_local FROM files
    db.mockedResults.push([]); // bulk: files id/state
    db.mockedResults.push([{ file_path: "queued.md", new_path: null }]); // bulk: offline_queue
    db.mockedResults.push([]); // bulk: sync_state

    await indexer.indexVaultFull();

    const insertFileQuery = db.queries.find(q => q.query.includes("INSERT INTO files") && q.params.includes("queued.md"));
    expect(insertFileQuery).toBeDefined();
    expect((insertFileQuery?.params as any[]).at(-1)).toBe("local_ahead");
  });

  it("preserves an existing local_ahead sync state during re-index", async () => {
    await vaultAdapter.writeTextFile("dirty.md", "Dirty local change");
    db.mockedOneResults.push({ sync_state: "local_ahead" }); // existing files.sync_state
    db.mockedOneResults.push(null); // no pending offline_queue item

    await indexer.indexFile({
      path: "dirty.md",
      name: "dirty.md",
      isDirectory: false,
      mtime: Date.now(),
      size: 18
    });

    const insertFileQuery = db.queries.find(q => q.query.includes("INSERT INTO files") && q.params.includes("dirty.md"));
    expect(insertFileQuery).toBeDefined();
    expect((insertFileQuery?.params as any[]).at(-1)).toBe("local_ahead");
  });

  it("detects external modifications and calls callback", async () => {
    let externalModPath: string | null = null;
    const testIndexer = new VaultIndexer(vaultAdapter, db, {
      onExternalModification: (p) => { externalModPath = p; }
    });

    await vaultAdapter.writeTextFile("ext.md", "v1");
    // Simulate first index by mocking DB state so indexer thinks it already has it
    // But it's easier to just do a full index first:
    await testIndexer.indexVaultFull();

    // After first index, mock the bulk-pass lookups (P2.4 query order):
    // #1 known files, #2 files id/state, #3 offline_queue, #4 sync_state.
    db.mockedResults.push([{ path: "ext.md", mtime_local: 0 }]); // For the SELECT path, mtime_local FROM files
    db.mockedResults.push([]); // bulk: files id/state
    db.mockedResults.push([]); // bulk: offline_queue
    db.mockedResults.push([{ path: "ext.md", local_sha256: "old_fake_hash" }]); // bulk: sync_state

    // Trigger change on disk
    await vaultAdapter.writeTextFile("ext.md", "v2");
    
    // Run index again
    await testIndexer.indexVaultFull();

    expect(externalModPath).toBe("ext.md");
  });

  it("re-indexes a file whose mtime went backwards (restored older version, P1.6)", async () => {
    // The user copies an OLDER version of a file over the current one (Explorer
    // keeps the original, older mtime). A strictly-greater mtime check would
    // never re-index it and the stale content would stick in search/links.
    await vaultAdapter.writeTextFile("restored.md", "old content restored");
    db.mockedResults.push([{ path: "restored.md", mtime_local: 9_000_000_000_000_000 }]);

    await indexer.indexVaultFull();

    const insert = db.queries.find(
      (q) => q.query.includes("INSERT INTO files") && q.params.includes("restored.md")
    );
    expect(insert).toBeDefined();
  });

  it("reports newly discovered files via onNewLocalFile", async () => {
    const newFiles: string[] = [];
    const testIndexer = new VaultIndexer(vaultAdapter, db, {
      onNewLocalFile: (p) => newFiles.push(p),
    });

    await vaultAdapter.writeTextFile("fresh.md", "# fresh");
    await testIndexer.indexVaultFull();

    expect(newFiles).toContain("fresh.md");
  });

  it("reports a file gone from disk via onLocalFileDeleted (without purging sync_state itself)", async () => {
    const deleted: string[] = [];
    const testIndexer = new VaultIndexer(vaultAdapter, db, {
      onLocalFileDeleted: (p) => deleted.push(p),
    });

    // First index picks up the file.
    await vaultAdapter.writeTextFile("gone.md", "bye");
    await testIndexer.indexVaultFull();

    // Re-index: DB has gone.md, disk does not -> it counts as a deletion.
    db.mockedResults.push([{ path: "gone.md", mtime_local: 0 }]); // SELECT path, mtime_local FROM files
    await vaultAdapter.deleteItem("gone.md");
    await testIndexer.indexVaultFull();

    expect(deleted).toContain("gone.md");
    // The indexer must NOT delete sync_state itself anymore (owner = sync layer).
    expect(db.queries.some((q) => q.query.includes("DELETE FROM sync_state"))).toBe(false);
  });

  it("tracks non-.md attachments as mode=attachment and reports them as new", async () => {
    const newFiles: string[] = [];
    const testIndexer = new VaultIndexer(vaultAdapter, db, {
      onNewLocalFile: (p) => newFiles.push(p),
    });

    await vaultAdapter.writeTextFile("assets/pic.png", "PNG-BYTES");
    await vaultAdapter.writeTextFile("note.md", "# note");
    await testIndexer.indexVaultFull();

    expect(newFiles).toContain("assets/pic.png");
    const insert = db.queries.find(
      (q) => q.query.includes("INSERT INTO files") && (q.params as any[]).includes("assets/pic.png")
    );
    expect(insert).toBeDefined();
    expect((insert!.params as any[]).includes("attachment")).toBe(true);
    // Attachments get no FTS row.
    expect(db.queries.some((q) => q.query.includes("INSERT INTO fts_notes") && (q.params as any[]).includes("assets/pic.png"))).toBe(false);
  });

  it("excludes internal paths by segment but tracks attachments incl. conflict copies and lookalikes", async () => {
    const newFiles: string[] = [];
    const testIndexer = new VaultIndexer(vaultAdapter, db, {
      onNewLocalFile: (p) => newFiles.push(p),
    });

    await vaultAdapter.writeTextFile("real.png", "ok");
    await vaultAdapter.writeTextFile("notes.plainva.png", "lookalike"); // segment-anchored: NOT internal -> tracked
    await vaultAdapter.writeTextFile("img.CONFLICT-1.png", "c");         // conflict copy -> indexed (visible), not pushed
    await vaultAdapter.writeTextFile(".plainva/backups/old.bin", "x");   // real internal segment -> excluded
    await testIndexer.indexVaultFull();

    expect(newFiles).toContain("real.png");
    expect(newFiles).toContain("notes.plainva.png");
    expect(newFiles).toContain("img.CONFLICT-1.png");
    expect(newFiles.some((p) => p.replace(/\\/g, "/").split("/").includes(".plainva"))).toBe(false);
  });

  it("indexes a .base text file with a text hash + base_text (mergeable), not a byte hash", async () => {
    const content = "name: Plan\nviews:\n  - type: table\n";
    await vaultAdapter.writeTextFile("db.base", content);
    await indexer.indexVaultFull();

    // Indexed as an attachment (non-.md) ...
    const insert = db.queries.find(
      (q) => q.query.includes("INSERT INTO files") && (q.params as any[]).includes("db.base")
    );
    expect(insert).toBeDefined();
    expect((insert!.params as any[]).includes("attachment")).toBe(true);

    // ... but with a base_text (so the write path can 3-way merge) and a TEXT hash that
    // matches what ConflictAwareVaultAdapter computes — preventing spurious .CONFLICTs.
    const baseInsert = db.queries.find(
      (q) => q.query.includes("INSERT INTO sync_state") &&
             q.query.includes("base_text") &&
             (q.params as any[]).includes("db.base")
    );
    expect(baseInsert).toBeDefined();
    const params = baseInsert!.params as any[];
    expect(params).toContain(content); // base_text == file content
    expect(params).toContain(await sha256Hex(content)); // local_sha256 == text hash
  });

  // indexFile returns whether tree-relevant metadata changed so the editor can
  // skip the app-wide fileTreeVersion bump on pure prose edits (the autosave
  // typing-lag fix). The single-file path issues, in order:
  //   queryOne: existingFileState (files) -> hasPendingQueueOp (offline_queue)
  //   query:    getSyncState (sync_state) -> old tags (tags) -> old props (properties)
  // so we prime the mock FIFOs to represent the previously-indexed row.
  it("indexFile returns false when only the body changed (no frontmatter)", async () => {
    await vaultAdapter.writeTextFile("note.md", "# note\nrewritten body text");
    db.mockedOneResults = [
      { sync_state: "synced", ctime: 1000, title: "note", mode: "obsidian" }, // existingFileState
      null, // no pending queue op
    ];
    db.mockedResults = [
      [], // getSyncState -> none
      [], // old tags -> none (new tag signature is also empty)
      [], // old properties -> none (new prop signature is also empty)
    ];
    const changed = await indexer.indexFile({
      path: "note.md", name: "note.md", isDirectory: false, mtime: 2000, size: 30,
    });
    expect(changed).toBe(false);
  });

  it("indexFile returns false when the body of a note WITH unchanged frontmatter changed", async () => {
    // A `.base` row note: editing its body must NOT force a view refresh, but its
    // frontmatter (the column values) is unchanged, so metadata is unchanged.
    await vaultAdapter.writeTextFile("task.md", "---\nstatus: Todo\n---\n# task\nnew body");
    db.mockedOneResults = [
      { sync_state: "synced", ctime: 1000, title: "task", mode: "obsidian" },
      null,
    ];
    db.mockedResults = [
      [],
      [],
      [{ key: "status", value: "Todo" }], // old properties match the new frontmatter
    ];
    const changed = await indexer.indexFile({
      path: "task.md", name: "task.md", isDirectory: false, mtime: 2000, size: 40,
    });
    expect(changed).toBe(false);
  });

  it("indexFile returns true when a frontmatter property changed (e.g. a .base column)", async () => {
    await vaultAdapter.writeTextFile("task.md", "---\nstatus: Done\n---\n# task");
    db.mockedOneResults = [
      { sync_state: "synced", ctime: 1000, title: "task", mode: "obsidian" },
      null,
    ];
    db.mockedResults = [
      [],
      [],
      [{ key: "status", value: "Todo" }], // old status differs -> metadata changed
    ];
    const changed = await indexer.indexFile({
      path: "task.md", name: "task.md", isDirectory: false, mtime: 2000, size: 40,
    });
    expect(changed).toBe(true);
  });

  it("indexFile returns true when the title changed", async () => {
    await vaultAdapter.writeTextFile("note.md", "---\ntitle: New Title\n---\n# note");
    db.mockedOneResults = [
      { sync_state: "synced", ctime: 1000, title: "Old Title", mode: "okf" }, // existingFileState
      null,
    ];
    db.mockedResults = [[], [], []];
    const changed = await indexer.indexFile({
      path: "note.md", name: "note.md", isDirectory: false, mtime: 2000, size: 40,
    });
    expect(changed).toBe(true);
  });

  it("indexFile returns true when a tag was added", async () => {
    await vaultAdapter.writeTextFile("note.md", "# note\nBody with #newtag");
    db.mockedOneResults = [
      { sync_state: "synced", ctime: 1000, title: "note", mode: "obsidian" },
      null,
    ];
    db.mockedResults = [
      [],
      [], // old tags -> none, but the new content has #newtag
      [],
    ];
    const changed = await indexer.indexFile({
      path: "note.md", name: "note.md", isDirectory: false, mtime: 2000, size: 30,
    });
    expect(changed).toBe(true);
  });

  it("indexFile returns true for a newly discovered file (no existing row)", async () => {
    await vaultAdapter.writeTextFile("fresh.md", "# fresh");
    db.mockedOneResults = [null, null]; // no existing files row
    db.mockedResults = [[], [], []];
    const changed = await indexer.indexFile({
      path: "fresh.md", name: "fresh.md", isDirectory: false, mtime: 2000, size: 7,
    });
    expect(changed).toBe(true);
  });
});

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
