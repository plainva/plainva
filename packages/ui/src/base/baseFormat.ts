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
 * raw object retained on `_obsidian` — the whole file on the config, and each
 * view's own copy on that view, so its native keys follow it when views are
 * deleted, moved or duplicated. The serializer writes anew only what differs
 * from what the file reads as; an unchanged value keeps the file's spelling.
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
import { normalizeRollup, serializeRollup } from "@plainva/core";

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
  // Copies: the input is the file's pristine copy too, which the serializer
  // compares against later — reading it must never change it.
  const and = [...filterItems(raw.and)];
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
  // A rating's scale and glyph (plan Journal-Erweiterungen, X6). Out-of-range
  // values are clamped where the marks are drawn, not here: a `.base` written
  // by hand must not lose its column over a typo.
  if (typeof src.ratingMax === "number" && Number.isFinite(src.ratingMax)) col.ratingMax = src.ratingMax;
  if (typeof src.ratingGlyph === "string" && src.ratingGlyph.trim()) col.ratingGlyph = src.ratingGlyph;
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
  // Rollup: a value derived from the linked notes, computed at query time and
  // stored nowhere. A malformed spec is dropped (the column then has no
  // values) rather than thrown on — a `.base` from a newer Plainva must never
  // keep the database from opening.
  const rollup = normalizeRollup(src.rollup);
  if (rollup) col.rollup = rollup;
  const previousKeys = normalizePreviousKeys(src.previousKeys);
  if (previousKeys) col.previousKeys = previousKeys;
  return col;
}

/** How many former names a column remembers before the oldest falls off. */
export const MAX_PREVIOUS_KEYS = 8;

/**
 * Former bare names of this property, oldest first (plan Stufe E, section 5).
 *
 * A comment can be anchored to a frontmatter key, and a comment is sealed - its
 * anchor can never be rewritten. So the rename trail travels here, in the file
 * that already changes during a rename and reaches every device through the
 * ordinary sync. It rides in the `plainva` namespace, so Obsidian never sees it.
 */
function normalizePreviousKeys(src: any): string[] | null {
  if (!Array.isArray(src)) return null;
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const raw of src) {
    if (typeof raw !== "string") continue;
    const key = raw.trim();
    // A hand-edited file can say anything; keep the list bounded and free of
    // duplicates rather than trusting what arrives.
    if (!key || seen.has(key) || keys.length >= MAX_PREVIOUS_KEYS) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys.length > 0 ? keys : null;
}

