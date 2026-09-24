import type { ISettingsStore } from "@plainva/ui";

/**
 * A settings store that answers like the desktop's real one (finding
 * 2026-09-24).
 *
 * The desktop store lives in Rust. `serde_json` without `preserve_order` keeps
 * every object in a sorted map, so a value comes back with its keys in
 * alphabetical order at every level — `{ id, label, host }` is read back as
 * `{ host, id, label }`. The in-memory maps the tests used before kept the
 * insertion order, and a whole class of read-back checks that compared JSON
 * text passed every test while failing every real desktop.
 *
 * Deliberately written without `storedJson`, so the store does not share an
 * implementation with the code it checks.
 */
export function serdeOrdered<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map((item) => (item === undefined ? null : walk(item)));
    if (v === null || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v).sort()) {
      const item = (v as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = walk(item);
    }
    return out;
  };
  return walk(JSON.parse(JSON.stringify(value) ?? "null")) as T;
}

export interface SerdeSettingsStore extends ISettingsStore {
  /** The raw map, for assertions. Values are held in serde order. */
  values: Map<string, unknown>;
  /** Makes the next `save()` throw once — a disk that refuses the write. */
  failNextSave(): void;
}

/** In-memory `ISettingsStore` with the desktop's key order. */
export function createSerdeSettingsStore(): SerdeSettingsStore {
  const values = new Map<string, unknown>();
  let failSave = false;
  return {
    values,
    failNextSave: () => { failSave = true; },
    get: async <T,>(key: string) => (values.has(key) ? serdeOrdered(values.get(key)) as T : undefined),
    set: async (key: string, value: unknown) => { values.set(key, serdeOrdered(value)); },
    delete: async (key: string) => values.delete(key),
    keys: async () => [...values.keys()],
    save: async () => {
      if (failSave) {
        failSave = false;
        throw new Error("disk full");
      }
    },
  } as SerdeSettingsStore;
}
