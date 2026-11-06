import { rewriteNoteProperties, type RewriteResult } from "./bulkSetProperty";
import { withColumnValues } from "./propertyModel";
import type { PropertyWriteAdapter } from "./writeProperty";

/**
 * A date column switched between "Date only" and "Date & time" (Sammelplan
 * § 3.71 no. 2).
 *
 * The type and the values have to keep agreeing: a column typed "Date & time"
 * whose notes hold bare days shows no time anywhere, and one typed "Date only"
 * whose notes hold moments shows a time it says it does not have. So a switch
 * rewrites the values in the notes — a day gets 12:00, a moment loses its time
 * (and that loses something, so it is asked first). The desktop did this in
 * the view settings of a calendar or timeline only; its column editor and the
 * phone's property sheet set the type and left the notes as they were. One
 * rule now, for every place a column changes between the two.
 */

export type DateInput = "date" | "datetime";

export function isDateInput(value: unknown): value is DateInput {
  return value === "date" || value === "datetime";
}

/**
 * The date type a column switches to, or null where the change is no switch
 * between the two date types — a column becoming a date for the first time,
 * a date becoming text, no change at all. Only a switch rewrites values.
 */
export function dateInputSwitch(from: unknown, to: unknown): DateInput | null {
  if (!isDateInput(to)) return null;
  // An untyped column is read as a day by the index; only a declared moment is one.
  const current: DateInput | null = from === "datetime" ? "datetime" : from === "date" ? "date" : null;
  return current !== null && current !== to ? to : null;
}

/** Whether switching to `to` drops what a value holds — the question in front of it. */
export function dateSwitchLosesTime(to: DateInput): boolean {
  return to === "date";
}

/**
 * One stored value under the new type. A day gets 12:00 when the column takes
 * a time; a moment keeps its day when it does not. What is no date (a text,
 * an empty value, a list) stays as it is.
 */
export function convertDateValue(value: unknown, to: DateInput): unknown {
  if (typeof value !== "string" || value === "") return value;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return value;
  if (to === "datetime") return value.length > 10 ? value : `${day}T12:00`;
  return day;
}

/**
 * Rewrites the values of `fields` in the notes at `paths` for the new type —
 * each under the key the note carries it, in any casing. Goes on past a note
 * it cannot write and answers which ones those were.
 */
export function convertDateColumns(
  adapter: PropertyWriteAdapter,
  paths: readonly string[],
  fields: readonly string[],
  to: DateInput
): Promise<RewriteResult> {
  return rewriteNoteProperties(adapter, paths, (props) => withColumnValues(props, fields, (value) => convertDateValue(value, to)));
}
