/**
 * Rollup columns: a value derived from the notes a relation points at.
 *
 * Design (plan Projektwerkzeug, decision E1): a rollup is COMPUTED AT QUERY
 * TIME and stored nowhere — exactly like the reverse-relation column it usually
 * runs over. A project note never carries "12 open tasks" in its frontmatter,
 * so no sync can ever transport a stale count and no two devices can disagree
 * about it. The schema below lives in the `.base` (under the `plainva`
 * namespace of the property), the values live only in the rendered view.
 *
 * The `where` grammar deliberately reuses the operator vocabulary of the base
 * filters (`databaseQueryHelpers.buildPropertyPredicate`) rather than inventing
 * a second one: a user who has written `status != Erledigt` as a filter reads
 * the same words in the rollup editor, and both compare values the same way.
 */

/** Aggregate functions a rollup column can apply to the linked notes. */
export type RollupFn =
  | "count"
  | "countWhere"
  | "percentWhere"
  | "sum"
  | "average"
  | "median"
  | "min"
  | "max"
  | "earliest"
  | "latest"
  | "checked"
  | "unchecked"
  | "empty"
  | "filled"
  | "unique";

export const ROLLUP_FNS: readonly RollupFn[] = [
  "count",
  "countWhere",
  "percentWhere",
  "sum",
  "average",
  "median",
  "min",
  "max",
  "earliest",
  "latest",
  "checked",
  "unchecked",
  "empty",
  "filled",
  "unique",
] as const;

/** Comparison operators of a rollup condition — same vocabulary as base filters. */
export type RollupWhereOp = "==" | "!=" | "contains" | "notContains" | ">" | "<" | ">=" | "<=";

export interface RollupWhere {
  op: RollupWhereOp;
  /** Compared as a string (or numerically/by date for the ordered operators). */
  value: string;
}

export interface RollupSpec {
  /** Column of THIS base that holds the links: a relation or a reverse column. */
  through: string;
  /** Property of the LINKED notes to aggregate. Not needed by `count`. */
  of?: string;
  fn: RollupFn;
  /** Condition on `of`; required by `countWhere`/`percentWhere`, ignored elsewhere. */
  where?: RollupWhere;
}

const WHERE_OPS: readonly RollupWhereOp[] = ["==", "!=", "contains", "notContains", ">", "<", ">=", "<="];

/** Functions that count/measure the notes themselves and need no `of` property. */
export function rollupNeedsProperty(fn: RollupFn): boolean {
  return fn !== "count";
}

/** Functions whose result is meaningless without a condition. */
export function rollupNeedsWhere(fn: RollupFn): boolean {
  return fn === "countWhere" || fn === "percentWhere";
}

/** Functions that produce a number (as opposed to a date or a text). */
export function rollupIsNumeric(fn: RollupFn): boolean {
  return (
    fn === "count" ||
    fn === "countWhere" ||
    fn === "percentWhere" ||
    fn === "sum" ||
    fn === "average" ||
    fn === "median" ||
    fn === "min" ||
    fn === "max" ||
    fn === "checked" ||
    fn === "unchecked" ||
    fn === "empty" ||
    fn === "filled" ||
    fn === "unique"
  );
}

/**
 * Read a rollup spec off a raw `.base` value.
 *
 * Returns null for anything malformed — a rollup whose function nobody knows,
 * or a `countWhere` without an operand, is DROPPED rather than thrown on: a
 * `.base` written by a newer Plainva (or by hand) must never keep the whole
 * database from opening. The column then simply has no values.
 */
export function normalizeRollup(src: unknown): RollupSpec | null {
  if (!src || typeof src !== "object" || Array.isArray(src)) return null;
  const raw = src as Record<string, unknown>;
  const through = typeof raw.through === "string" ? raw.through.trim() : "";
  const fn = typeof raw.fn === "string" ? (raw.fn as RollupFn) : null;
  if (!through || !fn || !ROLLUP_FNS.includes(fn)) return null;

  const of = typeof raw.of === "string" ? raw.of.trim() : "";
  if (rollupNeedsProperty(fn) && !of) return null;

  const spec: RollupSpec = { through, fn };
  if (of) spec.of = of;

  const rawWhere = raw.where;
  if (rawWhere && typeof rawWhere === "object" && !Array.isArray(rawWhere)) {
    const w = rawWhere as Record<string, unknown>;
    const op = typeof w.op === "string" ? (w.op as RollupWhereOp) : null;
    const value = w.value == null ? "" : String(w.value);
    // An operand-less condition is malformed, not "empty means unset": the
    // is-empty operators are `== ""` / `!= ""`, which carry an explicit value.
    if (op && WHERE_OPS.includes(op) && "value" in w) spec.where = { op, value };
  }
  if (rollupNeedsWhere(fn) && !spec.where) return null;
  return spec;
}

