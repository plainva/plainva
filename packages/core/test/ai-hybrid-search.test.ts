import { beforeEach, describe, expect, it } from "vitest";
import { createTrigramEmbeddingEngine } from "../src/ai/embeddings/engine.js";
import { HybridSearchService, meaningText } from "../src/ai/embeddings/hybridSearch.js";
import type { SearchMode } from "../src/ai/embeddings/searchMode.js";
import { EmbeddingIndexer } from "../src/ai/embeddings/pipeline.js";
import { resetEmbeddingStores } from "../src/ai/embeddings/store.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { SNIPPET_MARK_START } from "../src/vault/ftsQuery.js";
import { sha256Hex, utf8Encode } from "../src/workspace/encoding.js";
import { realSqlite } from "./helpers/realSqlite.js";

const NOTES: Record<string, { content: string; tags?: string[] }> = {
  "Budget.md": { content: "## Costs\n\nThe quarterly budget review is on Friday." },
  "Garden/Tomatoes.md": { content: "Intro.\n\n## Care\n\nWater the tomatoes every morning, before the heat." },
  "Garden/Basil.md": { content: "Basil needs sun and a little water." },
  "Travel.md": { content: "Train tickets to Lisbon are booked.", tags: ["trip"] },
};

describe("search by words, by meaning, or by both", () => {
  let db: IDatabaseAdapter;
  let words: VaultQueryService;
  let indexer: EmbeddingIndexer;
  let mode: SearchMode;
  let active: boolean;
  let hybrid: HybridSearchService;

  beforeEach(async () => {
    resetEmbeddingStores();
    db = await realSqlite();
    let mtime = 1000;
    for (const [path, note] of Object.entries(NOTES)) {
      const title = path.replace(/^.*\//, "").replace(/\.md$/, "");
      await db.execute(`INSERT INTO files (id, path, title, sha256, mtime_local, mode) VALUES (?, ?, ?, ?, ?, 'obsidian')`, [
        path, path, title, sha256Hex(utf8Encode(note.content)), mtime++,
      ]);
      await db.execute(`INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES (?, ?, ?, '', '')`, [note.content, title, path]);
      for (const tag of note.tags ?? []) await db.execute(`INSERT INTO tags (file_id, tag) VALUES (?, ?)`, [path, tag]);
    }
    const readText = async (path: string) => NOTES[path]?.content ?? null;
    words = new VaultQueryService(db);
    indexer = new EmbeddingIndexer({ db, engine: createTrigramEmbeddingEngine(256), readText });
    await indexer.embed((await indexer.plan()).pending);
    mode = "both";
    active = true;
    hybrid = new HybridSearchService({ words, meaning: () => (active ? indexer : null), mode: () => mode, readText });
  });

  it("is the search of today in words mode and without a model", async () => {
    mode = "words";
    const page = await hybrid.searchOccurrencesPage("budget");
    expect(page.hits.map((hit) => [hit.path, hit.found])).toEqual([["Budget.md", undefined]]);
    mode = "both";
    active = false;
    expect(hybrid.activeMode()).toBe("words");
    expect((await hybrid.searchOccurrencesPage("budget")).hits.map((hit) => hit.path)).toEqual(["Budget.md"]);
  });

  it("finds by meaning what the words miss, and points at the chunk", async () => {
    mode = "meaning";
    const { hits } = await hybrid.searchOccurrencesPage("watering tomatoes");
    expect(hits[0]!.path).toBe("Garden/Tomatoes.md");
    expect(hits[0]!.found).toBe("meaning");
    const content = NOTES["Garden/Tomatoes.md"]!.content;
    const occurrence = hits[0]!.occurrence!;
    expect(content.slice(occurrence.from, occurrence.to)).toBe(occurrence.quote);
    expect(occurrence.quote).toBe("Water the tomatoes every morning, before the heat.");
    expect(occurrence.line).toBe(5);
    expect(occurrence.headings).toEqual(["Care"]);
    expect(hits[0]!.snippet).not.toContain(SNIPPET_MARK_START);
    expect(new Set(hits.map((hit) => hit.path)).size).toBe(hits.length);
  });

  it("marks what found each note when both take part", async () => {
    const { hits } = await hybrid.searchOccurrencesPage("budget review");
    expect(hits[0]).toMatchObject({ path: "Budget.md", found: "both" });
    expect(hits[0]!.snippet).toContain(SNIPPET_MARK_START);
    expect(hits.slice(1).every((hit) => hit.found === "meaning")).toBe(true);
  });

  it("keeps the operators' limits for meaning hits", async () => {
    mode = "meaning";
    const garden = await hybrid.searchOccurrencesPage("path:garden water");
    expect(garden.hits.map((hit) => hit.path).sort()).toEqual(["Garden/Basil.md", "Garden/Tomatoes.md"]);
    const trips = await hybrid.searchOccurrencesPage("tag:trip train");
    expect(trips.hits.map((hit) => hit.path)).toEqual(["Travel.md"]);
    expect(meaningText("path:garden -tag:x water the plants")).toBe("water the plants");
  });

  it("pages through one ranking", async () => {
    mode = "meaning";
    const first = await hybrid.searchOccurrencesPage("water", { limit: 1 });
    expect(first.hits).toHaveLength(1);
    const second = await hybrid.searchOccurrencesPage("water", { limit: 1, cursor: first.next });
    expect(second.hits).toHaveLength(1);
    expect(second.hits[0]!.path).not.toBe(first.hits[0]!.path);
  });

  it("leaves another order to the words", async () => {
    const { hits } = await hybrid.searchOccurrencesPage("water", { order: { key: "title", dir: "asc" } });
    expect(hits.map((hit) => [hit.path, hit.found])).toEqual([
      ["Garden/Basil.md", "words"],
      ["Garden/Tomatoes.md", "words"],
    ]);
  });
});
