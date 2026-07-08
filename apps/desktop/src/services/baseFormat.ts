/**
 * Obsidian-compatible `.base` (de)serialization (ADR 0008, point 10).
 *
 * On disk a `.base` must use ONLY Obsidian's canonical top-level keys
 * (`filters`, `formulas`, `properties`, `views`) so the core "Bases" plugin can
 * open it. Plainva's richness — the per-property input type, curated option sets
 * with colors/groups, relation targets, and the board/calendar/timeline views —
 * is stored under a NAMESPACED `plainva:` sub-key inside `properties[x]` and
 * `views[i]`. Those are places Obsidian documents as open-ended ("it is up to the
 * individual view how to use these configuration values"; plugins "can add
 * additional data"), so Obsidian ignores them (graceful degradation: a Plainva
 * board shows as a plain table) while Plainva reads them for full functionality.
 *
 * The rest of the app keeps using the historical IN-MEMORY shape with bare
 * property names: `config.columns[bareProp] = { input, options, relationBase }`
 * and `config.views[i] = { type, order, sort, dateField, endField, ... }`. This
 * module is the ONLY translation layer:
 *   - `parseBaseConfig` normalizes any on-disk form into that in-memory shape —
 *     the new namespaced format, the Obsidian-native form, AND the legacy
 *     top-level `columns:` written by older Plainva builds (auto-migrated on the
 *     next save).
 *   - `serializeBaseConfig` converts the in-memory shape back to Obsidian-native
 *     YAML.
 * Unknown keys (Obsidian `formulas`, a property's `displayName`, future keys)
 * are preserved verbatim across a parse->serialize round-trip via the pristine
 * raw object retained on `_obsidian`.
 *
 * Obsidian additionally REJECTS the whole file (not just the odd key) when a
 * view has no `name` or when a `filters` object carries more than one of
 * `and`/`or`/`not` side by side. In memory Plainva keeps the flat two-list
 * shape the UI edits (`filters.and` + `filters.or`, semantics: all of `and`
 * AND at least one of `or`), so this module maps it losslessly onto the
 * single-rooted on-disk form `and: [...and, {or: [...or]}]` on save. Files
 * older builds wrote in the invalid two-key form heal themselves on the next
 * save.
 *
 * Since plan Base-Filtergruppen (P8) the entries of those two lists may
 * themselves be one-level {and}/{or} GROUP OBJECTS (Notion-style filter
 * groups) — they round-trip verbatim as list entries. Only ONE parse-time
 * normalization remains from the pre-groups era: a trailing {or: [...]} group
 * inside `and` is lifted back into the flat or-list when that is provably
 * just the serialized form of the old flat or-list (the group holds only
 * source conditions, or everything else in `and` is a source condition).
 * Real property groups the new UI writes stay group entries.
 */

import * as yaml from "yaml";

const NOTE_PREFIX = "note.";

