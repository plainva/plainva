// Last active view per `.base` file (Base-UX2 P6): the rule lives in
// packages/ui since the Build-91 feedback round (P6) so the phone restores
// the same view; the desktop keeps its call sites through this re-export.
export { getLastActiveView, setLastActiveView, resolveViewIndex, viewStateName } from "@plainva/ui";

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

// Collapsed swimlanes per `.base` file (issue #83, P6) — app-side like the two
// above: which lanes are folded away is a way of looking, not part of the view.

const lanesKeyFor = (vaultPath: string) => `plainva-base-lanes-${vaultPath}`;

function readLanesMap(vaultPath: string): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(lanesKeyFor(vaultPath));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getCollapsedLanes(vaultPath: string | null, filePath: string): string[] {
  if (!vaultPath) return [];
  const v = readLanesMap(vaultPath)[filePath];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function setCollapsedLanes(vaultPath: string | null, filePath: string, keys: string[]): void {
  if (!vaultPath) return;
  try {
    const map = readLanesMap(vaultPath);
    if (keys.length === 0) delete map[filePath];
    else map[filePath] = keys;
    localStorage.setItem(lanesKeyFor(vaultPath), JSON.stringify(map));
  } catch {
    /* quota/serialization — non-fatal */
  }
}
