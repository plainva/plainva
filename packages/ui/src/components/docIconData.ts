import { useSyncExternalStore } from "react";
import type { LucideIconEntry } from "./lucideIconData";

/**
 * The icon set of document icons (ADR 0009), loaded when the first document icon is drawn (performance plan L5):
 * the set is a chunk of the app's own bundle, not part of the start. Until it is there a document icon holds its
 * place at its size, and draws itself the moment the set arrives.
 */
let icons: ReadonlyMap<string, LucideIconEntry> | null = null;
let loading: Promise<ReadonlyMap<string, LucideIconEntry>> | null = null;
const listeners = new Set<() => void>();

export function loadDocIconSet(): Promise<ReadonlyMap<string, LucideIconEntry>> {
  if (icons) return Promise.resolve(icons);
  loading ??= import("./lucideIconData").then(
    (module) => {
      icons = module.LUCIDE_ICON_MAP;
      for (const listener of listeners) listener();
      return icons;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The set when it is loaded, else `null`. */
export function docIconSet(): ReadonlyMap<string, LucideIconEntry> | null {
  return icons;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The set for a component: `null` until it is loaded — asking starts the load — then the set. */
export function useDocIconSet(): ReadonlyMap<string, LucideIconEntry> | null {
  const set = useSyncExternalStore(subscribe, docIconSet, docIconSet);
  if (!set) void loadDocIconSet().catch(() => undefined);
  return set;
}
