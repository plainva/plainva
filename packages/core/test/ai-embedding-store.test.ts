import { beforeEach, describe, expect, it } from "vitest";
import { EmbeddingStore, resetEmbeddingStores, type StoredChunkVector } from "../src/ai/embeddings/store.js";
import { l2Normalize, quantizeInt8 } from "../src/ai/embeddings/vectors.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { realSqlite } from "./helpers/realSqlite.js";

const DIM = 4;
const vector = (seed: number) => quantizeInt8(l2Normalize(Float32Array.from({ length: DIM }, (_, i) => Math.sin(seed * 7 + i))));
const chunks = (count: number, tag = "h"): StoredChunkVector[] =>
  Array.from({ length: count }, (_, ordinal) => ({ ordinal, hash: `${tag}${ordinal}`, vector: vector(ordinal + tag.length) }));

describe("EmbeddingStore on SQLite", () => {
  let db: IDatabaseAdapter;
  let store: EmbeddingStore;

  beforeEach(async () => {
    resetEmbeddingStores();
    db = await realSqlite();
    store = new EmbeddingStore(db);
    await store.registerEngine("e1", DIM);
  });

  it("writes a note's vectors and loads them back in order", async () => {
    await store.writeNote("e1", "a.md", "sha-a", chunks(3));
    const [note] = await store.loadEngine("e1", DIM);
    expect(note!.path).toBe("a.md");
    expect(note!.sha256).toBe("sha-a");
    expect(note!.chunks.map((c) => c.ordinal)).toEqual([0, 1, 2]);
    expect(Array.from(note!.chunks[1]!.vector.values)).toEqual(Array.from(vector(2).values));
    expect(note!.chunks[1]!.vector.scale).toBeCloseTo(vector(2).scale, 6);
    expect(await store.noteStates("e1")).toEqual(new Map([["a.md", { sha256: "sha-a", chunks: 3 }]]));
  });

  it("replaces a note whole: no old chunk survives", async () => {
    await store.writeNote("e1", "a.md", "v1", chunks(5));
    await store.writeNote("e1", "a.md", "v2", chunks(2, "n"));
    const [note] = await store.loadEngine("e1", DIM);
    expect(note!.sha256).toBe("v2");
    expect(note!.chunks.map((c) => c.hash)).toEqual(["n0", "n1"]);
  });

  it("finds stored vectors by chunk hash across notes", async () => {
    await store.writeNote("e1", "a.md", "s", chunks(2));
    const found = await store.vectorsByHash("e1", DIM, ["h1", "missing", "h1"]);
    expect([...found.keys()]).toEqual(["h1"]);
    expect(Array.from(found.get("h1")!.values)).toEqual(Array.from(vector(2).values));
  });

  it("forgets notes of one engine or of all", async () => {
    await store.registerEngine("e2", DIM);
    for (const engine of ["e1", "e2"]) {
      await store.writeNote(engine, "a.md", "s", chunks(1));
      await store.writeNote(engine, "b.md", "s", chunks(1));
    }
    await store.forgetNotes(["a.md"], "e1");
    expect([...(await store.noteStates("e1")).keys()]).toEqual(["b.md"]);
    expect([...(await store.noteStates("e2")).keys()].sort()).toEqual(["a.md", "b.md"]);
    await store.forgetNotes(["b.md"]);
    expect([...(await store.noteStates("e1")).keys()]).toEqual([]);
    expect([...(await store.noteStates("e2")).keys()]).toEqual(["a.md"]);
  });

  it("lists and drops vector spaces, and keeps one dimension per space", async () => {
    await store.writeNote("e1", "a.md", "s", chunks(3));
    expect(await store.spaces()).toEqual([{ engine: "e1", dim: DIM, notes: 1, chunks: 3 }]);
    await expect(store.registerEngine("e1", 8)).rejects.toThrow(/4-dimensional/);
    await store.dropEngine("e1");
    expect(await store.spaces()).toEqual([]);
    expect(await store.loadEngine("e1", DIM)).toEqual([]);
  });

  it("loads large spaces page by page", async () => {
    for (let n = 0; n < 45; n++) await store.writeNote("e1", `n${String(n).padStart(2, "0")}.md`, `s${n}`, chunks(50));
    const notes = await store.loadEngine("e1", DIM);
    expect(notes).toHaveLength(45);
    expect(notes.every((note) => note.chunks.length === 50)).toBe(true);
    expect(notes[44]!.chunks.map((c) => c.ordinal)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  // A note that cannot be read whole is embedded again instead of answering half.
  it("treats a note with a broken or missing chunk as not embedded", async () => {
    await store.writeNote("e1", "broken.md", "s", chunks(2));
    await store.writeNote("e1", "partial.md", "s", chunks(3));
    await store.writeNote("e1", "fine.md", "s", chunks(1));
    await db.execute(`UPDATE ai_embedding SET vec = 'AAAA' WHERE path = 'broken.md' AND ordinal = 1`);
    await db.execute(`DELETE FROM ai_embedding WHERE path = 'partial.md' AND ordinal = 2`);
    expect((await store.loadEngine("e1", DIM)).map((note) => note.path)).toEqual(["fine.md"]);
  });
});

describe("EmbeddingStore on a read-only connection", () => {
  it("reads as empty and refuses to write", async () => {
    resetEmbeddingStores();
    const db = await realSqlite();
    const readOnly: IDatabaseAdapter = { ...db, execute: async () => Promise.reject(new Error("sql.execute not allowed")) };
    const store = new EmbeddingStore(readOnly);
    expect(await store.writable()).toBe(false);
    expect(await store.loadEngine("e1", DIM)).toEqual([]);
    expect(await store.spaces()).toEqual([]);
    await store.forgetNotes(["a.md"]);
    await expect(store.writeNote("e1", "a.md", "s", chunks(1))).rejects.toThrow(/read-only/);
  });
});
