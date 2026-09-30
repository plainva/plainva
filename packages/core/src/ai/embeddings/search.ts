/**
 * Search by meaning (plan KI-Harness §10.4): an engine's vectors in memory,
 * compared with the question one by one. The spike measured 15 ms for 5,675
 * chunks × 768 dimensions, so a vault needs no approximate index. A note
 * answers with its best chunk; words and meaning meet in reciprocal rank
 * fusion, which needs no common score scale.
 */
import type { StoredChunkVector, StoredNoteVectors } from "./store.js";
import { dotInt8 } from "./vectors.js";

export interface SemanticHit {
  path: string;
  /** The best chunk of the note. */
  ordinal: number;
  hash: string;
  /** Cosine similarity of the question and that chunk. */
  score: number;
}

interface Packed {
  paths: string[];
  ordinals: Int32Array;
  hashes: string[];
  scales: Float32Array;
  values: Int8Array;
}

/**
 * The vectors of one engine, note by note. Notes are replaced whole; the
 * packed matrix is rebuilt on the next search after a change.
 */
export class VectorIndex {
  private readonly notes = new Map<string, StoredNoteVectors>();
  private packed: Packed | null = null;

  constructor(
    readonly engine: string,
    readonly dim: number,
  ) {}

  load(notes: readonly StoredNoteVectors[]): void {
    for (const note of notes) this.notes.set(note.path, note);
    this.packed = null;
  }

  setNote(path: string, sha256: string, chunks: readonly StoredChunkVector[]): void {
    for (const chunk of chunks) {
      if (chunk.vector.values.length !== this.dim) throw new Error(`vector index: ${chunk.vector.values.length} components, not ${this.dim}`);
    }
    this.notes.set(path, { path, sha256, chunks: [...chunks] });
    this.packed = null;
  }

  removeNote(path: string): void {
    if (this.notes.delete(path)) this.packed = null;
  }

  /** The note text a note's vectors were cut from, or undefined when it has none. */
  sha256Of(path: string): string | undefined {
    return this.notes.get(path)?.sha256;
  }

  get noteCount(): number {
    return this.notes.size;
  }

  get chunkCount(): number {
    let count = 0;
    for (const note of this.notes.values()) count += note.chunks.length;
    return count;
  }

  private pack(): Packed {
    if (this.packed) return this.packed;
    const rows = this.chunkCount;
    const packed: Packed = {
      paths: new Array<string>(rows),
      ordinals: new Int32Array(rows),
      hashes: new Array<string>(rows),
      scales: new Float32Array(rows),
      values: new Int8Array(rows * this.dim),
    };
    let row = 0;
    for (const note of this.notes.values()) {
      for (const chunk of note.chunks) {
        packed.paths[row] = note.path;
        packed.ordinals[row] = chunk.ordinal;
        packed.hashes[row] = chunk.hash;
        packed.scales[row] = chunk.vector.scale;
        packed.values.set(chunk.vector.values, row * this.dim);
        row++;
      }
    }
    this.packed = packed;
    return packed;
  }

  /**
   * The `limit` notes closest to an L2-normalised question, each with its best
   * chunk. `accept` leaves notes out before they take a place (a folder the
   * search is limited to, a note that no longer exists).
   */
  search(query: Float32Array, limit: number, accept: (path: string) => boolean = () => true): SemanticHit[] {
    if (query.length !== this.dim) throw new Error(`vector index: a ${query.length}-dimensional question for ${this.dim} dimensions`);
    const packed = this.pack();
    const best = new Map<string, { score: number; row: number }>();
    const accepted = new Map<string, boolean>();
    for (let row = 0; row < packed.paths.length; row++) {
      const path = packed.paths[row]!;
      let ok = accepted.get(path);
      if (ok === undefined) {
        ok = accept(path);
        accepted.set(path, ok);
      }
      if (!ok) continue;
      const score = dotInt8(query, packed.values, row, packed.scales[row]!);
      const current = best.get(path);
      if (!current || score > current.score) best.set(path, { score, row });
    }
    return [...best.entries()]
      .sort((a, b) => b[1].score - a[1].score || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit)
      .map(([path, { score, row }]) => ({ path, ordinal: packed.ordinals[row]!, hash: packed.hashes[row]!, score }));
  }
}

/** The constant of reciprocal rank fusion; 60 is the literature's and the spike's. */
export const RRF_K = 60;

export interface FusedHit {
  path: string;
  score: number;
  /** 1-based rank of the note in each ranking that holds it — which ones found it. */
  ranks: Record<string, number>;
}

/**
 * Reciprocal rank fusion: a note scores `1 / (k + rank)` in every ranking
 * that holds it. Only ranks count, so full-text scores and cosines never have
 * to be put on one scale. Ties keep a stable order by path.
 */
export function fuseRankings(rankings: Record<string, readonly string[]>, k = RRF_K): FusedHit[] {
  const fused = new Map<string, FusedHit>();
  for (const [source, paths] of Object.entries(rankings)) {
    paths.forEach((path, index) => {
      let hit = fused.get(path);
      if (!hit) {
        hit = { path, score: 0, ranks: {} };
        fused.set(path, hit);
      }
      if (hit.ranks[source] !== undefined) return;
      hit.ranks[source] = index + 1;
      hit.score += 1 / (k + index + 1);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
