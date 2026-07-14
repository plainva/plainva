import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { hierarchy, pack, packEnclose } from "d3-hierarchy";

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
  opts: { seed: string; iterations?: number; spread?: number; stableStarts?: boolean }
): LayoutResult {
  const random = createSeededRandom(hashSeed(opts.seed));
  const spread = opts.spread ?? 60;
  const simNodes = nodes.map((n, i) => {
    // Deterministic start positions. Default: phyllotaxis ring by INDEX (the
    // historical behavior — context/base scenes keep their exact layouts).
    // stableStarts hashes the start from the node ID instead, so adding or
    // removing one node no longer shifts every other start position — a small
    // index update moves the map a little, not "wildly everywhere" (vault map).
    let angle: number;
    let radius: number;
    if (opts.stableStarts) {
      const h = hashSeed(`${opts.seed}:${n.id}`);
      angle = ((h % 4096) / 4096) * Math.PI * 2;
      radius = spread * (0.5 + (((h >>> 12) % 4096) / 4096) * 3.5);
    } else {
      angle = i * 2.399963229728653; // golden angle
      radius = spread * Math.sqrt(i + 1);
    }
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

// ---- recursive hybrid packing (vault map A4) ---------------------------------

export interface HybridPackLeaf {
  id: string;
  /** Collision/render radius. */
  size: number;
  /** Absolute pinned position — kept exactly; enclosing containers recompute
   *  around it (the container follows its content, never the other way). */
  pin?: { x: number; y: number };
}

export interface HybridPackContainer {
  id: string;
  children: HybridPackChild[];
}

export type HybridPackChild = HybridPackLeaf | HybridPackContainer;

export interface HybridPackResult {
  /** Absolute center per leaf AND per container. */
  positions: Map<string, { x: number; y: number }>;
  /** Enclosing radius per container id (content + padding). */
  radii: Map<string, number>;
}

function isPackContainer(child: HybridPackChild): child is HybridPackContainer {
  return (child as HybridPackContainer).children !== undefined;
}

/** Smallest enclosing circle over child circles; d3's packEnclose is
 *  deterministic since v2 (seeded LCG instead of a random shuffle). */
function encloseCircles(circles: { x: number; y: number; r: number }[]): { x: number; y: number; r: number } {
  if (circles.length === 0) return { x: 0, y: 0, r: 0 };
  return packEnclose(circles.map((c) => ({ ...c })));
}

/**
 * Recursive hybrid layout for the vault map (plan A4): every unfolded folder is
 * a container circle that ENCLOSES its content. Per container the direct
 * children (leaf notes, collapsed-folder bubbles, sub-containers) are laid out
 * with the seeded force run — links keep the knowledge-net character — and the
 * container radius is the smallest enclosing circle plus padding, computed
 * bottom-up. Edges are given at LEAF level; each one acts exactly once, at the
 * lowest common container of its endpoints, mapped onto that level's children.
 *
 * Pins are absolute and win unconditionally; afterwards a bottom-up reflow
 * re-separates each container's children (pinned leaves and containers holding
 * pinned leaves stay fixed, moved sub-containers shift their subtree rigidly)
 * and recomputes every enclosing circle, so a container always wraps its
 * (possibly far-dragged) children. Deterministic: seeded per container id,
 * child order is normalized by id.
 */
export function packHierarchy(
  topChildren: HybridPackChild[],
  edges: ForceLayoutEdge[],
  opts: { seed: string; padding?: number }
): HybridPackResult {
  const padding = opts.padding ?? 14;
  const positions = new Map<string, { x: number; y: number }>();
  const radii = new Map<string, number>();

  // ---- structure maps --------------------------------------------------------
  // NUL-prefixed sentinel (built at runtime so no raw control byte lands in the source).
  const TOP = String.fromCharCode(0) + "top";
  const leafById = new Map<string, HybridPackLeaf>();
  const containerById = new Map<string, HybridPackContainer>();
  /** Container chain from the top down to (excluding) the node itself. */
  const chainOf = new Map<string, string[]>();
  const walk = (children: HybridPackChild[], chain: string[]): void => {
    for (const child of children) {
      chainOf.set(child.id, chain);
      if (isPackContainer(child)) {
        containerById.set(child.id, child);
        walk(child.children, [...chain, child.id]);
      } else {
        leafById.set(child.id, child);
      }
    }
  };
  walk(topChildren, []);

  // ---- level edges: each leaf edge acts once, at the LCA container -----------
  const levelEdges = new Map<string, ForceLayoutEdge[]>();
  for (const e of edges) {
    if (!leafById.has(e.source) || !leafById.has(e.target) || e.source === e.target) continue;
    const cs = chainOf.get(e.source)!;
    const ct = chainOf.get(e.target)!;
    let depth = 0;
    while (depth < cs.length && depth < ct.length && cs[depth] === ct[depth]) depth++;
    const lca = depth === 0 ? TOP : cs[depth - 1];
    const a = depth < cs.length ? cs[depth] : e.source;
    const b = depth < ct.length ? ct[depth] : e.target;
    if (a === b) continue;
    const list = levelEdges.get(lca) ?? [];
    list.push({ source: a, target: b });
    levelEdges.set(lca, list);
  }

  // ---- phase 1: bottom-up relative layout + enclosing radius -----------------
  /** Child positions relative to the container center. */
  const relPos = new Map<string, Map<string, { x: number; y: number }>>();

  const layoutLevel = (
    levelId: string,
    children: HybridPackChild[],
    sizeOfChild: (c: HybridPackChild) => number
  ): Map<string, { x: number; y: number }> => {
    // Normalize child order so the layout is input-order invariant.
    const kids = [...children].sort((a, b) => a.id.localeCompare(b.id)).map((c) => ({ id: c.id, size: sizeOfChild(c) }));
    if (kids.length === 0) return new Map();
    if (kids.length === 1) return new Map([[kids[0].id, { x: 0, y: 0 }]]);
    const avg = kids.reduce((s, k) => s + k.size, 0) / kids.length;
    const spread = Math.min(70, Math.max(24, avg * 1.5));
    const forced = computeForceLayout(kids, levelEdges.get(levelId) ?? [], {
      seed: `${opts.seed}:${levelId}`,
      spread,
      // Hash-per-id starts: an index update (one note more or less) must not
      // reshuffle the whole level — the map stays calm across rebuilds.
      stableStarts: true,
    }).positions;
    // Tighten residual overlaps with the real radii (the force run separates
    // via collide, this pass guarantees it with the exact sizes).
    return resolveCollisions(
      kids.map((k) => {
        const p = forced.get(k.id)!;
        return { id: k.id, x: p.x, y: p.y, size: k.size };
      }),
      { seed: `${opts.seed}:c:${levelId}`, padding: Math.min(padding, 8) }
    );
  };

  const layoutContainer = (container: HybridPackContainer): number => {
    const childRadius = (c: HybridPackChild): number => (isPackContainer(c) ? layoutContainer(c) : c.size);
    // Resolve sub-containers FIRST (post-order) so their radii feed this level.
    const sizes = new Map(container.children.map((c) => [c.id, childRadius(c)] as const));
    const local = layoutLevel(container.id, container.children, (c) => sizes.get(c.id)!);
    const circles = container.children.map((c) => {
      const p = local.get(c.id)!;
      return { x: p.x, y: p.y, r: sizes.get(c.id)! };
    });
    const enc = encloseCircles(circles);
    const rel = new Map<string, { x: number; y: number }>();
    for (const c of container.children) {
      const p = local.get(c.id)!;
      rel.set(c.id, { x: p.x - enc.x, y: p.y - enc.y });
    }
    relPos.set(container.id, rel);
    const r = enc.r + padding;
    radii.set(container.id, r);
    return r;
  };

  const topSizes = new Map(
    topChildren.map((c) => [c.id, isPackContainer(c) ? layoutContainer(c) : c.size] as const)
  );
  const topLocal = layoutLevel(TOP, topChildren, (c) => topSizes.get(c.id)!);

  // ---- phase 2: resolve to absolute positions (top-down) ---------------------
  const place = (child: HybridPackChild, x: number, y: number): void => {
    positions.set(child.id, { x, y });
    if (isPackContainer(child)) {
      const rel = relPos.get(child.id)!;
      for (const sub of child.children) {
        const p = rel.get(sub.id)!;
        place(sub, x + p.x, y + p.y);
      }
    }
  };
  for (const child of topChildren) {
    const p = topLocal.get(child.id)!;
    place(child, p.x, p.y);
  }

  // ---- phase 3: pins override, then reflow so containers wrap their content --
  let anyPin = false;
  for (const leaf of leafById.values()) {
    if (leaf.pin) {
      positions.set(leaf.id, { x: leaf.pin.x, y: leaf.pin.y });
      anyPin = true;
    }
  }
  if (!anyPin) return { positions, radii };

  const containsPinned = (container: HybridPackContainer): boolean =>
    container.children.some((c) => (isPackContainer(c) ? containsPinned(c) : !!c.pin));

  const shiftSubtree = (container: HybridPackContainer, dx: number, dy: number): void => {
    for (const c of container.children) {
      // Pinned leaves NEVER move — that is the fixed-guard's contract; a fixed
      // container is not shifted at all, so this only runs on pin-free content.
      const p = positions.get(c.id)!;
      positions.set(c.id, { x: p.x + dx, y: p.y + dy });
      if (isPackContainer(c)) shiftSubtree(c, dx, dy);
    }
  };

  const reflowLevel = (levelId: string, children: HybridPackChild[]): void => {
    // Post-order: sub-containers reflow first, their new circles feed this level.
    for (const c of children) if (isPackContainer(c)) reflowLevel(c.id, c.children);
    const items: CollisionItem[] = children.map((c) => {
      const p = positions.get(c.id)!;
      const containerChild = isPackContainer(c);
      return {
        id: c.id,
        x: p.x,
        y: p.y,
        size: containerChild ? radii.get(c.id)! : (c as HybridPackLeaf).size,
        fixed: containerChild ? containsPinned(c) : !!(c as HybridPackLeaf).pin,
      };
    });
    const relaxed = resolveCollisions(items, { seed: `${opts.seed}:r:${levelId}`, padding: Math.min(padding, 8) });
    for (const c of children) {
      const before = positions.get(c.id)!;
      const after = relaxed.get(c.id)!;
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      if (dx === 0 && dy === 0) continue;
      positions.set(c.id, { x: after.x, y: after.y });
      if (isPackContainer(c)) shiftSubtree(c, dx, dy);
    }
    if (levelId !== TOP) {
      // Recompute this container's enclosing circle around the final children.
      const enc = encloseCircles(
        children.map((c) => {
          const p = positions.get(c.id)!;
          return { x: p.x, y: p.y, r: isPackContainer(c) ? radii.get(c.id)! : (c as HybridPackLeaf).size };
        })
      );
      positions.set(levelId, { x: enc.x, y: enc.y });
      radii.set(levelId, enc.r + padding);
    }
  };
  reflowLevel(TOP, topChildren);

  return { positions, radii };
}
