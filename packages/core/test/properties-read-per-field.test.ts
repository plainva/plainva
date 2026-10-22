import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realSqlite } from "./helpers/realSqlite.js";
import { initializeSchema } from "../src/db/Schema.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";

/**
 * A note's properties in the index, read field by field (ADR 0009, addendum
 * 2026-10-22).
 *
 * The index's reader refused a WHOLE block over one value that did not fit
 * its field. Such a note had no property in the index — empty cells in a
 * database, no hit for a property filter —, no tag from its block and the
 * file name for a title. The forms below are the ones found in the test vaults
 * (a `timestamp` that is a date, a template's placeholder, an empty `aliases:`)
 * and the ones the finding named.
 *
 * Real files, the real index on a real SQLite.
 */

const NOTES: Record<string, string> = {
  "Refs/Domains.md":
    "---\ntype: Referenz\ntitle: Domain-Sicherung\ntags:\n  - typ/referenz\naliases: [ Plainva Domains ]\ntimestamp: 2026-06-22\n---\nBody.\n",
  "Notes/Empty tags.md": "---\ntags:\nstatus: open\nowner: Anna\n---\nBody.\n",
  "Notes/Year.md": "---\ntags:\n  - 2024\n  - journal\nowner: Anna\n---\nBody.\n",
  "Notes/Numeric title.md": "---\ntitle: 2024\nstatus: open\n---\nBody.\n",
  "Templates/Person.md": "---\ntags:\n  - typ/template\naliases:\n  - {{title}}\ntemplate_for: typ/person\n---\n# {{title}}\n",
  // Its block after a byte order mark: the index's full text begins with the mark.
  "Notes/Marked.md": "\uFEFF---\ntags:\nowner: Anna\n---\nBody.\n",
  "Notes/Plain.md": "No block here.\n",
  "Notes/Readable.md": "---\ntitle: Readable\nowner: Ben\n---\nBody.\n",
};
/** The notes whose block the reader used to refuse. */
const REFUSED = ["Refs/Domains.md", "Notes/Empty tags.md", "Notes/Year.md", "Notes/Numeric title.md", "Templates/Person.md", "Notes/Marked.md"];

