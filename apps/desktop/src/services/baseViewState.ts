// Last active view per `.base` file (Base-UX2 P6), persisted app-side in
// localStorage — deliberately NOT inside the `.base`: merely switching the view
// tab must not dirty the file (sync churn, Obsidian diffs; Obsidian keeps this
// kind of state in its workspace too). Keyed per vault like the pane layout
// (`plainva-layout-<vault>`). Views are addressed by NAME — robust against
// reordering, and `serializeBaseConfig` guarantees on-disk names — with an
// index sentinel `#<i>` as fallback for unnamed in-memory views.

const keyFor = (vaultPath: string) => `plainva-base-active-view-${vaultPath}`;

function readMap(vaultPath: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(keyFor(vaultPath));
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

export function getLastActiveView(vaultPath: string | null, filePath: string): string | null {
  if (!vaultPath) return null;
  const v = readMap(vaultPath)[filePath];
  return typeof v === "string" ? v : null;
}

export function setLastActiveView(vaultPath: string | null, filePath: string, viewName: string): void {
  if (!vaultPath) return;
  try {
    const map = readMap(vaultPath);
    if (map[filePath] === viewName) return;
    map[filePath] = viewName;
    localStorage.setItem(keyFor(vaultPath), JSON.stringify(map));
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

// Expanded sub-item rows per `.base` file (Gesamtplan Base-Relationen, P10) —
// app-side like the active view above; default is collapsed (Notion model).

const subItemsKeyFor = (vaultPath: string) => `plainva-base-subitems-${vaultPath}`;

function readSubItemsMap(vaultPath: string): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(subItemsKeyFor(vaultPath));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getExpandedSubItems(vaultPath: string | null, filePath: string): string[] {
  if (!vaultPath) return [];
  const v = readSubItemsMap(vaultPath)[filePath];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function setExpandedSubItems(vaultPath: string | null, filePath: string, keys: string[]): void {
  if (!vaultPath) return;
  try {
    const map = readSubItemsMap(vaultPath);
    if (keys.length === 0) delete map[filePath];
    else map[filePath] = keys;
    localStorage.setItem(subItemsKeyFor(vaultPath), JSON.stringify(map));
  } catch {
    /* quota/serialization — non-fatal */
  }
}
