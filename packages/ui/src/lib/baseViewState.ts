/**
 * Last active view per `.base` file (Base-UX2 P6; shared since the Build-91
 * feedback round, P6), persisted app-side — deliberately NOT inside the
 * `.base`: merely switching the view tab must not dirty the file (sync churn,
 * Obsidian diffs; Obsidian keeps this kind of state in its workspace too).
 * Keyed per vault like the pane layout (`plainva-layout-<vault>`). Views are
 * addressed by NAME — robust against reordering, and `serializeBaseConfig`
 * guarantees on-disk names — with an index sentinel `#<i>` as fallback for
 * unnamed in-memory views.
 *
 * The phone kept its view index in React state only, so a restored session
 * opened every database on its first view — the pinboard the tester uses as
 * his start page could not come back.
 */

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const defaultStorage = (): StorageLike | null => (typeof localStorage === "undefined" ? null : localStorage);

export const baseViewStateKey = (vaultKey: string) => `plainva-base-active-view-${vaultKey}`;

function readMap(vaultKey: string, storage: StorageLike | null): Record<string, string> {
  try {
    const raw = storage?.getItem(baseViewStateKey(vaultKey));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Stable identifier of a view for persistence: its name, else `#<index>`. */
export function viewStateName(view: any, index: number): string {
  const n = view?.name;
  return typeof n === "string" && n.trim() ? n : `#${index}`;
}

export function getLastActiveView(vaultKey: string | null, filePath: string, storage: StorageLike | null = defaultStorage()): string | null {
  if (!vaultKey) return null;
  const v = readMap(vaultKey, storage)[filePath];
  return typeof v === "string" ? v : null;
}

export function setLastActiveView(
  vaultKey: string | null,
  filePath: string,
  viewName: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!vaultKey) return;
  try {
    const map = readMap(vaultKey, storage);
    if (map[filePath] === viewName) return;
    map[filePath] = viewName;
    storage?.setItem(baseViewStateKey(vaultKey), JSON.stringify(map));
  } catch {
    /* quota/serialization — non-fatal */
  }
}

/** Stored identifier -> view index; 0 when unknown, renamed or out of range. */
export function resolveViewIndex(views: any[] | undefined, stored: string | null): number {
  if (!stored || !Array.isArray(views) || views.length === 0) return 0;
  const idx = views.findIndex((v, i) => viewStateName(v, i) === stored);
  return idx >= 0 ? idx : 0;
}
