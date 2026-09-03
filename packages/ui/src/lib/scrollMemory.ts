/**
 * Where you were (feedback round 2026-09-01, A5 + T6).
 *
 * Two device-local memories, both per vault, both surviving a restart, none
 * of it synced — where you had scrolled to in a note is a fact about this
 * device, and so is which note you had open when you left:
 *
 *  - the scroll position per file, restored when the file opens again;
 *  - the last opened note, so the phone can pick up where you stopped
 *    (the desktop already restores its tabs through the layout store).
 *
 * Kept in `localStorage` under the vault's key (E7: "im Layout-Store" — the
 * same place and lifetime as the desktop's layout snapshot), capped so a
 * vault of thousands of notes cannot grow it without bound, and forgotten
 * together with the vault.
 */

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultStorage = (): StorageLike | null => (typeof localStorage === "undefined" ? null : localStorage);

const scrollKey = (vaultKey: string) => `plainva-scroll-${vaultKey}`;
const lastOpenKey = (vaultKey: string) => `plainva-last-open-${vaultKey}`;
/** Files remembered per vault; the least recently touched fall out first. */
export const SCROLL_MEMORY_MAX = 200;

type ScrollMap = Record<string, { top: number; at: number }>;

function readMap(vaultKey: string, storage: StorageLike | null): ScrollMap {
  try {
    const raw = storage?.getItem(scrollKey(vaultKey));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as ScrollMap) : {};
  } catch {
    return {};
  }
}

function writeMap(vaultKey: string, map: ScrollMap, storage: StorageLike | null): void {
  try {
    storage?.setItem(scrollKey(vaultKey), JSON.stringify(map));
  } catch {
    /* the memory simply does not persist */
  }
}

/** Remembers `top` for `path`; a position at the very top is forgotten instead of stored. */
export function rememberScrollTop(vaultKey: string, path: string, top: number, storage: StorageLike | null = defaultStorage()): void {
  const map = readMap(vaultKey, storage);
  if (!Number.isFinite(top) || top <= 0) {
    if (!(path in map)) return;
    delete map[path];
  } else {
    map[path] = { top: Math.round(top), at: Date.now() };
    const keys = Object.keys(map);
    if (keys.length > SCROLL_MEMORY_MAX) {
      keys
        .sort((a, b) => map[a].at - map[b].at)
        .slice(0, keys.length - SCROLL_MEMORY_MAX)
        .forEach((k) => delete map[k]);
    }
  }
  writeMap(vaultKey, map, storage);
}

/** The remembered position for `path`, or null when the file starts at the top. */
export function recallScrollTop(vaultKey: string, path: string, storage: StorageLike | null = defaultStorage()): number | null {
  const entry = readMap(vaultKey, storage)[path];
  return entry && Number.isFinite(entry.top) && entry.top > 0 ? entry.top : null;
}

/** A file was renamed: the memory follows it. */
export function moveScrollMemory(vaultKey: string, from: string, to: string, storage: StorageLike | null = defaultStorage()): void {
  const map = readMap(vaultKey, storage);
  if (!(from in map)) return;
  map[to] = map[from];
  delete map[from];
  writeMap(vaultKey, map, storage);
}

export function rememberLastOpen(vaultKey: string, path: string | null, storage: StorageLike | null = defaultStorage()): void {
  try {
    if (path) storage?.setItem(lastOpenKey(vaultKey), path);
    else storage?.removeItem(lastOpenKey(vaultKey));
  } catch {
    /* not persisted */
  }
}

export function recallLastOpen(vaultKey: string, storage: StorageLike | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(lastOpenKey(vaultKey)) || null;
  } catch {
    return null;
  }
}

/** The vault is gone from this device: both memories go with it. */
export function forgetScrollMemory(vaultKey: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(scrollKey(vaultKey));
    storage?.removeItem(lastOpenKey(vaultKey));
  } catch {
    /* nothing to forget */
  }
}
