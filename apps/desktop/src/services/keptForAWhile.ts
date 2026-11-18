/**
 * A small memory that outlives a reload of the window (A15).
 *
 * The window bus remembers, for a while, which runs of a request that must not
 * run twice already landed (the central window), and which tries ended in "it
 * may still land" (every window). Held only in the page, both were gone when
 * the window loaded again — the central window's reload after an error, a
 * Labs build reloading on a change — and the person's next press ran the
 * request a second time. A window's session storage survives its reloads and
 * ends with the window; that is where this lives. Without it (tests, a page
 * that may not use it) it lives in the module, which a reload does not keep.
 */

interface Entry<V> {
  value: V;
  until: number;
}

const inModule = new Map<string, Map<string, Entry<unknown>>>();

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export interface KeptForAWhile<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
  readonly size: number;
}

/** Entries under `name`, each kept `keepMs` from when it was set. Values must survive JSON. */
export function keptForAWhile<V>(name: string, keepMs: number): KeptForAWhile<V> {
  const storageKey = `plainva.kept.${name}`;
  let entries = inModule.get(storageKey) as Map<string, Entry<V>> | undefined;
  if (!entries) {
    entries = new Map();
    try {
      const raw = storage()?.getItem(storageKey);
      if (raw) for (const [key, entry] of Object.entries(JSON.parse(raw) as Record<string, Entry<V>>)) entries.set(key, entry);
    } catch {
      // silent: an unreadable store starts empty; it only ever spares a second run.
    }
    inModule.set(storageKey, entries as Map<string, Entry<unknown>>);
  }
  const map = entries;
  const drop = () => {
    const now = Date.now();
    for (const [key, entry] of map) if (entry.until <= now) map.delete(key);
  };
  const save = () => {
    try {
      storage()?.setItem(storageKey, JSON.stringify(Object.fromEntries(map)));
    } catch {
      // silent: kept in the module then; a reload forgets it, as before 2026-11-17.
    }
  };
  return {
    get(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (entry.until > Date.now()) return entry.value;
      map.delete(key);
      save();
      return undefined;
    },
    set(key, value) {
      drop();
      map.set(key, { value, until: Date.now() + keepMs });
      save();
    },
    delete(key) {
      if (map.delete(key)) save();
    },
    get size() {
      drop();
      return map.size;
    },
  };
}

/** Test seam — the app never resets this. */
export function resetKeptForAWhileForTest(): void {
  inModule.clear();
  try {
    const s = storage();
    if (s) for (const key of Object.keys(s)) if (key.startsWith("plainva.kept.")) s.removeItem(key);
  } catch {
    // silent: nothing to clear.
  }
}
