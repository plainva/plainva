import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { buildPropertyPredicate, isSourceFilter } from "../src/vault/databaseQueryHelpers.js";

describe("database metadata filters over the real index", () => {
  let folder: string;
  let adapter: LocalVaultAdapter;
  let db: Awaited<ReturnType<typeof realSqlite>>;
  let query: VaultQueryService;
  const source = { filters: { and: ['file.folder == "Notes"'] } };
  const names = async (rule: unknown) => (await query.queryDatabaseFiles({ filters: { and: [...source.filters.and, rule] } }))
    .map((row) => row["file.path"]).sort();

  beforeAll(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-metadata-"));
    adapter = new LocalVaultAdapter(folder);
    await adapter.initialize();
    db = await realSqlite();
    query = new VaultQueryService(db);
    const files = {
      "Notes/A.md": '---\ntype: Note\ntags: [work]\nlabels: [work, home]\nplainva:\n  header_color: "#ABC"\n  icon: "🍃"\n---\n\n#research\n',
      "Notes/B.md": '---\ntype: Note\ntags: [work/child]\nlabels: [workshop]\nplainva:\n  header_color: "#aabbcc"\n  icon: "lucide:unknown-saved-icon"\n---\n\n#homework\n',
      "Notes/C.md": '---\ntype: Note\n---\n\nA note without tags or an icon.\n',
      "Other/D.md": '---\ntype: Note\ntags: [work]\nplainva:\n  icon: "🍃"\n---\n\nOutside the source.\n',
    };
    for (const [file, text] of Object.entries(files)) await adapter.writeTextFile(file, text);
    await new VaultIndexer(adapter, db).indexVaultFull();
  });

  afterAll(async () => {
    await db?.close();
    if (folder && path.dirname(path.resolve(folder)) === path.resolve(os.tmpdir())) await fs.rm(folder, { recursive: true, force: true });
  });

  it("normalizes colour spellings and evaluates nested groups within the source", async () => {
    expect(await names('note.plainva.header_color == "#AaBbCc"')).toEqual(["Notes/A.md", "Notes/B.md"]);
    expect(await names({ or: ['note.plainva.icon == "🍃"', { and: ['note.plainva.header_color == ""', 'file.tags.isEmpty()'] }] }))
      .toEqual(["Notes/A.md", "Notes/C.md"]);
    expect(await names('note.plainva.icon == "lucide:unknown-saved-icon"')).toEqual(["Notes/B.md"]);
  });

  it("reads inline and frontmatter tags and compares whole values, not prefixes", async () => {
    expect(await names('file.tags.contains("#work")')).toEqual(["Notes/A.md"]);
    expect(await names('file.tags.contains("#research")')).toEqual(["Notes/A.md"]);
    expect(await names('file.tags.contains("#work/child")')).toEqual(["Notes/B.md"]);
    expect(await names('!file.tags.contains("#work")')).toEqual(["Notes/B.md", "Notes/C.md"]);
    expect(await names('labels == "work"')).toEqual(["Notes/A.md"]);
    // Existing property expressions retain substring behaviour, including
    // relation queries that search A1 inside [[A1]]. New whole-note tags use
    // the native exact-membership operation above.
    expect(await names('contains(labels, "work")')).toEqual(["Notes/A.md", "Notes/B.md"]);
    expect(await names('file.tags.isEmpty()')).toEqual(["Notes/C.md"]);
  });

  it("provides source suggestions independently of an empty filtered result", async () => {
    expect(await names('note.plainva.icon == "missing"')).toEqual([]);
    const rows = await query.queryDatabaseFiles(source, { includeFilterMetadata: true });
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row["file.path"] === "Notes/A.md")?.["file.tags"].sort()).toEqual(["#research", "#work"]);
    expect(rows.find((row) => row["file.path"] === "Notes/A.md")?.plainva.header_color).toBe("#aabbcc");
    expect(await adapter.readTextFile("Notes/A.md")).toContain('header_color: "#ABC"');
  });

  it("never interprets text inside a quoted property value as a source clause", () => {
    const rule = 'status == "file.hasTag(\\"work\\")"';
    expect(isSourceFilter(rule)).toBe(false);
    expect(buildPropertyPredicate(rule)?.({ status: 'file.hasTag("work")' })).toBe(true);
  });
});