/** The bare property name of Obsidian's `groupBy: { property, direction }`, or undefined. */
function nativeGroupProperty(g: Record<string, any>): string | undefined {
  return typeof g.property === "string" && g.property.trim() ? fromPropId(g.property) : undefined;
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
  // Column summaries (Obsidian-native views[i].summaries): a footer value per
  // column. Native on both sides, so a summary set in Obsidian shows up here
  // and vice versa. Keys are property ids on disk, bare names in memory.
  if (isPlainObject(v.summaries)) {
    const sums: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.summaries)) {
      if (typeof val === "string" && val) sums[fromPropId(String(k))] = val;
    }
    if (Object.keys(sums).length > 0) out.summaries = sums;
  }
  // Per-view filters (Obsidian-native views[i].filters): property rules that
  // apply to this view only; folder/tag sources stay in the file-level filters.
  const viewFilters = normalizeFiltersIn(v.filters);
  if (viewFilters !== undefined) out.filters = viewFilters;
  // Plainva view extras live under `plainva`; legacy files stored them at the view top level.
  const dateField = pv.dateField ?? v.dateField;
  const endField = pv.endField ?? v.endField;
  // Obsidian's own `groupBy` is `{ property, direction }` with a property id;
  // in memory the grouping is the bare property name, whichever key holds it
  // (a legacy Plainva file kept the bare name at the view top level).
  const groupBy = pv.groupBy ?? (isPlainObject(v.groupBy) ? nativeGroupProperty(v.groupBy) : v.groupBy);
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
  // Board color mode (namespace-only, WP3): "column" tints the whole column in
  // the group's color; "chip" (default) only colors the header chip.
  if (pv.boardColorMode === "column") out.boardColorMode = "column";
  // Board swimlanes (namespace-only, issue #83): the second grouping property.
  if (typeof pv.boardLaneBy === "string" && pv.boardLaneBy) out.boardLaneBy = pv.boardLaneBy;
  // Board WIP limits (namespace-only, issue #83): column key -> most cards the
  // column should hold. Only positive integers survive the read.
  if (isPlainObject(pv.boardWipLimits)) {
    const limits: Record<string, number> = {};
    for (const [k, v] of Object.entries(pv.boardWipLimits as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isInteger(n) && n > 0) limits[k] = n;
    }
    if (Object.keys(limits).length > 0) out.boardWipLimits = limits;
  }
  // Timeline bar colour (namespace-only, S21): the column whose value decides a
  // bar's colour. Obsidian has no timeline, so this can only live here.
  if (typeof pv.colorBy === "string" && pv.colorBy) out.colorBy = pv.colorBy;
  // Pinboard options (namespace-only, plan Pinboard P1): manual card order
  // (vault-relative paths), the pinned subset (its list order IS the pinned
  // section's order) and the label-chip source ("tags" default stays unwritten).
  if (Array.isArray(pv.pinboardOrder)) out.pinboardOrder = pv.pinboardOrder.map((x: any) => String(x));
  if (Array.isArray(pv.pinboardPinned)) out.pinboardPinned = pv.pinboardPinned.map((x: any) => String(x));
  if (typeof pv.pinboardFilterBy === "string" && pv.pinboardFilterBy) out.pinboardFilterBy = pv.pinboardFilterBy;
  return out;
}

/**
 * The key under which every parsed in-memory view keeps its pristine on-disk
 * copy (the same name the config uses for the whole file). Spreads and JSON
 * clones of a view carry it along, so a duplicated view keeps its source's
 * native keys and a new view starts without anybody's.
 */
const VIEW_RAW = "_obsidian";

/** The in-memory names of the file-wide options stored in the first view's `plainva` block. */
const FILE_WIDE_KEYS = ["iconColor", "newItemFolder", "newItemTemplate", "taskList", "contextFilters"] as const;

/** The file-wide options as on-disk views carry them: the first valid value of each key wins. */
function readFileWide(views: any[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const v of views) {
    const pv = isPlainObject(v) && isPlainObject(v.plainva) ? v.plainva : null;
    if (!pv) continue;
    if (out.iconColor === undefined && typeof pv.fileIconColor === "string" && HEX_COLOR_RE.test(pv.fileIconColor)) {
      out.iconColor = pv.fileIconColor;
    }
    if (out.newItemFolder === undefined && typeof pv.newItemFolder === "string" && pv.newItemFolder.trim()) {
      out.newItemFolder = pv.newItemFolder;
    }
    if (out.newItemTemplate === undefined && typeof pv.newItemTemplate === "string" && pv.newItemTemplate.trim()) {
      out.newItemTemplate = pv.newItemTemplate;
    }
    // Which provider list a task created here also goes to (C4/S15). Absent
    // means absent: the task stays a note, as it does today.
    if (out.taskList === undefined && typeof pv.taskList === "string" && pv.taskList.trim()) {
      out.taskList = pv.taskList;
    }
    // Self-reference filters ("Diese Notiz") — Obsidian ignores them; Plainva
    // resolves them against the embedding host at render time (embedScope).
    if (out.contextFilters === undefined && Array.isArray(pv.contextFilters)) {
      const list = pv.contextFilters.filter((x: any): x is string => typeof x === "string" && !!x);
      if (list.length > 0) out.contextFilters = list;
    }
  }
  return out;
}

/** The file-wide options of an in-memory config, by the rules `readFileWide` reads them back with. */
function wantedFileWide(src: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  if (typeof src.iconColor === "string" && HEX_COLOR_RE.test(src.iconColor)) out.iconColor = src.iconColor;
  for (const key of ["newItemFolder", "newItemTemplate", "taskList"] as const) {
    if (typeof src[key] === "string" && src[key].trim()) out[key] = src[key];
  }
  const list = Array.isArray(src.contextFilters) ? src.contextFilters.filter((x: any) => typeof x === "string" && x) : [];
  if (list.length > 0) out.contextFilters = list;
  return out;
}

