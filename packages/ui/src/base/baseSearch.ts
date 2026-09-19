/**
 * The search of a database, for EVERY view (finding 2026-09-19).
 *
 * Only the pinboard had a search field, although nothing about it was the
 * pinboard's: the field and the hook match a row's visible texts at once and
 * the note bodies through the full-text index a moment later. A table with
 * three hundred rows had no way to say "the ones about Vogt". This module is
 * what the other seven views were missing — what a row is searched BY, when a
 * result goes stale, and the filter itself — so both shells feed the same hook
 * the pinboard feeds and no view grows a search of its own.
 */
import { cardRevision } from "./pinboardCache";

export { PinboardSearch as BaseSearchField, usePinboardSearch as useBaseSearch } from "./PinboardSearch";

type Row = Record<string, unknown>;

/**
 * What each row is searched by without opening its note: the name, the tags
 * and the text of every visible column as the view DISPLAYS it (a relation
 * shows a title, a date its formatted form — and that is what a reader types).
 */
export function baseSearchMetadata(
  rows: readonly Row[],
  visibleColumns: readonly string[],
  display: (row: Row, column: string) => string,
  extra?: (path: string) => readonly string[],
): Map<string, string[]> {
  return new Map(
    rows.map((row) => {
      const path = String(row["file.path"]);
      const tags = Array.isArray(row["file.tags"]) ? (row["file.tags"] as unknown[]).map(String) : [];
      return [path, [String(row["file.name"] ?? ""), ...(extra?.(path) ?? []), ...tags, ...visibleColumns.map((column) => display(row, column))]];
    }),
  );
}

/**
 * A cell as plain text, for a shell whose display formatter is not at hand where
 * the rows are narrowed (the phone filters them at the source). Lists join,
 * objects fall back to their JSON; a wiki link keeps its target's name, which
 * is what a reader types.
 */
export function plainCellText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(plainCellText).join(" ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * A cell's searchable text where a formatter IS at hand: what the view shows
 * when that is text (a formatted date, a rollup with its unit), and always the
 * plain value too. A typed cell renders as an element - a chip, a link - and
 * stringifying that yields "[object Object]", which is how a select column
 * came to be unsearchable although it stood right there on the card.
 */
export function searchableCellText(raw: unknown, shown?: unknown): string {
  const plain = plainCellText(raw);
  return typeof shown === "string" || typeof shown === "number" ? `${shown} ${plain}` : plain;
}

/** Changes whenever a row's note changed — a cached body match of the old text must not survive it. */
export function baseSearchRevision(rows: readonly Row[]): string {
  return JSON.stringify(rows.map((row) => [row["file.path"], cardRevision(row as Parameters<typeof cardRevision>[0])]));
}

/** The rows a search leaves; `null` (no query) leaves them all and keeps the array's identity. */
export function filterRowsBySearch<T extends Row>(rows: T[], matches: ReadonlySet<string> | null): T[] {
  return matches ? rows.filter((row) => matches.has(String(row["file.path"]))) : rows;
}
