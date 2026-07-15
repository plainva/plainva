import { describe, it, expect } from "vitest";
import { VaultQueryService } from "../src/vault/VaultQueryService.ts";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";

describe("VaultQueryService.findInVault", () => {
  it("returns notes with matches and their counts, deriving a title fallback", async () => {
    const db = new MockDatabaseAdapter();
    db.mockedResults = [
      [
        { path: "a.md", title: "A", content: "cat and cat" },
        { path: "b.md", title: null, content: "no match here" },
        { path: "notes/c.md", title: null, content: "one Cat" },
      ],
    ];
    const res = await new VaultQueryService(db).findInVault("cat");
    expect(res.map((r) => [r.path, r.matchCount])).toEqual([
      ["a.md", 2],
      ["notes/c.md", 1],
    ]);
    expect(res[0].matches[0].lineText).toBe("cat and cat");
    expect(res[1].title).toBe("c");
  });

  it("returns nothing for an empty query", async () => {
    const db = new MockDatabaseAdapter();
    expect(await new VaultQueryService(db).findInVault("")).toEqual([]);
  });
});
