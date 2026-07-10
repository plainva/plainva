import { getSettingsStore } from "./settingsStore";

/**
 * Whole-UI zoom (issue #5 follow-up, a11y): scales EVERYTHING — chrome,
 * menus, sidebars — via the webview zoom factor. Desktop-only by design:
 * Tauri's set_zoom does not exist on Android, and mobile follows the OS
 * font scale instead. Content-only sizing lives in services/contentFont.ts.
 *
 * Requires the `core:webview:allow-set-zoom` capability.
 */

export const DEFAULT_UI_ZOOM = 100;
export const MIN_UI_ZOOM = 80;
export const MAX_UI_ZOOM = 150;
export const UI_ZOOM_STEP = 10;

export function clampUiZoom(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_UI_ZOOM;
  return Math.min(MAX_UI_ZOOM, Math.max(MIN_UI_ZOOM, n));
}

async function applyZoom(percent: number): Promise<void> {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  await getCurrentWebviewWindow().setZoom(clampUiZoom(percent) / 100);
}

export async function getStoredUiZoom(): Promise<number> {
  try {
    const store = await getSettingsStore();
    return clampUiZoom(await store.get<number>("uiZoom"));
  } catch {
    return DEFAULT_UI_ZOOM;
  }
}

export async function setStoredUiZoom(percent: number): Promise<number> {
  const clamped = clampUiZoom(percent);
  const store = await getSettingsStore();
  await store.set("uiZoom", clamped);
  await store.save();
  await applyZoom(clamped);
  return clamped;
}

/** Mod+Plus/Minus step for the shortcuts; returns the new percentage. */
export async function adjustUiZoom(direction: 1 | -1): Promise<number> {
  const current = await getStoredUiZoom();
  return setStoredUiZoom(current + direction * UI_ZOOM_STEP);
}

/** Applies a stored non-default zoom at startup (default needs no call). */
export function initUiZoom(): void {
  getStoredUiZoom()
    .then((z) => {
      if (z !== DEFAULT_UI_ZOOM) return applyZoom(z);
    })
    .catch(() => {});
}
