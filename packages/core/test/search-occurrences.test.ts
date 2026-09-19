import { describe, expect, it, vi } from "vitest";
import { findSearchOccurrences } from "../src/vault/searchOccurrences.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";

describe("individual source occurrences", () => {
  it("retains CRLF, Unicode, the exact spelling and the heading chain", () => {
    const raw = "---\r\ntitle: x\r\n---\r\n# Project\r\n## Goals\r\n😀 Müller starts\r\n## Next\r\nMÜLLER continues\r\n";
    const hits = findSearchOccurrences(raw, "muller");
    expect(hits.map((hit) => [hit.occurrence.line, hit.occurrence.quote, hit.occurrence.headings])).toEqual([[6, "Müller", ["Project", "Goals"]], [8, "MÜLLER", ["Project", "Next"]]]);
    for (const { occurrence } of hits) expect(raw.slice(occurrence.from, occurrence.to)).toBe(occurrence.quote);
  });
  it("respects exact phrases, prefixes, excluded terms and filters", () => {
    const raw = "project start, project starter, reproject start, other";
    expect(findSearchOccurrences(raw, '"project start" -other path:notes').map((hit) => hit.occurrence.quote)).toEqual(["project start"]);
    expect(findSearchOccurrences(raw, 'proje').map((hit) => hit.occurrence.quote)).toEqual(["project", "project"]);
  });
  it("resumes inside a note without repeating the last result", () => {
    const raw = "# Work\n" + "task ".repeat(90);
    const first = findSearchOccurrences(raw, "task", { limit: 5 });
    const second = findSearchOccurrences(raw, "task", { limit: 5, from: first[4].occurrence.to });
    expect(first).toHaveLength(5);
    expect(second).toHaveLength(5);
    expect(second[0].occurrence.from).toBeGreaterThan(first[4].occurrence.to);
  });
});

describe("bounded result pages", () => {
  const row = (path: string, sourceContent: string) => ({ id: path, path, title: path, mtime_local: 1, size_bytes: sourceContent.length, sourceContent });
  it("continues a dense note, does not leak whole source text and stops at the end", async () => {
    const service = new VaultQueryService(new MockDatabaseAdapter());
    const search = vi.spyOn(service, "searchFullText").mockResolvedValue([row("A.md", "task task task"), row("B.md", "task")]);
    const first = await service.searchOccurrencesPage("task", { limit: 2 });
    expect(first.hits.map((hit) => hit.occurrence?.from)).toEqual([0, 5]);
    expect(first.hits.every((hit) => !("sourceContent" in hit))).toBe(true);
    const second = await service.searchOccurrencesPage("task", { cursor: first.next, limit: 2 });
    expect(second.hits.map((hit) => [hit.path, hit.occurrence?.from])).toEqual([["A.md", 10], ["B.md", 0]]);
    expect(second.next).toBeNull();
    expect(search).toHaveBeenCalledWith("task", 17, 0, true, null);
  });
  it("examines at most sixteen notes, rejects obsolete queries and observes cancellation", async () => {
    const service = new VaultQueryService(new MockDatabaseAdapter());
    const search = vi.spyOn(service, "searchFullText").mockResolvedValue(Array.from({ length: 17 }, (_, i) => row(`${i}.md`, "task")));
    const page = await service.searchOccurrencesPage("task", { cursor: { query: "old", noteOffset: 900, from: 500 } });
    expect(page.hits).toHaveLength(16);
    expect(page.next?.noteOffset).toBe(16);
    expect(search).toHaveBeenCalledWith("task", 17, 0, true, null);
    const abort = new AbortController(); abort.abort();
    await expect(service.searchOccurrencesPage("task", { signal: abort.signal })).rejects.toThrow();
    expect(search).toHaveBeenCalledTimes(1);
  });
  /**
   * The order is part of the request (finding 2026-09-19). Hits arrive page by
   * page, so the ORDER has to be the statement's: a page sorted after the fact
   * would reshuffle the list with every "load more". And a cursor belongs to
   * the order it was cut from - offset 16 by title is not offset 16 by time.
   */
  it("hands the chosen order to the statement and stamps it on the cursor", async () => {
    const service = new VaultQueryService(new MockDatabaseAdapter());
    const search = vi.spyOn(service, "searchFullText").mockResolvedValue(Array.from({ length: 17 }, (_, i) => row(`${i}.md`, "task")));
    const page = await service.searchOccurrencesPage("task", { order: { key: "modified", dir: "desc" } });
    expect(search).toHaveBeenCalledWith("task", 17, 0, true, { key: "modified", dir: "desc" });
    expect(page.next).toMatchObject({ query: "task", order: "modified:desc", noteOffset: 16 });
    // The same order continues where the cursor stands ...
    await service.searchOccurrencesPage("task", { cursor: page.next, order: { key: "modified", dir: "desc" } });
    expect(search).toHaveBeenLastCalledWith("task", 17, 16, true, { key: "modified", dir: "desc" });
    // ... another order, or the other direction, starts over.
    await service.searchOccurrencesPage("task", { cursor: page.next, order: { key: "title", dir: "asc" } });
    expect(search).toHaveBeenLastCalledWith("task", 17, 0, true, { key: "title", dir: "asc" });
    await service.searchOccurrencesPage("task", { cursor: page.next, order: { key: "modified", dir: "asc" } });
    expect(search).toHaveBeenLastCalledWith("task", 17, 0, true, { key: "modified", dir: "asc" });
  });
  it("reads a cursor from before the option as relevance", async () => {
    const service = new VaultQueryService(new MockDatabaseAdapter());
    const search = vi.spyOn(service, "searchFullText").mockResolvedValue([row("A.md", "task")]);
    await service.searchOccurrencesPage("task", { cursor: { query: "task", noteOffset: 32, from: 0 } });
    expect(search).toHaveBeenLastCalledWith("task", 17, 32, true, null);
    await service.searchOccurrencesPage("task", { cursor: { query: "task", noteOffset: 32, from: 0 }, order: { key: "relevance", dir: "desc" } });
    expect(search).toHaveBeenLastCalledWith("task", 17, 32, true, { key: "relevance", dir: "desc" });
  });
});
