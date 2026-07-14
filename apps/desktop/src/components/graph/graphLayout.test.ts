import { describe, expect, it } from "vitest";
import {
  arcPositions,
  computeForceLayout,
  createSeededRandom,
  hashSeed,
  logRadius,
  packCircles,
  packHierarchy,
  resolveCollisions,
  type HybridPackChild,
} from "@plainva/ui";

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

  it("logRadius grows monotonically over magnitudes and clamps at the ends", () => {
    const opts = { min: 6, max: 34, k: 2 };
    expect(logRadius(0, opts)).toBe(6); // zero magnitude sits at min
    expect(logRadius(1, opts)).toBeGreaterThan(6);
    expect(logRadius(10, opts)).toBeGreaterThan(logRadius(1, opts));
    expect(logRadius(1000, opts)).toBeGreaterThan(logRadius(10, opts));
    expect(logRadius(1e9, opts)).toBe(34); // hard cap, no runaway "giant circle"
    expect(logRadius(-5, opts)).toBe(6); // defensive on negative input
  });

  it("resolveCollisions separates overlapping nodes and is deterministic", () => {
    const items = [
      { id: "a", x: 0, y: 0, size: 10 },
      { id: "b", x: 2, y: 0, size: 10 }, // heavily overlapping
    ];
    const one = resolveCollisions(items, { seed: "sep", padding: 6 });
    const two = resolveCollisions(items, { seed: "sep", padding: 6 });
    expect(one.get("a")).toEqual(two.get("a")); // deterministic
    expect(one.get("b")).toEqual(two.get("b"));
    const a = one.get("a")!;
    const b = one.get("b")!;
    // Required center distance ~= (10+6)+(10+6) = 32; allow slack from finite ticks.
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(28);
  });

  it("resolveCollisions keeps fixed nodes exactly in place", () => {
    const out = resolveCollisions(
      [
        { id: "fixed", x: 0, y: 0, size: 10, fixed: true },
        { id: "free", x: 1, y: 0, size: 10 },
      ],
      { seed: "fix", padding: 6 }
    );
    expect(out.get("fixed")).toEqual({ x: 0, y: 0 });
    expect(out.get("free")!.x).not.toBe(1); // pushed off the fixed node
    expect(resolveCollisions([], { seed: "empty" }).size).toBe(0);
  });
});

