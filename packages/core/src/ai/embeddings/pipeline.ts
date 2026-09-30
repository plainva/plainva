/**
 * Keeps a vault's vectors in step with its notes (plan KI-Harness P2a-2).
 *
 * The index is the truth. Every note in `files` is owed vectors cut from the
 * text its `sha256` names; `plan` compares that with what the store holds and
 * lists what is missing or outdated, the most recently changed first. Nobody
 * has to report a change: an edit, a sync pull, a rename and a file changed
 * outside the app all end as a new `files.sha256`, and the next plan sees it.
 *
 * Never stale: a hit counts only while its note's current `files.sha256` is
 * the one its vectors were cut from (`search`). Old vectors stay stored until
 * the note is embedded again, so an edit re-embeds only the chunks whose text
 * changed — reused by hash, across restarts.
 */
import type { IDatabaseAdapter } from "../../db/IDatabaseAdapter.js";
import { sha256Hex, utf8Encode } from "../../workspace/encoding.js";
import { chunkNote, type NoteChunk } from "./chunks.js";
import type { EmbeddingEngine } from "./engine.js";
import { VectorIndex, type SemanticHit } from "./search.js";
import { EmbeddingStore, type StoredChunkVector } from "./store.js";
import { quantizeInt8, type QuantizedVector } from "./vectors.js";

export interface EmbeddingWork {
  path: string;
  /** The note's title in the index (frontmatter `title`, else the file name). */
  title: string;
  /** `files.sha256` when the plan was made. */
  sha256: string;
  mtime: number;
}

export interface EmbeddingPlan {
  /** Notes without vectors for their current text, the most recently changed first. */
  pending: EmbeddingWork[];
  /** Notes that have vectors but are gone from the index. */
  orphans: string[];
  /** Notes in the index. */
  total: number;
}

/**
 * What became of a note: embedded; changed on disk since the index read it
 * (the index re-reads it, and the next plan brings it back); or gone.
 */
export type EmbeddingOutcome = "embedded" | "changed" | "gone";

export interface EmbeddingIndexerOptions {
  db: IDatabaseAdapter;
  engine: EmbeddingEngine;
  /** A note's text as it is now, or null when it is gone. */
  readText(path: string): Promise<string | null>;
}

