import { rewriteNoteProperties, type RewriteResult } from "./bulkSetProperty";
import { withColumnValues } from "./propertyModel";
import type { PropertyWriteAdapter } from "./writeProperty";
import type { IndexReader } from "@plainva/core";

/**
 * A property of a database written (empty) into the notes that lack it
 * (decision F1, Sammelplan § 3.71 no. 1): asked for in a column's editor, or
 * done for a view that needs a column it has to create — a date for a
 * calendar, a selection for a board. Never implicit: a note gets a key only
 * when somebody asked for the column in every note.
 */

/** The paths of `rows` that do not carry `col` at all — on screen a count; a fill takes them from `readWholeViewRows`. */
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
export function fillMissingProperty(adapter: PropertyWriteAdapter, view: WholeViewRows, col: string): Promise<RewriteResult> {
  const paths = notesMissingProperty(view.rows, col);
  return rewriteNoteProperties(adapter, paths, (props) => withColumnValues(props, [col], (value) => (value === undefined ? "" : undefined)));
}

/**
 * Every row of a database view, read for a write that means "every note"
 * (fourth review of 11.11.): from the reader — which refuses while the index
 * is not whole, with the state it is in — and never from the rows on screen,
 * which the head's search, a chip or a copy may have narrowed. `query` is the
 * view's query as the shell builds it for its rows (sources and the view's
 * own filters). The only way to a fill: a list handed in by hand does not fit.
 */
export interface WholeViewRows {
  readonly rows: readonly Record<string, unknown>[];
  readonly wholeView: true;
}

export async function readWholeViewRows(reader: IndexReader<"queryDatabaseFiles">, query: unknown): Promise<WholeViewRows> {
  return { rows: await reader.queryDatabaseFiles(query as never), wholeView: true };
}
