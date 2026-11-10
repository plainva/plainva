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

/**
 * What the editor's save label says (finding X5, review 2026-11-10).
 *
 * The tab's dot and the label used to answer from two sources: the dot from
 * this store, the label from "is a write running right now". During the
 * one-second autosave delay — and after a write that finished while newer
 * typing waited — the tab said "unsaved" while the label said "Saved". Both
 * now answer from the same fact: a file this store holds as dirty is not
 * saved yet, and its autosave is on the way, so the label says "Saving…".
 * A failed write wins, because the dot stays until the user acts on it.
 */
export type SaveLabel = "saved" | "saving" | "failed";

export function saveLabelFor(state: { writing: boolean; failed: boolean; dirty: boolean }): SaveLabel {
  if (state.failed) return "failed";
  if (state.writing || state.dirty) return "saving";
  return "saved";
}
