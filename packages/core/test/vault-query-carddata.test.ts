import { describe, it, expect } from "vitest";
import { VaultQueryService } from "../src/vault/VaultQueryService.ts";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";

// Plan Pinboard P2: card data (body/tags/ctime) comes from the index — the FTS
// content the editor updates on every save, never per-card file I/O.
describe("VaultQueryService.getCardData", () => {
  it("reads content from fts_notes, ctime from files and tags via the file join, merged per path", async () => {
    const db = new MockDatabaseAdapter();
    db.mockedResults = [
      [
        { path: "Zettel/A.md", content: "---\ntags: [x]\n---\nBody A" },
        { path: "Zettel/B.md", content: null },
      ],
      [
        { path: "Zettel/A.md", ctime: 111 },
        { path: "Zettel/B.md", ctime: null },
      ],
      [
        { path: "Zettel/A.md", tag: "einkauf" },
        { path: "Zettel/A.md", tag: "privat/haus" },
      ],
    ];
    const out = await new VaultQueryService(db).getCardData(["Zettel/A.md", "Zettel/B.md"]);
    expect(out["Zettel/A.md"]).toEqual({ content: "---\ntags: [x]\n---\nBody A", tags: ["einkauf", "privat/haus"], ctime: 111 });
    expect(out["Zettel/B.md"]).toEqual({ content: "", tags: [], ctime: null });

    // SQL pinning: exactly three chunk queries, IN placeholders, paths as params.
    expect(db.queries).toHaveLength(3);
    expect(db.queries[0].query).toContain("SELECT path, content FROM fts_notes WHERE path IN (?,?)");
    expect(db.queries[1].query).toContain("SELECT path, ctime FROM files WHERE path IN (?,?)");
    expect(db.queries[2].query).toContain("FROM tags t JOIN files f ON f.id = t.file_id WHERE f.path IN (?,?)");
    for (const q of db.queries) expect(q.params).toEqual(["Zettel/A.md", "Zettel/B.md"]);
  });

  it("keeps a path present even when only the files table knows it (fresh note, FTS row pending)", async () => {
    const db = new MockDatabaseAdapter();
    db.mockedResults = [[], [{ path: "New.md", ctime: 42 }], []];
    const out = await new VaultQueryService(db).getCardData(["New.md"]);
    expect(out["New.md"]).toEqual({ content: "", tags: [], ctime: 42 });
  });

  it("chunks large path sets to respect the SQLite variable limit", async () => {
    const db = new MockDatabaseAdapter();
    const paths = Array.from({ length: 501 }, (_, i) => `n${i}.md`);
    db.mockedResults = [[], [], [], [], [], []];
    await new VaultQueryService(db).getCardData(paths);
    // Two chunks (500 + 1) x three queries each.
    expect(db.queries).toHaveLength(6);
    expect(db.queries[0].params).toHaveLength(500);
    expect(db.queries[3].params).toHaveLength(1);
  });

  it("returns an empty record without querying for an empty path list", async () => {
    const db = new MockDatabaseAdapter();
    const out = await new VaultQueryService(db).getCardData([]);
    expect(out).toEqual({});
    expect(db.queries).toHaveLength(0);
  });
});
