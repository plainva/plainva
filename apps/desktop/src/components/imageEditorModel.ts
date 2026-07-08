/**
 * Pure model of the image editor (plan UI-UX-Paket P10): edits are a replayable
 * op list (no pixel snapshots) — undo/redo pop and re-push ops, rendering
 * replays them from the original bitmap. Geometry math lives here so it is
 * unit-testable without a real canvas.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DrawTool = "pen" | "arrow" | "rect" | "text";

export type ImageOp =
  | { kind: "rotate90"; dir: 1 | -1 }
  | { kind: "flip"; axis: "h" | "v" }
  | { kind: "crop"; rect: Rect }
  | { kind: "resize"; width: number; height: number }
  | {
      kind: "draw";
      tool: DrawTool;
      /** pen: the stroke; arrow: [from, to]; text: [anchor]. */
      points?: Point[];
      rect?: Rect;
      text?: string;
      color: string;
      strokeWidth: number;
      fontSize?: number;
    };

export interface EditorState {
  ops: ImageOp[];
  redo: ImageOp[];
}

export const emptyEditorState = (): EditorState => ({ ops: [], redo: [] });

export function pushOp(state: EditorState, op: ImageOp): EditorState {
  return { ops: [...state.ops, op], redo: [] };
}

export function undoOp(state: EditorState): EditorState {
  if (state.ops.length === 0) return state;
  return { ops: state.ops.slice(0, -1), redo: [state.ops[state.ops.length - 1], ...state.redo] };
}

export function redoOp(state: EditorState): EditorState {
  if (state.redo.length === 0) return state;
  return { ops: [...state.ops, state.redo[0]], redo: state.redo.slice(1) };
}

/** Canvas size after applying the geometry ops (draw ops never change it). */
export function sizeAfterOps(initial: Size, ops: ImageOp[]): Size {
  let w = initial.width;
  let h = initial.height;
  for (const op of ops) {
    if (op.kind === "rotate90") [w, h] = [h, w];
    else if (op.kind === "crop") {
      w = Math.round(op.rect.width);
      h = Math.round(op.rect.height);
    } else if (op.kind === "resize") {
      w = op.width;
      h = op.height;
    }
  }
  return { width: w, height: h };
}

/** Normalized rectangle between two drag points (any direction). */
export function rectFrom(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** rectFrom clamped into the canvas bounds (crop never leaves the image). */
export function clampRect(a: Point, b: Point, bounds: Size): Rect {
  const x1 = Math.max(0, Math.min(a.x, b.x));
  const y1 = Math.max(0, Math.min(a.y, b.y));
  const x2 = Math.min(bounds.width, Math.max(a.x, b.x));
  const y2 = Math.min(bounds.height, Math.max(a.y, b.y));
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

/** The two rear points of an arrow head ending at `to`. */
export function arrowHeadPoints(from: Point, to: Point, size: number): [Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  return [
    { x: to.x - size * Math.cos(angle - spread), y: to.y - size * Math.sin(angle - spread) },
    { x: to.x - size * Math.cos(angle + spread), y: to.y - size * Math.sin(angle + spread) },
  ];
}

/** Maps a pointer event to canvas pixel coordinates (CSS size ≠ pixel size). */
export function toCanvasPoint(
  e: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement
): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function drawOnto(ctx: CanvasRenderingContext2D, op: Extract<ImageOp, { kind: "draw" }>): void {
  ctx.save();
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (op.tool === "pen" && op.points && op.points.length > 0) {
    ctx.beginPath();
    ctx.moveTo(op.points[0].x, op.points[0].y);
    for (const p of op.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  } else if (op.tool === "arrow" && op.points && op.points.length >= 2) {
    const [from, to] = [op.points[0], op.points[op.points.length - 1]];
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    const size = Math.max(10, op.strokeWidth * 3.5);
    const [h1, h2] = arrowHeadPoints(from, to, size);
    ctx.beginPath();
    ctx.moveTo(h1.x, h1.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineTo(h2.x, h2.y);
    ctx.stroke();
  } else if (op.tool === "rect" && op.rect) {
    ctx.strokeRect(op.rect.x, op.rect.y, op.rect.width, op.rect.height);
  } else if (op.tool === "text" && op.points && op.points.length > 0 && op.text) {
    ctx.font = `${op.fontSize ?? 18}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(op.text, op.points[0].x, op.points[0].y);
  }
  ctx.restore();
}

function applyGeometry(source: HTMLCanvasElement, op: ImageOp): HTMLCanvasElement {
  const next = document.createElement("canvas");
  const ctx = () => {
    const c = next.getContext("2d");
    if (!c) throw new Error("2d context unavailable");
    c.imageSmoothingQuality = "high";
    return c;
  };
  if (op.kind === "rotate90") {
    next.width = source.height;
    next.height = source.width;
    const c = ctx();
    c.translate(next.width / 2, next.height / 2);
    c.rotate((op.dir * Math.PI) / 2);
    c.drawImage(source, -source.width / 2, -source.height / 2);
  } else if (op.kind === "flip") {
    next.width = source.width;
    next.height = source.height;
    const c = ctx();
    if (op.axis === "h") {
      c.translate(next.width, 0);
      c.scale(-1, 1);
    } else {
      c.translate(0, next.height);
      c.scale(1, -1);
    }
    c.drawImage(source, 0, 0);
  } else if (op.kind === "crop") {
    const w = Math.max(1, Math.round(op.rect.width));
    const h = Math.max(1, Math.round(op.rect.height));
    next.width = w;
    next.height = h;
    ctx().drawImage(source, op.rect.x, op.rect.y, w, h, 0, 0, w, h);
  } else if (op.kind === "resize") {
    next.width = Math.max(1, op.width);
    next.height = Math.max(1, op.height);
    ctx().drawImage(source, 0, 0, next.width, next.height);
  } else {
    return source;
  }
  return next;
}

/**
 * Replays all ops (plus an optional in-progress preview op) from the source
 * bitmap into `target`. Draw ops paint in the coordinate space at their point
 * in the chain — exactly what the user saw when placing them.
 */
export function renderOps(
  source: ImageBitmap | HTMLCanvasElement,
  ops: ImageOp[],
  target: HTMLCanvasElement,
  previewOp?: ImageOp
): void {
  let canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const baseCtx = canvas.getContext("2d");
  if (!baseCtx) throw new Error("2d context unavailable");
  baseCtx.drawImage(source, 0, 0);

  const all = previewOp ? [...ops, previewOp] : ops;
  for (const op of all) {
    if (op.kind === "draw") {
      const ctx = canvas.getContext("2d");
      if (ctx) drawOnto(ctx, op);
    } else {
      canvas = applyGeometry(canvas, op);
    }
  }

  target.width = canvas.width;
  target.height = canvas.height;
  const tctx = target.getContext("2d");
  if (!tctx) throw new Error("2d context unavailable");
  tctx.clearRect(0, 0, target.width, target.height);
  tctx.drawImage(canvas, 0, 0);
}
