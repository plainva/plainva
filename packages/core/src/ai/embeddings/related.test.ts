import { describe, expect, it } from "vitest";
import { relatedNotes } from "./related.js";
import { VectorIndex } from "./search.js";
import type { StoredChunkVector } from "./store.js";
import { l2Normalize, quantizeInt8 } from "./vectors.js";

const DIM = 128;

/** A deterministic direction: a unit vector from a seed. */
function direction(seed: number): Float32Array {
  const out = new Float32Array(DIM);
  let state = seed * 2654435761 + 1;
  for (let i = 0; i < DIM; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out[i] = state / 2 ** 32 - 0.5;
  }
  return l2Normalize(out);
}

function mix(parts: [Float32Array, number][]): Float32Array {
  const out = new Float32Array(DIM);
  for (const [vector, weight] of parts) for (let i = 0; i < DIM; i++) out[i] = out[i]! + vector[i]! * weight;
  return l2Normalize(out);
}

const section = (ordinal: number, vector: Float32Array): StoredChunkVector => ({ ordinal, hash: `h${ordinal}-${vector[0]!.toFixed(6)}`, vector: quantizeInt8(vector) });

const COSTS = direction(1);
const SHOOTING = direction(2);

/** Twenty notes about other things, the kick-off, and what is close to it. */
function vault(): VectorIndex {
  const index = new VectorIndex("test", DIM);
  for (let i = 0; i < 20; i++) index.setNote(`other/${i}.md`, `s${i}`, [section(0, direction(100 + i))]);
  index.setNote("Kickoff.md", "k", [section(0, COSTS), section(1, SHOOTING)]);
  // Close to the kick-off's second section, and nothing like it elsewhere.
  index.setNote("Schedule.md", "s", [section(0, direction(50)), section(1, mix([[SHOOTING, 0.9], [direction(51), 0.45]]))]);
  // A copy: every section the same as the kick-off's.
  index.setNote("Kickoff copy.md", "c", [section(0, COSTS), section(1, SHOOTING)]);
  // Close as well, but linked from the kick-off.
  index.setNote("Linked.md", "l", [section(0, mix([[COSTS, 0.9], [direction(52), 0.45]]))]);
  return index;
}

/** Plan KI-Harness P2b-4: related notes from the stored vectors, only what stands out, never a copy. */
describe("related notes", () => {
  it("names the note that stands out of the neighbourhood, with the pair of sections that says why", () => {
    const hints = relatedNotes(vault(), "Kickoff.md", { exclude: new Set(["Linked.md"]) });
    expect(hints.map((hint) => hint.path)).toEqual(["Schedule.md"]);
    expect(hints[0]).toMatchObject({ from: { ordinal: 1 }, to: { ordinal: 1 } });
    expect(hints[0]!.score).toBeGreaterThan(0.8);
    expect(hints[0]!.prominence).toBeGreaterThanOrEqual(4);
  });

  it("never offers a copy, the note itself or what the caller leaves out", () => {
    const paths = relatedNotes(vault(), "Kickoff.md").map((hint) => hint.path);
    expect(paths).toContain("Linked.md");
    expect(paths).not.toContain("Kickoff copy.md");
    expect(paths).not.toContain("Kickoff.md");
    expect(relatedNotes(vault(), "Kickoff.md", { exclude: new Set(["Schedule.md", "Linked.md"]) })).toEqual([]);
  });

  it("offers nothing where every note looks alike", () => {
    const index = new VectorIndex("test", DIM);
    const theme = direction(7);
    for (let i = 0; i < 20; i++) index.setNote(`daily/${i}.md`, `d${i}`, [section(0, mix([[theme, 1], [direction(200 + i), 0.25]]))]);
    expect(relatedNotes(index, "daily/0.md")).toEqual([]);
  });

  it("offers nothing in a vault too small to have a neighbourhood, or for a note without vectors", () => {
    const index = new VectorIndex("test", DIM);
    index.setNote("a.md", "a", [section(0, SHOOTING)]);
    index.setNote("b.md", "b", [section(0, mix([[SHOOTING, 0.9], [direction(9), 0.45]]))]);
    expect(relatedNotes(index, "a.md")).toEqual([]);
    expect(relatedNotes(vault(), "missing.md")).toEqual([]);
  });

  it("gives at most three, and only notes the caller accepts", () => {
    const index = vault();
    for (let i = 0; i < 4; i++) index.setNote(`close/${i}.md`, `x${i}`, [section(0, mix([[SHOOTING, 0.9], [direction(300 + i), 0.45]]))]);
    expect(relatedNotes(index, "Kickoff.md")).toHaveLength(3);
    const accepted = relatedNotes(index, "Kickoff.md", { accept: (path) => !path.startsWith("close/") });
    expect(accepted.map((hint) => hint.path).some((path) => path.startsWith("close/"))).toBe(false);
  });
});
