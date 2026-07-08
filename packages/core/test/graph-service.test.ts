import { describe, expect, it, beforeEach } from "vitest";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import { GraphService } from "../src/vault/GraphService.ts";
import { initializeSchema } from "../src/db/Schema.ts";

/**
 * loadGraph issues exactly three queries in order: files, type-properties,
 * links. This helper primes the FIFO mock accordingly.
 */
function primeGraph(
  db: MockDatabaseAdapter,
  files: { path: string; title?: string; mode?: string; mtime_local?: number; ctime?: number | null }[],
  links: {
    source_path: string;
    target_path: string;
    target_raw?: string;
    link_type?: string;
    property_key?: string | null;
    line_number?: number | null;
  }[],
  types: { path: string; value: string }[] = []
) {
  db.mockedResults.push(
    files.map((f) => ({
      path: f.path,
      title: f.title ?? f.path.split("/").pop()!.replace(/\.md$/, ""),
      mode: f.mode ?? "obsidian",
      mtime_local: f.mtime_local ?? 1000,
      ctime: f.ctime ?? null,
    }))
  );
  db.mockedResults.push(types);
  db.mockedResults.push(
    links.map((l) => ({
      source_path: l.source_path,
      target_path: l.target_path,
      target_raw: l.target_raw ?? l.target_path,
      link_type: l.link_type ?? "wikilink",
      property_key: l.property_key ?? null,
      line_number: l.line_number ?? null,
    }))
  );
}