/** Structural equality of two YAML-shaped values; key order and `undefined`-valued keys do not count. */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameData(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).filter((k) => (a as any)[k] !== undefined);
    const kb = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => sameData((a as any)[k], (b as any)[k]));
  }
  return false;
}

/** Put `key` of `target` back to what `source` holds — the value verbatim, or absent. */
function restoreKey(target: Record<string, any>, source: Record<string, any> | null, key: string): void {
  if (source && key in source) target[key] = clone(source[key]);
  else delete target[key];
}

/**
 * True when Obsidian accepts this `filters` value as it stands: absent, a
 * condition string, or an object with exactly one of `and`/`or`/`not`. Older
 * Plainva builds wrote `and` and `or` side by side, which Obsidian rejects —
 * those are rewritten on save even when unchanged.
 */
function isValidFilterRoot(f: unknown): boolean {
  if (f == null || typeof f === "string") return true;
  if (!isPlainObject(f)) return false;
  const keys = Object.keys(f);
  return keys.length === 1 && (keys[0] === "and" || keys[0] === "or" || keys[0] === "not");
}

/** View types this module reads by name; any other `type` is unknown to Plainva and kept as written. */
const KNOWN_VIEW_TYPES = new Set(["table", "list", "cards", "gallery", "board", "calendar", "timeline"]);

/** The keys of a column's `plainva` block this module reads and writes. */
const COLUMN_KEYS = [
  "input", "ratingMax", "ratingGlyph", "options", "relationBase", "relationLimit", "reverseOf", "rollup", "previousKeys",
] as const;

/** The keys of a view's `plainva` block that hold one in-memory key of the same name. */
const VIEW_PLAINVA_KEYS = [
  "dateField", "endField", "coverImage", "widths", "dateFormat", "subItemsProperty",
  "graphEdges", "graphColorBy", "graphSizeBy", "graphShowExternal", "graphShowIncoming",
  "boardColumnOrder", "boardColorMode", "boardLaneBy", "boardWipLimits", "colorBy",
  "pinboardOrder", "pinboardPinned", "pinboardFilterBy",
] as const;

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

  // Each view carries its own pristine on-disk copy, so the keys Plainva does
  // not edit (`limit`, `image`, a plugin's settings, an unknown `type`) stay
  // with THEIR view when views are deleted, moved or duplicated — keyed to the
  // view, never to its position in the list.
  config.views = Array.isArray(raw.views)
    ? raw.views.map((v: any) => {
        const view = normalizeViewIn(v);
        if (isPlainObject(v)) view[VIEW_RAW] = clone(v);
        return view;
      })
    : [];

  // File-level presentation & authoring state: the database-icon tint (Base-UX2
  // P7) and the new-item defaults (plan Base-Neu P1: storage folder + default
  // template) live under `views[i].plainva.*` — one of the tolerated extension
  // slots. A NEW top-level key would make Obsidian reject the whole file
  // (ADR 0008, the `columns:` incident). First valid value wins per key.
  for (const key of FILE_WIDE_KEYS) delete config[key];
  Object.assign(config, readFileWide(Array.isArray(raw.views) ? raw.views : []));

  const filters = normalizeFiltersIn(raw.filters);
  if (filters !== undefined) config.filters = filters;
  else delete config.filters;

  return config;
}

/** The property id under which the file keeps this bare column (`note.x`, or a bare id a hand-written file used). */
function rawPropertyId(props: Record<string, any>, bare: string): string {
  const id = toPropId(bare);
  if (id in props) return id;
  for (const k of Object.keys(props)) if (fromPropId(k) === bare) return k;
  return id;
}

