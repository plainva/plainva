import { quadtree, type Quadtree } from "d3-quadtree";
import { getGraphThemeTokens, subscribeGraphThemeTokens, type GraphThemeTokens } from "../../services/themeTokens";
import type { NodePointerEvent, SceneEdge, SceneNode, SceneTransform } from "./graphTypes";

/**
 * Canvas-2D graph scene — one instance per view, living OUTSIDE React (the
 * editorSession pattern: the host component passes changing callbacks through
 * a per-render updated deps ref, the engine itself is created exactly once).
 *
 * Painting rules: every color comes from the theme tokens; emphasis and
 * de-emphasis use ctx.globalAlpha only (designLint forbids color literals in
 * components/). Nothing animates at rest — transitions lerp once per data or
 * focus change and honor prefers-reduced-motion.
 */

export interface GraphEngineDeps {
  onNodeClick?(id: string, ev: NodePointerEvent): void;
  onNodeDoubleClick?(id: string): void;
  onNodeContext?(id: string, clientX: number, clientY: number): void;
  onEdgeContext?(id: string, clientX: number, clientY: number): void;
  onEdgeClick?(id: string, clientX: number, clientY: number): void;
  onNodeHover?(id: string | null): void;
  onEdgeHover?(id: string | null, clientX?: number, clientY?: number): void;
  onCanvasContext?(clientX: number, clientY: number, worldX: number, worldY: number): void;
  onBackgroundClick?(): void;
  /** Node drag finished on empty space -> new (pinned) position. */
  onNodeDragEnd?(id: string, x: number, y: number): void;
  /** Node drag finished ON another node -> connect gesture (P6). */
  onNodeDropOnNode?(sourceId: string, targetId: string): void;
  onLassoSelect?(ids: string[], additive: boolean): void;
  /** Keyboard: Enter on the focused node. */
  onNodeActivate?(id: string): void;
  onFocusChange?(id: string | null): void;
  onZoomChange?(k: number): void;
  reducedMotion?(): boolean;
}

interface RenderNode extends SceneNode {
  /** Animated current position (lerps toward x/y). */
  cx: number;
  cy: number;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
/** Labels appear when a node's apparent radius crosses this many px. */
const LABEL_APPARENT_RADIUS = 9;
/** Icons appear a bit earlier than labels. */
const ICON_APPARENT_RADIUS = 6;
const EDGE_HIT_TOLERANCE = 6;

export interface GraphScene {
  setData(nodes: SceneNode[], edges: SceneEdge[], opts?: { animate?: boolean }): void;
  patchNode(id: string, patch: Partial<SceneNode>): void;
  getTransform(): SceneTransform;
  setTransform(t: SceneTransform): void;
  zoomToFit(paddingPx?: number): void;
  setSelection(ids: Iterable<string>): void;
  getSelection(): string[];
  setKeyboardFocus(id: string | null): void;
  getKeyboardFocus(): string | null;
  /** Arrow-key navigation to the angularly best neighbor. */
  moveFocus(direction: "up" | "down" | "left" | "right"): void;
  getNodePositions(): Map<string, { x: number; y: number }>;
  nodeAtClient(clientX: number, clientY: number): string | null;
  clientToWorld(clientX: number, clientY: number): { x: number; y: number };
  requestRender(): void;
  resize(): void;
  toSVG(): string;
  destroy(): void;
}

export function createGraphScene(
  canvas: HTMLCanvasElement,
  depsRef: { current: GraphEngineDeps }
): GraphScene {
  const ctx = canvas.getContext("2d");
  let nodes: RenderNode[] = [];
  let edges: SceneEdge[] = [];
  let nodeById = new Map<string, RenderNode>();
  let adjacency = new Map<string, Set<string>>();
  let tree: Quadtree<RenderNode> | null = null;
  let transform: SceneTransform = { x: 0, y: 0, k: 1 };
  const selection = new Set<string>();
  let keyboardFocus: string | null = null;
  let hoverNode: string | null = null;
  let hoverEdge: string | null = null;
  let destroyed = false;
  let frame = 0;
  let animFrame = 0;
  // zoomToFit called while the canvas has no layout size yet (collapsed
  // sidebar section, first mount before paint) is deferred and re-run by
  // resize() once a real size arrives — otherwise the transform clamps to
  // MIN_ZOOM and the scene "renders" invisibly off-screen (report #1).
  let pendingFitPadding: number | null = null;
  let tokens: GraphThemeTokens = getGraphThemeTokens();
  const unsubscribeTheme = subscribeGraphThemeTokens(() => {
    tokens = getGraphThemeTokens();
    requestRender();
  });

  // ---- geometry ------------------------------------------------------------

  function cssSize(): { w: number; h: number } {
    // Raw CSS pixels. A hidden canvas (display:none) honestly reports 0 so
    // zoomToFit defers instead of fitting to the <canvas> default of 300×150
    // (the old `|| canvas.width` fallback mixed device pixels in and made a
    // hidden canvas look sized — the context-graph-blank-until-toggle bug).
    const rect = canvas.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  /** Syncs the canvas backing store to the current CSS size. Returns true when
   *  it actually changed — used by zoomToFit so a canvas that JUST became
   *  visible (display:none → block) draws at full size without waiting for a
   *  ResizeObserver tick (which, in the sidebar, may not fire before paint). */
  function syncBackingStore(): boolean {
    const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const { w, h } = cssSize();
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      return true;
    }
    return false;
  }

  function resize(): void {
    syncBackingStore();
    const { w, h } = cssSize();
    if (pendingFitPadding !== null && w > 4 && h > 4) {
      const padding = pendingFitPadding;
      pendingFitPadding = null;
      scene.zoomToFit(padding);
      return;
    }
    requestRender();
  }

  function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return { x: (px - transform.x) / transform.k, y: (py - transform.y) / transform.k };
  }

