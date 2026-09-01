import { MAX_PREVIOUS_KEYS } from "./baseFormat";
import { parsePropertyFilter, serializePropertyFilter } from "./filterExpr";

// Pure config side of renaming a `.base` property (Base-UX2 follow-up): every
// place the in-memory config references the old bare name moves to the new one
// — the columns schema, each view's order/sort/layout fields, the editable
// property-filter strings (bare and `note.`-prefixed) and the raw
// `_obsidian.properties` entry (so Obsidian extras like displayName follow and
// serializeBaseConfig cannot resurrect a ghost column from the stale key).
// The frontmatter rewrite in the notes themselves is the caller's job.
export function renamePropertyInConfig(config: any, oldName: string, newName: string, schema?: any): any {
  const nc = config == null ? {} : JSON.parse(JSON.stringify(config));

  // Columns map: move the schema; an explicitly passed schema (from the column
  // editor's pending edits) wins over the stored one.
  if (!nc.columns || Array.isArray(nc.columns)) nc.columns = {};
  const moved = schema !== undefined ? schema : nc.columns[oldName];
  delete nc.columns[oldName];
  if (moved !== undefined) nc.columns[newName] = withPreviousKey(moved, oldName, newName);

  // Views: order, sort and the layout fields that address a property by name.
  if (Array.isArray(nc.views)) {
    nc.views = nc.views.map((v: any) => {
      if (!v || typeof v !== "object") return v;
      const nv = { ...v };
      if (Array.isArray(nv.order)) nv.order = nv.order.map((c: any) => (c === oldName ? newName : c));
      if (Array.isArray(nv.sort)) {
        nv.sort = nv.sort.map((s: any) =>
          s && typeof s === "object" && (s.property ?? s.field) === oldName ? { ...s, property: newName } : s
        );
      }
      for (const key of ["groupBy", "dateField", "endField", "coverImage", "subItemsProperty"] as const) {
        if (nv[key] === oldName) nv[key] = newName;
      }
      if (nv.widths && typeof nv.widths === "object" && oldName in nv.widths) {
        const w = { ...nv.widths };
        w[newName] = w[oldName];
        delete w[oldName];
        nv.widths = w;
      }
      return nv;
    });
  }

  // Editable property-filter strings; the prefix style of the raw target is
  // kept. Group entries (plan Base-Filtergruppen) map their items recursively;
  // other nested Obsidian filter shapes stay untouched (not editable here).
  const mapFilter = (f: any): any => {
    if (f && typeof f === "object" && !Array.isArray(f)) {
      const nf: any = { ...f };
      for (const key of ["and", "or", "not"] as const) {
        if (Array.isArray(nf[key])) nf[key] = nf[key].map(mapFilter);
      }
      return nf;
    }
    if (typeof f !== "string") return f;
    const rule = parsePropertyFilter(f);
    if (!rule) return f;
    const bare = rule.column.replace(/^note\./, "");
    if (bare !== oldName) return f;
    const prefix = rule.column.startsWith("note.") ? "note." : "";
    return serializePropertyFilter({ ...rule, column: prefix + newName });
  };
  if (Array.isArray(nc.filters?.and)) nc.filters.and = nc.filters.and.map(mapFilter);
  if (Array.isArray(nc.filters?.or)) nc.filters.or = nc.filters.or.map(mapFilter);
  // Per-view filters (views[i].filters, plan Per-View-Filter 2026-07-07) hold
  // the property rules since the migration — rename them too.
  if (Array.isArray(nc.views)) {
    nc.views = nc.views.map((v: any) =>
      v && typeof v === "object" && v.filters != null ? { ...v, filters: mapFilter(v.filters) } : v
    );
  }

  // Raw Obsidian property entry (displayName etc.): rename the id key.
  const rawProps = nc._obsidian?.properties;
  if (rawProps && typeof rawProps === "object" && !Array.isArray(rawProps)) {
    const oldId = `note.${oldName}`;
    const newId = `note.${newName}`;
    if (oldId in rawProps) {
      if (!(newId in rawProps)) rawProps[newId] = rawProps[oldId];
      delete rawProps[oldId];
    }
  }

  return nc;
}

/**
 * Records the former name on the moved column so a comment anchored to that
 * property can still find it (plan Stufe E, section 5: "Der Anker zieht mit").
 *
 * The trail has to live HERE, in the `.base` file, and not in the comment
 * record: a comment is sealed and immutable, so nothing can rewrite its anchor,
 * and a purely local migration of the stored anchor would leave every other
 * device showing the same comment as orphaned - a silent divergence that is
 * worse than orphaning it everywhere. The `.base` file is the one place that
 * already changes during a rename, reaches every device through the ordinary
 * sync, is invisible to Obsidian (it rides in the `plainva` namespace) and is
 * written by both shells through this shared helper.
 *
 * Renaming back to a former name drops that entry rather than leaving a
 * self-alias behind, and the list is capped so a column that gets renamed for
 * years does not grow without bound - the oldest name falls off first.
 */
function withPreviousKey(column: any, oldName: string, newName: string): any {
  if (column == null || typeof column !== "object" || Array.isArray(column)) return column;
  const existing = Array.isArray(column.previousKeys) ? column.previousKeys.filter((k: any) => typeof k === "string" && k) : [];
  const kept = existing.filter((k: string) => k !== oldName && k !== newName);
  const previousKeys = [...kept, oldName].slice(-MAX_PREVIOUS_KEYS);
  return { ...column, previousKeys };
}

/**
 * Reads the rename trail back: which column claims a former key today.
 *
 * The counterpart to `withPreviousKey`, kept in the same file so writer and
 * reader cannot drift apart. `resolvePropertyAnchor` in the core takes this as
 * its `aliasOf` and walks the chain, so a column renamed twice through two
 * different `.base` files still leads back to a live key.
 *
 * A former name that two columns both claim is ambiguous, and the honest answer
 * is none: pointing a comment at an arbitrary one of them would attach it to a
 * property its author never saw.
 */
export function propertyAliasResolver(configs: readonly any[]): (former: string) => string | null {
  const byFormer = new Map<string, string | null>();
  for (const config of configs) {
    const columns = config?.columns;
    if (!columns || typeof columns !== "object" || Array.isArray(columns)) continue;
    for (const [name, column] of Object.entries(columns)) {
      const previous = (column as any)?.previousKeys;
      if (!Array.isArray(previous)) continue;
      for (const former of previous) {
        if (typeof former !== "string" || !former || former === name) continue;
        const seen = byFormer.get(former);
        // `undefined` = unseen, `null` = seen twice with different answers.
        byFormer.set(former, seen === undefined || seen === name ? name : null);
      }
    }
  }
  return (former: string) => byFormer.get(former) ?? null;
}

/** True when the name is usable as a fresh bare property name in this base. */
export function isValidNewPropertyName(name: string, existingColumns: string[], currentName: string): boolean {
  const n = name.trim();
  if (!n || n === currentName) return false;
  if (n.startsWith("file.") || n.startsWith("formula.") || n.startsWith("note.")) return false;
  return !existingColumns.includes(n);
}
