import { describe, expect, it } from "vitest";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.js";
import { clearParkedSuggestion, listParkedSuggestionPaths, parkedSuggestionKey, readParkedSuggestion, writeParkedSuggestion } from "../src/suggestionPark.js";

/**
 * The unsent suggestion copy lives in the vault database (C34) - never in the
 * note, never in the sync. These pin the row shape and the reader's caution.
 */
describe("parked suggestion store", () => {
  it("writes one row per note into the meta table, keyed by the path", async () => {
    const db = new MockDatabaseAdapter();
    await writeParkedSuggestion(db, { path: "Notes/A.md", base: "one", copy: "two", note: "why", savedAt: "2026-09-04T10:00:00.000Z" });
    const write = db.queries.find((q: { query: string }) => q.query.includes("INSERT OR REPLACE INTO meta"))!;
    expect(write.params).toEqual([parkedSuggestionKey("Notes/A.md"), JSON.stringify({ base: "one", copy: "two", note: "why", savedAt: "2026-09-04T10:00:00.000Z" })]);
    expect(parkedSuggestionKey("Notes/A.md")).toBe("suggestion-park:Notes/A.md");
  });

  it("reads the record back and treats a damaged row as no copy", async () => {
    const db = new MockDatabaseAdapter();
    db.mockedOneResults.push({ value: JSON.stringify({ base: "one", copy: "two", note: "why", savedAt: "t" }) });
    await expect(readParkedSuggestion(db, "Notes/A.md")).resolves.toEqual({ path: "Notes/A.md", base: "one", copy: "two", note: "why", savedAt: "t" });
    db.mockedOneResults.push({ value: "{not json" });
    await expect(readParkedSuggestion(db, "Notes/A.md")).resolves.toBeNull();
    db.mockedOneResults.push({ value: JSON.stringify({ copy: "no base" }) });
    await expect(readParkedSuggestion(db, "Notes/A.md")).resolves.toBeNull();
  });

  it("clears by key and lists the parked paths", async () => {
    const db = new MockDatabaseAdapter();
    await clearParkedSuggestion(db, "Notes/A.md");
    expect(db.queries.at(-1)).toEqual({ query: "DELETE FROM meta WHERE key = ?", params: [parkedSuggestionKey("Notes/A.md")] });
    db.mockedResults.push([{ key: parkedSuggestionKey("Notes/A.md") }, { key: parkedSuggestionKey("B.md") }]);
    await expect(listParkedSuggestionPaths(db)).resolves.toEqual(["Notes/A.md", "B.md"]);
  });
});
