import { describe, expect, it } from "vitest";
import { arcPositions, computeForceLayout, createSeededRandom, hashSeed, packCircles } from "@plainva/ui";

describe("graphLayout", () => {
  it("seeded random is deterministic per seed", () => {
    const a1 = createSeededRandom(42);
    const a2 = createSeededRandom(42);
    const b = createSeededRandom(43);
    const seqA1 = [a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2()];
    const seqB = [b(), b(), b()];
    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual(seqB);
    for (const v of seqA1) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of seqA1) expect(v).toBeLessThan(1);
  });

  it("hashSeed is stable and spreads different inputs", () => {
    expect(hashSeed("vault-a")).toBe(hashSeed("vault-a"));
    expect(hashSeed("vault-a")).not.toBe(hashSeed("vault-b"));
  });

  it("force layout is fully deterministic (same seed => identical positions)", () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, size: 8 }));
    const edges = Array.from({ length: 15 }, (_, i) => ({ source: `n${i}`, target: `n${(i + 3) % 20}` }));
    const one = computeForceLayout(nodes, edges, { seed: "same" });
    const two = computeForceLayout(nodes, edges, { seed: "same" });
    for (const [id, p] of one.positions) {
      const q = two.positions.get(id)!;
      expect(q.x).toBe(p.x);
      expect(q.y).toBe(p.y);
    }
  });

  it("keeps pinned nodes exactly at their pin", () => {
    const { positions } = computeForceLayout(
      [
        { id: "pinned", size: 8, fx: 123, fy: -45 },
        { id: "free", size: 8 },
      ],
      [{ source: "pinned", target: "free" }],
      { seed: "pin" }
    );
    expect(positions.get("pinned")).toEqual({ x: 123, y: -45 });
    expect(positions.get("free")!.x).not.toBe(123);
  });

  it("pulls linked nodes closer than chain-distant ones and survives bogus edges", () => {
    // Chain a-b-c-d-e-f: direct neighbors must sit far closer than the ends.
    const ids = ["a", "b", "c", "d", "e", "f"];
    const nodes = ids.map((id) => ({ id, size: 8 }));
    const edges = [
      ...ids.slice(1).map((id, i) => ({ source: ids[i], target: id })),
      { source: "a", target: "a" }, // self edge: filtered
      { source: "a", target: "ghost" }, // unknown target: filtered
    ];
    const { positions } = computeForceLayout(nodes, edges, { seed: "dist" });
    const d = (p: string, q: string) => {
      const a = positions.get(p)!;
      const b = positions.get(q)!;
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    expect(d("a", "b")).toBeLessThan(d("a", "f"));
  });

  it("packs circles deterministically with count-proportional radii", () => {
    const items = [
      { id: "big", count: 40 },
      { id: "small", count: 2 },
      { id: "mid", count: 10 },
    ];
    const one = packCircles(items, { radius: 300 });
    const two = packCircles(items, { radius: 300 });
    expect(one).toEqual(two);
    const byId = new Map(one.map((c) => [c.id, c]));
    expect(byId.get("big")!.r).toBeGreaterThan(byId.get("mid")!.r);
    expect(byId.get("mid")!.r).toBeGreaterThan(byId.get("small")!.r);
    expect(packCircles([], { radius: 100 })).toEqual([]);
  });

  it("distributes arc positions across the span", () => {
    const single = arcPositions(1, { centerX: 0, centerY: 0, radius: 10, startAngle: 0, endAngle: Math.PI });
    expect(single[0].x).toBeCloseTo(Math.cos(Math.PI / 2) * 10, 5);
    expect(single[0].y).toBeCloseTo(10, 5);

    const three = arcPositions(3, { centerX: 0, centerY: 0, radius: 10, startAngle: 0, endAngle: Math.PI });
    expect(three[0].x).toBeCloseTo(10, 5);
    expect(three[2].x).toBeCloseTo(-10, 5);
  });
});
