import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realSqlite } from "./helpers/realSqlite.js";
import { initializeSchema } from "../src/db/Schema.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";

describe("empty properties through the real derived index", () => {
  let directory: string, files: LocalVaultAdapter, db: Awaited<ReturnType<typeof realSqlite>>;
  let query: VaultQueryService, indexer: VaultIndexer;
  const values = { empty: "", tilde: "~", null: "null", quoted: '"null"', string: '""', list: "[]" };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "plainva-empty-values-"));
    files = new LocalVaultAdapter(directory); await files.initialize(); db = await realSqlite();
    query = new VaultQueryService(db); indexer = new VaultIndexer(files, db);
    for (const [name, value] of Object.entries(values)) await files.writeTextFile(`Notes/${name}.md`, `---\nSummary: ${value}\n---\nBody.\n`);
    await indexer.indexVaultFull();
  });
  afterAll(async () => { await db.close(); await rm(directory, { recursive: true, force: true }); });

  it.each(["table", "list", "board", "gallery", "pinboard"])("keeps null, empty values and literal strings distinct for the shared %s rows", async type => {
    const config = { filters: { and: ['file.folder == "Notes"'] }, views: [{ type, order: ["Summary"] }] };
    const rows = await query.queryDatabaseFiles(config);
    const byName = new Map(rows.map(row => [row["file.path"], row.Summary]));
    for (const name of ["empty", "tilde", "null"]) expect(byName.get(`Notes/${name}.md`)).toBeNull();
    expect(byName.get("Notes/quoted.md")).toBe("null");
    expect(byName.get("Notes/string.md")).toBe(""); expect(byName.get("Notes/list.md")).toEqual([]);
    const empty = await query.queryDatabaseFiles({ ...config, filters: { and: [...config.filters.and, 'Summary.isEmpty()'] } });
    expect(empty.map(row => row["file.path"]).sort()).toEqual(["empty", "list", "null", "string", "tilde"].map(name => `Notes/${name}.md`));
    const nonempty = await query.queryDatabaseFiles({ ...config, filters: { and: [...config.filters.and, '!Summary.isEmpty()'] } });
    expect(nonempty.map(row => row["file.path"])).toEqual(["Notes/quoted.md"]);
  });

  it("stores explicit nulls with no string value, while preserving the quoted word", async () => {
    expect(await db.query("SELECT value, type FROM properties WHERE key = 'Summary' AND type = 'null'")).toEqual(Array.from({ length: 3 }, () => ({ value: "", type: "null" })));
    const suggestions = await query.getDistinctPropertyValues("Summary");
    expect(suggestions.find(value => value.value === "null")?.count).toBe(1);
  });

  it("rebuilds old properties once without changing any note or sync ancestor", async () => {
    await db.execute("UPDATE properties SET type = 'object', value = 'null' WHERE type = 'null'");
    await db.execute("UPDATE meta SET value = '3' WHERE key = 'index_format_version'");
    const repo = new SyncStateRepository(db), before = await repo.getSyncState("Notes/null.md");
    const write = vi.spyOn(files, "writeTextFile");
    await initializeSchema(db);
    expect((await db.queryOne<{ value: string }>("SELECT value FROM meta WHERE key = 'index_format_version'"))?.value).toBe("5");
    await indexer.indexVaultFull();
    expect(await repo.getSyncState("Notes/null.md")).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(await db.query("SELECT value, type FROM properties WHERE key = 'Summary' AND type = 'null'")).toHaveLength(3);
    const mtime = await db.query("SELECT mtime_local FROM files ORDER BY path");
    await initializeSchema(db);
    expect(await db.query("SELECT mtime_local FROM files ORDER BY path")).toEqual(mtime);
    write.mockRestore();
  });
});
