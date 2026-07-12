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
}

const THEME_ATTRIBUTES = ["data-theme", "data-theme-name", "data-theme-variant", "data-density"];

let cache: GraphThemeTokens | null = null;
let observer: MutationObserver | null = null;
const listeners = new Set<() => void>();

function read(): GraphThemeTokens {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  const chips: { bg: string; fg: string }[] = [];
  for (let i = 0; i < 8; i++) {
    chips.push({ bg: v(`--chip-${i}-bg`), fg: v(`--chip-${i}-fg`) });
  }
  const durRaw = v("--dur-2");
  const durationMs = Number.parseFloat(durRaw) || 180;
  return {
    bgPrimary: v("--bg-primary"),
    bgSecondary: v("--bg-secondary"),
    textMain: v("--text-main"),
    textMuted: v("--text-muted"),
    textFaint: v("--text-faint"),
    accent: v("--accent-color"),
    accentOn: v("--accent-on"),
    border: v("--border-color"),
    fontUi: v("--font-ui") || "sans-serif",
    durationMs,
    chips,
    statusError: v("--error-text") || v("--accent-color"),
    statusWarning: v("--warning-text") || v("--accent-color"),
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