function clone<T>(v: T): T {
  return v == null ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Bare in-memory property name -> Obsidian property id (frontmatter -> note.x; file. and formula. ids kept). */
export function toPropId(bare: string): string {
  if (bare.startsWith("file.") || bare.startsWith("formula.")) return bare;
  return NOTE_PREFIX + bare;
}

/** Obsidian property id -> bare in-memory name. */
export function fromPropId(id: string): string {
  return id.startsWith(NOTE_PREFIX) ? id.slice(NOTE_PREFIX.length) : id;
}

/** View types that map losslessly onto a native Obsidian view type (no `plainva.render` needed). */
const NATIVE_RENDER = new Set(["table", "list", "gallery"]);

/** Same hex shapes the plainva frontmatter namespace accepts (ADR 0009). */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Plainva render type -> the native Obsidian view type Obsidian will accept. */
export function toObsidianViewType(render: string | undefined): string {
  switch (render) {
    case "list":
      return "list";
    case "gallery":
      return "cards";
    case "table":
      return "table";
    // board / calendar / timeline are Plainva-only: degrade to a plain table in Obsidian.
    default:
      return NATIVE_RENDER.has(render ?? "") ? (render as string) : "table";
  }
}

/**
 * Native Obsidian view type -> Plainva render type. Used only when no
 * `plainva.render` is present (Obsidian-authored views, or legacy Plainva files
 * that stored their render type directly in `type`).
 */
export function fromObsidianViewType(type: string | undefined): string {
  switch (type) {
    case "cards":
      return "gallery";
    // Legacy Plainva files stored these directly in `type` (no plainva namespace yet).
    case "board":
    case "calendar":
    case "timeline":
    case "gallery":
    case "list":
      return type;
    case "table":
    default:
      return "table";
  }
}

/**
 * Obsidian requires every view to carry a non-empty string `name` and refuses
 * to open the base otherwise ("'name' in view N is missing or invalid").
 * Fallback for views created without one (wizard, inline base, legacy files):
 * the capitalized Plainva render type, de-duplicated against sibling views.
 */
function fallbackViewName(render: string, taken: Set<string>): string {
  const key = render && typeof render === "string" ? render : "table";
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  let name = label;
  let n = 2;
  while (taken.has(name)) name = `${label} ${n++}`;
  return name;
}

/** Coerce a filter group's value to a list (lenient: a lone string counts as one entry). */
function filterItems(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

/** True for a plain object with exactly the one key `k` — an Obsidian filter group. */
function isSoleGroup(v: any, k: string): boolean {
  return isPlainObject(v) && Object.keys(v).length === 1 && k in v;
}

/** Local mirror of filterExpr.isSourceCondition (kept dependency-free). */
function isSourceString(v: any): boolean {
  return typeof v === "string" && (/file\.folder\s*==/.test(v) || /file\.hasTag\(/.test(v));
}

/** True for an entry the serializer keeps: a non-blank string, or a group
 * object with at least one non-empty and/or/not list (empty group shells the
 * UI left behind are dropped). Unknown object shapes pass through verbatim. */
function keepFilterEntry(v: any): boolean {
  if (typeof v === "string") return v.trim() !== "";
  if (!isPlainObject(v)) return false;
  const keys = ["and", "or", "not"].filter((k) => v[k] != null);
  if (keys.length === 0) return true; // not a group shape — preserve verbatim
  return keys.some((k) => filterItems(v[k]).length > 0);
}

/**
 * On-disk `filters` -> the flat in-memory `{and, or}` lists the UI edits.
 * Group objects among the entries stay entries (Notion-style groups, P8).
 * Also understood: the invalid two-key form older Plainva builds wrote
 * (`and` + `or` side by side) and a bare condition string. A pure `not` root
 * passes through untouched (Plainva has no UI for it; it round-trips
 * verbatim). One legacy normalization: a trailing {or} group inside `and`
 * that is provably the serialized OLD flat or-list (see module header) is
 * lifted back into the flat or-list — semantics are identical either way;
 * this only restores the pre-groups reading (top-level "any" with its
 * source conditions visible to the source editor).
 */
function normalizeFiltersIn(raw: any): any {
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw.trim() ? { and: [raw] } : undefined;
  if (!isPlainObject(raw)) return undefined;
  const hasAnd = raw.and != null;
  const hasOr = raw.or != null;
  const hasNot = raw.not != null;
  if (!hasAnd && !hasOr && !hasNot) return undefined;
  if (!hasAnd && !hasOr) return clone(raw); // pure not-group: opaque passthrough
  const and = filterItems(raw.and);
  let or = filterItems(raw.or);
  // A stray sibling not-group (never written by Plainva) survives as a nested item.
  if (hasNot) and.push({ not: filterItems(raw.not) });
  if (or.length === 0) {
    const liftIdx = and.map((x) => isSoleGroup(x, "or") && Array.isArray(x.or)).lastIndexOf(true);
    if (liftIdx >= 0) {
      const groupItems: any[] = and[liftIdx].or;
      const rest = and.filter((_, i) => i !== liftIdx);
      const groupIsPureSource = groupItems.length > 0 && groupItems.every(isSourceString);
      const restIsPureSource = rest.every(isSourceString);
      if (groupIsPureSource || restIsPureSource) {
        or = groupItems;
        and.splice(liftIdx, 1);
      }
    }
  }
  const out: Record<string, any> = {};
  if (and.length > 0) out.and = and;
  if (or.length > 0) out.or = or;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * In-memory `filters` -> the single-rooted form Obsidian accepts: a filter
 * object must contain EXACTLY ONE of `and`/`or`/`not`. Plainva's query
 * semantics ((all of and) AND (any of or)) map losslessly onto
 * `and: [...and, {or: [...or]}]`; group entries serialize verbatim inside
 * their list. Empty group shells are dropped. Returns undefined when there is
 * nothing to keep (the `filters` key is then omitted).
 */
function normalizeFiltersOut(filters: any): any {
  if (filters == null) return undefined;
  if (typeof filters === "string") return filters.trim() ? filters : undefined;
  if (!isPlainObject(filters)) return undefined;
  const and = filterItems(filters.and).filter(keepFilterEntry);
  const or = filterItems(filters.or).filter(keepFilterEntry);
  const not = filterItems(filters.not).filter(keepFilterEntry);
  const groups: any[] = [];
  if (or.length > 0) groups.push({ or });
  if (not.length > 0) groups.push({ not });
  if (and.length > 0) return { and: [...and, ...groups] };
  if (groups.length === 1) return groups[0];
  if (groups.length > 1) return { and: groups };
  return undefined;
}

/** Normalize a single curated option to `{ value, label?, color?, group? }`. */
function normalizeOption(o: any): Record<string, any> {
  if (typeof o === "string") return { value: o };
  if (isPlainObject(o)) {
    const value = o.value ?? o.label ?? "";
    const opt: Record<string, any> = { value: String(value) };
    if (o.label != null && o.label !== value) opt.label = o.label;
    // `color` is a Plainva palette NAME. Legacy board options used a CSS
    // `backgroundColor` that does not map to a palette -> drop it (the chip
    // colour then falls back to a deterministic value-derived colour).
    if (o.color != null) opt.color = o.color;
    if (o.group != null) opt.group = o.group;
    return opt;
  }
  return { value: "" };
}

/** Normalize an on-disk column/plainva-property schema to the in-memory column shape. */
function normalizeColumn(src: any): Record<string, any> {
  const col: Record<string, any> = {};
  if (!isPlainObject(src)) return col;
  if (src.input != null) col.input = src.input;
  if (Array.isArray(src.options)) col.options = src.options.map(normalizeOption);
  if (src.relationBase != null) col.relationBase = src.relationBase;
  // Cardinality: "one" is the only persisted value; anything else means
  // unlimited and self-heals away on the next save.
  if (src.relationLimit === "one") col.relationLimit = "one";
  if (
    isPlainObject(src.reverseOf) &&
    typeof src.reverseOf.base === "string" && src.reverseOf.base &&
    typeof src.reverseOf.property === "string" && src.reverseOf.property
  ) {
    col.reverseOf = { base: src.reverseOf.base, property: src.reverseOf.property };
  }
  return col;
}

/** Normalize one on-disk view to the in-memory view shape (bare names, Plainva render type). */
function normalizeViewIn(v: any): Record<string, any> {
  if (!isPlainObject(v)) return { type: "table" };
  const pv = isPlainObject(v.plainva) ? v.plainva : {};
  const out: Record<string, any> = {
    type: pv.render ?? fromObsidianViewType(v.type),
  };
  if (v.name != null) out.name = v.name;
  if (Array.isArray(v.order)) out.order = v.order.map((c: any) => fromPropId(String(c)));
  if (Array.isArray(v.sort)) {
    out.sort = v.sort
      .filter((s: any) => isPlainObject(s))
      .map((s: any) => ({ property: fromPropId(String(s.property ?? s.field ?? "")), direction: s.direction ?? "ASC" }));
  }
  // Per-view filters (Obsidian-native views[i].filters): property rules that
  // apply to this view only; folder/tag sources stay in the file-level filters.
  const viewFilters = normalizeFiltersIn(v.filters);
  if (viewFilters !== undefined) out.filters = viewFilters;
  // Plainva view extras live under `plainva`; legacy files stored them at the view top level.
  const dateField = pv.dateField ?? v.dateField;
  const endField = pv.endField ?? v.endField;
  const groupBy = pv.groupBy ?? v.groupBy;
  const coverImage = pv.coverImage ?? v.coverImage;
  const widths = pv.widths ?? v.widths;
  const dateFormat = pv.dateFormat ?? v.dateFormat;
  if (dateField != null) out.dateField = dateField;
  if (endField != null) out.endField = endField;
  if (groupBy != null) out.groupBy = groupBy;
  if (coverImage != null) out.coverImage = coverImage;
  if (isPlainObject(widths)) out.widths = widths;
  if (dateFormat != null) out.dateFormat = dateFormat;
  // Sub-items (namespace-only, the key never existed at the view top level).
  if (typeof pv.subItemsProperty === "string" && pv.subItemsProperty) {
    out.subItemsProperty = pv.subItemsProperty;
  }
  // Graph view options (namespace-only, plan Graph P8).
  if (Array.isArray(pv.graphEdges)) out.graphEdges = pv.graphEdges.map((x: any) => String(x));
  if (typeof pv.graphColorBy === "string" && pv.graphColorBy) out.graphColorBy = pv.graphColorBy;
  if (typeof pv.graphSizeBy === "string" && pv.graphSizeBy) out.graphSizeBy = pv.graphSizeBy;
  if (pv.graphShowExternal === true) out.graphShowExternal = true;
  if (pv.graphShowIncoming === true) out.graphShowIncoming = true;
  // Board column order (namespace-only, plan Board-Reorder 2026-07-07).
  if (Array.isArray(pv.boardColumnOrder)) out.boardColumnOrder = pv.boardColumnOrder.map((x: any) => String(x));
  return out;
}

/**
 * Parse `.base` text into the in-memory config shape used across the app.
 * Carries unknown top-level keys through and stashes a pristine copy on
 * `_obsidian` for lossless round-tripping.
 */
export function parseBaseConfig(text: string): any {
  const raw = text && text.trim() ? yaml.parse(text) : {};
  if (!isPlainObject(raw)) return { columns: {}, views: [], _obsidian: {} };

  const config: Record<string, any> = { ...raw };
  config._obsidian = clone(raw);

  // Columns: merge the legacy top-level `columns:` map with the new
  // `properties[x].plainva` namespace (the namespace wins on conflict).
  const columns: Record<string, any> = {};
  if (isPlainObject(raw.columns)) {
    for (const k of Object.keys(raw.columns)) columns[fromPropId(k)] = normalizeColumn(raw.columns[k]);
  }
  if (isPlainObject(raw.properties)) {
    for (const id of Object.keys(raw.properties)) {
      const p = raw.properties[id];
      if (isPlainObject(p) && isPlainObject(p.plainva)) columns[fromPropId(id)] = normalizeColumn(p.plainva);
    }
  }
  config.columns = columns;

  config.views = Array.isArray(raw.views) ? raw.views.map(normalizeViewIn) : [];

  // File-level presentation & authoring state: the database-icon tint (Base-UX2
  // P7) and the new-item defaults (plan Base-Neu P1: storage folder + default
  // template) live under `views[i].plainva.*` — one of the tolerated extension
  // slots. A NEW top-level key would make Obsidian reject the whole file
  // (ADR 0008, the `columns:` incident). First valid value wins per key.
  delete config.iconColor;
  delete config.newItemFolder;
  delete config.newItemTemplate;
  delete config.contextFilters;
  for (const v of Array.isArray(raw.views) ? raw.views : []) {
    const pv = isPlainObject(v) && isPlainObject(v.plainva) ? v.plainva : null;
    if (!pv) continue;
    if (config.iconColor === undefined && typeof pv.fileIconColor === "string" && HEX_COLOR_RE.test(pv.fileIconColor)) {
      config.iconColor = pv.fileIconColor;
    }
    if (config.newItemFolder === undefined && typeof pv.newItemFolder === "string" && pv.newItemFolder.trim()) {
      config.newItemFolder = pv.newItemFolder;
    }
    if (config.newItemTemplate === undefined && typeof pv.newItemTemplate === "string" && pv.newItemTemplate.trim()) {
      config.newItemTemplate = pv.newItemTemplate;
    }
    // Self-reference filters ("Diese Notiz") — Obsidian ignores them; Plainva
    // resolves them against the embedding host at render time (embedScope).
    if (config.contextFilters === undefined && Array.isArray(pv.contextFilters)) {
      const list = pv.contextFilters.filter((x: any): x is string => typeof x === "string" && !!x);
      if (list.length > 0) config.contextFilters = list;
    }
  }

  const filters = normalizeFiltersIn(raw.filters);
  if (filters !== undefined) config.filters = filters;
  else delete config.filters;

  return config;
}

/**
 * Serialize the in-memory config to Obsidian-native `.base` YAML: native
 * top-level keys only, Plainva richness under `properties[x].plainva` /
 * `views[i].plainva`. Preserves unknown keys captured on `_obsidian`.
 */
export function serializeBaseConfig(config: any): string {
  const src = isPlainObject(config) ? config : {};
  const out: Record<string, any> = isPlainObject(src._obsidian) ? clone(src._obsidian) : {};
  delete out._obsidian;
  // Drop the legacy top-level columns map — its data now lives under properties[x].plainva.
  delete out.columns;

  // --- properties ---
  const props: Record<string, any> = isPlainObject(out.properties) ? out.properties : {};
  const columns = isPlainObject(src.columns) ? src.columns : {};
  for (const bare of Object.keys(columns)) {
    const col = columns[bare] ?? {};
    const id = toPropId(bare);
    const entry = isPlainObject(props[id]) ? props[id] : {};
    const plainva: Record<string, any> = {};
    if (col.input != null) plainva.input = col.input;
    if (Array.isArray(col.options)) plainva.options = col.options.map(normalizeOption);
    if (col.relationBase != null) plainva.relationBase = col.relationBase;
    if (col.relationLimit === "one") plainva.relationLimit = "one";
    if (isPlainObject(col.reverseOf) && col.reverseOf.base && col.reverseOf.property) {
      plainva.reverseOf = { base: col.reverseOf.base, property: col.reverseOf.property };
    }
    if (Object.keys(plainva).length > 0) entry.plainva = plainva;
    else delete entry.plainva;
    props[id] = entry;
  }
  if (Object.keys(props).length > 0) out.properties = props;
  else delete out.properties;

  // --- views ---
  const prevViews: any[] = Array.isArray(out.views) ? out.views : [];
  // Obsidian refuses a base without views — never write an empty list.
  const views: any[] = Array.isArray(src.views) && src.views.length > 0 ? src.views : [{ type: "table" }];
  // Names already present (in memory or on disk) count as taken so synthesized
  // fallbacks stay unique; user-given names are never rewritten.
  const takenNames = new Set<string>();
  views.forEach((v: any, i: number) => {
    const nm = v?.name ?? (isPlainObject(prevViews[i]) ? prevViews[i].name : undefined);
    if (nm != null && String(nm).trim()) takenNames.add(String(nm));
  });
  out.views = views.map((v: any, i: number) => {
    const base: Record<string, any> = isPlainObject(prevViews[i]) ? clone(prevViews[i]) : {};
    const render = v?.type ?? "table";
    base.type = toObsidianViewType(render);
    // Every view MUST carry a non-empty string name (Obsidian rejects the file
    // otherwise): keep the in-memory name, else the previous on-disk name,
    // else synthesize one from the render type.
    const given = v?.name != null && String(v.name).trim() ? String(v.name)
      : base.name != null && String(base.name).trim() ? String(base.name)
      : null;
    if (given) base.name = given;
    else {
      base.name = fallbackViewName(render, takenNames);
      takenNames.add(base.name);
    }
    if (Array.isArray(v?.order)) base.order = v.order.map((c: any) => toPropId(String(c)));
    else delete base.order;
    if (Array.isArray(v?.sort)) {
      base.sort = v.sort
        .filter((s: any) => isPlainObject(s))
        .map((s: any) => ({ property: toPropId(String(s.property ?? s.field ?? "")), direction: s.direction ?? "ASC" }));
    } else delete base.sort;

    const pv: Record<string, any> = isPlainObject(base.plainva) ? base.plainva : {};
    // Only carry a render hint when the native type is lossy (board/calendar/timeline).
    if (!NATIVE_RENDER.has(render)) pv.render = render;
    else delete pv.render;
    if (v?.dateField != null) pv.dateField = v.dateField;
    else delete pv.dateField;
    if (v?.endField != null) pv.endField = v.endField;
    else delete pv.endField;
    if (v?.groupBy != null) pv.groupBy = v.groupBy;
    else delete pv.groupBy;
    if (v?.coverImage != null) pv.coverImage = v.coverImage;
    else delete pv.coverImage;
    if (isPlainObject(v?.widths) && Object.keys(v.widths).length > 0) pv.widths = v.widths;
    else delete pv.widths;
    // "default" is the implicit value — keep the file free of redundant keys.
    if (v?.dateFormat != null && v.dateFormat !== "default") pv.dateFormat = v.dateFormat;
    else delete pv.dateFormat;
    if (typeof v?.subItemsProperty === "string" && v.subItemsProperty) pv.subItemsProperty = v.subItemsProperty;
    else delete pv.subItemsProperty;
    // Graph view options (plan Graph P8) — written only when set, so files
    // of other view types stay byte-identical.
    if (Array.isArray(v?.graphEdges) && v.graphEdges.length > 0) pv.graphEdges = v.graphEdges.map((x: any) => String(x));
    else delete pv.graphEdges;
    if (typeof v?.graphColorBy === "string" && v.graphColorBy) pv.graphColorBy = v.graphColorBy;
    else delete pv.graphColorBy;
    if (typeof v?.graphSizeBy === "string" && v.graphSizeBy) pv.graphSizeBy = v.graphSizeBy;
    else delete pv.graphSizeBy;
    if (v?.graphShowExternal === true) pv.graphShowExternal = true;
    else delete pv.graphShowExternal;
    if (v?.graphShowIncoming === true) pv.graphShowIncoming = true;
    else delete pv.graphShowIncoming;
    // Board column order (plan Board-Reorder 2026-07-07) — per-view layout for
    // relation/text boards; select/status boards reorder their options instead.
    if (Array.isArray(v?.boardColumnOrder) && v.boardColumnOrder.length > 0) pv.boardColumnOrder = v.boardColumnOrder.map((x: any) => String(x));
    else delete pv.boardColumnOrder;
    // The file-level keys (icon tint P7, new-item folder/template P1) are
    // stamped onto the FIRST view only and scrubbed from the rest so
    // reorders/deletes never leave stale duplicates.
    const iconColor = typeof src.iconColor === "string" && HEX_COLOR_RE.test(src.iconColor) ? src.iconColor : null;
    if (i === 0 && iconColor) pv.fileIconColor = iconColor;
    else delete pv.fileIconColor;
    const newItemFolder = typeof src.newItemFolder === "string" && src.newItemFolder.trim() ? src.newItemFolder : null;
    if (i === 0 && newItemFolder) pv.newItemFolder = newItemFolder;
    else delete pv.newItemFolder;
    const newItemTemplate = typeof src.newItemTemplate === "string" && src.newItemTemplate.trim() ? src.newItemTemplate : null;
    if (i === 0 && newItemTemplate) pv.newItemTemplate = newItemTemplate;
    else delete pv.newItemTemplate;
    const contextFilters = Array.isArray(src.contextFilters)
      ? src.contextFilters.filter((x: any) => typeof x === "string" && x)
      : [];
    if (i === 0 && contextFilters.length > 0) pv.contextFilters = contextFilters;
    else delete pv.contextFilters;
    if (Object.keys(pv).length > 0) base.plainva = pv;
    else delete base.plainva;
    // Per-view filters (native): overwrite the cloned on-disk value with the
    // current in-memory view filters (single-rooted for Obsidian).
    const outViewFilters = normalizeFiltersOut(v?.filters);
    if (outViewFilters !== undefined) base.filters = outViewFilters;
    else delete base.filters;
    return base;
  });

  // --- filters (single-rooted and/or/not form; invalid legacy shapes heal here) ---
  const filters = normalizeFiltersOut(src.filters);
  if (filters !== undefined) out.filters = filters;
  else delete out.filters;

  return yaml.stringify(out);
}
