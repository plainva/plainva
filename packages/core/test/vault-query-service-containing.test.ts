import { describe, expect, it } from "vitest";
import { VaultQueryService } from "../src/vault/VaultQueryService.ts";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";

/**
 * Plan KI-Harness P4-5: which notes name a file — a scan of the stored note
 * texts, because the link table knows neither a Markdown image nor an
 * attachment as a link target.
 */
describe("VaultQueryService.notesContaining", () => {
  it("scans the note texts for each spelling literally, as parameters", async () => {
    const db = new MockDatabaseAdapter();
    const qs = new VaultQueryService(db);
    db.mockedResults.push([{ path: "Journal/Private.md" }, { path: "Projects/Kickoff.md" }]);
    expect(await qs.notesContaining(["Scan 1.png", "Scan%201.png"])).toEqual({ paths: ["Journal/Private.md", "Projects/Kickoff.md"], truncated: false });
    const q = db.queries.find((x) => x.query.includes("FROM fts_notes"))!;
    expect(q.query.replace(/\s+/g, " ").trim()).toBe("SELECT path FROM fts_notes WHERE content LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' ORDER BY path LIMIT ?");
    // The words themselves never stand in the statement, and what LIKE would read as a wildcard is escaped: a percent sign in a name is a percent sign.
    expect(q.params).toEqual(["%Scan 1.png%", "%Scan\\%201.png%", 201]);
  });

  it("escapes every character LIKE gives a meaning", async () => {
    const db = new MockDatabaseAdapter();
    const qs = new VaultQueryService(db);
    db.mockedResults.push([]);
    await qs.notesContaining(["50%_off\\final.png"]);
    expect(db.queries.find((x) => x.query.includes("FROM fts_notes"))!.params).toEqual(["%50\\%\\_off\\\\final.png%", 201]);
  });

  it("says when there were more than it returns", async () => {
    const db = new MockDatabaseAdapter();
    const qs = new VaultQueryService(db);
    db.mockedResults.push([{ path: "a.md" }, { path: "b.md" }, { path: "c.md" }]);
    expect(await qs.notesContaining(["x"], 2)).toEqual({ paths: ["a.md", "b.md"], truncated: true });
    db.mockedResults.push([{ path: "a.md" }, { path: "b.md" }]);
    expect(await qs.notesContaining(["x"], 2)).toEqual({ paths: ["a.md", "b.md"], truncated: false });
  });

  it("asks nothing for no spelling, drops empty ones and takes a few at most", async () => {
    const db = new MockDatabaseAdapter();
    const qs = new VaultQueryService(db);
    expect(await qs.notesContaining([])).toEqual({ paths: [], truncated: false });
    expect(await qs.notesContaining(["", ""])).toEqual({ paths: [], truncated: false });
    expect(db.queries.filter((x) => x.query.includes("FROM fts_notes"))).toHaveLength(0);
    db.mockedResults.push([]);
    await qs.notesContaining(["a", "a", "", ...Array.from({ length: 20 }, (_, i) => `n${i}`)]);
    const q = db.queries.find((x) => x.query.includes("FROM fts_notes"))!;
    // "a" once, then seven more: eight spellings and the limit.
    expect(q.params).toEqual(["%a%", "%n0%", "%n1%", "%n2%", "%n3%", "%n4%", "%n5%", "%n6%", 201]);
  });
});