describe("GraphService", () => {
  let db: MockDatabaseAdapter;
  let service: GraphService;

  beforeEach(async () => {
    db = new MockDatabaseAdapter();
    await db.initialize();
    service = new GraphService(db);
  });

  it("bundles parallel links and maps frontmatter relations to kind 'property'", async () => {
    primeGraph(
      db,
      [{ path: "a.md" }, { path: "b.md" }],
      [
        { source_path: "a.md", target_path: "b", line_number: 5 },
        { source_path: "a.md", target_path: "b", line_number: 3 },
        { source_path: "a.md", target_path: "b", property_key: "projekt" },
      ]
    );
    const g = await service.loadGraph();

    expect(g.nodes.size).toBe(2);
    expect(g.edges.length).toBe(2);
    const body = g.edges.find((e) => e.kind === "wikilink")!;
    expect(body.target).toBe("b.md"); // resolved like the backlinks panel
    expect(body.count).toBe(2);
    expect(body.lineNumber).toBe(3); // smallest line of the bundle
    const relation = g.edges.find((e) => e.kind === "property")!;
    expect(relation.propertyKey).toBe("projekt");
    expect(relation.count).toBe(1);
  });

  it("resolves via the prebuilt corpus index: same-folder preference and NFD paths (P2.3)", async () => {
    // "Notes/a.md -> [[b]]" must prefer Notes/b.md over Other/b.md (ambiguous
    // basename), and an NFC link must land on an NFD-named file - both pin
    // that loadGraph resolves through the SAME indexed resolver as backlinks.
    const nfdCafe = "Café.md".normalize("NFD"); // as APFS reports the name
    primeGraph(
      db,
      [
        { path: "Notes/a.md" },
        { path: "Notes/b.md" },
        { path: "Other/b.md" },
        { path: nfdCafe },
      ],
      [
        { source_path: "Notes/a.md", target_path: "b" },
        { source_path: "Notes/a.md", target_path: "Café".normalize("NFC") }, // typed link text
      ]
    );
    const g = await service.loadGraph();
    expect(g.broken.length).toBe(0);
    const targets = g.edges.map((e) => e.target).sort();
    expect(targets).toEqual([nfdCafe, "Notes/b.md"]);
  });

  it("never reports external URLs or anchor-only links as broken", async () => {
    primeGraph(
      db,
      [{ path: "a.md" }],
      [
        { source_path: "a.md", target_path: "https://youtube.com/watch?v=x", link_type: "markdown-link" },
        { source_path: "a.md", target_path: "mailto:x@y.z", link_type: "markdown-link" },
        { source_path: "a.md", target_path: "", target_raw: "#nur-anker" },
      ]
    );
    const g = await service.loadGraph();
    expect(g.edges.length).toBe(0);
    expect(g.broken.length).toBe(0);
  });

  it("collects unresolvable links as broken instead of edges", async () => {
    primeGraph(
      db,
      [{ path: "a.md" }],
      [{ source_path: "a.md", target_path: "missing", target_raw: "Missing Note", line_number: 7 }]
    );
    const g = await service.loadGraph();
    expect(g.edges.length).toBe(0);
    expect(g.broken).toEqual([
      { sourcePath: "a.md", targetRaw: "Missing Note", lineNumber: 7, propertyKey: null },
    ]);
  });

  it("drops self links, .base targets and unlinked attachments; includeAttachments keeps linked ones", async () => {
    const files = [
      { path: "a.md" },
      { path: "db.base", mode: "attachment" },
      { path: "img.png", mode: "attachment" },
      { path: "unused.png", mode: "attachment" },
    ];
    const links = [
      { source_path: "a.md", target_path: "a.md" },
      { source_path: "a.md", target_path: "db.base" },
      { source_path: "a.md", target_path: "img.png", link_type: "embed" },
    ];

    primeGraph(db, files, links);
    const bare = await service.loadGraph();
    expect(bare.nodes.size).toBe(1); // only a.md
    expect(bare.edges.length).toBe(0);
    expect(bare.broken.length).toBe(0); // dropped, not broken

    primeGraph(db, files, links);
    const withAtt = await service.loadGraph({ includeAttachments: true });
    expect(withAtt.nodes.has("img.png")).toBe(true);
    expect(withAtt.nodes.has("unused.png")).toBe(false); // only LINKED attachments
    expect(withAtt.edges).toEqual([
      { source: "a.md", target: "img.png", kind: "embed", propertyKey: null, count: 1, lineNumber: null },
    ]);
  });

  it("reads the OKF type into nodes", async () => {
    primeGraph(db, [{ path: "p.md" }], [], [{ path: "p.md", value: "projekt" }]);
    const g = await service.loadGraph();
    expect(g.nodes.get("p.md")!.okfType).toBe("projekt");
  });

  it("computes BFS neighborhoods per depth with only inner edges", async () => {
    primeGraph(
      db,
      [{ path: "a.md" }, { path: "b.md" }, { path: "c.md" }],
      [
        { source_path: "a.md", target_path: "b" },
        { source_path: "b.md", target_path: "c" },
      ]
    );
    const g = await service.loadGraph();

    const d1 = await service.getNeighborhood("a.md", 1, g);
    expect(d1.nodes.map((n) => n.path).sort()).toEqual(["a.md", "b.md"]);
    expect(d1.edges.length).toBe(1);
    expect(d1.truncated).toBe(false);

    const d2 = await service.getNeighborhood("a.md", 2, g);
    expect(d2.nodes.map((n) => n.path).sort()).toEqual(["a.md", "b.md", "c.md"]);
    expect(d2.edges.length).toBe(2);
  });

  it("truncates neighborhoods at the node budget", async () => {
    const files = [{ path: "hub.md" }];
    const links: { source_path: string; target_path: string }[] = [];
    for (let i = 0; i < 450; i++) {
      files.push({ path: `n${i}.md` });
      links.push({ source_path: "hub.md", target_path: `n${i}` });
    }
    primeGraph(db, files, links);
    const g = await service.loadGraph();
    const hood = await service.getNeighborhood("hub.md", 1, g);
    expect(hood.truncated).toBe(true);
    expect(hood.nodes.length).toBe(400);
  });

  it("aggregates the folder overview with ancestors, index flag and inter-folder bundles", async () => {
    primeGraph(
      db,
      [
        { path: "root.md" },
        { path: "P/a.md" },
        { path: "P/index.md" },
        { path: "P/Sub/b.md" },
      ],
      [
        { source_path: "P/a.md", target_path: "P/Sub/b" },
        { source_path: "P/a.md", target_path: "root" },
      ]
    );
    const overview = await service.getFolderOverview();

    expect(overview.rootNotes).toEqual(["root.md"]);
    const p = overview.folders.find((f) => f.folder === "P")!;
    expect(p.noteCount).toBe(2); // a.md + index.md (direct only)
    expect(p.hasIndexNote).toBe(true);
    const sub = overview.folders.find((f) => f.folder === "P/Sub")!;
    expect(sub.noteCount).toBe(1);
    expect(overview.folderEdges).toEqual(
      expect.arrayContaining([
        { source: "P", target: "P/Sub", count: 1 },
        { source: "P", target: "", count: 1 },
      ])
    );
  });

  it("unfolds one folder into notes, child aggregates and inner/external edges", async () => {
    primeGraph(
      db,
      [
        { path: "P/a.md" },
        { path: "P/b.md" },
        { path: "P/Sub/deep.md" },
        { path: "Other/x.md" },
      ],
      [
        { source_path: "P/a.md", target_path: "P/b" },
        { source_path: "P/a.md", target_path: "Other/x" },
      ]
    );
    const sub = await service.getFolderSubgraph("P");

    expect(sub.notes.map((n) => n.path)).toEqual(["P/a.md", "P/b.md"]);
    expect(sub.subfolders).toEqual([{ folder: "P/Sub", noteCount: 1 }]);
    expect(sub.innerEdges.length).toBe(1);
    expect(sub.externalEdges).toEqual([{ source: "P/a.md", targetFolder: "Other", count: 1 }]);
  });

  it("lists orphans without linked, attachment or reserved notes", async () => {
    primeGraph(
      db,
      [
        { path: "linked.md" },
        { path: "target.md" },
        { path: "lonely.md" },
        { path: "P/index.md" },
        { path: "img.png", mode: "attachment" },
      ],
      [{ source_path: "linked.md", target_path: "target" }]
    );
    const orphans = await service.getOrphans();
    expect(orphans.map((o) => o.path)).toEqual(["lonely.md"]);
  });

  it("suggests co-citations only for pairs with >= 2 shared citers and no direct link", async () => {
    primeGraph(
      db,
      [{ path: "s1.md" }, { path: "s2.md" }, { path: "a.md" }, { path: "b.md" }, { path: "c.md" }],
      [
        { source_path: "s1.md", target_path: "a" },
        { source_path: "s1.md", target_path: "b" },
        { source_path: "s2.md", target_path: "a" },
        { source_path: "s2.md", target_path: "b" },
        // c is co-cited with a only once -> below threshold
        { source_path: "s1.md", target_path: "c" },
      ]
    );
    const out = await service.suggestCoCitations(10);
    expect(out.length).toBe(1);
    expect([out[0].source, out[0].target].sort()).toEqual(["a.md", "b.md"]);
    expect(out[0].score).toBe(2);
  });

  it("does not suggest co-citations for directly linked pairs", async () => {
    primeGraph(
      db,
      [{ path: "s1.md" }, { path: "s2.md" }, { path: "a.md" }, { path: "b.md" }],
      [
        { source_path: "s1.md", target_path: "a" },
        { source_path: "s1.md", target_path: "b" },
        { source_path: "s2.md", target_path: "a" },
        { source_path: "s2.md", target_path: "b" },
        { source_path: "a.md", target_path: "b" },
      ]
    );
    const out = await service.suggestCoCitations(10);
    expect(out.length).toBe(0);
  });

  it("suggests neighbor overlaps by jaccard", async () => {
    primeGraph(
      db,
      [{ path: "a.md" }, { path: "b.md" }, { path: "n1.md" }, { path: "n2.md" }, { path: "x.md" }],
      [
        { source_path: "a.md", target_path: "n1" },
        { source_path: "a.md", target_path: "n2" },
        { source_path: "a.md", target_path: "x" },
        { source_path: "b.md", target_path: "n1" },
        { source_path: "b.md", target_path: "n2" },
      ]
    );
    const out = await service.suggestByNeighbors(10);
    const pair = out.find((s) => [s.source, s.target].sort().join() === "a.md,b.md");
    expect(pair).toBeDefined();
    // shared {n1,n2} = 2, union {n1,n2,x} = 3
    expect(pair!.score).toBeCloseTo(2 / 3, 5);
  });

  it("suggests pairs sharing a rare tag with the BETWEEN bound as parameter", async () => {
    primeGraph(db, [{ path: "a.md" }, { path: "b.md" }], []);
    db.mockedResults.push([{ tag: "selten" }]); // rare-tag query
    db.mockedResults.push([{ path: "a.md" }, { path: "b.md" }]); // files of that tag

    const out = await service.suggestBySharedTags(5, 10);
    expect(out).toEqual([
      { source: "a.md", target: "b.md", reason: "tag", score: 1, detail: "selten" },
    ]);
    const tagQuery = db.queries.find((q) => q.query.includes("HAVING COUNT(DISTINCT file_id) BETWEEN 2 AND ?"));
    expect(tagQuery).toBeDefined();
    expect((tagQuery!.params as any[])[0]).toBe(5);
  });

  describe("findUnlinkedMentions", () => {
    it("scans vault-wide with exact FTS phrases and drops linked/self/reserved sources", async () => {
      primeGraph(
        db,
        [
          { path: "Projekt X.md", title: "Projekt X" },
          { path: "mention.md" },
          { path: "linked.md" },
          { path: "docs/index.md", title: "index" },
        ],
        [{ source_path: "linked.md", target_path: "Projekt X" }]
      );
      db.mockedResults.push([]); // aliases query
      const progress: string[] = [];
      // One FTS query per candidate term (4 notes, but only titles >= 3 chars
      // qualify — "index" is a candidate TERM but reserved as SOURCE only).
      // FIFO: answer every term query; only the "Projekt X" one has hits.
      db.mockedResults.push([
        { path: "mention.md" },
        { path: "linked.md" },
        { path: "docs/index.md" },
        { path: "Projekt X.md" },
      ]); // "Projekt X"
      db.mockedResults.push([]); // "mention"
      db.mockedResults.push([]); // "linked"

      const out = await service.findUnlinkedMentions({
        onProgress: (_c, _t, term) => progress.push(term),
      });

      expect(out).toEqual([
        { source: "mention.md", target: "Projekt X.md", reason: "mention", score: 1, term: "Projekt X" },
      ]);
      // Reserved notes are not scan TARGETS: 3 candidate terms, 3 FTS queries.
      expect(progress).toEqual(["Projekt X", "mention", "linked"]);
      const ftsQueries = db.queries.filter((q) => q.query.includes("MATCH ?"));
      expect(ftsQueries.length).toBe(3);
      expect((ftsQueries[0].params as any[])[0]).toBe('"Projekt X"');
    });

    it("stops immediately on an aborted signal", async () => {
      primeGraph(db, [{ path: "note.md" }], []);
      db.mockedResults.push([]); // aliases
      const controller = new AbortController();
      controller.abort();
      const out = await service.findUnlinkedMentions({ signal: controller.signal });
      expect(out).toEqual([]);
      expect(db.queries.some((q) => q.query.includes("MATCH ?"))).toBe(false);
    });

    it("uses aliases as additional candidate terms", async () => {
      primeGraph(db, [{ path: "note.md", title: "Note" }, { path: "other.md" }], []);
      db.mockedResults.push([{ path: "note.md", value: '["Der Zweitname"]' }]); // aliases
      db.mockedResults.push([]); // FTS "Note"
      db.mockedResults.push([{ path: "other.md" }]); // FTS "Der Zweitname"
      db.mockedResults.push([]); // FTS "other"

      const out = await service.findUnlinkedMentions({});
      expect(out).toEqual([
        { source: "other.md", target: "note.md", reason: "mention", score: 1, term: "Der Zweitname" },
      ]);
    });

    it("scopes to a focus note: mentions OF it and foreign titles INSIDE it (word boundaries)", async () => {
      primeGraph(
        db,
        [
          { path: "focus.md", title: "Focus" },
          { path: "caller.md" },
          { path: "Other Note.md", title: "Other Note" },
          { path: "Otherx.md", title: "Otherx Note" },
        ],
        []
      );
      db.mockedResults.push([]); // aliases
      db.mockedResults.push([{ path: "caller.md" }]); // FTS for own term "Focus"
      db.mockedOneResults.push({
        content: "We should compare this with Other Note soon. Otherx Notes is a typo-ish word.",
      });

      const out = await service.findUnlinkedMentions({ forPath: "focus.md" });

      expect(out).toEqual(
        expect.arrayContaining([
          { source: "caller.md", target: "focus.md", reason: "mention", score: 1, term: "Focus" },
          { source: "focus.md", target: "Other Note.md", reason: "mention", score: 1, term: "Other Note" },
        ])
      );
      // "Otherx Note" is followed by "s" (no word boundary) -> no match.
      expect(out.some((s) => s.target === "Otherx.md")).toBe(false);
    });
  });

  it("parses effective dates with date > datum > created priority", async () => {
    db.mockedResults.push([
      { path: "daily.md", key: "datum", value: "2026-07-01" },
      { path: "daily.md", key: "date", value: "2026-06-01" },
      { path: "made.md", key: "created", value: "2026-01-15T10:00:00Z" },
      { path: "junk.md", key: "date", value: "not a date" },
    ]);
    const dates = await service.getEffectiveDates();
    expect(dates.get("daily.md")).toBe(Date.parse("2026-06-01")); // date wins over datum
    expect(dates.get("made.md")).toBe(Date.parse("2026-01-15T10:00:00Z"));
    expect(dates.has("junk.md")).toBe(false);
  });

  it("exposes the built-in suggestion providers in display order", () => {
    expect(service.getSuggestionProviders().map((p) => p.id)).toEqual([
      "mention",
      "cocitation",
      "neighbors",
      "tag",
    ]);
  });
});

