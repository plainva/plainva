import { getSettingsStore } from "./settingsStore";

/**
 * UI density (plan Designsprache 2026-07-05, §2.5). "comfortable" is the
 * default (no attribute on <html>); "compact" sets data-density="compact",
 * which tightens the chrome tokens --control-* / --pad-row-y / --pad-cell in
 * styles/tokens.css. Document content (editor + read view) is unaffected.
 * Persistence mirrors services/theme.ts (Tauri store, global setting).
 */
export type Density = "comfortable" | "compact";

export const DEFAULT_DENSITY: Density = "comfortable";

export function isDensity(v: unknown): v is Density {
  return v === "comfortable" || v === "compact";
}

/** Writes the density axis onto <html>. No-op without a DOM (unit tests). */
export function applyDensity(density: Density): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (density === "compact") root.setAttribute("data-density", "compact");
  else root.removeAttribute("data-density");
}

export async function getStoredDensity(): Promise<Density> {
  try {
    const store = await getSettingsStore();
    const v = await store.get<Density>("density");
    return isDensity(v) ? v : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
}

export async function setStoredDensity(density: Density): Promise<void> {
  const store = await getSettingsStore();
  await store.set("density", density);
  await store.save();
  applyDensity(density);
}

/** Applies the default immediately (avoids a flash), then the stored value. */
export function initDensity(): void {
  applyDensity(DEFAULT_DENSITY);
  getStoredDensity()
    .then((d) => applyDensity(d))
    .catch(() => {});
}
