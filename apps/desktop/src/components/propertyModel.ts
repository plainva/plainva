/**
 * Pure, framework-free helpers for the Properties panel (right sidebar).
 *
 * Design (ADR 0008 — two-layer model): every value here is a canonical,
 * Obsidian-native frontmatter value (scalar / list / number / boolean / ISO
 * date string). The "richness" (which type a property is, select/status option
 * sets and colors) lives outside the note — the type choice in a per-vault
 * registry (see propertyTypeStore), curated option sets in a `.base`, and
 * otherwise discovered from vault usage. Nothing here writes objects or
 * active-flags into the note.
 */

export type PropertyType =
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "list"
  | "tags"
  | "select"
  | "status"
  | "multiselect"
  | "url"
  | "email"
  | "phone"
  | "link";

/** Single-value option types rendered as one colored chip. */
export function isSingleSelect(t: PropertyType): boolean {
  return t === "select" || t === "status";
}

/** Multi-value types rendered as several chips/pills. */
export function isMulti(t: PropertyType): boolean {
  return t === "list" || t === "tags" || t === "multiselect" || t === "link";
}

/** Types whose chips carry a deterministic color (option-like). */
export function isColored(t: PropertyType): boolean {
  return t === "select" || t === "status" || t === "multiselect";
}

/** Types whose value is a plain single-line string in the note. */
export function isPlainString(t: PropertyType): boolean {
  return t === "text" || t === "url" || t === "email" || t === "phone";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const URL_RE = /^https?:\/\/\S+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WIKILINK_RE = /^\[\[.+\]\]$/;

/**
 * Best-effort type inference from a raw frontmatter value when no explicit type
 * is registered. Conservative: only promotes to a richer type on an unambiguous
 * shape (option types select/status/multiselect are never inferred — they are an
 * explicit user/`.base` choice).
 */
export function inferType(value: unknown, key: string): PropertyType {
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) {
    if (key === "tags" || key === "tag") return "tags";
    if (value.length > 0 && value.every((v) => typeof v === "string" && WIKILINK_RE.test(String(v).trim()))) return "link";
    return "list";
  }
  if (value instanceof Date) return "datetime";
  if (typeof value === "string") {
    const v = value.trim();
    if (DATE_RE.test(v)) return "date";
    if (DATETIME_RE.test(v)) return "datetime";
    if (WIKILINK_RE.test(v)) return "link";
    if (URL_RE.test(v)) return "url";
    if (EMAIL_RE.test(v)) return "email";
  }
  return "text";
}

/** Convert an existing value to the shape a newly chosen type expects. */
export function coerceForType(value: unknown, type: PropertyType): unknown {
  switch (type) {
    case "checkbox":
      return value === true || value === "true" || value === "yes";
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case "list":
    case "tags":
    case "multiselect":
    case "link":
      if (Array.isArray(value)) return value;
      if (value === "" || value == null) return [];
      return String(value)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    case "date": {
      if (typeof value === "string" && DATE_RE.test(value.trim())) return value;
      const d = parseLocalDate(String(value ?? ""));
      return d ? toIsoDate(d) : "";
    }
    case "datetime": {
      if (typeof value === "string" && DATETIME_RE.test(value.trim())) return value;
      const d = parseLocalDate(String(value ?? ""));
      return d ? toIsoDateTime(d) : "";
    }
    default: // text, select, status, url, email, phone
      if (Array.isArray(value)) return value.join(", ");
      if (value == null) return "";
      return String(value);
  }
}

/** Initial value for a freshly added property of the given type. */
export function defaultValueForType(type: PropertyType): unknown {
  if (type === "checkbox") return false;
  if (type === "number") return 0;
  if (isMulti(type)) return [];
  return ""; // text/select/status/url/email/phone/date/datetime — empty, edited in place
}