describe("packHierarchy", () => {
  const leaf = (id: string, size = 10, pin?: { x: number; y: number }): HybridPackChild => ({ id, size, pin });
  const container = (id: string, children: HybridPackChild[]): HybridPackChild => ({ id, children });

  /** Every child circle must sit fully inside its container circle. */
  function expectEnclosed(
    result: ReturnType<typeof packHierarchy>,
    containerId: string,
    children: { id: string; r: number }[]
  ) {
    const c = result.positions.get(containerId)!;
    const cr = result.radii.get(containerId)!;
    for (const child of children) {
      const p = result.positions.get(child.id)!;
      const dist = Math.hypot(p.x - c.x, p.y - c.y);
      expect(dist + child.r).toBeLessThanOrEqual(cr + 0.001);
    }
  }

  const TREE: HybridPackChild[] = [
    container("folder:P", [
      leaf("P/a.md", 8),
      leaf("P/b.md", 8),
      container("folder:P/Sub", [leaf("P/Sub/deep.md", 6), leaf("P/Sub/other.md", 6)]),
    ]),
    leaf("root.md", 9),
    leaf("folder:Q", 20),
  ];
  const EDGES = [
    { source: "P/a.md", target: "P/b.md" },
    { source: "P/a.md", target: "root.md" },
    { source: "P/Sub/deep.md", target: "P/Sub/other.md" },
  ];

  it("is deterministic and input-order invariant", () => {
    const one = packHierarchy(TREE, EDGES, { seed: "s" });
    const two = packHierarchy(TREE, EDGES, { seed: "s" });
    expect([...one.positions.entries()]).toEqual([...two.positions.entries()]);
    expect([...one.radii.entries()]).toEqual([...two.radii.entries()]);

    // Same tree with shuffled child order lays out identically (order is
    // normalized by id inside).
    const shuffled: HybridPackChild[] = [
      leaf("folder:Q", 20),
      container("folder:P", [
        container("folder:P/Sub", [leaf("P/Sub/other.md", 6), leaf("P/Sub/deep.md", 6)]),
        leaf("P/b.md", 8),
        leaf("P/a.md", 8),
      ]),
      leaf("root.md", 9),
    ];
    const three = packHierarchy(shuffled, EDGES, { seed: "s" });
    expect(three.positions.get("P/a.md")).toEqual(one.positions.get("P/a.md"));
    expect(three.radii.get("folder:P")).toEqual(one.radii.get("folder:P"));
  });

  it("encloses every child in its container, recursively, without sibling overlap", () => {
    const res = packHierarchy(TREE, EDGES, { seed: "s" });
    const subR = res.radii.get("folder:P/Sub")!;
    expectEnclosed(res, "folder:P/Sub", [
      { id: "P/Sub/deep.md", r: 6 },
      { id: "P/Sub/other.md", r: 6 },
    ]);
    expectEnclosed(res, "folder:P", [
      { id: "P/a.md", r: 8 },
      { id: "P/b.md", r: 8 },
      { id: "folder:P/Sub", r: subR },
    ]);
    // Direct siblings inside folder:P keep clear of each other.
    const pairs: [string, number][] = [
      ["P/a.md", 8],
      ["P/b.md", 8],
      ["folder:P/Sub", subR],
    ];
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const a = res.positions.get(pairs[i][0])!;
        const b = res.positions.get(pairs[j][0])!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(pairs[i][1] + pairs[j][1] - 1);
      }
    }
  });

  it("pulls linked leaves closer than unlinked ones within a container", () => {
    const kids = ["a", "b", "c", "d", "e", "f"].map((id) => leaf(`F/${id}.md`, 8));
    const tree = [container("folder:F", kids)];
    const chain = [
      { source: "F/a.md", target: "F/b.md" },
      { source: "F/b.md", target: "F/c.md" },
      { source: "F/c.md", target: "F/d.md" },
      { source: "F/d.md", target: "F/e.md" },
      { source: "F/e.md", target: "F/f.md" },
    ];
    const res = packHierarchy(tree, chain, { seed: "chain" });
    const d = (p: string, q: string) => {
      const a = res.positions.get(p)!;
      const b = res.positions.get(q)!;
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    expect(d("F/a.md", "F/b.md")).toBeLessThan(d("F/a.md", "F/f.md"));
  });

  it("keeps a pinned leaf exactly at its pin and grows the container around it", () => {
    const tree = [
      container("folder:P", [leaf("P/a.md", 8, { x: 900, y: -400 }), leaf("P/b.md", 8), leaf("P/c.md", 8)]),
      leaf("root.md", 9),
    ];
    const res = packHierarchy(tree, [], { seed: "pin" });
    expect(res.positions.get("P/a.md")).toEqual({ x: 900, y: -400 });
    // The container follows its content: the far pin sits inside the circle.
    expectEnclosed(res, "folder:P", [
      { id: "P/a.md", r: 8 },
      { id: "P/b.md", r: 8 },
      { id: "P/c.md", r: 8 },
    ]);
    // Unpinned siblings stay clear of the pinned leaf.
    const a = res.positions.get("P/a.md")!;
    for (const other of ["P/b.md", "P/c.md"]) {
      const p = res.positions.get(other)!;
      expect(Math.hypot(a.x - p.x, a.y - p.y)).toBeGreaterThan(15);
    }
  });

  it("centers a single child and pads the container radius", () => {
    const res = packHierarchy([container("folder:One", [leaf("One/x.md", 12)])], [], { seed: "one", padding: 14 });
    const c = res.positions.get("folder:One")!;
    const x = res.positions.get("One/x.md")!;
    expect(Math.hypot(c.x - x.x, c.y - x.y)).toBeLessThan(0.001);
    expect(res.radii.get("folder:One")).toBeCloseTo(12 + 14, 5);
    expect(packHierarchy([], [], { seed: "empty" }).positions.size).toBe(0);
  });
});
