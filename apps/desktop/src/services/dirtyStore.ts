import { useSyncExternalStore } from "react";

/**
 * Unsaved-changes registry (plan Designsprache P6/L2). The editor marks its
 * file dirty on the first real edit and clean after a successful save (or a
 * safe CONFLICT preserve) — tab strips subscribe and show the dirty dot.
 */
let dirty: ReadonlySet<string> = new Set<string>();
const owners = new Map<string, Set<string>>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const dirtyStore = {
  get: (): ReadonlySet<string> => dirty,
  set(path: string, isDirty: boolean, owner = "legacy") {
    if (!path) return;
    const holders = owners.get(path) ?? new Set<string>();
    if (isDirty) holders.add(owner); else holders.delete(owner);
    if (holders.size) owners.set(path, holders); else owners.delete(path);
    const remainsDirty = holders.size > 0;
    if (remainsDirty === dirty.has(path)) return;
    const next = new Set(dirty);
    if (remainsDirty) next.add(path);
    else next.delete(path);
    dirty = next;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Test helper. */
  clearAll() {
    owners.clear();
    if ((dirty as Set<string>).size === 0) return;
    dirty = new Set<string>();
    emit();
  },
};

export function useDirtyPaths(): ReadonlySet<string> {
  return useSyncExternalStore(dirtyStore.subscribe, dirtyStore.get);
}
