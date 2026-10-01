/**
 * Related notes (plan KI-Harness P2b-4): notes close in meaning to one note,
 * from the vectors already stored — no request, not even to an own provider,
 * and nothing leaves the device.
 *
 * A hint must stand out of the note's neighbourhood, not merely be close:
 * the note's direction (the mean of its sections) is compared with every
 * other note, and only a note far above the median of all of them qualifies
 * (`prominence`, robust deviations). A model's cosines sit in a band of their
 * own — the default model puts unrelated notes near 0.7 — so a fixed cosine
 * would mean something else for every model, while a prominence is measured
 * against the model's own band. The closest pair of sections then names the
 * reason, and it must stand out as far. A section that repeats one of the
 * other note's (at or above the near-duplicate line) is a copy or a
 * template's lines — shared text, not a relation — and takes no part: a copy
 * of the note is never a hint, and daily notes are not related through
 * their template. A vault of look-alike notes yields no hints rather than
 * noise.
 *
 * At most three; the note itself and whatever the caller leaves out (linked
 * notes, dismissed pairs) never appear.
 */
import { prominence, scoreSpread, type VectorIndex } from "./search.js";
import type { StoredChunkVector } from "./store.js";

export interface RelatedHint {
  path: string;
  /** Cosine of the closest pair of sections that are not shared text. */
  score: number;
  /** How far the note and that pair stand out of the neighbourhood (robust deviations; the lower of the two). */
  prominence: number;
  /** The pair: a section of the note and one of the hint. */
  from: { ordinal: number; hash: string };
  to: { ordinal: number; hash: string };
}

export interface RelatedOptions {
  /** Paths that never become hints: the note's links, dismissed pairs. */
  exclude?: ReadonlySet<string>;
  /** The notes that take part at all (current vectors only). */
  accept?: (path: string) => boolean;
  limit?: number;
  /** The prominence a hint needs. */
  prominence?: number;
  /** A section this close to one of the other note's is shared text, not a relation. */
  nearDuplicate?: number;
}

export const RELATED_LIMIT = 3;
/**
 * Robust deviations above the neighbourhood's median. Measured on the
 * embedding spike's test vault (01.10., 48 notes in ten languages): from 4
 * on, 18 notes get hints and every one is a person's project, a project's
 * meeting or the weekly that names it; at 2 (mean and standard deviation)
 * 39 notes got hints, among them a bank note next to the weekly and the
 * health note next to a pasted text.
 */
export const RELATED_PROMINENCE = 4;
export const RELATED_NEAR_DUPLICATE = 0.95;
/** Below this many other notes a neighbourhood has no shape: no hints. */
export const RELATED_MIN_NOTES = 10;
/** Notes compared section by section after the coarse pass. */
const RESCORE = 12;

function cosine(a: StoredChunkVector, b: StoredChunkVector): number {
  const x = a.vector.values;
  const y = b.vector.values;
  let dot = 0;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < x.length; i++) {
    dot += x[i]! * y[i]!;
    nx += x[i]! * x[i]!;
    ny += y[i]! * y[i]!;
  }
  return nx > 0 && ny > 0 ? dot / Math.sqrt(nx * ny) : 0;
}

/** The note's direction: the mean of its sections, scaled back and normalised. */
function meanVector(chunks: readonly StoredChunkVector[], dim: number): Float32Array {
  const out = new Float32Array(dim);
  for (const chunk of chunks) {
    const { scale, values } = chunk.vector;
    for (let i = 0; i < dim; i++) out[i] = out[i]! + values[i]! * scale;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += out[i]! * out[i]!;
  if (norm > 0) {
    const inverse = 1 / Math.sqrt(norm);
    for (let i = 0; i < dim; i++) out[i] = out[i]! * inverse;
  }
  return out;
}

export function relatedNotes(index: VectorIndex, path: string, options: RelatedOptions = {}): RelatedHint[] {
  const own = index.chunksOf(path);
  if (!own?.length) return [];
  const exclude = options.exclude ?? new Set<string>();
  const accept = options.accept ?? (() => true);
  const needed = options.prominence ?? RELATED_PROMINENCE;
  const nearDuplicate = options.nearDuplicate ?? RELATED_NEAR_DUPLICATE;
  // The coarse pass: every other note's best section against the note's direction, best first.
  const { hits } = index.rank(meanVector(own, index.dim), index.noteCount, (other) => other !== path && accept(other));
  if (hits.length < RELATED_MIN_NOTES) return [];
  const spread = scoreSpread(hits.map((hit) => hit.score));
  const hints: RelatedHint[] = [];
  for (const hit of hits) {
    const lead = prominence(hit.score, spread);
    if (lead < needed || hints.length >= RESCORE) break;
    if (exclude.has(hit.path)) continue;
    const theirs = index.chunksOf(hit.path) ?? [];
    const alike = theirs.map((b) => own.map((a) => cosine(a, b)));
    // Shared text on either side leaves the comparison: what is left says whether the notes are related.
    const ownShared = own.map((_, i) => alike.some((row) => row[i]! >= nearDuplicate));
    const theirShared = alike.map((row) => row.some((score) => score >= nearDuplicate));
    let best: { i: number; j: number; score: number } | null = null;
    for (let j = 0; j < theirs.length; j++) {
      if (theirShared[j]) continue;
      for (let i = 0; i < own.length; i++) {
        if (ownShared[i]) continue;
        const score = alike[j]![i]!;
        if (!best || score > best.score) best = { i, j, score };
      }
    }
    if (!best) continue;
    const pairLead = prominence(best.score, spread);
    if (pairLead < needed) continue;
    const a = own[best.i]!;
    const b = theirs[best.j]!;
    hints.push({ path: hit.path, score: best.score, prominence: Math.min(lead, pairLead), from: { ordinal: a.ordinal, hash: a.hash }, to: { ordinal: b.ordinal, hash: b.hash } });
  }
  return hints.sort((a, b) => b.prominence - a.prominence || (a.path < b.path ? -1 : 1)).slice(0, options.limit ?? RELATED_LIMIT);
}