/** Parse "YYYY-MM-DD" / "YYYY-MM-DDTHH:mm" in LOCAL time (avoids the UTC off-by-one). */
export function parseLocalDate(value: string): Date | null {
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  const [, y, mo, d, hh, mm] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), hh ? Number(hh) : 0, mm ? Number(mm) : 0);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function toIsoDateTime(d: Date): string {
  return `${toIsoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Display formats of a date value (plan W4/P12): `long` is the verbose form the
 * properties panel always used; the `.base` views default to the short locale form. */
export type DateDisplayFormat = "default" | "long" | "iso" | "relative";

/**
 * Human, locale-aware display of a date / datetime ISO string. Returns the raw
 * input on parse failure. `now` exists for deterministic "relative" tests.
 */
export function formatDateValue(
  value: string,
  includeTime: boolean,
  locale: string,
  format: DateDisplayFormat = "long",
  now: Date = new Date(),
): string {
  if (!value) return "";
  const d = parseLocalDate(value);
  if (!d) return value;
  try {
    if (format === "iso") {
      return includeTime ? toIsoDateTime(d) : toIsoDate(d);
    }
    if (format === "relative") {
      const dayMs = 24 * 60 * 60 * 1000;
      const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
      const days = Math.round((startOfDay(d) - startOfDay(now)) / dayMs);
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      if (Math.abs(days) >= 365) return rtf.format(Math.trunc(days / 365), "year");
      if (Math.abs(days) >= 60) return rtf.format(Math.trunc(days / 30), "month");
      return rtf.format(days, "day");
    }
    const opts: Intl.DateTimeFormatOptions =
      format === "default"
        ? includeTime
          ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
          : { day: "2-digit", month: "2-digit", year: "numeric" }
        : includeTime
          ? { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }
          : { weekday: "short", day: "numeric", month: "long", year: "numeric" };
    return new Intl.DateTimeFormat(locale, opts).format(d);
  } catch {
    return value;
  }
}

/**
 * Normalize a raw frontmatter value for the UI: YAML timestamps can arrive as
 * Date objects (the schema allows z.date()). Convert them to canonical ISO
 * strings so renderers stay string-based and round-trips don't drift. Date-only
 * values (UTC midnight) use UTC components to avoid a timezone day-shift; values
 * with a time keep their local clock time.
 */
export function normalizeFrontmatterValue(value: unknown): unknown {
  if (value instanceof Date) {
    const dateOnly = value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0;
    if (dateOnly) return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    return toIsoDateTime(value);
  }
  return value;
}

/** Split a (possibly nested) tag into its parent path and leaf, e.g. "a/b/c" -> { parent: "a/b/", leaf: "c" }. */
export function tagSegments(tag: string): { parent: string; leaf: string } {
  const i = tag.lastIndexOf("/");
  if (i < 0) return { parent: "", leaf: tag };
  return { parent: tag.slice(0, i + 1), leaf: tag.slice(i + 1) };
}

/** Strip a single pair of leading/trailing wikilink brackets: "[[Note]]" -> "Note". */
export function stripWikiLink(raw: string): string {
  const m = String(raw).trim().match(/^\[\[(.+)\]\]$/);
  return m ? m[1] : String(raw).trim();
}

/**
 * Parsed pieces of a whole-value wiki link: "[[T#a|Alias]]" ->
 * { target: "T", anchor: "#a", alias: "Alias" }. Returns null for non-links.
 * `display` is what chips show (alias when present, else the target).
 */
export function parseWikiLinkValue(
  raw: unknown
): { target: string; anchor?: string; alias?: string; display: string } | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^\[\[([^[\]]+)\]\]$/);
  if (!m) return null;
  let inner = m[1];
  let alias: string | undefined;
  const pipe = inner.indexOf("|");
  if (pipe !== -1) {
    alias = inner.slice(pipe + 1).trim() || undefined;
    inner = inner.slice(0, pipe);
  }
  let anchor: string | undefined;
  const anchorIdx = inner.search(/[#^]/);
  if (anchorIdx !== -1) {
    anchor = inner.slice(anchorIdx).trim() || undefined;
    inner = inner.slice(0, anchorIdx);
  }
  const target = inner.trim();
  if (!target) return null;
  return { target, anchor, alias, display: alias ?? target };
}

/** Wrap a plain target in wikilink brackets unless it already is one. */
export function toWikiLink(raw: string): string {
  const v = String(raw).trim();
  if (!v) return v;
  return /^\[\[.+\]\]$/.test(v) ? v : `[[${v}]]`;
}

export const CHIP_COLOR_COUNT = 8;

/** Deterministic palette index for an option value, so the same value always gets the same color. */
export function chipColorIndex(value: string): number {
  let h = 0;
  const s = String(value);
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h % CHIP_COLOR_COUNT;
}

/** A curated option for select/status/multiselect, as stored in a `.base` column schema. */
export interface CuratedOption {
  value: string;
  label?: string;
  /** Palette name (see PALETTE_NAMES); when absent/invalid, color is derived from the value. */
  color?: string;
  /** Status only: groups options into ordered stages. */
  group?: string;
}

/** Palette names map 1:1 to the `.pv-chip-N` classes in App.css. */
export const PALETTE_NAMES = ["gray", "teal", "blue", "green", "amber", "coral", "purple", "pink"];

/** Representative solid swatch per palette name (for the color picker in the schema editor). */
export const PALETTE_SWATCH: Record<string, string> = {
  gray: "#888780", teal: "#1d9e75", blue: "#378add", green: "#639922",
  amber: "#ba7517", coral: "#d85a30", purple: "#7f77dd", pink: "#d4537e",
};

/** CSS class for an option chip: curated palette color if valid, else deterministic by value. */
export function chipClass(value: string, color?: string): string {
  const i = color ? PALETTE_NAMES.indexOf(color) : -1;
  return `pv-chip pv-chip-${i >= 0 ? i : chipColorIndex(value)}`;
}

/** Solid swatch colour for an option: curated palette colour when valid, else the same
 *  deterministic value-derived colour the chips use — so a dropdown row matches its chip. */
export function optionSwatch(value: string, color?: string): string {
  const name = color && PALETTE_NAMES.includes(color) ? color : PALETTE_NAMES[chipColorIndex(value)];
  return PALETTE_SWATCH[name];
}

/**
 * Options for inline select/status editing in the `.base` viewer: the curated
 * options when the column declares them, otherwise the distinct non-empty values
 * actually used by the matching rows — so a Status cell offers the real options
 * instead of an empty dropdown (point 9). `col` may be `note.`-prefixed while the
 * row stores the bare key; both are tried. List values are flattened.
 */
/**
 * True when a column carries at least one value and EVERY non-empty value is a
 * wiki-link. Such a column behaves as a relation for filtering even without an
 * explicit `input: relation` schema — frontmatter wiki-links are relations, so
 * it gets the note dropdown (with display-text labels + "this note"). A column
 * with mixed or no wiki-link values stays generic. Used only for columns that
 * declare no input type.
 */
export function columnValuesAreWikiLinks(rows: Record<string, any>[], col: string): boolean {
  const bare = col.startsWith("note.") ? col.slice(5) : col;
  let any = false;
  for (const r of rows) {
    let v = r[col];
    if (v === undefined) v = r[bare];
    const arr = Array.isArray(v) ? v : v == null || v === "" ? [] : [v];
    for (const x of arr) {
      any = true;
      if (!parseWikiLinkValue(String(x))) return false;
    }
  }
  return any;
}

export function inlineOptionsFrom(curated: CuratedOption[], rows: Record<string, any>[], col: string): CuratedOption[] {
  if (curated.length > 0) return curated;
  const seen = new Set<string>();
  const opts: CuratedOption[] = [];
  const push = (x: unknown) => {
    const s = x == null ? "" : String(x);
    if (s !== "" && !seen.has(s)) {
      seen.add(s);
      opts.push({ value: s });
    }
  };
  const bare = col.startsWith("note.") ? col.slice(5) : col;
  for (const r of rows) {
    let v = r[col];
    if (v === undefined) v = r[bare];
    if (Array.isArray(v)) v.forEach(push);
    else push(v);
  }
  return opts;
}

/**
 * Multi-value coercion for option-typed cells (Base-UX2 P1): arrays stay lists,
 * comma-joined strings split into their entries, scalars become a single entry.
 * Select/status/multiselect render and edit through this; explicit text columns
 * must NEVER run through it (text is not comma-separated by contract).
 */
export function splitMultiValue(x: unknown): string[] {
  if (Array.isArray(x)) return x.map((v) => String(v));
  if (x == null || x === "") return [];
  return String(x)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Group curated options into ordered stages by their `group` (status picker). Order = first appearance; ungrouped collected under null. */
export function groupOptions(options: CuratedOption[]): { group: string | null; options: CuratedOption[] }[] {
  const order: (string | null)[] = [];
  const map = new Map<string | null, CuratedOption[]>();
  for (const o of options) {
    const g = o.group && o.group.trim() !== "" ? o.group : null;
    if (!map.has(g)) { map.set(g, []); order.push(g); }
    map.get(g)!.push(o);
  }
  return order.map((g) => ({ group: g, options: map.get(g)! }));
}

/** Map a `.base` column `input` string to a Properties PropertyType (undefined = no explicit type). */
export function baseInputToType(input: string | undefined): PropertyType | undefined {
  switch (input) {
    case "text": return "text";
    case "number": return "number";
    case "checkbox": return "checkbox";
    case "date": return "date";
    case "datetime": return "datetime";
    case "select": return "select";
    case "status": return "status";
    case "multiselect":
    case "multi-select": return "multiselect";
    case "list": return "list";
    case "relation":
    case "link": return "link";
    case "url": return "url";
    case "email": return "email";
    case "phone": return "phone";
    case "tags": return "tags";
    default: return undefined;
  }
}

export interface TagSuggestion {
  tag: string;
  count: number;
}

/**
 * Filter vault-wide tags for the tag-pill autocomplete: drop already-applied tags,
 * substring-match the query (umlaut-safe via toLowerCase), keep the top matches.
 * An empty query returns the most-common tags (promotes reuse of existing hierarchy).
 */
export function filterTagSuggestions(all: TagSuggestion[], query: string, existing: string[], limit = 8): TagSuggestion[] {
  const q = query.trim().toLowerCase();
  const have = new Set(existing.map((t) => t.toLowerCase()));
  return all
    .filter((t) => !have.has(t.tag.toLowerCase()))
    .filter((t) => (q === "" ? true : t.tag.toLowerCase().includes(q)))
    .slice(0, limit);
}
