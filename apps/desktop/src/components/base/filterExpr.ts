// Translation between the property-filter ROWS of the config panel and the
// Obsidian-style expression strings stored in a `.base` (plan Base-Erweiterungen,
// W2/P4). The evaluation lives in @plainva/core (databaseQueryHelpers); this is
// only the UI's parse/serialize layer, so both sides must agree on the grammar:
//   col == "v"   col != "v"   contains(col, "v")   !contains(col, "v")
//   col > "v"  < >= <=
// "empty"/"notEmpty" are UI aliases for `col == ""` / `col != ""` (the stored
// string stays plain Obsidian syntax) — relation filters use them (P11).

export type FilterOp = "==" | "!=" | "contains" | "notContains" | ">" | "<" | ">=" | "<=" | "empty" | "notEmpty";

export interface PropertyFilterRule {
  column: string;
  op: FilterOp;
  value: string;
}

const QUOTED = /"((?:[^"\\]|\\.)*)"/.source;

export function isSourceCondition(filter: unknown): boolean {
  return typeof filter === "string" && (/file\.folder\s*==/.test(filter) || /file\.hasTag\(/.test(filter));
}

function escapeValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescapeValue(v: string): string {
  return v.replace(/\\(.)/g, "$1");
}

/** Parse a stored filter string into an editable rule; null when it is a source
 * condition or an expression this UI cannot edit (kept verbatim in the file). */
export function parsePropertyFilter(filter: unknown): PropertyFilterRule | null {
  if (typeof filter !== "string" || isSourceCondition(filter)) return null;

  const notContains = filter.match(new RegExp(`^!contains\\((.+?),\\s*${QUOTED}\\)$`));
  if (notContains) return { column: notContains[1].trim(), op: "notContains", value: unescapeValue(notContains[2]) };

  const contains = filter.match(new RegExp(`^contains\\((.+?),\\s*${QUOTED}\\)$`));
  if (contains) return { column: contains[1].trim(), op: "contains", value: unescapeValue(contains[2]) };

  const cmp = filter.match(new RegExp(`^(.+?)\\s*(==|!=|>=|<=|>|<)\\s*${QUOTED}$`));
  if (cmp) {
    const column = cmp[1].trim();
    const value = unescapeValue(cmp[3]);
    // Empty comparisons surface as the dedicated is-empty operators in the UI.
    if (value === "" && cmp[2] === "==") return { column, op: "empty", value: "" };
    if (value === "" && cmp[2] === "!=") return { column, op: "notEmpty", value: "" };
    return { column, op: cmp[2] as FilterOp, value };
  }

  return null;
}

export function serializePropertyFilter(rule: PropertyFilterRule): string {
  if (rule.op === "empty") return `${rule.column} == ""`;
  if (rule.op === "notEmpty") return `${rule.column} != ""`;
  const value = escapeValue(rule.value);
  if (rule.op === "contains") return `contains(${rule.column}, "${value}")`;
  if (rule.op === "notContains") return `!contains(${rule.column}, "${value}")`;
  return `${rule.column} ${rule.op} "${value}"`;
}

/**
 * Deep-cloned config with all property filters removed (folder/tag source
 * conditions kept). Querying with this yields the rows of the SOURCE, which is
 * what the filter value dropdowns must offer — deriving them from the already
 * filtered rows collapses a self-filtering column (e.g. `status is final`) to
 * its own active value, or to nothing when the filter matches zero rows.
 */
export function stripPropertyFilters<T>(config: T): T {
  const cfg: any = JSON.parse(JSON.stringify(config ?? null));
  if (cfg?.filters) {
    for (const logic of ["and", "or"] as const) {
      if (Array.isArray(cfg.filters[logic])) {
        cfg.filters[logic] = cfg.filters[logic].filter((f: any) => isSourceCondition(f));
      }
    }
  }
  return cfg as T;
}

// --- Notion-style filter groups (plan Base-Filtergruppen P9) ----------------
// The property-filter area of the config panel edits a TOP logic (all/any)
// over loose rules and ONE level of {and}/{or} group objects living as
// entries of filters.and / filters.or. Deeper or foreign structures render as
// non-editable (but deletable) entries and are still applied by the query.

export type FilterListName = "and" | "or";

export interface FilterEntryRef {
  list: FilterListName;
  idx: number;
}

export interface UIGroupItem {
  idx: number;
  raw: string;
  rule: PropertyFilterRule | null;
}

export type UIFilterEntry =
  | { kind: "rule"; ref: FilterEntryRef; raw: string; rule: PropertyFilterRule }
  | { kind: "rawString"; ref: FilterEntryRef; raw: string }
  | { kind: "group"; ref: FilterEntryRef; logic: "all" | "any"; items: UIGroupItem[] }
  | { kind: "opaque"; ref: FilterEntryRef; raw: any };

export interface UIFilterModel {
  topLogic: "all" | "any";
  hasEntries: boolean;
  entries: UIFilterEntry[];
}

function groupKeyOf(entry: any): "and" | "or" | null {
  if (entry == null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const keys = Object.keys(entry);
  if (keys.length !== 1 || (keys[0] !== "and" && keys[0] !== "or")) return null;
  return keys[0] as "and" | "or";
}

/** Editable group: exactly one and/or key whose items are all non-source strings. */
export function isEditableGroup(entry: any): boolean {
  const key = groupKeyOf(entry);
  if (!key) return false;
  const items = entry[key];
  return Array.isArray(items) && items.every((x: any) => typeof x === "string" && !isSourceCondition(x));
}

/** Derive the panel's filter model from the in-memory config. Source
 * conditions are the source editor's territory and never appear here. */
export function buildUIFilterModel(config: any): UIFilterModel {
  const entries: UIFilterEntry[] = [];
  let anyInOr = false;
  for (const list of ["and", "or"] as const) {
    const arr: any[] = Array.isArray(config?.filters?.[list]) ? config.filters[list] : [];
    arr.forEach((f: any, idx: number) => {
      if (typeof f === "string") {
        if (isSourceCondition(f)) return;
        const rule = parsePropertyFilter(f);
        entries.push(
          rule
            ? { kind: "rule", ref: { list, idx }, raw: f, rule }
            : { kind: "rawString", ref: { list, idx }, raw: f }
        );
      } else if (isEditableGroup(f)) {
        const key = groupKeyOf(f)!;
        entries.push({
          kind: "group",
          ref: { list, idx },
          logic: key === "and" ? "all" : "any",
          items: (f[key] as string[]).map((raw, i) => ({ idx: i, raw, rule: parsePropertyFilter(raw) })),
        });
      } else {
        entries.push({ kind: "opaque", ref: { list, idx }, raw: f });
      }
      if (list === "or") anyInOr = true;
    });
  }
  return { topLogic: anyInOr ? "any" : "all", hasEntries: entries.length > 0, entries };
}

// The mutators below work IN PLACE on a caller-provided config copy and
// return it (the BaseViewer clones before, saves after). Refs come from the
// model built off the same config revision.

function listOf(config: any, list: FilterListName): any[] {
  if (!config.filters) config.filters = {};
  if (!Array.isArray(config.filters[list])) config.filters[list] = [];
  return config.filters[list];
}

const topList = (topLogic: "all" | "any"): FilterListName => (topLogic === "any" ? "or" : "and");

/** Append a loose rule at top level, respecting the top logic. */
export function addTopFilterRule(config: any, ruleStr: string, topLogic: "all" | "any"): any {
  listOf(config, topList(topLogic)).push(ruleStr);
  return config;
}

/** Create a group with its first rule (empty groups never reach the file). */
export function addGroupWithRule(config: any, groupLogic: "all" | "any", ruleStr: string, topLogic: "all" | "any"): any {
  listOf(config, topList(topLogic)).push({ [groupLogic === "any" ? "or" : "and"]: [ruleStr] });
  return config;
}

export function addRuleToGroup(config: any, ref: FilterEntryRef, ruleStr: string): any {
  const entry = listOf(config, ref.list)[ref.idx];
  const key = groupKeyOf(entry);
  if (key) entry[key].push(ruleStr);
  return config;
}

export function updateTopFilterRule(config: any, ref: FilterEntryRef, ruleStr: string): any {
  const arr = listOf(config, ref.list);
  if (ref.idx >= 0 && ref.idx < arr.length) arr[ref.idx] = ruleStr;
  return config;
}

export function updateGroupRule(config: any, ref: FilterEntryRef, itemIdx: number, ruleStr: string): any {
  const entry = listOf(config, ref.list)[ref.idx];
  const key = groupKeyOf(entry);
  if (key && itemIdx >= 0 && itemIdx < entry[key].length) entry[key][itemIdx] = ruleStr;
  return config;
}

/** Remove a whole top-level entry (rule, group or opaque object). */
export function removeFilterEntry(config: any, ref: FilterEntryRef): any {
  const arr = listOf(config, ref.list);
  if (ref.idx >= 0 && ref.idx < arr.length) arr.splice(ref.idx, 1);
  return config;
}

/** Remove one rule inside a group; the group disappears with its last rule. */
export function removeGroupRule(config: any, ref: FilterEntryRef, itemIdx: number): any {
  const arr = listOf(config, ref.list);
  const entry = arr[ref.idx];
  const key = groupKeyOf(entry);
  if (!key) return config;
  if (itemIdx >= 0 && itemIdx < entry[key].length) entry[key].splice(itemIdx, 1);
  if (entry[key].length === 0) arr.splice(ref.idx, 1);
  return config;
}

export function setGroupLogic(config: any, ref: FilterEntryRef, logic: "all" | "any"): any {
  const arr = listOf(config, ref.list);
  const entry = arr[ref.idx];
  const key = groupKeyOf(entry);
  const nextKey = logic === "any" ? "or" : "and";
  if (key && key !== nextKey) arr[ref.idx] = { [nextKey]: entry[key] };
  return config;
}

/** Toggle the TOP logic: move every non-source entry (strings AND group
 * objects) between the and/or lists; source conditions stay put. */
export function moveTopFilterEntries(config: any, to: "all" | "any"): any {
  const target = topList(to);
  const from: FilterListName = target === "and" ? "or" : "and";
  const src = listOf(config, from);
  const stay: any[] = [];
  const moved: any[] = [];
  for (const f of src) {
    if (typeof f === "string" && isSourceCondition(f)) stay.push(f);
    else moved.push(f);
  }
  if (moved.length === 0) return config;
  config.filters[from] = stay;
  listOf(config, target).push(...moved);
  return config;
}

// --- Source conditions (folder/tag), shared by the source editor and the
// creation wizard. Same expressions the SQL layer of the query service reads. ---

export interface SourceClause {
  type: "folder" | "tag";
  value: string;
}

export function buildSourceClause(type: "folder" | "tag", value: string): string {
  return type === "folder" ? `file.folder == "${escapeValue(value)}"` : `file.hasTag("${escapeValue(value)}")`;
}

export function parseSourceClause(clause: unknown): SourceClause | null {
  if (typeof clause !== "string") return null;
  const folder = clause.match(new RegExp(`^file\\.folder\\s*==\\s*${QUOTED}$`));
  if (folder) return { type: "folder", value: unescapeValue(folder[1]) };
  const tag = clause.match(new RegExp(`^file\\.hasTag\\(${QUOTED}\\)$`));
  if (tag) return { type: "tag", value: unescapeValue(tag[1]) };
  return null;
}

// --- Per-view filters (plan Per-View-Filter 2026-07-07) ---------------------
// Property filter rules live in views[i].filters; folder/tag SOURCES stay in
// the file-level filters. These helpers merge them for the query and migrate
// existing global property rules into every view.

/** AND-combine two in-memory filter objects ({and,or}) into one {and:[...]}. */
export function combineFilters(a: any, b: any): { and: any[] } {
  const list: any[] = [];
  for (const f of [a, b]) {
    if (!f || typeof f !== "object") continue;
    if (Array.isArray(f.and)) list.push(...f.and);
    if (Array.isArray(f.or) && f.or.length > 0) list.push({ or: f.or });
  }
  return { and: list };
}

/**
 * Move the file-level PROPERTY filter rules into every view (AND-combined),
 * leaving only folder/tag SOURCES at the file level. Idempotent — a config whose
 * file-level filters are already sources-only comes back unchanged. Sources are
 * never moved; group objects count as property rules.
 */
export function migrateFiltersToPerView(config: any): any {
  const nc = JSON.parse(JSON.stringify(config ?? {}));
  const gf = nc.filters;
  if (!gf || typeof gf !== "object") return nc;
  const sources: { and: any[]; or: any[] } = { and: [], or: [] };
  const props: { and: any[]; or: any[] } = { and: [], or: [] };
  for (const list of ["and", "or"] as const) {
    for (const f of Array.isArray(gf[list]) ? gf[list] : []) {
      (isSourceCondition(f) ? sources : props)[list].push(f);
    }
  }
  if (props.and.length === 0 && props.or.length === 0) return nc; // already per-view
  const views = Array.isArray(nc.views) ? nc.views : [];
  for (const v of views) {
    if (v && typeof v === "object") v.filters = combineFilters(v.filters, props);
  }
  nc.filters = {};
  if (sources.and.length > 0) nc.filters.and = sources.and;
  if (sources.or.length > 0) nc.filters.or = sources.or;
  return nc;
}
