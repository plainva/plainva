import { useEffect, useMemo, useSyncExternalStore, type SetStateAction } from "react";
import type { TaskStatusFilter } from "./taskList";
import { taskDuplicatesSeenKey } from "./taskDuplicatesSeen";

export interface TaskViewState {
  status: TaskStatusFilter; text: string; folder: string; tag: string; dueOnly: boolean; showHidden: boolean;
}
export type TaskViewStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const taskViewStateKey = (vault: string) => `plainva-task-view-${vault}`;
const defaults = (): TaskViewState => ({ status: "open", text: "", folder: "", tag: "", dueOnly: false, showHidden: false });
function defaultStorage(): TaskViewStorage | null { try { return globalThis.localStorage ?? null; } catch { return null; } }

export function parseTaskViewState(raw: string | null): TaskViewState {
  const next = defaults();
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return next;
    const p = value as Record<string, unknown>;
    if (p.status === "open" || p.status === "done" || p.status === "all") next.status = p.status;
    for (const key of ["text", "folder", "tag"] as const) if (typeof p[key] === "string") next[key] = p[key].slice(0, 4096);
    for (const key of ["dueOnly", "showHidden"] as const) if (typeof p[key] === "boolean") next[key] = p[key];
  } catch { /* A broken local preference must not prevent opening tasks. */ }
  return next;
}

class TaskViewStore {
  private state: TaskViewState;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  constructor(private vault: string | null, private storage: TaskViewStorage | null) {
    let raw: string | null = null;
    try { if (vault) raw = storage?.getItem(taskViewStateKey(vault)) ?? null; } catch { /* unavailable */ }
    this.state = parseTaskViewState(raw);
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); this.flush(); }; };
  private emit() { this.listeners.forEach((listener) => listener()); }
  set<K extends keyof TaskViewState>(key: K, value: SetStateAction<TaskViewState[K]>) {
    const next = typeof value === "function" ? (value as (old: TaskViewState[K]) => TaskViewState[K])(this.state[key]) : value;
    if (this.state[key] === next) return;
    this.replace({ ...this.state, [key]: next });
  }
  reset = () => this.replace(defaults());
  private replace(next: TaskViewState) {
    this.state = next; this.dirty = true; this.emit(); clearTimeout(this.timer);
    this.timer = setTimeout(this.flush, 250);
  }
  flush = () => {
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.dirty || !this.vault || !this.storage) return;
    try { this.storage.setItem(taskViewStateKey(this.vault), JSON.stringify({ version: 1, ...this.state })); this.dirty = false; }
    catch { /* Keep the live selection when storage is unavailable. */ }
  };
  receive = (raw: string | null) => {
    // An outstanding local edit is the next writer. Otherwise follow the last
    // write from a second window, without echoing it back into storage.
    if (!this.dirty) { this.state = parseTaskViewState(raw); this.emit(); }
  };
  forget() { clearTimeout(this.timer); this.dirty = false; this.state = defaults(); this.emit(); }
}
const stores = new WeakMap<TaskViewStorage, Map<string, TaskViewStore>>();
export function taskViewStore(vault: string | null, storage: TaskViewStorage | null = defaultStorage()): TaskViewStore {
  if (!vault || !storage) return new TaskViewStore(null, storage);
  let map = stores.get(storage); if (!map) { map = new Map(); stores.set(storage, map); }
  let store = map.get(vault); if (!store) { store = new TaskViewStore(vault, storage); map.set(vault, store); }
  return store;
}
export function flushTaskViewStates(storage: TaskViewStorage | null = defaultStorage()) {
  if (storage) stores.get(storage)?.forEach((store) => store.flush());
}
export function forgetTaskViewState(vault: string, storage: TaskViewStorage | null = defaultStorage()) {
  const store = storage && stores.get(storage)?.get(vault); store?.forget();
  if (storage) stores.get(storage)?.delete(vault);
  try { storage?.removeItem(taskViewStateKey(vault)); } catch { /* unavailable */ }
  // Everything the tasks view remembers about a vault goes with it — the
  // put-away duplicates notice included.
  try { storage?.removeItem(taskDuplicatesSeenKey(vault)); } catch { /* unavailable */ }
}

export function useTaskViewState(vault: string | null) {
  const store = useMemo(() => taskViewStore(vault), [vault]);
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => {
    const background = () => { if (document.visibilityState === "hidden") store.flush(); };
    const changed = (event: StorageEvent) => { if (vault && event.key === taskViewStateKey(vault)) store.receive(event.newValue); };
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", store.flush); window.addEventListener("storage", changed);
    return () => { store.flush(); document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", store.flush); window.removeEventListener("storage", changed); };
  }, [vault, store]);
  const actions = useMemo(() => ({
    setStatus: (value: SetStateAction<TaskStatusFilter>) => store.set("status", value),
    setText: (value: SetStateAction<string>) => store.set("text", value),
    setFolder: (value: SetStateAction<string>) => store.set("folder", value),
    setTag: (value: SetStateAction<string>) => store.set("tag", value),
    setDueOnly: (value: SetStateAction<boolean>) => store.set("dueOnly", value),
    setShowHidden: (value: SetStateAction<boolean>) => store.set("showHidden", value), resetFilters: store.reset,
  }), [store]);
  return { ...state, ...actions };
}
