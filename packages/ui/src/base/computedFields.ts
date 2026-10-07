import { capitalizeFirst, formatDateValue, parseWikiLinkValue, toIsoDateTime } from "./propertyModel";

/**
 * Human-readable, localized label of a column: the built-in file properties
 * get proper names instead of their raw keys, note properties honour an
 * Obsidian `displayName` (kept verbatim on `_obsidian.properties`) and
 * otherwise show their bare frontmatter key with a capital first letter
 * (display only — the key on disk stays as it is).
 *
 * Shared since 2026-10-06: the desktop had this in its base viewer, the phone
 * a shorter copy that knew two of the six file columns.
 */
export function baseColumnLabel(col: string, t: (key: string, fallback?: string) => string, dbConfig?: unknown): string {
  if (col === "file.name") return t("database.colFileName", "Name");
  if (col === "file.mtime") return t("database.colModified", "Geändert");
  if (col === "file.size") return t("database.colSize", "Größe");
  if (col === "file.path") return t("database.colPath", "Pfad");
  if (col === "file.tasks") return t("database.colChecklist", "Checkliste");
  // The day a daily note's FILE NAME stands for (plan Journal-Erweiterungen, X8).
  if (col === "file.day") return t("database.colDay");
  if (col.startsWith("file.")) return col.slice(5);
  const bare = col.replace(/^note\./, "");
  const properties = (dbConfig as { _obsidian?: { properties?: Record<string, { displayName?: unknown }> } } | null | undefined)?._obsidian?.properties;
  const displayName = properties?.[`note.${bare}`]?.displayName ?? properties?.[bare]?.displayName;
  if (typeof displayName === "string" && displayName.trim()) return displayName;
  return capitalizeFirst(bare);
}

/**
 * The columns of a database that are NOT a property of the note (plan Befunde
 * 2026-10-06, decision E1).
 *
 * The sidebar's database section used to list every column of the view with
 * its value — and for most notes that was the same three values the properties
 * section showed directly below, in another form. Now a column that is a
 * property is shown once, under Properties, and the database section keeps
 * what only the database knows: values that are COMPUTED when the view is
 * read and stand in no file.
 *
 *  - `rollup`:  aggregated from the notes a link column points at,
 *  - `reverse`: the notes that point at this one through a relation,
 *  - `file`:    a fact about the file (changed, size, the day its name stands for),
 *  - `formula`: an Obsidian formula column, where a view carries one.
 *
 * Both shells classify with this one function, so "what is a property" cannot
 * mean two things.
 */
export type ComputedFieldKind = "rollup" | "reverse" | "file" | "formula";

export interface NoteComputedField {
  /** Column id as the view names it, without the `note.` prefix (`file.mtime`, `Offene`). */
  column: string;
  kind: ComputedFieldKind;
  /** The value as the database's query delivers it. */
  value: unknown;
  /** Rollup function, for the few that format their number (`percentWhere`, `earliest`, `latest`). */
  rollupFn?: string;
}

/**
 * `file.*` columns that say where the note is and what it is called. The note
 * shows both in its own head; a row "Name: <the title>" would be the very
 * repetition this section is meant to end.
 */
const IDENTITY_FILE_COLUMNS: ReadonlySet<string> = new Set(["file.name", "file.basename", "file.path", "file.folder", "file.ext"]);

interface ColumnSchemaLike {
  rollup?: { fn?: unknown } | null;
  reverseOf?: { property?: unknown } | null;
}

/** The kind of a view column, or null when it is a property of the note. */
export function computedFieldKind(column: string, schema: ColumnSchemaLike | null | undefined): ComputedFieldKind | null {
  if (column.startsWith("file.")) return IDENTITY_FILE_COLUMNS.has(column) ? null : "file";
  if (column.startsWith("formula.")) return "formula";
  if (schema?.rollup && typeof schema.rollup === "object") return "rollup";
  if (schema?.reverseOf && typeof schema.reverseOf === "object") return "reverse";
  return null;
}

/** True for a view column the note carries itself — a `file.*` identity column is neither. */
export function isPropertyColumn(column: string, schema: ColumnSchemaLike | null | undefined): boolean {
  return !column.startsWith("file.") && !column.startsWith("formula.") && computedFieldKind(column, schema) === null;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** `1.5 KB` — the size of a file the way every list in the app writes it. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return String(bytes);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(1)} ${units[i]}`;
}

function plainText(value: unknown): string {
  if (value === true) return "☑";
  if (value === false) return "☐";
  if (Array.isArray(value)) return value.map(plainText).filter((part) => part !== "").join(", ");
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  const text = String(value);
  return parseWikiLinkValue(text)?.display ?? text;
}

/**
 * A computed field as text — what the phone's sheet shows and what a tooltip
 * can carry. Empty when there is nothing to show (the caller decides between
 * a dash and leaving the row out).
 */
export function computedFieldText(field: NoteComputedField, locale: string): string {
  const { value, column } = field;
  if (isMissing(value)) return "";
  if (field.kind === "rollup") {
    if (field.rollupFn === "percentWhere") return `${plainText(value)} %`;
    if ((field.rollupFn === "earliest" || field.rollupFn === "latest") && typeof value === "string") {
      return formatDateValue(value, false, locale, "long");
    }
    return plainText(value);
  }
  if (column === "file.mtime" || column === "file.ctime") {
    const date = new Date(Number(value));
    return Number.isNaN(date.getTime()) ? plainText(value) : formatDateValue(toIsoDateTime(date), true, locale, "long");
  }
  if (column === "file.size") return formatByteSize(Number(value));
  if (column === "file.day" && typeof value === "string") return formatDateValue(value, false, locale, "long");
  return plainText(value);
}

/** "Status, Date, Tags" in the language's own list form. */
export function listNames(names: readonly string[], locale: string): string {
  // `Intl.ListFormat` is newer than the library target this package compiles
  // against, and older WebViews may lack it; a comma list is the fallback.
  type ListFormatter = new (locale: string, options: { style: "short"; type: "unit" }) => { format(list: readonly string[]): string };
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatter }).ListFormat;
  try {
    if (ListFormat) return new ListFormat(locale, { style: "short", type: "unit" }).format(names);
  } catch {
    /* an unknown locale: fall through */
  }
  return names.join(", ");
}

/** The fields worth a row: a formula Plainva did not evaluate has no value and is left out. */
export function shownComputedFields(fields: readonly NoteComputedField[]): NoteComputedField[] {
  return fields.filter((field) => field.kind !== "formula" || !isMissing(field.value));
}