  function rebuildIndex(): void {
    tree = quadtree<RenderNode>()
      .x((d) => d.cx)
      .y((d) => d.cy)
      .addAll(nodes.filter((n) => !n.hidden));
    adjacency = new Map();
    for (const e of edges) {
      if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
      if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
      adjacency.get(e.source)!.add(e.target);
      adjacency.get(e.target)!.add(e.source);
    }
  }

  function nodeAt(worldX: number, worldY: number): RenderNode | null {
    if (!tree) return null;
    const candidate = tree.find(worldX, worldY, 64);
    if (!candidate || candidate.hidden) return null;
    const dx = candidate.cx - worldX;
    const dy = candidate.cy - worldY;
    const hitRadius = candidate.size + 4 / transform.k;
    return dx * dx + dy * dy <= hitRadius * hitRadius ? candidate : null;
  }

  function edgeAt(worldX: number, worldY: number): SceneEdge | null {
    const tol = EDGE_HIT_TOLERANCE / transform.k;
    let best: SceneEdge | null = null;
    let bestDist = tol;
    for (const e of edges) {
      if (e.hidden) continue;
      const a = nodeById.get(e.source);
      const b = nodeById.get(e.target);
      if (!a || !b || a.hidden || b.hidden) continue;
      const dist = pointSegmentDistance(worldX, worldY, a.cx, a.cy, b.cx, b.cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = e;
      }
    }
    return best;
  }

  // ---- animation -----------------------------------------------------------

  function animatePositions(): void {
    cancelAnimationFrame(animFrame);
    const reduced = depsRef.current.reducedMotion?.() === true;
    if (reduced) {
      for (const n of nodes) {
        n.cx = n.x;
        n.cy = n.y;
      }
      rebuildIndex();
      requestRender();
      return;
    }
    const duration = tokens.durationMs;
    const starts = nodes.map((n) => ({ n, sx: n.cx, sy: n.cy }));
    const t0 = performance.now();
    const step = (now: number) => {
      if (destroyed) return;
      const t = Math.min(1, (now - t0) / duration);
      const ease = 1 - (1 - t) * (1 - t);
      for (const { n, sx, sy } of starts) {
        n.cx = sx + (n.x - sx) * ease;
        n.cy = sy + (n.y - sy) * ease;
      }
      rebuildIndex();
      draw();
      if (t < 1) animFrame = requestAnimationFrame(step);
    };
    animFrame = requestAnimationFrame(step);
  }

  // ---- painting ------------------------------------------------------------

  function requestRender(): void {
    if (destroyed) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  }

  /** Saturated node color: chip FG tone, icon tint, else the theme accent —
   *  the graph visibly wears the active theme (maintainer report #11). */
  function nodeColor(n: SceneNode): string {
    if (n.color) return n.color;
    if (n.colorToken != null && tokens.chips[n.colorToken % tokens.chips.length]) {
      return tokens.chips[n.colorToken % tokens.chips.length].fg;
    }
    return tokens.accent;
  }

  function edgeStroke(e: SceneEdge): string {
    if (e.style === "property") return tokens.accent;
    if (e.style === "suggestion" || e.style === "embed" || e.style === "structure") return tokens.textFaint;
    return tokens.textMuted;
  }

