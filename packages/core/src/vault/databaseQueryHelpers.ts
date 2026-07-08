/**
 * Pure helpers for `.base` database queries (plan Base-Erweiterungen, W2):
 * property-filter predicates over the in-memory result rows and a stable
 * multi-rule sort. Kept free of DB access so they are unit-testable and the
 * query service stays thin.
 *
 * Filter strings are the Obsidian-style expressions Plainva reads and writes:
 *   prop == "value"     prop != "value"     contains(prop, "value")
 *   prop > "value"      prop < "value"      prop >= "value"     prop <= "value"
 * Values are double-quoted with `\"` escaping. Comparison is numeric when both
 * sides are numbers, otherwise lexicographic — ISO dates compare correctly
 * either way.
 *
 * LIST row values (frontmatter tags, aliases, multiselect) use membership
 * semantics: `prop == "v"` is true when the list CONTAINS v exactly, `!=` when
 * it does not. Stringifying the array (the old behavior) could never match —
 * `tags == "x"` on ["x","y"] compared "x,y" with "x" and filtered every row out.
 */

export type DatabaseRow = Record<string, any>;

const QUOTED = /"((?:[^"\\]|\\.)*)"/.source;

function unescapeValue(raw: string): string {
  return raw.replace(/\\(.)/g, "$1");
}