/** The legacy top-level `columns:` entry an old build wrote for this column, if any (the last one wins, as on read). */
function legacyColumnEntry(legacy: Record<string, any>, bare: string): Record<string, any> | null {
  let found: Record<string, any> | null = null;
  for (const k of Object.keys(legacy)) {
    if (fromPropId(k) === bare && isPlainObject(legacy[k])) found = legacy[k];
  }
  return found;
}

/** One view written for disk, before the file-wide options are settled across all views. */
interface WrittenView {
  base: Record<string, any>;
  pv: Record<string, any>;
  rawPv: Record<string, any> | null;
}

/**
 * One in-memory view -> its on-disk form. Starts from the view's own on-disk
 * copy (never from whatever view once stood at the same index) and writes
 * anew only the keys whose in-memory value differs from what that copy reads
 * as; an unchanged key keeps the file's spelling.
 */
function serializeView(v: any, takenNames: Set<string>): WrittenView {
  const raw: Record<string, any> | null = isPlainObject(v?.[VIEW_RAW]) ? v[VIEW_RAW] : null;
  const rawPv = raw && isPlainObject(raw.plainva) ? raw.plainva : null;
  const was = raw ? normalizeViewIn(raw) : null;
  const unchanged = (key: string): boolean => was !== null && sameData(v?.[key], was[key]);
  const base: Record<string, any> = raw ? clone(raw) : {};
  const pv: Record<string, any> = isPlainObject(base.plainva) ? base.plainva : {};
  const render = v?.type ?? "table";

  // A type Plainva does not know (a plugin's view, a future Obsidian type) is
  // shown as a table and stays as written until the user picks another type.
  if (!(raw && unchanged("type") && typeof raw.type === "string" && !KNOWN_VIEW_TYPES.has(raw.type))) {
    base.type = toObsidianViewType(render);
    // Only carry a render hint when the native type is lossy (board/calendar/timeline).
    if (!NATIVE_RENDER.has(render)) pv.render = render;
    else delete pv.render;
  }
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
  if (isPlainObject(v?.summaries) && Object.keys(v.summaries).length > 0) {
    const sums: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.summaries as Record<string, unknown>)) {
      if (typeof val === "string" && val) sums[toPropId(String(k))] = val;
    }
    if (Object.keys(sums).length > 0) base.summaries = sums;
    else delete base.summaries;
  } else delete base.summaries;
  for (const key of ["order", "sort", "summaries"]) if (unchanged(key)) restoreKey(base, raw, key);

  if (v?.dateField != null) pv.dateField = v.dateField;
  else delete pv.dateField;
  if (v?.endField != null) pv.endField = v.endField;
  else delete pv.endField;
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
  // Board color mode (WP3) — only "column" is stored; "chip" is the default
  // and elided so files without the feature stay byte-identical.
  if (v?.boardColorMode === "column") pv.boardColorMode = "column";
  else delete pv.boardColorMode;
  if (typeof v?.boardLaneBy === "string" && v.boardLaneBy) pv.boardLaneBy = v.boardLaneBy;
  else delete pv.boardLaneBy;
  // Board WIP limits (issue #83) — written only when at least one is set.
  const wip = isPlainObject(v?.boardWipLimits)
    ? Object.fromEntries(Object.entries(v.boardWipLimits as Record<string, unknown>).filter(([, n]) => Number.isInteger(Number(n)) && Number(n) > 0).map(([k, n]) => [k, Number(n)]))
    : {};
  if (Object.keys(wip).length > 0) pv.boardWipLimits = wip;
  else delete pv.boardWipLimits;
  if (typeof v?.colorBy === "string" && v.colorBy) pv.colorBy = v.colorBy;
  else delete pv.colorBy;
  // Pinboard options (plan Pinboard P1) — written only when set so files of
  // other view types stay byte-identical. "tags" is the implicit filter
  // default and elided; empty order/pinned lists mean "not arranged yet".
  if (Array.isArray(v?.pinboardOrder) && v.pinboardOrder.length > 0) pv.pinboardOrder = v.pinboardOrder.map((x: any) => String(x));
  else delete pv.pinboardOrder;
  if (Array.isArray(v?.pinboardPinned) && v.pinboardPinned.length > 0) pv.pinboardPinned = v.pinboardPinned.map((x: any) => String(x));
  else delete pv.pinboardPinned;
  if (typeof v?.pinboardFilterBy === "string" && v.pinboardFilterBy && v.pinboardFilterBy !== "tags") pv.pinboardFilterBy = v.pinboardFilterBy;
  else delete pv.pinboardFilterBy;
  for (const key of VIEW_PLAINVA_KEYS) if (unchanged(key)) restoreKey(pv, rawPv, key);

  // Grouping: the board's column property. Obsidian's own `groupBy` (an object
  // with a property id and a direction) is read as that property; a view that
  // carries it keeps it as the one place of its grouping — changed in place,
  // direction kept — instead of getting a second copy in another shape.
  const nativeGroup = raw && isPlainObject(raw.groupBy) ? raw.groupBy : null;
  if (unchanged("groupBy")) restoreKey(pv, rawPv, "groupBy");
  else if (nativeGroup && rawPv?.groupBy == null) {
    if (v?.groupBy != null) base.groupBy = { ...clone(nativeGroup), property: toPropId(String(v.groupBy)) };
    else delete base.groupBy;
    delete pv.groupBy;
  } else if (v?.groupBy != null) pv.groupBy = v.groupBy;
  else delete pv.groupBy;

  // Per-view filters (native): the current in-memory view filters,
  // single-rooted for Obsidian — or the file's own form when they are
  // unchanged and Obsidian accepts that form.
  const outViewFilters = normalizeFiltersOut(v?.filters);
  if (outViewFilters !== undefined) base.filters = outViewFilters;
  else delete base.filters;
  if (raw && unchanged("filters") && isValidFilterRoot(raw.filters)) restoreKey(base, raw, "filters");

  return { base, pv, rawPv };
}

