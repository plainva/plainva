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

/**
 * How closeness to one question spreads over the notes (plan P2b): the median
 * of the notes' best scores and a robust deviation. A model's cosines sit in a
 * band of their own — the default model puts unrelated notes near 0.7 — so a
 * hit counts by how far it stands out of that band, not by its cosine or its
 * ratio to the best, which always crowns something. Median and MAD, because
 * the few notes that do answer must not widen the band they are measured
 * against.
 */
export interface ScoreSpread {
  /** The notes the question was compared with. */
  notes: number;
  /** The median of their best scores. */
  center: number;
  /** 1.4826 × the median absolute deviation: the standard deviation a normal spread with it would have. */
  scale: number;
}

const median = (sorted: Float64Array): number => {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
};

export function scoreSpread(scores: ArrayLike<number>): ScoreSpread {
  if (!scores.length) return { notes: 0, center: 0, scale: 0 };
  const sorted = Float64Array.from(scores).sort();
  const center = median(sorted);
  const deviations = sorted.map((score) => Math.abs(score - center)).sort();
  return { notes: sorted.length, center, scale: 1.4826 * median(deviations) };
}

/** How far a score stands out: robust deviations above the spread's center; 0 without a spread. */
export function prominence(score: number, spread: ScoreSpread): number {
  return spread.scale > 0 ? (score - spread.center) / spread.scale : 0;
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

  /**
   * The cosine of two stored sections (int8, scaled back); null when either
   * is not in the index. Near-duplicates are told apart by it (plan P2b).
   */
  similarity(a: { path: string; ordinal: number }, b: { path: string; ordinal: number }): number | null {
    const first = this.notes.get(a.path)?.chunks.find((chunk) => chunk.ordinal === a.ordinal)?.vector;
    const second = this.notes.get(b.path)?.chunks.find((chunk) => chunk.ordinal === b.ordinal)?.vector;
    if (!first || !second || first.values.length !== second.values.length) return null;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < first.values.length; i++) {
      dot += first.values[i]! * second.values[i]!;
      na += first.values[i]! * first.values[i]!;
      nb += second.values[i]! * second.values[i]!;
    }
    return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
  }

  /** A note's stored sections, or undefined when it has none. */
  chunksOf(path: string): readonly StoredChunkVector[] | undefined {
    return this.notes.get(path)?.chunks;
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
    return this.rank(query, limit, accept).hits;
  }

  /** As `search`, with how the question's closeness spreads over every accepted note. */
  rank(query: Float32Array, limit: number, accept: (path: string) => boolean = () => true): { hits: SemanticHit[]; spread: ScoreSpread } {
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
    const entries = [...best.entries()];
    const hits = entries
      .sort((a, b) => b[1].score - a[1].score || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit)
      .map(([path, { score, row }]) => ({ path, ordinal: packed.ordinals[row]!, hash: packed.hashes[row]!, score }));
    return { hits, spread: scoreSpread(entries.map(([, { score }]) => score)) };
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