/** True for the folder/tag source conditions that the SQL layer already applied. */
export function isSourceFilter(filter: string): boolean {
  return /file\.folder\s*==/.test(filter) || /file\.hasTag\(/.test(filter);
}

function rowValue(row: DatabaseRow, col: string): any {
  if (col in row) return row[col];
  if (col.startsWith("note.")) return row[col.slice(5)];
  return undefined;
}

/** Ordered comparison used by > < >= <=; numeric when both sides are numeric. */
function compareOrdered(rowVal: any, filterVal: string): number | null {
  if (rowVal === undefined || rowVal === null || rowVal === "") return null;
  const a = Number(rowVal);
  const b = Number(filterVal);
  if (!Number.isNaN(a) && !Number.isNaN(b) && String(rowVal).trim() !== "" && filterVal.trim() !== "") {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  const sa = String(rowVal);
  return sa === filterVal ? 0 : sa < filterVal ? -1 : 1;
}

/**
 * Build a row predicate for one property-filter expression. Returns null for
 * source conditions (handled in SQL) and for anything unparseable (nested
 * Obsidian filter objects arrive as non-strings and are ignored upstream).
 */
/** Empty in the filter sense: unset, null, empty string or an empty list. */
function isEmptyValue(rowVal: any): boolean {
  return rowVal === undefined || rowVal === null || rowVal === "" || (Array.isArray(rowVal) && rowVal.length === 0);
}

export function buildPropertyPredicate(filter: string): ((row: DatabaseRow) => boolean) | null {
  if (typeof filter !== "string" || isSourceFilter(filter)) return null;

  const containsMatch = filter.match(new RegExp(`^(!?)contains\\((.+?),\\s*${QUOTED}\\)$`));
  if (containsMatch) {
    const negated = containsMatch[1] === "!";
    const col = containsMatch[2].trim();
    const val = unescapeValue(containsMatch[3]);
    const hit = (row: DatabaseRow) => {
      const rowVal = rowValue(row, col);
      if (rowVal === undefined || rowVal === null) return false;
      if (Array.isArray(rowVal)) return rowVal.some((v) => String(v).includes(val));
      return String(rowVal).includes(val);
    };
    return negated ? (row) => !hit(row) : hit;
  }

  // Order matters: >= and <= must match before > and <.
  const cmpMatch = filter.match(new RegExp(`^(.+?)\\s*(==|!=|>=|<=|>|<)\\s*${QUOTED}$`));
  if (cmpMatch) {
    const col = cmpMatch[1].trim();
    const op = cmpMatch[2];
    const val = unescapeValue(cmpMatch[3]);
    // Empty comparisons are the is-empty operators (P11): `col == ""` matches
    // unset/null/empty-list values too — the old string-equality never could.
    if (val === "" && op === "==") return (row) => isEmptyValue(rowValue(row, col));
    if (val === "" && op === "!=") return (row) => !isEmptyValue(rowValue(row, col));
    if (op === "==") return (row) => {
      const rowVal = rowValue(row, col);
      if (rowVal === undefined || rowVal === null) return false;
      if (Array.isArray(rowVal)) return rowVal.some((v) => String(v) === val);
      return String(rowVal) === val;
    };
    if (op === "!=") return (row) => {
      const rowVal = rowValue(row, col);
      if (rowVal === undefined || rowVal === null) return true;
      if (Array.isArray(rowVal)) return !rowVal.some((v) => String(v) === val);
      return String(rowVal) !== val;
    };
    return (row) => {
      const c = compareOrdered(rowValue(row, col), val);
      if (c === null) return false;
      if (op === ">") return c > 0;
      if (op === "<") return c < 0;
      if (op === ">=") return c >= 0;
      return c <= 0;
    };
  }

  return null;
}

// --- Recursive filter-node evaluation (plan Base-Filtergruppen P7) ----------
// A `.base` filters tree is arbitrarily nested {and/or/not} groups over
// condition strings. The UI edits one group level; files (especially
// Obsidian-authored ones) may nest deeper — previously such groups were
// preserved but IGNORED by the query. This evaluator applies them correctly.

const SOURCE_FOLDER_RE = new RegExp(`^file\\.folder\\s*==\\s*${QUOTED}$`);
const SOURCE_TAG_RE = new RegExp(`^file\\.hasTag\\(${QUOTED}\\)$`);

export interface FilterEvalContext {
  /** True when the row's note carries the (un-prefixed) tag. Only consulted
   * for `file.hasTag` conditions that were not applied in SQL. */
  hasTag: (row: DatabaseRow, tag: string) => boolean;
}

/** True when a `file.hasTag` condition occurs anywhere in the node tree —
 * the caller then has to provide real tag data in the eval context. */
export function filterNeedsTags(node: any): boolean {
  if (typeof node === "string") return /file\.hasTag\(/.test(node);
  if (!node || typeof node !== "object") return false;
  for (const key of ["and", "or", "not"] as const) {
    const list = (node as any)[key];
    const items = Array.isArray(list) ? list : list != null ? [list] : [];
    if (items.some(filterNeedsTags)) return true;
  }
  return false;
}

/**
 * Build a row predicate for one filter node (condition string or nested
 * {and/or/not} group). Returns null for nodes that cannot be evaluated
 * (unparseable expressions, empty groups) — a null child is NEUTRAL: dropped
 * from its parent group, and a group of only-neutral children is itself
 * neutral. Source conditions (folder/tag) evaluate in memory here; `not` uses
 * Obsidian semantics (none of the children may match).
 */
export function buildFilterNodePredicate(
  node: any,
  ctx: FilterEvalContext
): ((row: DatabaseRow) => boolean) | null {
  if (typeof node === "string") {
    const folder = node.match(SOURCE_FOLDER_RE);
    if (folder) {
      const value = unescapeValue(folder[1]);
      if (value === "/" || value === "") return () => true;
      const prefix = value.endsWith("/") ? value : value + "/";
      return (row) => String(row["file.path"] ?? "").startsWith(prefix);
    }
    const tag = node.match(SOURCE_TAG_RE);
    if (tag) {
      let value = unescapeValue(tag[1]);
      if (value.startsWith("#")) value = value.substring(1);
      return (row) => ctx.hasTag(row, value);
    }
    // buildPropertyPredicate nulls out source conditions itself, so exotic
    // source spellings that miss the anchored patterns stay neutral (ignored),
    // exactly like before.
    return buildPropertyPredicate(node);
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  // Obsidian's form has exactly one of and/or/not; evaluate leniently — when
  // several appear side by side (invalid legacy), all of them must hold.
  const parts: Array<(row: DatabaseRow) => boolean> = [];
  for (const key of ["and", "or", "not"] as const) {
    const list = (node as any)[key];
    if (list == null) continue;
    const items = Array.isArray(list) ? list : [list];
    const preds = items
      .map((child: any) => buildFilterNodePredicate(child, ctx))
      .filter((p): p is (row: DatabaseRow) => boolean => !!p);
    if (preds.length === 0) continue;
    if (key === "and") parts.push((row) => preds.every((p) => p(row)));
    else if (key === "or") parts.push((row) => preds.some((p) => p(row)));
    else parts.push((row) => !preds.some((p) => p(row)));
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return (row) => parts.every((p) => p(row));
}

export interface SortRule {
  property: string;
  direction: "ASC" | "DESC";
}

/** Normalize the view's raw sort array (property/field, note. prefixes) to SortRule[]. */
export function normalizeSortRules(raw: any): SortRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s: any) => s && typeof s === "object" && (s.property ?? s.field))
    .map((s: any) => ({
      property: String(s.property ?? s.field),
      direction: String(s.direction ?? "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC",
    }));
}

/**
 * Stable multi-rule sort over the result rows (all rules apply, first rule has
 * the highest priority; missing values sort last regardless of direction).
 */
export function applySortRules(rows: DatabaseRow[], rules: SortRule[]): DatabaseRow[] {
  if (rules.length === 0) return rows;
  const compare = (a: DatabaseRow, b: DatabaseRow): number => {
    for (const rule of rules) {
      const key = rule.property.replace(/^note\./, "");
      const va = rowValue(a, key);
      const vb = rowValue(b, key);
      const aMissing = va === undefined || va === null || va === "";
      const bMissing = vb === undefined || vb === null || vb === "";
      if (aMissing && bMissing) continue;
      if (aMissing) return 1;
      if (bMissing) return -1;
      let c: number;
      if (typeof va === "number" && typeof vb === "number") c = va === vb ? 0 : va < vb ? -1 : 1;
      else c = String(va) === String(vb) ? 0 : String(va) < String(vb) ? -1 : 1;
      if (c !== 0) return rule.direction === "ASC" ? c : -c;
    }
    return 0;
  };
  // Array.prototype.sort is stable per spec; a decorated index keeps that explicit.
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => compare(x.row, y.row) || x.i - y.i)
    .map((x) => x.row);
}