/** Serialize back to the shape stored under `properties[id].plainva.rollup`. */
export function serializeRollup(spec: RollupSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { through: spec.through, fn: spec.fn };
  if (spec.of) out.of = spec.of;
  if (spec.where) out.where = { op: spec.where.op, value: spec.where.value };
  return out;
}

// --- Value handling --------------------------------------------------------
// Mirrors databaseQueryHelpers: a frontmatter value is a scalar, a list, or
// absent, and a list satisfies a condition when ANY member does.

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return String(v).trim() === "";
}

function compareOrdered(a: unknown, b: string): number | null {
  const an = typeof a === "number" ? a : Number(a);
  const bn = Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an < bn ? -1 : an > bn ? 1 : 0;
  if (a === undefined || a === null) return null;
  const as = String(a);
  return as < b ? -1 : as > b ? 1 : 0;
}

/** Does one linked note's value satisfy the condition? */
export function matchesRollupWhere(value: unknown, where: RollupWhere): boolean {
  const { op, value: val } = where;
  if (val === "" && op === "==") return isEmptyValue(value);
  if (val === "" && op === "!=") return !isEmptyValue(value);

  if (op === "contains" || op === "notContains") {
    const hit =
      value == null
        ? false
        : Array.isArray(value)
          ? value.some((v) => String(v).includes(val))
          : String(value).includes(val);
    return op === "contains" ? hit : !hit;
  }
  if (op === "==") {
    if (value === undefined || value === null) return false;
    return Array.isArray(value) ? value.some((v) => String(v) === val) : String(value) === val;
  }
  if (op === "!=") {
    if (value === undefined || value === null) return true;
    return Array.isArray(value) ? !value.some((v) => String(v) === val) : String(value) !== val;
  }
  const c = compareOrdered(value, val);
  if (c === null) return false;
  if (op === ">") return c > 0;
  if (op === "<") return c < 0;
  if (op === ">=") return c >= 0;
  return c <= 0;
}

function numbersOf(values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (v === undefined || v === null || v === "") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

function isChecked(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "yes";
}

/** ISO-ish date strings sort lexicographically; anything else is not a date. */
function datesOf(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) out.push(s);
  }
  return out;
}

/**
 * Aggregate the linked notes' values.
 *
 * `values` holds ONE entry per linked note — the raw frontmatter value of the
 * `of` property, which may itself be a list, or undefined when the note does
 * not carry the property at all. That distinction matters: `empty`/`filled`
 * count notes, not values.
 *
 * Returns null when the function cannot produce a value from what is there
 * (no numbers to sum, no dates to compare) — the cell then shows nothing
 * rather than a misleading zero.
 */
export function aggregateRollup(spec: RollupSpec, values: unknown[]): number | string | null {
  switch (spec.fn) {
    case "count":
      return values.length;
    case "countWhere":
      return spec.where ? values.filter((v) => matchesRollupWhere(v, spec.where!)).length : null;
    case "percentWhere": {
      if (!spec.where || values.length === 0) return values.length === 0 ? 0 : null;
      const hits = values.filter((v) => matchesRollupWhere(v, spec.where!)).length;
      return Math.round((hits / values.length) * 100);
    }
    case "empty":
      return values.filter((v) => isEmptyValue(v)).length;
    case "filled":
      return values.filter((v) => !isEmptyValue(v)).length;
    case "checked":
      return values.filter((v) => isChecked(v)).length;
    case "unchecked":
      return values.filter((v) => !isChecked(v)).length;
    case "unique": {
      const seen = new Set<string>();
      for (const v of values) {
        if (isEmptyValue(v)) continue;
        for (const one of Array.isArray(v) ? v : [v]) seen.add(String(one));
      }
      return seen.size;
    }
    case "sum":
    case "average":
    case "median":
    case "min":
    case "max": {
      const flat = values.flatMap((v) => (Array.isArray(v) ? v : [v]));
      const nums = numbersOf(flat);
      if (nums.length === 0) return null;
      if (spec.fn === "sum") return round2(nums.reduce((a, b) => a + b, 0));
      if (spec.fn === "average") return round2(nums.reduce((a, b) => a + b, 0) / nums.length);
      if (spec.fn === "min") return Math.min(...nums);
      if (spec.fn === "max") return Math.max(...nums);
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return round2(sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]);
    }
    case "earliest":
    case "latest": {
      const flat = values.flatMap((v) => (Array.isArray(v) ? v : [v]));
      const dates = datesOf(flat);
      if (dates.length === 0) return null;
      dates.sort();
      return spec.fn === "earliest" ? dates[0] : dates[dates.length - 1];
    }
    default:
      return null;
  }
}

/** Two decimals is enough for hours and money and keeps 0.1+0.2 readable. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
