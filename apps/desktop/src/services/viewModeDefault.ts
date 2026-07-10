import { getSettingsStore } from "./settingsStore";

/**
 * Default editor view mode (maintainer request 2026-07-07): which of the three
 * editor views (read / live preview / source) a note opens in. A global
 * setting like theme/density (Tauri store, Settings → General → Appearance).
 *
 * Because the store is async but the Editor needs the value synchronously in
 * its `useState` initializer, `initDefaultViewMode()` (app start) fills a
 * module cache that `resolveViewModeForPath` reads from.
 *
 * Manual mode switches are remembered PER FILE for the running session only
 * (no persistence): switching tab A to source, visiting B and returning to A
 * keeps A in source. Managed OKF index.md files are NOT handled here — the
 * Editor's managed-index guard forces read mode regardless of this setting.
 */
export type EditorViewMode = "read" | "live" | "source";

export const DEFAULT_VIEW_MODE: EditorViewMode = "live";

export function isEditorViewMode(v: unknown): v is EditorViewMode {
  return v === "read" || v === "live" || v === "source";
}

let cachedDefault: EditorViewMode = DEFAULT_VIEW_MODE;
const sessionModes = new Map<string, EditorViewMode>();

export async function getStoredDefaultViewMode(): Promise<EditorViewMode> {
  try {
    const store = await getSettingsStore();
    const v = await store.get<EditorViewMode>("defaultViewMode");
    return isEditorViewMode(v) ? v : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

export async function setStoredDefaultViewMode(mode: EditorViewMode): Promise<void> {
  cachedDefault = mode;
  const store = await getSettingsStore();
  await store.set("defaultViewMode", mode);
  await store.save();
}

/** Fills the sync cache from the store; call once at app start (main.tsx). */
export function initDefaultViewMode(): void {
  getStoredDefaultViewMode()
    .then((m) => { cachedDefault = m; })
    .catch(() => {});
}

/** The user manually switched the mode for this file: remember it for the session. */
export function rememberSessionViewMode(path: string | null | undefined, mode: EditorViewMode): void {
  if (path) sessionModes.set(path, mode);
}

/** Mode a file opens in: the session's manual choice for it, else the default. */
export function resolveViewModeForPath(path: string | null | undefined): EditorViewMode {
  if (path) {
    const remembered = sessionModes.get(path);
    if (remembered) return remembered;
  }
  return cachedDefault;
}

/** Test-only: reset the module cache and the session memory. */
export function resetViewModeStateForTests(): void {
  cachedDefault = DEFAULT_VIEW_MODE;
  sessionModes.clear();
}