/** New chunks per engine call, across notes: few calls, bounded memory. */
export const EMBED_CALL_CHUNKS = 32;
/** Paths per `IN` list. */
const PATHS_PER_QUERY = 200;

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class EmbeddingIndexer {
  readonly store: EmbeddingStore;
  private readonly db: IDatabaseAdapter;
  private readonly engine: EmbeddingEngine;
  private readonly readText: (path: string) => Promise<string | null>;
  private index: Promise<VectorIndex> | null = null;

  constructor(options: EmbeddingIndexerOptions) {
    this.db = options.db;
    this.engine = options.engine;
    this.readText = options.readText;
    this.store = new EmbeddingStore(options.db);
  }

  get engineId(): string {
    return this.engine.id;
  }

  /** The engine's vectors in memory, loaded once (again after a failed load). */
  vectorIndex(): Promise<VectorIndex> {
    this.index ??= (async () => {
      const index = new VectorIndex(this.engine.id, this.engine.dim);
      index.load(await this.store.loadEngine(this.engine.id, this.engine.dim));
      return index;
    })().catch((error: unknown) => {
      this.index = null;
      throw error;
    });
    return this.index;
  }

  async plan(): Promise<EmbeddingPlan> {
    // The store's tables must exist for the join; a read-only connection has none to plan for.
    if (!(await this.store.writable())) return { pending: [], orphans: [], total: 0 };
    await this.store.registerEngine(this.engine.id, this.engine.dim);
    const rows = await this.db.query<{ path: string; title: string | null; sha256: string | null; mtime: number | null; embedded: string | null }>(
      `SELECT f.path AS path, f.title AS title, f.sha256 AS sha256, f.mtime_local AS mtime, n.sha256 AS embedded
         FROM files f
         LEFT JOIN ai_embedding_note n ON n.engine = ? AND n.path = f.path
        WHERE f.mode != 'attachment' AND f.path NOT LIKE '%.base'`,
      [this.engine.id],
    );
    const known = new Set<string>();
    const pending: EmbeddingWork[] = [];
    for (const row of rows) {
      known.add(row.path);
      if (!row.sha256 || row.embedded === row.sha256) continue;
      pending.push({ path: row.path, title: String(row.title ?? ""), sha256: row.sha256, mtime: Number(row.mtime) || 0 });
    }
    pending.sort((a, b) => b.mtime - a.mtime || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const orphans = [...(await this.store.noteStates(this.engine.id)).keys()].filter((path) => !known.has(path));
    return { pending, orphans, total: rows.length };
  }

  /**
   * Embeds notes of a plan. A note is read now and embedded only when its text
   * is still the one the index hashed; its unchanged chunks keep their vectors.
   */
  async embed(works: readonly EmbeddingWork[], signal?: AbortSignal): Promise<Map<string, EmbeddingOutcome>> {
    const outcome = new Map<string, EmbeddingOutcome>();
    const notes: { work: EmbeddingWork; chunks: NoteChunk[] }[] = [];
    for (const work of works) {
      signal?.throwIfAborted();
      const content = await this.readText(work.path);
      if (content === null) outcome.set(work.path, "gone");
      else if (sha256Hex(utf8Encode(content)) !== work.sha256) outcome.set(work.path, "changed");
      else notes.push({ work, chunks: chunkNote(work.title, content) });
    }
    if (!notes.length) return outcome;
    const vectors: Map<string, QuantizedVector> = await this.store.vectorsByHash(
      this.engine.id,
      this.engine.dim,
      notes.flatMap((note) => note.chunks.map((chunk) => chunk.hash)),
    );
    const missing = new Map<string, string>();
    for (const note of notes) for (const chunk of note.chunks) if (!vectors.has(chunk.hash)) missing.set(chunk.hash, chunk.text);
    for (const group of chunked([...missing], EMBED_CALL_CHUNKS)) {
      signal?.throwIfAborted();
      const embedded = await this.engine.embed(group.map(([, text]) => text), "document", signal);
      group.forEach(([hash], i) => vectors.set(hash, quantizeInt8(embedded[i]!)));
    }
    const index = await this.vectorIndex();
    for (const { work, chunks } of notes) {
      const stored: StoredChunkVector[] = chunks.map((chunk) => ({ ordinal: chunk.ordinal, hash: chunk.hash, vector: vectors.get(chunk.hash)! }));
      await this.store.writeNote(this.engine.id, work.path, work.sha256, stored);
      index.setNote(work.path, work.sha256, stored);
      outcome.set(work.path, "embedded");
    }
    return outcome;
  }

  /** Drops the vectors of notes that left the index. */
  async forget(paths: readonly string[]): Promise<void> {
    if (!paths.length) return;
    await this.store.forgetNotes(paths, this.engine.id);
    const index = await this.vectorIndex();
    for (const path of paths) index.removeNote(path);
  }

  /**
   * The notes closest in meaning to a question, best first — only notes whose
   * vectors were cut from their current text. `accept` narrows the notes
   * before they take a place (a folder filter, the privacy gate).
   */
  async search(question: string, limit: number, accept?: (path: string) => boolean, signal?: AbortSignal): Promise<SemanticHit[]> {
    const index = await this.vectorIndex();
    if (!index.noteCount || limit <= 0) return [];
    const [query] = await this.engine.embed([question], "query", signal);
    const current: SemanticHit[] = [];
    // Stale notes are skipped, so ask for more than needed and widen once if a sync left many behind.
    for (const wanted of [limit * 2 + 8, index.noteCount]) {
      current.length = 0;
      const hits = index.search(query!, wanted, accept);
      const shas = await this.currentShas(hits.map((hit) => hit.path));
      for (const hit of hits) if (shas.get(hit.path) === index.sha256Of(hit.path)) current.push(hit);
      if (current.length >= limit || hits.length < wanted) break;
    }
    return current.slice(0, limit);
  }

  private async currentShas(paths: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const group of chunked(paths, PATHS_PER_QUERY)) {
      const rows = await this.db.query<{ path: string; sha256: string | null }>(
        `SELECT path, sha256 FROM files WHERE path IN (${group.map(() => "?").join(", ")})`,
        group,
      );
      for (const row of rows) if (row.sha256) out.set(row.path, row.sha256);
    }
    return out;
  }
}