  /** Dash pattern per edge style (report #8): relations are SOLID accent,
   *  plain links DASHED neutral — tell them apart at a glance. */
  function edgeDash(e: SceneEdge): number[] {
    if (e.style === "link") return [5 / transform.k, 4 / transform.k];
    if (e.style === "embed") return [1.5 / transform.k, 3 / transform.k];
    if (e.style === "suggestion") return [8 / transform.k, 6 / transform.k];
    return [];
  }

  /** Subtle dot grid gives the canvas depth and inherits the theme. */
  function drawDotGrid(w: number, h: number): void {
    if (!ctx || transform.k < 0.25) return;
    const spacing = 28;
    const left = -transform.x / transform.k;
    const top = -transform.y / transform.k;
    const startX = Math.floor(left / spacing) * spacing;
    const startY = Math.floor(top / spacing) * spacing;
    const cols = Math.ceil(w / transform.k / spacing) + 1;
    const rows = Math.ceil(h / transform.k / spacing) + 1;
    if (cols * rows > 20000) return;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = tokens.textFaint;
    const r = 1 / transform.k;
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        ctx.beginPath();
        ctx.arc(startX + i * spacing, startY + j * spacing, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function draw(): void {
    if (!ctx || destroyed) return;
    const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const { w, h } = cssSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr * transform.k, 0, 0, dpr * transform.k, dpr * transform.x, dpr * transform.y);

    const viewLeft = -transform.x / transform.k;
    const viewTop = -transform.y / transform.k;
    const viewRight = viewLeft + w / transform.k;
    const viewBottom = viewTop + h / transform.k;
    const margin = 80 / transform.k;
    const inView = (x: number, y: number, r: number) =>
      x + r > viewLeft - margin && x - r < viewRight + margin && y + r > viewTop - margin && y - r < viewBottom + margin;

    drawDotGrid(w, h);

    // ---- edges (below nodes) ----
    for (const e of edges) {
      if (e.hidden) continue;
      const a = nodeById.get(e.source);
      const b = nodeById.get(e.target);
      if (!a || !b || a.hidden || b.hidden) continue;
      if (!inView(Math.min(a.cx, b.cx), Math.min(a.cy, b.cy), Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy))) continue;
      const emphasized = hoverEdge === e.id;
      ctx.globalAlpha = e.dimmed
        ? 0.06
        : e.style === "structure"
          ? 0.25
          : e.style === "property"
            ? 0.8
            : e.style === "suggestion"
              ? 0.55
              : 0.45;
      if (emphasized) ctx.globalAlpha = 1;
      ctx.strokeStyle = emphasized ? tokens.accent : edgeStroke(e);
      const base = e.style === "structure" ? 0.7 : e.style === "property" ? 1.4 : 1.1;
      ctx.lineWidth = (base + Math.min(4, e.width - 1) * 0.5 + (emphasized ? 0.7 : 0)) / transform.k;
      ctx.setLineDash(edgeDash(e));
      ctx.beginPath();
      ctx.moveTo(a.cx, a.cy);
      ctx.lineTo(b.cx, b.cy);
      ctx.stroke();
      ctx.setLineDash([]);

      if (e.label && (emphasized || transform.k > 0.9)) {
        const mx = (a.cx + b.cx) / 2;
        const my = (a.cy + b.cy) / 2;
        const fontPx = 10 / transform.k;
        ctx.font = `${fontPx}px ${tokens.fontUi}`;
        const tw = ctx.measureText(e.label).width;
        ctx.globalAlpha = e.dimmed ? 0.2 : 0.92;
        // Chip behind the label so it stays readable over grid/edges.
        ctx.fillStyle = tokens.bgPrimary;
        ctx.beginPath();
        const padX = 4 / transform.k;
        const chipH = fontPx * 1.5;
        ctx.roundRect(mx - tw / 2 - padX, my - chipH / 2, tw + padX * 2, chipH, chipH / 2);
        ctx.fill();
        ctx.fillStyle = e.style === "property" ? tokens.accent : tokens.textMuted;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(e.label, mx, my);
      }
    }

    // ---- node shapes (pass 1) ----
    const visibleSorted: RenderNode[] = [];
    for (const n of nodes) {
      if (n.hidden || !inView(n.cx, n.cy, n.size)) continue;
      visibleSorted.push(n);
    }
    for (const n of visibleSorted) {
      const selected = selection.has(n.id);
      const focused = keyboardFocus === n.id;
      const hovered = hoverNode === n.id;
      const color = nodeColor(n);
      ctx.globalAlpha = n.dimmed ? 0.15 : 1;

      // Heat halo behind the node (heatmap overlay).
      if (n.heat != null && n.heat > 0 && !n.dimmed) {
        ctx.globalAlpha = 0.12 + n.heat * 0.28;
        ctx.fillStyle = tokens.accent;
        ctx.beginPath();
        ctx.arc(n.cx, n.cy, n.size * (1.4 + n.heat * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = n.dimmed ? 0.15 : 1;
      }

      if (n.shape === "folder") {
        // Folder bubble: soft accent-tinted disc, name centered inside.
        ctx.globalAlpha = (n.dimmed ? 0.15 : 1) * 0.09;
        ctx.fillStyle = tokens.accent;
        ctx.beginPath();
        ctx.arc(n.cx, n.cy, n.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = n.dimmed ? 0.2 : 0.5;
        ctx.strokeStyle = selected || focused || hovered ? tokens.accent : tokens.accent;
        if (selected || focused || hovered) ctx.globalAlpha = 0.95;
        ctx.lineWidth = (selected || focused ? 2.2 : hovered ? 1.8 : 1.3) / transform.k;
        ctx.stroke();
        continue;
      }

      // Note node: saturated disc; with an emoji icon it becomes a light
      // carrier disc with a colored ring so the emoji stays legible.
      const hasIcon = !!n.icon && n.size * transform.k >= ICON_APPARENT_RADIUS;
      if (hasIcon) {
        ctx.fillStyle = tokens.bgSecondary;
        ctx.beginPath();
        ctx.arc(n.cx, n.cy, n.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = selected || focused || hovered ? tokens.accent : color;
        ctx.lineWidth = (selected || focused ? 2.4 : hovered ? 2 : 1.5) / transform.k;
        ctx.stroke();
        ctx.font = `${n.size * 1.1}px ${tokens.fontUi}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(n.icon!, n.cx, n.cy + n.size * 0.05);
      } else {
        ctx.globalAlpha = (n.dimmed ? 0.15 : 1) * 0.9;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.cx, n.cy, n.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = n.dimmed ? 0.15 : 1;
        if (selected || focused || hovered) {
          ctx.strokeStyle = tokens.accent;
          ctx.lineWidth = (selected || focused ? 2.6 : 2) / transform.k;
          ctx.beginPath();
          ctx.arc(n.cx, n.cy, n.size + 2 / transform.k, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (n.flag) {
        ctx.strokeStyle = n.flag === "broken" ? tokens.statusError : tokens.statusWarning;
        ctx.lineWidth = 2 / transform.k;
        ctx.beginPath();
        ctx.arc(n.cx, n.cy, n.size + 4 / transform.k, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (n.pinned) {
        ctx.fillStyle = tokens.bgPrimary;
        ctx.beginPath();
        ctx.arc(n.cx + n.size * 0.8, n.cy - n.size * 0.8, Math.max(2.4, n.size * 0.22), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = tokens.accent;
        ctx.beginPath();
        ctx.arc(n.cx + n.size * 0.8, n.cy - n.size * 0.8, Math.max(1.5, n.size * 0.14), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---- labels (pass 2, decluttered) ----
    // Priority: interaction states first, then bigger nodes; a label is skipped
    // when its box would overlap an already placed one (report #2: no more
    // label soup — hover always reveals).
    const labelOrder = [...visibleSorted].sort((a, b) => {
      const sa = selection.has(a.id) || keyboardFocus === a.id || hoverNode === a.id ? 1 : 0;
      const sb = selection.has(b.id) || keyboardFocus === b.id || hoverNode === b.id ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return b.size - a.size;
    });
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    let labelBudget = 90;
    for (const n of labelOrder) {
      const selected = selection.has(n.id);
      const focused = keyboardFocus === n.id;
      const hovered = hoverNode === n.id;
      const stateShown = selected || focused || hovered;
      const apparent = n.size * transform.k;
      const isFolder = n.shape === "folder";
      if (!stateShown && !isFolder && apparent < LABEL_APPARENT_RADIUS) continue;
      if (labelBudget <= 0 && !stateShown) continue;

      const fontPx = isFolder
        ? Math.min(15 / transform.k, Math.max(10 / transform.k, n.size * 0.32))
        : Math.min(13 / transform.k, Math.max(9 / transform.k, n.size * 0.55));
      ctx.font = `${isFolder ? "600 " : ""}${fontPx}px ${tokens.fontUi}`;
      const text = n.label;
      const tw = ctx.measureText(text).width;
      const lx = n.cx - tw / 2;
      const ly = isFolder ? n.cy - fontPx * 0.8 : n.cy + n.size + 3 / transform.k;
      const box = { x: lx - 2, y: ly - 1, w: tw + 4, h: fontPx * (isFolder ? 2.4 : 1.3) + 2 };
      const overlaps = placed.some((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y);
      if (overlaps && !stateShown) continue;
      placed.push(box);
      labelBudget--;

      ctx.globalAlpha = n.dimmed ? 0.25 : 1;
      ctx.textAlign = "center";
      if (isFolder) {
        ctx.fillStyle = tokens.textMain;
        ctx.textBaseline = "middle";
        ctx.fillText(text, n.cx, n.cy - fontPx * 0.35);
        if (n.badge != null) {
          ctx.fillStyle = tokens.textMuted;
          ctx.font = `${fontPx * 0.85}px ${tokens.fontUi}`;
          ctx.fillText(String(n.badge), n.cx, n.cy + fontPx * 0.85);
        }
      } else {
        ctx.fillStyle = stateShown ? tokens.textMain : tokens.textMuted;
        ctx.textBaseline = "top";
        ctx.fillText(text, n.cx, ly);
      }
    }

    // Lasso rectangle.
    if (lasso) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = tokens.accent;
      ctx.fillRect(
        Math.min(lasso.x0, lasso.x1),
        Math.min(lasso.y0, lasso.y1),
        Math.abs(lasso.x1 - lasso.x0),
        Math.abs(lasso.y1 - lasso.y0)
      );
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = tokens.accent;
      ctx.lineWidth = 1 / transform.k;
      ctx.strokeRect(
        Math.min(lasso.x0, lasso.x1),
        Math.min(lasso.y0, lasso.y1),
        Math.abs(lasso.x1 - lasso.x0),
        Math.abs(lasso.y1 - lasso.y0)
      );
    }

    // Connect gesture line.
    if (drag && drag.mode === "node" && drag.moved && drag.overNode && drag.overNode !== drag.nodeId) {
      const a = nodeById.get(drag.nodeId!);
      const b = nodeById.get(drag.overNode);
      if (a && b) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = tokens.accent;
        ctx.lineWidth = 1.6 / transform.k;
        ctx.setLineDash([6 / transform.k, 4 / transform.k]);
        ctx.beginPath();
        ctx.moveTo(a.cx, a.cy);
        ctx.lineTo(b.cx, b.cy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.globalAlpha = 1;
  }

  // ---- interaction ---------------------------------------------------------

  interface DragState {
    pointerId: number;
    mode: "pan" | "node" | "lasso";
    startClientX: number;
    startClientY: number;
    startTransformX: number;
    startTransformY: number;
    nodeId?: string;
    nodeStartX?: number;
    nodeStartY?: number;
    moved: boolean;
    overNode?: string | null;
    additive?: boolean;
  }
  let drag: DragState | null = null;
  let lasso: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let lastClick = 0;
  let lastClickNode: string | null = null;

  function onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0 && ev.button !== 1) return;
    canvas.setPointerCapture?.(ev.pointerId);
    const world = clientToWorld(ev.clientX, ev.clientY);
    const hit = nodeAt(world.x, world.y);
    if (hit && ev.button === 0 && !ev.shiftKey) {
      drag = {
        pointerId: ev.pointerId,
        mode: "node",
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startTransformX: transform.x,
        startTransformY: transform.y,
        nodeId: hit.id,
        nodeStartX: hit.x,
        nodeStartY: hit.y,
        moved: false,
        overNode: null,
      };
    } else if (!hit && ev.shiftKey && ev.button === 0) {
      drag = {
        pointerId: ev.pointerId,
        mode: "lasso",
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startTransformX: transform.x,
        startTransformY: transform.y,
        moved: false,
        additive: ev.ctrlKey || ev.metaKey,
      };
      lasso = { x0: world.x, y0: world.y, x1: world.x, y1: world.y };
    } else {
      drag = {
        pointerId: ev.pointerId,
        mode: "pan",
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startTransformX: transform.x,
        startTransformY: transform.y,
        nodeId: hit?.id,
        moved: false,
      };
    }
  }

  function onPointerMove(ev: PointerEvent): void {
    const world = clientToWorld(ev.clientX, ev.clientY);
    if (!drag) {
      const hit = nodeAt(world.x, world.y);
      const hitId = hit?.id ?? null;
      if (hitId !== hoverNode) {
        hoverNode = hitId;
        depsRef.current.onNodeHover?.(hitId);
        requestRender();
      }
      if (!hit) {
        const e = edgeAt(world.x, world.y);
        const edgeId = e?.id ?? null;
        if (edgeId !== hoverEdge) {
          hoverEdge = edgeId;
          depsRef.current.onEdgeHover?.(edgeId, ev.clientX, ev.clientY);
          requestRender();
        }
      } else if (hoverEdge) {
        hoverEdge = null;
        depsRef.current.onEdgeHover?.(null);
        requestRender();
      }
      return;
    }
    const dx = ev.clientX - drag.startClientX;
    const dy = ev.clientY - drag.startClientY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;

    if (drag.mode === "pan") {
      transform = { ...transform, x: drag.startTransformX + dx, y: drag.startTransformY + dy };
      requestRender();
    } else if (drag.mode === "node" && drag.moved) {
      const n = nodeById.get(drag.nodeId!);
      if (n) {
        n.x = drag.nodeStartX! + dx / transform.k;
        n.y = drag.nodeStartY! + dy / transform.k;
        n.cx = n.x;
        n.cy = n.y;
        const over = nodeAt(world.x, world.y);
        drag.overNode = over && over.id !== n.id ? over.id : null;
        requestRender();
      }
    } else if (drag.mode === "lasso" && lasso) {
      lasso.x1 = world.x;
      lasso.y1 = world.y;
      requestRender();
    }
  }

  function onPointerUp(ev: PointerEvent): void {
    const d = drag;
    drag = null;
    if (!d) return;
    canvas.releasePointerCapture?.(ev.pointerId);

    if (d.mode === "lasso" && lasso) {
      const [minX, maxX] = [Math.min(lasso.x0, lasso.x1), Math.max(lasso.x0, lasso.x1)];
      const [minY, maxY] = [Math.min(lasso.y0, lasso.y1), Math.max(lasso.y0, lasso.y1)];
      const ids = nodes
        .filter((n) => !n.hidden && n.cx >= minX && n.cx <= maxX && n.cy >= minY && n.cy <= maxY)
        .map((n) => n.id);
      lasso = null;
      requestRender();
      depsRef.current.onLassoSelect?.(ids, d.additive === true);
      return;
    }

    if (d.mode === "node") {
      const n = nodeById.get(d.nodeId!);
      if (!n) return;
      if (!d.moved) {
        const now = performance.now();
        const isDouble = now - lastClick < 350 && lastClickNode === n.id;
        lastClick = now;
        lastClickNode = n.id;
        if (isDouble) {
          depsRef.current.onNodeDoubleClick?.(n.id);
        } else {
          depsRef.current.onNodeClick?.(n.id, {
            ctrl: ev.ctrlKey || ev.metaKey,
            shift: ev.shiftKey,
            middle: ev.button === 1,
            clientX: ev.clientX,
            clientY: ev.clientY,
          });
        }
        rebuildIndex();
        return;
      }
      if (d.overNode && d.overNode !== n.id) {
        // Connect gesture: restore the dragged node's original spot.
        n.x = d.nodeStartX!;
        n.y = d.nodeStartY!;
        n.cx = n.x;
        n.cy = n.y;
        rebuildIndex();
        requestRender();
        depsRef.current.onNodeDropOnNode?.(n.id, d.overNode);
      } else {
        rebuildIndex();
        depsRef.current.onNodeDragEnd?.(n.id, n.x, n.y);
      }
      return;
    }

    // Pan without movement = click.
    if (d.mode === "pan" && !d.moved) {
      if (d.nodeId && ev.button === 1) {
        depsRef.current.onNodeClick?.(d.nodeId, {
          ctrl: ev.ctrlKey || ev.metaKey,
          shift: ev.shiftKey,
          middle: true,
          clientX: ev.clientX,
          clientY: ev.clientY,
        });
      } else if (!d.nodeId) {
        const world = clientToWorld(ev.clientX, ev.clientY);
        const e = edgeAt(world.x, world.y);
        if (e) depsRef.current.onEdgeClick?.(e.id, ev.clientX, ev.clientY);
        else depsRef.current.onBackgroundClick?.();
      }
    }
  }

  function onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const factor = Math.exp(-ev.deltaY * 0.0015);
    const nextK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transform.k * factor));
    if (nextK === transform.k) return;
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const wx = (px - transform.x) / transform.k;
    const wy = (py - transform.y) / transform.k;
    transform = { k: nextK, x: px - wx * nextK, y: py - wy * nextK };
    depsRef.current.onZoomChange?.(nextK);
    requestRender();
  }

  function onContextMenu(ev: MouseEvent): void {
    ev.preventDefault();
    const world = clientToWorld(ev.clientX, ev.clientY);
    const hit = nodeAt(world.x, world.y);
    if (hit) {
      depsRef.current.onNodeContext?.(hit.id, ev.clientX, ev.clientY);
      return;
    }
    const e = edgeAt(world.x, world.y);
    if (e) {
      depsRef.current.onEdgeContext?.(e.id, ev.clientX, ev.clientY);
      return;
    }
    depsRef.current.onCanvasContext?.(ev.clientX, ev.clientY, world.x, world.y);
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key === "Enter" && keyboardFocus) {
      ev.preventDefault();
      depsRef.current.onNodeActivate?.(keyboardFocus);
      return;
    }
    if (ev.key === "ContextMenu" && keyboardFocus) {
      const n = nodeById.get(keyboardFocus);
      if (n) {
        ev.preventDefault();
        const rect = canvas.getBoundingClientRect();
        depsRef.current.onNodeContext?.(
          keyboardFocus,
          rect.left + n.cx * transform.k + transform.x,
          rect.top + n.cy * transform.k + transform.y
        );
      }
      return;
    }
    const dirs: Record<string, "up" | "down" | "left" | "right"> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };
    const dir = dirs[ev.key];
    if (dir) {
      ev.preventDefault();
      moveFocus(dir);
    }
  }

  function moveFocus(direction: "up" | "down" | "left" | "right"): void {
    const visible = nodes.filter((n) => !n.hidden);
    if (visible.length === 0) return;
    if (!keyboardFocus || !nodeById.get(keyboardFocus)) {
      setKeyboardFocus(visible[0].id);
      return;
    }
    const from = nodeById.get(keyboardFocus)!;
    const targetAngle =
      direction === "right" ? 0 : direction === "down" ? Math.PI / 2 : direction === "left" ? Math.PI : -Math.PI / 2;
    // Prefer graph neighbors; fall back to any visible node in that direction.
    const neighborIds = adjacency.get(from.id);
    const pools: RenderNode[][] = [];
    if (neighborIds && neighborIds.size > 0) {
      pools.push(visible.filter((n) => neighborIds.has(n.id)));
    }
    pools.push(visible.filter((n) => n.id !== from.id));
    for (const pool of pools) {
      let best: RenderNode | null = null;
      let bestScore = Infinity;
      for (const n of pool) {
        const dx = n.cx - from.cx;
        const dy = n.cy - from.cy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) continue;
        let angleDiff = Math.abs(Math.atan2(dy, dx) - targetAngle);
        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
        if (angleDiff > Math.PI / 2.5) continue; // must roughly point that way
        const score = dist * (1 + angleDiff * 2);
        if (score < bestScore) {
          bestScore = score;
          best = n;
        }
      }
      if (best) {
        setKeyboardFocus(best.id);
        return;
      }
    }
  }

  function setKeyboardFocus(id: string | null): void {
    keyboardFocus = id;
    depsRef.current.onFocusChange?.(id);
    requestRender();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("keydown", onKeyDown);

  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  resizeObserver?.observe(canvas);

  // ---- public API ----------------------------------------------------------

  const scene: GraphScene = {
    setData(nextNodes, nextEdges, opts) {
      const previous = nodeById;
      nodes = nextNodes.map((n) => {
        const prev = previous.get(n.id);
        return { ...n, cx: prev ? prev.cx : n.x, cy: prev ? prev.cy : n.y };
      });
      nodeById = new Map(nodes.map((n) => [n.id, n]));
      edges = nextEdges.slice();
      if (keyboardFocus && !nodeById.has(keyboardFocus)) keyboardFocus = null;
      for (const id of [...selection]) if (!nodeById.has(id)) selection.delete(id);
      rebuildIndex();
      if (opts?.animate) animatePositions();
      else {
        for (const n of nodes) {
          n.cx = n.x;
          n.cy = n.y;
        }
        rebuildIndex();
        requestRender();
      }
    },
    patchNode(id, patch) {
      const n = nodeById.get(id);
      if (!n) return;
      Object.assign(n, patch);
      if (patch.x != null) n.cx = patch.x;
      if (patch.y != null) n.cy = patch.y;
      rebuildIndex();
      requestRender();
    },
    getTransform: () => ({ ...transform }),
    setTransform(t) {
      transform = { ...t };
      requestRender();
    },
    zoomToFit(paddingPx = 40) {
      const visible = nodes.filter((n) => !n.hidden);
      if (visible.length === 0) return;
      const size = cssSize();
      if (size.w <= 4 || size.h <= 4) {
        pendingFitPadding = paddingPx;
        return;
      }
      // The canvas may have just become visible without a resize tick — sync
      // the backing store to the real size, otherwise the fit is computed for
      // the right dimensions but drawn onto a stale 1×1 buffer (report:
      // context graph stays blank until a manual collapse/expand).
      syncBackingStore();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of visible) {
        minX = Math.min(minX, n.x - n.size);
        minY = Math.min(minY, n.y - n.size);
        maxX = Math.max(maxX, n.x + n.size);
        maxY = Math.max(maxY, n.y + n.size);
      }
      const { w, h } = cssSize();
      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((w - paddingPx * 2) / spanX, (h - paddingPx * 2) / spanY)));
      transform = {
        k,
        x: (w - spanX * k) / 2 - minX * k,
        y: (h - spanY * k) / 2 - minY * k,
      };
      depsRef.current.onZoomChange?.(k);
      requestRender();
    },
    setSelection(ids) {
      selection.clear();
      for (const id of ids) selection.add(id);
      requestRender();
    },
    getSelection: () => [...selection],
    setKeyboardFocus,
    getKeyboardFocus: () => keyboardFocus,
    moveFocus,
    getNodePositions() {
      const out = new Map<string, { x: number; y: number }>();
      for (const n of nodes) out.set(n.id, { x: n.x, y: n.y });
      return out;
    },
    nodeAtClient(clientX, clientY) {
      const world = clientToWorld(clientX, clientY);
      return nodeAt(world.x, world.y)?.id ?? null;
    },
    clientToWorld,
    requestRender,
    resize,
    toSVG() {
      return sceneToSVG(nodes, edges, nodeById, tokens);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(animFrame);
      unsubscribeTheme();
      resizeObserver?.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("keydown", onKeyDown);
    },
  };

  resize();
  return scene;
}

function pointSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Serializes the CURRENT scene as standalone SVG (same tokens, no live DOM). */
function sceneToSVG(
  nodes: (SceneNode & { cx: number; cy: number })[],
  edges: SceneEdge[],
  nodeById: Map<string, SceneNode & { cx: number; cy: number }>,
  tokens: GraphThemeTokens
): string {
  const visible = nodes.filter((n) => !n.hidden);
  if (visible.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of visible) {
    minX = Math.min(minX, n.cx - n.size - 60);
    minY = Math.min(minY, n.cy - n.size - 60);
    maxX = Math.max(maxX, n.cx + n.size + 60);
    maxY = Math.max(maxY, n.cy + n.size + 60);
  }
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" font-family="${escapeXml(
      tokens.fontUi
    )}">`
  );
  parts.push(`<rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="${tokens.bgPrimary}"/>`);
  for (const e of edges) {
    if (e.hidden) continue;
    const a = nodeById.get(e.source);
    const b = nodeById.get(e.target);
    if (!a || !b || a.hidden || b.hidden) continue;
    const stroke = e.style === "property" ? tokens.accent : e.style === "suggestion" ? tokens.textFaint : tokens.textMuted;
    const dash = e.style === "embed" ? ` stroke-dasharray="2 3"` : e.style === "suggestion" ? ` stroke-dasharray="5 4"` : "";
    const opacity = e.dimmed ? 0.06 : e.style === "structure" ? 0.25 : 0.6;
    parts.push(
      `<line x1="${a.cx}" y1="${a.cy}" x2="${b.cx}" y2="${b.cy}" stroke="${stroke}" stroke-width="${
        0.8 + Math.min(4, e.width - 1) * 0.6
      }" opacity="${opacity}"${dash}/>`
    );
  }
  for (const n of visible) {
    const chip = n.colorToken != null ? tokens.chips[n.colorToken % tokens.chips.length] : null;
    const fill = n.color ?? chip?.bg ?? tokens.bgSecondary;
    const stroke = chip?.fg ?? tokens.border;
    const opacity = n.dimmed ? 0.15 : 1;
    parts.push(`<circle cx="${n.cx}" cy="${n.cy}" r="${n.size}" fill="${fill}" stroke="${stroke}" opacity="${opacity}"/>`);
    if (n.icon) {
      parts.push(
        `<text x="${n.cx}" y="${n.cy}" font-size="${n.size * 1.05}" text-anchor="middle" dominant-baseline="central" opacity="${opacity}">${escapeXml(
          n.icon
        )}</text>`
      );
    }
    parts.push(
      `<text x="${n.cx}" y="${n.cy + n.size + 4}" font-size="${Math.max(9, n.size * 0.5)}" text-anchor="middle" dominant-baseline="hanging" fill="${
        tokens.textMuted
      }" opacity="${opacity}">${escapeXml(n.label)}</text>`
    );
  }
  parts.push(`</svg>`);
  return parts.join("");
}