describe("Schema migration v3", () => {
  it("adds files.ctime and backfills it BEFORE resetting mtime_local", async () => {
    const db = new MockDatabaseAdapter();
    await initializeSchema(db); // version queryOne -> null (FIFO empty) => migrate

    const executed = db.queries.map((q) => q.query);
    expect(executed.some((q) => q.includes("ALTER TABLE files ADD COLUMN ctime INTEGER"))).toBe(true);

    const backfillIdx = executed.findIndex((q) => q.includes("SET ctime = mtime_local WHERE ctime IS NULL"));
    const resetIdx = executed.findIndex((q) => q.includes("SET mtime_local = 0"));
    expect(backfillIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeGreaterThan(-1);
    expect(backfillIdx).toBeLessThan(resetIdx);

    const versionWrite = db.queries.find((q) =>
      q.query.includes("INSERT OR REPLACE INTO meta (key, value) VALUES ('index_format_version', ?)")
    );
    expect(versionWrite).toBeDefined();
    expect((versionWrite!.params as any[])[0]).toBe("3");
  });

  it("skips the migration when the stored version is current", async () => {
    const db = new MockDatabaseAdapter();
    db.mockedOneResults.push({ value: "3" });
    await initializeSchema(db);
    expect(db.queries.some((q) => q.query.includes("SET mtime_local = 0"))).toBe(false);
    expect(db.queries.some((q) => q.query.includes("SET ctime = mtime_local"))).toBe(false);
  });
});
