import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { hierarchy, pack } from "d3-hierarchy";

/**
 * Deterministic layouts for the graph views (decision E6): d3-force runs
 * HEADLESS with a seeded random source and a fixed synchronous tick budget,
 * then freezes — the same vault renders the same map on every device, and
 * nothing ever wiggles at rest. Pins (stored positions) simply override the
 * computed coordinates afterwards.
 */

/** mulberry32 — tiny seedable PRNG, plenty for layout jitter. */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string — stable seed per vault/context. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface ForceLayoutNode {
  id: string;
  /** Collision radius. */
  size: number;
  /** Optional pinned position — kept fixed during the simulation. */
  fx?: number;
  fy?: number;
}

export interface ForceLayoutEdge {
  source: string;
  target: string;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
}

/**
 * Frozen force layout: seeded, synchronously ticked, then discarded. The
 * result is a pure position map — no live simulation object escapes.
 */
export function computeForceLayout(
  nodes: ForceLayoutNode[],
  edges: ForceLayoutEdge[],
  opts: { seed: string; iterations?: number; spread?: number }
): LayoutResult {
  const random = createSeededRandom(hashSeed(opts.seed));
  const spread = opts.spread ?? 60;
  const simNodes = nodes.map((n, i) => {
    // Deterministic phyllotaxis-ish start ring so the initial state is stable.
    const angle = i * 2.399963229728653; // golden angle
    const radius = spread * Math.sqrt(i + 1);
    return {
      id: n.id,
      index: i,
      x: n.fx ?? Math.cos(angle) * radius,
      y: n.fy ?? Math.sin(angle) * radius,
      fx: n.fx,
      fy: n.fy,
      size: n.size,
    };
  });
  const idSet = new Set(nodes.map((n) => n.id));
  const simEdges = edges
    .filter((e) => idSet.has(e.source) && idSet.has(e.target) && e.source !== e.target)
    .map((e) => ({ source: e.source, target: e.target }));

  const sim = forceSimulation(simNodes as any)
    .randomSource(random)
    .force(
      "link",
      forceLink(simEdges as any)
        .id((d: any) => d.id)
        .distance(spread * 1.6)
        .strength(0.4)
    )
    .force("charge", forceManyBody().strength(-spread * 2.5))
    .force("x", forceX(0).strength(0.05))
    .force("y", forceY(0).strength(0.05))
    .force(
      "collide",
      forceCollide()
        .radius((d: any) => d.size + 6)
        .iterations(2)
    )
    .stop();

  const iterations = opts.iterations ?? 200;
  for (let i = 0; i < iterations; i++) sim.tick();

  const positions = new Map<string, { x: number; y: number }>();
  for (const n of simNodes) positions.set(n.id, { x: (n as any).x, y: (n as any).y });
  return { positions };
}

export interface CollisionItem {
  id: string;
  x: number;
  y: number;
  /** Render radius (world units). */
  size: number;
  /** Kept exactly in place (focus note, pinned nodes). */
  fixed?: boolean;
}

/**
 * Collision-only relaxation: pushes overlapping nodes apart WITHOUT link/charge/
 * center forces, so a hand-designed zone layout (context graph: parents above,
 * children below, associations at the sides) keeps its shape — only overlaps are
 * resolved. Seeded like computeForceLayout (deterministic, then discarded); fixed
 * items are pinned via fx/fy and never move. Cheap enough for the ~30-node
 * context graph and per-group vault-map passes.
 */
export function resolveCollisions(
  items: CollisionItem[],
  opts: { seed: string; padding?: number; iterations?: number }
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (items.length === 0) return out;
  const random = createSeededRandom(hashSeed(opts.seed));
  const padding = opts.padding ?? 6;
  const simNodes = items.map((it) => ({
    id: it.id,
    x: it.x,
    y: it.y,
    fx: it.fixed ? it.x : undefined,
    fy: it.fixed ? it.y : undefined,
    size: it.size,
  }));
  const sim = forceSimulation(simNodes as any)
    .randomSource(random)
    .force(
      "collide",
      forceCollide()
        .radius((d: any) => d.size + padding)
        .strength(1)
        .iterations(3)
    )
    .stop();
  const iterations = opts.iterations ?? 40;
  for (let i = 0; i < iterations; i++) sim.tick();
  for (const n of simNodes as any[]) out.set(n.id, { x: n.x, y: n.y });
  return out;
}

export interface PackItem {
  id: string;
  /** Weight (note count); packs to area. */
  count: number;
}

export interface PackedCircle {
  id: string;
  x: number;
  y: number;
  r: number;
}

/**
 * Circle-packs sibling bubbles (folder overview / unfolded folder content).
 * Deterministic by construction — d3 pack has no randomness.
 */
export function packCircles(items: PackItem[], opts: { radius: number }): PackedCircle[] {
  if (items.length === 0) return [];
  const root = hierarchy<{ children?: PackItem[]; count?: number; id?: string }>({ children: items })
    .sum((d) => Math.max(1, d.count ?? 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || String(a.data.id).localeCompare(String(b.data.id)));
  const layout = pack<{ children?: PackItem[]; count?: number; id?: string }>()
    .size([opts.radius * 2, opts.radius * 2])
    .padding(opts.radius * 0.06);
  layout(root as any);
  const out: PackedCircle[] = [];
  for (const child of root.children ?? []) {
    out.push({
      id: String(child.data.id),
      x: (child as any).x - opts.radius,
      y: (child as any).y - opts.radius,
      r: (child as any).r,
    });
  }
  return out;
}

/**
 * Evenly places `count` items on an arc — the context graph's zone layout
 * (parents above, children below, associations at the sides) builds on this.
 */
export function arcPositions(
  count: number,
  opts: { centerX: number; centerY: number; radius: number; startAngle: number; endAngle: number }
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (count <= 0) return out;
  const span = opts.endAngle - opts.startAngle;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = opts.startAngle + span * t;
    out.push({
      x: opts.centerX + Math.cos(angle) * opts.radius,
      y: opts.centerY + Math.sin(angle) * opts.radius,
    });
  }
  return out;
}

/**
 * Node radius as a log2-compressed function of a magnitude (connection degree,
 * folder note count). Grows visibly across many orders of magnitude but flattens
 * softly toward `max` instead of hard-saturating early (the old sqrt+cap
 * saturated already at ~64 notes). `value` is a non-negative count; the +1 keeps
 * a zero-magnitude node at exactly `min`.
 */
export function logRadius(value: number, opts: { min: number; max: number; k: number }): number {
  const v = value > 0 ? value : 0;
  return Math.max(opts.min, Math.min(opts.max, opts.min + opts.k * Math.log2(v + 1)));
}
