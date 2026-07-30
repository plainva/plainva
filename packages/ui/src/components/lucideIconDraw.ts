import { LUCIDE_ICON_MAP } from "./lucideIconData";
import { parseDocIcon } from "./DocIcon";

/**
 * Drawing icon-set references outside the DOM: on a canvas and into an SVG
 * export.
 *
 * The graph used to paint `n.icon` with `fillText`, which is right for an emoji
 * but not for an icon reference — there the value is the raw string
 * `lucide:circle-question-mark`, and it was drawn across the map at node size
 * (report 2026-07-29, screenshot). The SVG export had the same bug.
 *
 * No new renderer and no new dependency: the shapes already exist as lucide
 * `IconNode` element lists, the same data `<DocIcon/>` renders. Here they become
 * `Path2D` objects (canvas) or element markup (export), so all three surfaces
 * draw one source of truth.
 */

/** The coordinate system every lucide icon is authored in. */
export const LUCIDE_VIEWBOX = 24;
/** Upstream stroke width, in viewBox units. */
export const LUCIDE_STROKE = 2;

/** True when this icon value can be drawn on a canvas (emoji excluded). */
export function isLucideIconRef(icon: string): boolean {
  const parsed = parseDocIcon(icon);
  return parsed.kind === "lucide" && LUCIDE_ICON_MAP.has(parsed.name);
}

const num = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
};

/** Point list of a `polyline`/`polygon` attribute: "1,2 3,4" and "1 2 3 4" both. */
function points(value: unknown): Array<[number, number]> {
  const parts = String(value ?? "")
    .trim()
    .split(/[\s,]+/)
    .map((p) => parseFloat(p))
    .filter((n) => Number.isFinite(n));
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) out.push([parts[i], parts[i + 1]]);
  return out;
}

/**
 * The icon as canvas paths, in the 0..24 viewBox space — stroke them after
 * translating and scaling. Returns null for an emoji, an unknown name, or an
 * environment without `Path2D` (jsdom); every caller then falls back to the
 * plain node, which is the honest answer for an icon it cannot draw.
 */
export function lucideIconPaths(icon: string): Path2D[] | null {
  const parsed = parseDocIcon(icon);
  if (parsed.kind !== "lucide") return null;
  const entry = LUCIDE_ICON_MAP.get(parsed.name);
  if (!entry || typeof Path2D === "undefined") return null;

  const paths: Path2D[] = [];
  for (const [tag, attrs] of entry.node) {
    const a = attrs as Record<string, unknown>;
    if (tag === "path" && typeof a.d === "string") {
      paths.push(new Path2D(a.d));
      continue;
    }
    const p = new Path2D();
    if (tag === "circle") {
      p.arc(num(a.cx), num(a.cy), num(a.r), 0, Math.PI * 2);
    } else if (tag === "ellipse") {
      p.ellipse(num(a.cx), num(a.cy), num(a.rx), num(a.ry), 0, 0, Math.PI * 2);
    } else if (tag === "line") {
      p.moveTo(num(a.x1), num(a.y1));
      p.lineTo(num(a.x2), num(a.y2));
    } else if (tag === "rect") {
      // Rounded corners where lucide asks for them; rx alone means both axes.
      const rx = num(a.rx, num(a.ry));
      if (rx > 0 && typeof p.roundRect === "function") p.roundRect(num(a.x), num(a.y), num(a.width), num(a.height), rx);
      else p.rect(num(a.x), num(a.y), num(a.width), num(a.height));
    } else if (tag === "polyline" || tag === "polygon") {
      const pts = points(a.points);
      if (pts.length === 0) continue;
      p.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts.slice(1)) p.lineTo(x, y);
      if (tag === "polygon") p.closePath();
    } else {
      continue; // unknown element: skip it rather than draw something wrong
    }
    paths.push(p);
  }
  return paths.length > 0 ? paths : null;
}

/**
 * Strokes an icon centred on (cx, cy) at the given diameter. Restores the
 * context, so a caller can treat it as one drawing primitive.
 */
export function drawLucideIcon(
  ctx: CanvasRenderingContext2D,
  icon: string,
  cx: number,
  cy: number,
  diameter: number,
  color: string
): boolean {
  const paths = lucideIconPaths(icon);
  if (!paths) return false;
  const scale = diameter / LUCIDE_VIEWBOX;
  ctx.save();
  ctx.translate(cx - diameter / 2, cy - diameter / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = LUCIDE_STROKE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = "transparent";
  for (const path of paths) ctx.stroke(path);
  ctx.restore();
  return true;
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The same icon as SVG markup for the export, positioned like the canvas
 * version. Returns null in exactly the cases the canvas version does, so both
 * surfaces show the same picture — including what they leave out.
 */
export function lucideIconSvg(
  icon: string,
  cx: number,
  cy: number,
  diameter: number,
  color: string,
  opacity = 1
): string | null {
  const parsed = parseDocIcon(icon);
  if (parsed.kind !== "lucide") return null;
  const entry = LUCIDE_ICON_MAP.get(parsed.name);
  if (!entry) return null;

  const scale = diameter / LUCIDE_VIEWBOX;
  const inner = entry.node
    .map(([tag, attrs]) => {
      const pairs = Object.entries(attrs as Record<string, unknown>)
        .filter(([key]) => key !== "key")
        .map(([key, value]) => `${key}="${escapeAttr(String(value))}"`)
        .join(" ");
      return `<${tag} ${pairs}/>`;
    })
    .join("");
  return (
    `<g transform="translate(${cx - diameter / 2} ${cy - diameter / 2}) scale(${scale})" fill="none" ` +
    `stroke="${escapeAttr(color)}" stroke-width="${LUCIDE_STROKE}" stroke-linecap="round" stroke-linejoin="round" ` +
    `opacity="${opacity}">${inner}</g>`
  );
}
