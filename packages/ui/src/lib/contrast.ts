/**
 * Colour math for the user theme (plan 2026-09-04, P2): WCAG contrast, hex ↔
 * HSL, mixing, and the one operation the guardrails rest on — moving a colour's
 * lightness until it clears a contrast ratio against a ground. Pure; no DOM,
 * no CSS. Everything takes and returns `#rrggbb`.
 */

export interface Rgb { r: number; g: number; b: number }
export interface Hsl { h: number; s: number; l: number }

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value.trim());
}

/** `#abc` → `#aabbcc`, lower case; anything else → null. */
export function normalizeHex(value: unknown): string | null {
  if (!isHexColor(value)) return null;
  const v = value.trim().toLowerCase();
  if (v.length === 7) return v;
  return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
}

export function hexToRgb(hex: string): Rgb {
  const v = normalizeHex(hex) ?? "#000000";
  return { r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16) };
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number) => clamp255(n).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** WCAG 2.x relative luminance, 0 (black) … 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 … 21. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function hexToHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let r: number;
  let g: number;
  let b: number;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}

/** Linear mix in sRGB: `t` is the weight of `b` (0 = a, 1 = b). */
export function mixHex(a: string, b: string, t: number): string {
  const w = Math.max(0, Math.min(1, t));
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return rgbToHex({ r: ca.r + (cb.r - ca.r) * w, g: ca.g + (cb.g - ca.g) * w, b: ca.b + (cb.b - ca.b) * w });
}

/** `rgba(r, g, b, a)` for translucent tints derived from a solid colour. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export interface NudgeResult {
  hex: string;
  ratio: number;
  changed: boolean;
}

/**
 * Moves `fg` away from `bg` in lightness — hue and saturation untouched —
 * until it clears `min`. The direction follows the ground: on a light ground
 * the colour darkens, on a dark one it lightens; when that runs out of room
 * the other direction is tried. A colour that already clears the ratio comes
 * back unchanged.
 */
export function nudgeToContrast(fg: string, bg: string, min: number): NudgeResult {
  const start = normalizeHex(fg) ?? "#000000";
  const ground = normalizeHex(bg) ?? "#ffffff";
  const startRatio = contrastRatio(start, ground);
  if (startRatio >= min) return { hex: start, ratio: startRatio, changed: false };
  const { h, s, l } = hexToHsl(start);
  const groundIsLight = relativeLuminance(ground) > 0.5;
  const tryDirection = (step: number): NudgeResult | null => {
    let light = l;
    for (let i = 0; i < 100; i += 1) {
      light += step;
      if (light < 0 || light > 1) break;
      const hex = hslToHex({ h, s, l: light });
      const ratio = contrastRatio(hex, ground);
      if (ratio >= min) return { hex, ratio, changed: true };
    }
    return null;
  };
  const preferred = groundIsLight ? -0.01 : 0.01;
  const hit = tryDirection(preferred) ?? tryDirection(-preferred);
  if (hit) return hit;
  // Nothing on this hue clears it (a saturated mid-tone on a mid ground):
  // fall back to the extreme that reads best.
  const black = hslToHex({ h: 0, s: 0, l: 0 });
  const white = hslToHex({ h: 0, s: 0, l: 1 });
  const pick = contrastRatio(black, ground) >= contrastRatio(white, ground) ? black : white;
  return { hex: pick, ratio: contrastRatio(pick, ground), changed: true };
}

/** One decimal, the way WCAG ratios are quoted ("4.5:1"). */
export function formatRatio(ratio: number): string {
  return `${(Math.round(ratio * 10) / 10).toFixed(1)}:1`;
}
