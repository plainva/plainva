/**
 * Reads the theme's CSS custom properties into a plain object so canvas code
 * can paint with the SAME colors the DOM uses. This is the canonical CSS-var-
 * in-JS bridge (there was none before the graph): values are cached and
 * invalidated when a theme axis attribute on <html> changes, so LCARS &
 * friends restyle the canvas exactly like they restyle components.
 *
 * Canvas painters must not hard-code colors (designLint forbids literals in
 * components/) — everything visual flows through these tokens plus
 * ctx.globalAlpha for derived emphasis.
 */

export interface GraphThemeTokens {
  bgPrimary: string;
  bgSecondary: string;
  textMain: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentOn: string;
  border: string;
  /** Chrome font stack (labels, badges). */
  fontUi: string;
  /** ms parsed from --dur-2; used for focus/unfold animations. */
  durationMs: number;
  /** The 8 chip colors (bg/fg pairs) — node type palette. */
  chips: { bg: string; fg: string }[];
  statusError: string;
  statusWarning: string;
  /** Accent pre-mixed with a fixed alpha (0.30 / 0) for glow rings and halos —
   *  computed once per theme change so the canvas never parses colors per frame. */
  accentGlowStrong: string;
  accentGlowSoft: string;
  /** 0 = all decorative effects (glow, gradient highlight) off; default 1.
   *  Win95 / high-contrast set 0; phosphor / LCARS may set >1. */
  glowIntensity: number;
  /** Quadratic edge bend as a fraction of node distance; 0 = straight edges
   *  (retro/utilitarian themes), default ~0.16. */
  edgeCurvature: number;
  /** Faint edge darkening for the screen-space vignette (text tone @ low alpha). */
  vignetteTint: string;
}

const THEME_ATTRIBUTES = ["data-theme", "data-theme-name", "data-theme-variant", "data-density"];

let cache: GraphThemeTokens | null = null;
let observer: MutationObserver | null = null;
const listeners = new Set<() => void>();

/**
 * Parses a #rgb / #rrggbb / rgb() / rgba() theme color into an rgba() string
 * with the given alpha. Runs once per theme change (not per frame) so glow
 * gradients can fade to transparent without a color literal in the canvas code.
 * Exported for the engine's folder dome-shading gradients (token colors only).
 */
export function toRgba(color: string, alpha: number): string {
  const c = color.trim();
  let r = 0;
  let g = 0;
  let b = 0;
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
  } else {
    const m = c.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const parts = m[1].split(",").map((p) => Number.parseFloat(p));
      r = parts[0] || 0;
      g = parts[1] || 0;
      b = parts[2] || 0;
    }
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function read(): GraphThemeTokens {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  const readNumber = (name: string, fallback: number): number => {
    const n = Number.parseFloat(v(name));
    return Number.isFinite(n) ? n : fallback;
  };
  const chips: { bg: string; fg: string }[] = [];
  for (let i = 0; i < 8; i++) {
    chips.push({ bg: v(`--chip-${i}-bg`), fg: v(`--chip-${i}-fg`) });
  }
  const durRaw = v("--dur-2");
  const durationMs = Number.parseFloat(durRaw) || 180;
  const accent = v("--accent-color");
  return {
    bgPrimary: v("--bg-primary"),
    bgSecondary: v("--bg-secondary"),
    textMain: v("--text-main"),
    textMuted: v("--text-muted"),
    textFaint: v("--text-faint"),
    accent,
    accentOn: v("--accent-on"),
    border: v("--border-color"),
    fontUi: v("--font-ui") || "sans-serif",
    durationMs,
    chips,
    statusError: v("--error-text") || v("--accent-color"),
    statusWarning: v("--warning-text") || v("--accent-color"),
    accentGlowStrong: toRgba(accent, 0.3),
    accentGlowSoft: toRgba(accent, 0),
    glowIntensity: readNumber("--graph-glow-intensity", 1),
    edgeCurvature: readNumber("--graph-edge-curvature", 0.16),
    vignetteTint: toRgba(v("--text-main"), 0.05),
  };
}

function ensureObserver(): void {
  if (observer || typeof MutationObserver === "undefined") return;
  observer = new MutationObserver((mutations) => {
    if (!mutations.some((m) => m.type === "attributes")) return;
    cache = null;
    for (const cb of listeners) cb();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: THEME_ATTRIBUTES,
  });
}

/** Current theme tokens (cached until a theme axis attribute changes). */
export function getGraphThemeTokens(): GraphThemeTokens {
  if (!cache) cache = read();
  return cache;
}

/**
 * Notifies on theme changes; returns the unsubscribe function. The first
 * subscription installs the <html> attribute observer.
 */
export function subscribeGraphThemeTokens(cb: () => void): () => void {
  ensureObserver();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Test hook: drop the cache without an attribute mutation. */
export function __resetThemeTokenCache(): void {
  cache = null;
}
