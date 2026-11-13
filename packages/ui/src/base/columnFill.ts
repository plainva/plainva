import { rewriteNoteProperties, type RewriteResult } from "./bulkSetProperty";
import { withColumnValues } from "./propertyModel";
import type { PropertyWriteAdapter } from "./writeProperty";
import type { WholeRows } from "@plainva/core";

/**
 * A property of a database written (empty) into the notes that lack it
 * (decision F1, Sammelplan § 3.71 no. 1): asked for in a column's editor, or
 * done for a view that needs a column it has to create — a date for a
 * calendar, a selection for a board. Never implicit: a note gets a key only
 * when somebody asked for the column in every note.
 */

/** The paths of the shown rows that do not carry `col` at all — a count to show; a fill takes them with `requireWholeRows`. */
export function notesMissingProperty(rows: readonly Record<string, unknown>[], col: string): string[] {
  return rows.flatMap((row) => {
    const path = row["file.path"];
    return typeof path === "string" && path !== "" && row[col] === undefined ? [path] : [];
  });
}

/**
 * Writes `col` (empty) into the notes at `paths` — under the key a note
 * carries it, in any casing (3.144 no. 3). A note that turns out to carry
 * the key (the index was behind) is left as it is, an empty `key:` too: its
 * text keeps its form. Goes on past a note it cannot write and answers which
 * ones those were.
 */
export function fillMissingProperty(adapter: PropertyWriteAdapter, paths: readonly string[], col: string, _whole: WholeRows): Promise<RewriteResult> {
  // `_whole`: the rows the paths come from were asked whether they are whole
  // (`requireWholeRows`, third review of 11.11.) — "every note" over half an
  // index fills half the notes and says it filled them all.
  return rewriteNoteProperties(adapter, paths, (props) => withColumnValues(props, [col], (value) => (value === undefined ? "" : undefined)));
}