describe("properties read field by field, through the real index", () => {
  let directory: string, files: LocalVaultAdapter, db: Awaited<ReturnType<typeof realSqlite>>, indexer: VaultIndexer;

  const properties = async (path: string) => {
    const rows = await db.query<{ key: string; value: string; type: string }>(
      "SELECT p.key AS key, p.value AS value, p.type AS type FROM properties p JOIN files f ON f.id = p.file_id WHERE f.path = ? ORDER BY p.key",
      [path],
    );
    return Object.fromEntries(rows.map((row) => [row.key, `${row.type}:${row.value}`]));
  };
  const tags = async (path: string) =>
    (await db.query<{ tag: string }>("SELECT t.tag AS tag FROM tags t JOIN files f ON f.id = t.file_id WHERE f.path = ? ORDER BY t.tag", [path])).map((row) => row.tag);
  const file = async (path: string) => db.queryOne<{ title: string; mode: string; mtime_local: number }>("SELECT title, mode, mtime_local FROM files WHERE path = ?", [path]);

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "plainva-read-per-field-"));
    files = new LocalVaultAdapter(directory);
    await files.initialize();
    db = await realSqlite();
    indexer = new VaultIndexer(files, db);
    for (const [path, text] of Object.entries(NOTES)) await files.writeTextFile(path, text);
    await indexer.indexVaultFull();
  });
  afterAll(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("holds every property of a note whose block the reader used to refuse, with its tags and its title", async () => {
    expect(await properties("Refs/Domains.md")).toEqual({
      aliases: 'list:["Plainva Domains"]',
      tags: 'list:["typ/referenz"]',
      timestamp: "string:2026-06-22",
      title: "string:Domain-Sicherung",
      type: "string:Referenz",
    });
    expect(await file("Refs/Domains.md")).toMatchObject({ title: "Domain-Sicherung", mode: "okf" });
    expect(await tags("Refs/Domains.md")).toEqual(["typ/referenz"]);

    expect(await properties("Notes/Empty tags.md")).toEqual({ owner: "string:Anna", status: "string:open", tags: "list:[]" });
    expect(await tags("Notes/Empty tags.md")).toEqual([]);
    expect(await properties("Notes/Marked.md")).toEqual({ owner: "string:Anna", tags: "list:[]" });

    expect(await properties("Notes/Year.md")).toEqual({ owner: "string:Anna", tags: 'list:["2024","journal"]' });
    expect(await tags("Notes/Year.md")).toEqual(["2024", "journal"]);

    expect(await properties("Notes/Numeric title.md")).toEqual({ status: "string:open", title: "string:2024" });
    expect(await file("Notes/Numeric title.md")).toMatchObject({ title: "2024" });

    expect(await properties("Templates/Person.md")).toEqual({
      aliases: 'list:["{{title}}"]',
      tags: 'list:["typ/template"]',
      template_for: "string:typ/person",
    });
  });

  it("an index of format 7 catches up: the notes that begin with a block it holds no property for are read again, and no other", async () => {
    // What the old reader left in the index for the notes it refused: no
    // property, no tag from the block, the file name for a title.
    for (const path of REFUSED) {
      const row = await db.queryOne<{ id: string }>("SELECT id FROM files WHERE path = ?", [path]);
      await db.execute("DELETE FROM properties WHERE file_id = ?", [row!.id]);
      await db.execute("DELETE FROM tags WHERE file_id = ?", [row!.id]);
      await db.execute("UPDATE files SET title = ? WHERE id = ?", [path.split("/").pop()!.replace(/\.md$/, ""), row!.id]);
    }
    await db.execute("UPDATE meta SET value = '7' WHERE key = 'index_format_version'");
    const readable = (await file("Notes/Readable.md"))!.mtime_local;
    const plain = (await file("Notes/Plain.md"))!.mtime_local;
    // The step finds a block by the note's full text in the index, the mark included.
    expect((await db.queryOne<{ first: string }>("SELECT substr(content, 1, 1) AS first FROM fts_notes WHERE path = ?", ["Notes/Marked.md"]))?.first).toBe("\uFEFF");
    const repo = new SyncStateRepository(db);
    const syncBefore = await Promise.all(Object.keys(NOTES).map((path) => repo.getSyncState(path)));
    const write = vi.spyOn(files, "writeTextFile");

    await initializeSchema(db);

    expect((await db.queryOne<{ value: string }>("SELECT value FROM meta WHERE key = 'index_format_version'"))?.value).toBe("8");
    for (const path of REFUSED) expect((await file(path))!.mtime_local, path).toBe(0);
    // A note without a block has no property either, and nothing to read again.
    expect((await file("Notes/Plain.md"))!.mtime_local).toBe(plain);
    // One the index holds properties for is not.
    expect((await file("Notes/Readable.md"))!.mtime_local).toBe(readable);

    await indexer.indexVaultFull();

    expect(await properties("Notes/Empty tags.md")).toEqual({ owner: "string:Anna", status: "string:open", tags: "list:[]" });
    expect(await tags("Notes/Year.md")).toEqual(["2024", "journal"]);
    expect(await file("Refs/Domains.md")).toMatchObject({ title: "Domain-Sicherung", mode: "okf" });
    expect(await file("Notes/Numeric title.md")).toMatchObject({ title: "2024" });
    // No note was written, and no sync state moved.
    expect(write).not.toHaveBeenCalled();
    expect(await Promise.all(Object.keys(NOTES).map((path) => repo.getSyncState(path)))).toEqual(syncBefore);
    write.mockRestore();

    // The step runs once.
    const mtimes = await db.query("SELECT path, mtime_local FROM files ORDER BY path");
    await initializeSchema(db);
    expect(await db.query("SELECT path, mtime_local FROM files ORDER BY path")).toEqual(mtimes);
  });
});