/**
 * Serialize the in-memory config to Obsidian-native `.base` YAML: native
 * top-level keys only, Plainva richness under `properties[x].plainva` /
 * `views[i].plainva`.
 *
 * Only what changed in memory is written anew. Each key this module knows is
 * compared with what the file it came from reads as (the pristine copy on
 * `_obsidian`, per view on the view itself); where both agree, the file's own
 * spelling stays. So everything Plainva does not know or cannot read — unknown
 * keys, an unreadable rollup, a plugin's view type, Obsidian's `groupBy`, an
 * option written as a bare string — survives a save, and a file read and saved
 * without a change comes back with the same YAML data (baseRoundTrip.test.ts).
 */
export function serializeBaseConfig(config: any): string {
  const src = isPlainObject(config) ? config : {};
  const rawFile: Record<string, any> = isPlainObject(src._obsidian) ? src._obsidian : {};
  const out: Record<string, any> = clone(rawFile);
  delete out._obsidian;
  // Drop the legacy top-level columns map — its data now lives under properties[x].plainva.
  delete out.columns;
  const legacyColumns: Record<string, any> = isPlainObject(rawFile.columns) ? rawFile.columns : {};

  // --- properties ---
  const props: Record<string, any> = isPlainObject(out.properties) ? out.properties : {};
  const columns = isPlainObject(src.columns) ? src.columns : {};
  for (const bare of Object.keys(columns)) {
    const col = isPlainObject(columns[bare]) ? columns[bare] : {};
    const id = rawPropertyId(props, bare);
    const entry = isPlainObject(props[id]) ? props[id] : {};
    // What the file says about this column: its plainva block, or the entry
    // of the legacy top-level `columns:` map an old build wrote.
    const fromFile = isPlainObject(entry.plainva) ? entry.plainva : legacyColumnEntry(legacyColumns, bare);
    const was = fromFile ? normalizeColumn(fromFile) : null;
    const plainva: Record<string, any> = fromFile ? clone(fromFile) : {};
    if (col.input != null) plainva.input = col.input;
    else delete plainva.input;
    if (typeof col.ratingMax === "number" && Number.isFinite(col.ratingMax)) plainva.ratingMax = col.ratingMax;
    else delete plainva.ratingMax;
    if (typeof col.ratingGlyph === "string" && col.ratingGlyph.trim()) plainva.ratingGlyph = col.ratingGlyph;
    else delete plainva.ratingGlyph;
    if (Array.isArray(col.options)) plainva.options = col.options.map(normalizeOption);
    else delete plainva.options;
    if (col.relationBase != null) plainva.relationBase = col.relationBase;
    else delete plainva.relationBase;
    if (col.relationLimit === "one") plainva.relationLimit = "one";
    else delete plainva.relationLimit;
    if (isPlainObject(col.reverseOf) && col.reverseOf.base && col.reverseOf.property) {
      plainva.reverseOf = { base: col.reverseOf.base, property: col.reverseOf.property };
    } else delete plainva.reverseOf;
    const rollup = normalizeRollup(col.rollup);
    if (rollup) plainva.rollup = serializeRollup(rollup);
    else delete plainva.rollup;
    const previousKeys = normalizePreviousKeys(col.previousKeys);
    if (previousKeys) plainva.previousKeys = previousKeys;
    else delete plainva.previousKeys;
    // Keys the user did not change keep the file's spelling — and a value
    // this build cannot read (a rollup from a newer Plainva) stays.
    if (was) for (const key of COLUMN_KEYS) if (sameData(col[key], was[key])) restoreKey(plainva, fromFile, key);
    const keptEmpty = isPlainObject(entry.plainva) && Object.keys(entry.plainva).length === 0;
    if (Object.keys(plainva).length > 0 || keptEmpty) entry.plainva = plainva;
    else delete entry.plainva;
    props[id] = entry;
  }
  if (Object.keys(props).length > 0) out.properties = props;
  else delete out.properties;

  // --- views ---
  // Obsidian refuses a base without views — never write an empty list.
  const views: any[] = Array.isArray(src.views) && src.views.length > 0 ? src.views : [{ type: "table" }];
  // Names already present (in memory or on disk) count as taken so synthesized
  // fallbacks stay unique; user-given names are never rewritten.
  const takenNames = new Set<string>();
  for (const v of views) {
    const nm = v?.name ?? (isPlainObject(v?.[VIEW_RAW]) ? v[VIEW_RAW].name : undefined);
    if (nm != null && String(nm).trim()) takenNames.add(String(nm));
  }
  const written = views.map((v) => serializeView(v, takenNames));

  // The file-wide keys (icon tint P7, new-item folder/template P1, task list,
  // context filters) belong on the FIRST view. They stay as the file has them
  // as long as the first written view alone reads back what is in memory;
  // otherwise (a change, a moved view) they are stamped onto view 0 and
  // scrubbed from the rest.
  const wanted = wantedFileWide(src);
  if (!sameData(readFileWide([{ plainva: written[0].pv }]), wanted)) {
    written.forEach(({ pv }, i) => {
      delete pv.fileIconColor;
      delete pv.newItemFolder;
      delete pv.newItemTemplate;
      delete pv.taskList;
      delete pv.contextFilters;
      if (i !== 0) return;
      if (wanted.iconColor) pv.fileIconColor = wanted.iconColor;
      if (wanted.newItemFolder) pv.newItemFolder = wanted.newItemFolder;
      if (wanted.newItemTemplate) pv.newItemTemplate = wanted.newItemTemplate;
      if (wanted.taskList) pv.taskList = wanted.taskList;
      if (wanted.contextFilters) pv.contextFilters = wanted.contextFilters;
    });
  }
  out.views = written.map(({ base, pv, rawPv }) => {
    if (Object.keys(pv).length > 0 || (rawPv && Object.keys(rawPv).length === 0)) base.plainva = pv;
    else delete base.plainva;
    return base;
  });

  // --- filters (single-rooted and/or/not form; invalid legacy shapes heal here) ---
  const filters = normalizeFiltersOut(src.filters);
  if (filters !== undefined) out.filters = filters;
  else delete out.filters;
  if (sameData(src.filters, normalizeFiltersIn(rawFile.filters)) && isValidFilterRoot(rawFile.filters)) {
    restoreKey(out, rawFile, "filters");
  }

  return yaml.stringify(out);
}
