import { describe, expect, it, beforeEach } from "vitest";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import { VaultQueryService } from "../src/vault/VaultQueryService.ts";

describe("VaultQueryService", () => {
  let db: MockDatabaseAdapter;
  let queryService: VaultQueryService;

  beforeEach(async () => {
    db = new MockDatabaseAdapter();
    await db.initialize();
    queryService = new VaultQueryService(db);
  });

  it("searches full text with a quoted prefix MATCH (search-as-you-type)", async () => {
    db.mockedResults.push([{ path: "hello.md", snippet: "snippet" }]);
    const results = await queryService.searchFullText("importan");
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("hello.md");
    expect(db.queries[0].query).toContain("MATCH ?");
    // The raw input never reaches MATCH — it is quoted and prefix-starred.
    expect((db.queries[0].params as any[])[0]).toBe('"importan"*');
    // Title hits outrank body hits; snippet/highlight use char(1)/char(2).
    expect(db.queries[0].query).toContain("bm25(fts_notes, 1.0, 4.0)");
    expect(db.queries[0].query).toContain("snippet(fts_notes, 0, char(1), char(2)");
    expect(db.queries[0].query).toContain("highlight(fts_notes, 1, char(1), char(2)) AS titleHighlighted");
    // Default limit is a bound parameter.
    expect((db.queries[0].params as any[])[1]).toBe(50);
  });

  it("passes a custom search limit through", async () => {
    db.mockedResults.push([]);
    await queryService.searchFullText("foo", 10);
    expect((db.queries[0].params as any[])[1]).toBe(10);
  });

  it("issues no query for empty or tokenizer-empty search input", async () => {
    expect(await queryService.searchFullText("   ")).toEqual([]);
    expect(await queryService.searchFullText("- (((")).toEqual([]);
    expect(db.queries.length).toBe(0);
  });

  it("applies -term exclusions as a NOT IN fts subquery", async () => {
    db.mockedResults.push([]);
    await queryService.searchFullText("projekt -review");
    const q = db.queries[0];
    expect(q.query).toContain("f.path NOT IN (SELECT path FROM fts_notes WHERE fts_notes MATCH ?)");
    expect(q.params as any[]).toEqual(['"projekt"*', '"review"*', 50]);
  });

  it("applies path: and tag: operators as SQL filters next to the MATCH", async () => {
    db.mockedResults.push([]);
    await queryService.searchFullText('foo path:Notes -path:archiv tag:intern -tag:alt');
    const q = db.queries[0];
    expect(q.query).toContain("instr(lower(f.path), ?) > 0");
    expect(q.query).toContain("instr(lower(f.path), ?) = 0");
    expect(q.query).toContain("EXISTS (SELECT 1 FROM tags t WHERE t.file_id = f.id AND (t.tag = ? OR t.tag LIKE ?))");
    expect(q.query).toContain("NOT EXISTS (SELECT 1 FROM tags t");
    expect(q.params as any[]).toEqual(['"foo"*', "notes", "archiv", "intern", "intern/%", "alt", "alt/%", 50]);
  });

  it("searches without MATCH for pure operator queries (tag:/path: only)", async () => {
    db.mockedResults.push([]);
    await queryService.searchFullText("tag:projekt");
    const q = db.queries[0];
    expect(q.query).not.toContain("MATCH");
    expect(q.query).toContain("FROM files f");
    expect(q.query).toContain("ORDER BY f.mtime_local DESC");
    expect(q.query).toContain("NULL AS snippet");
    expect(q.params as any[]).toEqual(["projekt", "projekt/%", 50]);
  });

  it("finds backlinks", async () => {
    // 1st query: links
    db.mockedResults.push([{ source_path: "hello.md", target_path: "world" }]);
    // 2nd query: all files
    db.mockedResults.push([{ path: "hello.md" }, { path: "world.md" }]);

    const backlinks = await queryService.getBacklinks("world.md");
    expect(backlinks.length).toBe(1);
    expect(db.queries[0].query).toContain("FROM links");
    expect((db.queries[0].params as any[])[0]).toBe("%world%");
  });

  it("finds files by tag", async () => {
    db.mockedResults.push([{ path: "hello.md" }]);
    const files = await queryService.getFilesByTag("urgent");
    expect(files.length).toBe(1);
    expect(db.queries[0].query).toContain("FROM tags");
    expect((db.queries[0].params as any[])[0]).toBe("urgent");
  });

  it("gets file properties", async () => {
    db.mockedResults.push([{ key: "priority", value: "high", type: "string" }]);
    const props = await queryService.getFileProperties("hello.md");
    expect(props).toEqual({ priority: "high" });
  });

  it("maps document icons (value + tint) from the plainva namespace, skipping malformed rows", async () => {
    db.mockedResults.push([
      { path: "a.md", value: '{"icon":"🚀","header_color":"#2f6f6f"}' },
      { path: "b.md", value: '{"header_color":"#aabbcc"}' },
      { path: "c.md", value: "not-json" },
      { path: "d.md", value: '{"icon":"lucide:rocket","icon_color":"#c94f4f"}' },
    ]);
    const icons = await queryService.getDocumentIcons();
    expect(icons.get("a.md")).toEqual({ icon: "🚀", color: undefined });
    expect(icons.has("b.md")).toBe(false);
    expect(icons.has("c.md")).toBe(false);
    expect(icons.get("d.md")).toEqual({ icon: "lucide:rocket", color: "#c94f4f" });
    expect((db.queries[0].params as any[])[0]).toBe("plainva");
  });

  it("gets distinct property values, most-used first", async () => {
    db.mockedResults.push([
      { value: "final", count: 5 },
      { value: "draft", count: 2 },
    ]);
    const values = await queryService.getDistinctPropertyValues("status");
    expect(values).toEqual([
      { value: "final", count: 5 },
      { value: "draft", count: 2 },
    ]);
    expect(db.queries[0].query).toContain("FROM properties");
    expect(db.queries[0].query).toContain("GROUP BY value");
    expect((db.queries[0].params as any[])[0]).toBe("status");
  });

  it("drops empty distinct property values", async () => {
    db.mockedResults.push([
      { value: "", count: 1 },
      { value: "x", count: 3 },
    ]);
    const values = await queryService.getDistinctPropertyValues("k");
    expect(values).toEqual([{ value: "x", count: 3 }]);
  });

  it("scopes distinct property values to a folder prefix", async () => {
    db.mockedResults.push([{ value: "final", count: 2 }]);
    await queryService.getDistinctPropertyValues("status", "Calendar/Tagebuch/");
    expect(db.queries[0].query).toContain("JOIN files");
    expect(db.queries[0].query).toContain("f.path LIKE ?");
    expect(db.queries[0].params as any[]).toEqual(["status", "Calendar/Tagebuch/%"]);
  });

  it("stays global when no folder prefix is given", async () => {
    db.mockedResults.push([{ value: "final", count: 2 }]);
    await queryService.getDistinctPropertyValues("status");
    expect(db.queries[0].query).not.toContain("JOIN files");
    expect(db.queries[0].params as any[]).toEqual(["status"]);
  });

  const threeFilesWithPriority = () => {
    db.mockedResults.push([
      { id: "1", path: "a.md", title: "A", mtime_local: 100, size_bytes: 1 },
      { id: "2", path: "b.md", title: "B", mtime_local: 200, size_bytes: 1 },
      { id: "3", path: "c.md", title: "C", mtime_local: 300, size_bytes: 1 },
    ]);
    db.mockedResults.push([
      { file_id: "1", key: "priority", value: "2", type: "number" },
      { file_id: "2", key: "priority", value: "1", type: "number" },
      { file_id: "3", key: "priority", value: "3", type: "number" },
    ]);
  };

  it("sorts by a custom property using the `property` key (ASC)", async () => {
    threeFilesWithPriority();
    const result = await queryService.queryDatabaseFiles({
      views: [{ sort: [{ property: "priority", direction: "ASC" }] }],
    });
    expect(result.map((r) => r["file.name"])).toEqual(["B", "A", "C"]);
  });

  it("still honours the legacy `field` sort key (DESC)", async () => {
    threeFilesWithPriority();
    const result = await queryService.queryDatabaseFiles({
      views: [{ sort: [{ field: "priority", direction: "DESC" }] }],
    });
    expect(result.map((r) => r["file.name"])).toEqual(["C", "A", "B"]);
  });

  it("sorts by a custom property written with the Obsidian `note.` prefix", async () => {
    threeFilesWithPriority();
    const result = await queryService.queryDatabaseFiles({
      views: [{ sort: [{ property: "note.priority", direction: "ASC" }] }],
    });
    expect(result.map((r) => r["file.name"])).toEqual(["B", "A", "C"]);
  });

  it("excludes OKF reserved files (index.md/log.md) from base results", async () => {
    // A folder source matches recursively, so a folder's managed index.md would
    // otherwise show up as a row. Reserved OKF names are folder-listing
    // infrastructure and are dropped from every base view in the query layer
    // (no per-`.base` filter needed — keeps the files Obsidian-openable).
    db.mockedResults.push([
      { id: "1", path: "Projects/Alpha.md", title: "Alpha", mtime_local: 100, size_bytes: 1 },
      { id: "2", path: "Projects/index.md", title: "Projects", mtime_local: 200, size_bytes: 1 },
      { id: "3", path: "index.md", title: "Vault", mtime_local: 300, size_bytes: 1 },
      { id: "4", path: "Projects/log.md", title: "Log", mtime_local: 400, size_bytes: 1 },
    ]);
    db.mockedResults.push([]); // properties for the surviving row
    const result = await queryService.queryDatabaseFiles({
      filters: { and: ['file.folder == "Projects"'] },
      views: [{}],
    });
    expect(result.map((r) => r["file.path"])).toEqual(["Projects/Alpha.md"]);
  });

  it("filters on a property whose name contains spaces", async () => {
    db.mockedResults.push([
      { id: "1", path: "a.md", title: "A", mtime_local: 100, size_bytes: 1 },
      { id: "2", path: "b.md", title: "B", mtime_local: 200, size_bytes: 1 },
    ]);
    db.mockedResults.push([
      { file_id: "1", key: "My Status", value: "done", type: "string" },
      { file_id: "2", key: "My Status", value: "open", type: "string" },
    ]);
    const result = await queryService.queryDatabaseFiles({
      filters: { and: ['My Status == "done"'] },
    });
    expect(result.length).toBe(1);
    expect(result[0]["file.name"]).toBe("A");
  });

  it("applies nested filter groups instead of ignoring them (plan Base-Filtergruppen P7)", async () => {
    db.mockedResults.push([
      { id: "1", path: "a.md", title: "A", mtime_local: 100, size_bytes: 1 },
      { id: "2", path: "b.md", title: "B", mtime_local: 200, size_bytes: 1 },
      { id: "3", path: "c.md", title: "C", mtime_local: 300, size_bytes: 1 },
    ]);
    db.mockedResults.push([
      { file_id: "1", key: "status", value: "offen", type: "string" },
      { file_id: "1", key: "prio", value: "1", type: "number" },
      { file_id: "2", key: "status", value: "offen", type: "string" },
      { file_id: "2", key: "prio", value: "2", type: "number" },
      { file_id: "3", key: "status", value: "fertig", type: "string" },
      { file_id: "3", key: "prio", value: "1", type: "number" },
    ]);
    const result = await queryService.queryDatabaseFiles({
      filters: { and: ['status == "offen"', { or: ['prio == "1"', 'prio == "3"'] }] },
    });
    expect(result.map((r) => r["file.name"])).toEqual(["A"]);
  });

  it("evaluates a MIXED or-list in memory instead of cutting it to its source clauses", async () => {
    db.mockedResults.push([
      { id: "1", path: "A/x.md", title: "X", mtime_local: 100, size_bytes: 1 },
      { id: "2", path: "B/y.md", title: "Y", mtime_local: 200, size_bytes: 1 },
      { id: "3", path: "B/z.md", title: "Z", mtime_local: 300, size_bytes: 1 },
    ]);
    db.mockedResults.push([
      { file_id: "2", key: "status", value: "done", type: "string" },
      { file_id: "3", key: "status", value: "open", type: "string" },
    ]);
    const result = await queryService.queryDatabaseFiles({
      filters: { or: ['file.folder == "A"', 'status == "done"'] },
    });
    // No folder pushdown for the mixed list: the files query stays unrestricted…
    expect(db.queries[0].query).not.toContain("LIKE");
    // …and the property alternative keeps row Y even though it is outside A/.
    expect(result.map((r) => r["file.name"]).sort()).toEqual(["X", "Y"]);
  });

  it("bulk-loads tags only when a residual hasTag condition remains", async () => {
    db.mockedResults.push([
      { id: "1", path: "a.md", title: "A", mtime_local: 100, size_bytes: 1 },
      { id: "2", path: "b.md", title: "B", mtime_local: 200, size_bytes: 1 },
    ]);
    db.mockedResults.push([{ file_id: "2", key: "status", value: "done", type: "string" }]);
    db.mockedResults.push([{ path: "a.md", tag: "intern" }]); // bulk tag load
    const result = await queryService.queryDatabaseFiles({
      filters: { or: ['file.hasTag("intern")', 'status == "done"'] },
    });
    expect(db.queries[2].query).toContain("FROM tags");
    expect(result.map((r) => r["file.name"]).sort()).toEqual(["A", "B"]);
  });

  it("still pushes a PURE source or-list down to SQL", async () => {
    db.mockedResults.push([
      { id: "1", path: "A/x.md", title: "X", mtime_local: 100, size_bytes: 1 },
    ]);
    db.mockedResults.push([]);
    await queryService.queryDatabaseFiles({
      filters: { or: ['file.folder == "A"', 'file.hasTag("t")'] },
    });
    expect(db.queries[0].query).toContain("LIKE");
    expect(db.queries[0].query).toContain("OR");
    // No residual evaluation -> exactly two queries (files + properties).
    expect(db.queries.length).toBe(2);
  });

  it("returns property_key on backlinks", async () => {
    db.mockedResults.push([{ source_path: "a.md", target_path: "world", property_key: "projekt" }]);
    db.mockedResults.push([{ path: "a.md" }, { path: "world.md" }]);
    const backlinks = await queryService.getBacklinks("world.md");
    expect(db.queries[0].query).toContain("l.property_key");
    expect(backlinks[0].property_key).toBe("projekt");
  });

  it("resolves property-scoped relation sources onto their targets", async () => {
    // corpus
    db.mockedResults.push([
      { path: "Projekte/P1.md" },
      { path: "Aufgaben/A1.md" },
      { path: "Aufgaben/A2.md" },
      { path: "Aufgaben/Self.md" },
    ]);
    // links stored for the property (bare + qualified raws, duplicate, self, unresolved)
    db.mockedResults.push([
      { source_path: "Aufgaben/A2.md", source_title: "A2", target_path: "Projekte/P1" },
      { source_path: "Aufgaben/A1.md", source_title: "A1", target_path: "P1" },
      { source_path: "Aufgaben/A2.md", source_title: "A2", target_path: "P1" },
      { source_path: "Aufgaben/Self.md", source_title: "Self", target_path: "Self" },
      { source_path: "Aufgaben/A1.md", source_title: "A1", target_path: "Anderswo" },
    ]);

    const map = await queryService.getRelationSources(["Projekte/P1.md", "Aufgaben/Self.md"], "projekt");

    expect(db.queries[1].query).toContain("WHERE l.property_key = ?");
    expect((db.queries[1].params as any[])[0]).toBe("projekt");
    // deduped per source, sorted by title; self-link excluded, unresolved dropped
    expect(map.get("Projekte/P1.md")).toEqual([
      { path: "Aufgaben/A1.md", title: "A1" },
      { path: "Aufgaben/A2.md", title: "A2" },
    ]);
    expect(map.has("Aufgaben/Self.md")).toBe(false);
  });

  it("enriches reverse-relation columns before the in-memory filters", async () => {
    db.mockedResults.push([
      { id: "1", path: "Projekte/P1.md", title: "P1", mtime_local: 100, size_bytes: 1 },
      { id: "2", path: "Projekte/P2.md", title: "P2", mtime_local: 200, size_bytes: 1 },
    ]);
    db.mockedResults.push([]); // properties
    db.mockedResults.push([{ path: "Projekte/P1.md" }, { path: "Projekte/P2.md" }, { path: "Aufgaben/A1.md" }]);
    db.mockedResults.push([{ source_path: "Aufgaben/A1.md", source_title: "A1", target_path: "P1" }]);

    const result = await queryService.queryDatabaseFiles({
      columns: { aufgaben: { reverseOf: { base: "Aufgaben.base", property: "projekt" } } },
      filters: { and: ['contains(aufgaben, "A1")'] },
      views: [],
    });

    // The filter runs on the computed column — only P1 survives.
    expect(result.length).toBe(1);
    expect(result[0]["file.name"]).toBe("P1");
    expect(result[0].aufgaben).toEqual(["[[A1]]"]);
  });

  it("always sets reverse columns (empty list) and sorts on them", async () => {
    db.mockedResults.push([
      { id: "1", path: "Projekte/P1.md", title: "P1", mtime_local: 100, size_bytes: 1 },
      { id: "2", path: "Projekte/P2.md", title: "P2", mtime_local: 200, size_bytes: 1 },
    ]);
    db.mockedResults.push([]); // properties
    db.mockedResults.push([{ path: "Projekte/P1.md" }, { path: "Projekte/P2.md" }, { path: "Aufgaben/A1.md" }]);
    db.mockedResults.push([{ source_path: "Aufgaben/A1.md", source_title: "A1", target_path: "P2" }]);

    const result = await queryService.queryDatabaseFiles({
      columns: { aufgaben: { reverseOf: { base: "Aufgaben.base", property: "projekt" } } },
      views: [{ sort: [{ property: "aufgaben", direction: "DESC" }] }],
    });

    expect(result.map((r) => r["file.name"])).toEqual(["P2", "P1"]);
    expect(result[0].aufgaben).toEqual(["[[A1]]"]);
    expect(result[1].aufgaben).toEqual([]);
  });

  it("qualifies reverse-column link text on basename collision and aliases differing titles", async () => {
    db.mockedResults.push([
      { id: "1", path: "Projekte/P1.md", title: "P1", mtime_local: 100, size_bytes: 1 },
    ]);
    db.mockedResults.push([]); // properties
    db.mockedResults.push([
      { path: "Projekte/P1.md" },
      { path: "Aufgaben/Task.md" },
      { path: "Archiv/Task.md" },
    ]);
    db.mockedResults.push([
      { source_path: "Aufgaben/Task.md", source_title: "Schöner Titel", target_path: "P1" },
    ]);

    const result = await queryService.queryDatabaseFiles({
      columns: { aufgaben: { reverseOf: { base: "Aufgaben.base", property: "projekt" } } },
      views: [],
    });

    expect(result[0].aufgaben).toEqual(["[[Aufgaben/Task|Schöner Titel]]"]);
  });

  it("issues no extra queries when the config has no reverse columns", async () => {
    threeFilesWithPriority();
    await queryService.queryDatabaseFiles({ views: [] });
    expect(db.queries.length).toBe(2); // files + one properties chunk
  });

  it("lists .base file paths", async () => {
    db.mockedResults.push([{ path: "projects.base" }, { path: "" }, { path: "sub/reading.base" }]);
    const paths = await queryService.listBaseFilePaths();
    expect(paths).toEqual(["projects.base", "sub/reading.base"]);
    expect(db.queries[0].query).toContain("LIKE '%.base'");
  });

  it("lists bases with titles falling back to the basename (mobile hub)", async () => {
    db.mockedResults.push([
      { path: "projects.base", title: "Projekte" },
      { path: "sub/reading.base", title: null },
      { path: "", title: "ghost" },
    ]);
    const bases = await queryService.listBases();
    expect(bases).toEqual([
      { path: "projects.base", title: "Projekte" },
      { path: "sub/reading.base", title: "reading" },
    ]);
    expect(db.queries[0].query).toContain("LIKE '%.base'");
    expect(db.queries[0].query).toContain("ORDER BY path");
  });

  it("lists notes with a title fallback and excludes attachments/.base in SQL", async () => {
    db.mockedResults.push([
      { path: "a.md", title: "A" },
      { path: "b.md", title: null },
      { path: "", title: "ghost" },
    ]);
    const notes = await queryService.listNotes();
    expect(notes).toEqual([
      { path: "a.md", title: "A" },
      { path: "b.md", title: "b.md" },
    ]);
    expect(db.queries[0].query).toContain("mode != 'attachment'");
    expect(db.queries[0].query).toContain("NOT LIKE '%.base'");
    expect(db.queries[0].query).not.toContain("LIMIT");
  });

  it("passes an optional limit to listNotes", async () => {
    db.mockedResults.push([]);
    await queryService.listNotes(300);
    expect(db.queries[0].query).toContain("LIMIT ?");
    expect(db.queries[0].params as any[]).toEqual([300]);
  });

  it("lists notes modified inside a [from, to) window, newest first (Today tab)", async () => {
    db.mockedResults.push([
      { path: "b.md", title: null, mtime_local: 200 },
      { path: "a.md", title: "A", mtime_local: 100 },
      { path: "", title: "ghost", mtime_local: 50 },
    ]);
    const notes = await queryService.listNotesModifiedBetween(0, 1000);
    expect(notes).toEqual([
      { path: "b.md", title: "b.md", mtime_local: 200 },
      { path: "a.md", title: "A", mtime_local: 100 },
    ]);
    expect(db.queries[0].query).toContain("mode != 'attachment'");
    expect(db.queries[0].query).toContain("NOT LIKE '%.base'");
    expect(db.queries[0].query).toContain("mtime_local >= ? AND mtime_local < ?");
    expect(db.queries[0].query).toContain("ORDER BY mtime_local DESC");
    expect(db.queries[0].params as any[]).toEqual([0, 1000]);
  });

  it("resolves a note path by title or path (editor link semantics)", async () => {
    db.mockedOneResults.push({ path: "notes/World.md" });
    const path = await queryService.resolveNotePath("World");
    expect(path).toBe("notes/World.md");
    expect(db.queries[0].query).toContain("COLLATE NOCASE");
    expect(db.queries[0].params as any[]).toEqual(["World", "World", "World.md"]);
  });

  it("returns null when a link target does not resolve", async () => {
    // no mocked row -> queryOne yields null
    const path = await queryService.resolveNotePath("missing");
    expect(path).toBeNull();
  });
});

describe("wikiTargetForPath", () => {
  it("uses the bare basename when unique vault-wide", async () => {
    const { wikiTargetForPath } = await import("../src/vault/LinkResolver.ts");
    expect(wikiTargetForPath("Aufgaben/A1.md", ["Aufgaben/A1.md", "Projekte/P1.md"])).toBe("A1");
  });

  it("qualifies with the path (without .md) on basename collision", async () => {
    const { wikiTargetForPath } = await import("../src/vault/LinkResolver.ts");
    expect(
      wikiTargetForPath("Aufgaben/Task.md", ["Aufgaben/Task.md", "Archiv/Task.md"])
    ).toBe("Aufgaben/Task");
    expect(
      wikiTargetForPath("Aufgaben/Task.md", ["Aufgaben/Task.md", "Archiv/task.md"])
    ).toBe("Aufgaben/Task"); // case-insensitive collision
  });
});
