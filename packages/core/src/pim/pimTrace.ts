/**
 * The task trace - a diagnostic aid, off unless somebody switches it on
 * (finding 2026-09-19).
 *
 * "A task I tick off at the provider is not ticked off here" cannot be settled
 * from the code: the sync mirrors what the API returns, and what the API returns
 * for a recurring task is the provider's own model. The trace keeps the rows of
 * a pull AS THEY CAME OVER THE WIRE, reduced to the fields a sync question needs:
 * identity, state, dates, revision. No notes, no links, no tokens; a title is cut
 * to a few characters and travels with a hash, so rows of one series can be told
 * apart from rows that merely look alike.
 *
 * Core only offers the seam. Whether anything listens, where the rows are kept
 * and how they leave the device is the shell's business.
 */

export interface PimTaskTraceRow {
  id: string;
  status?: string;
  hidden?: boolean;
  deleted?: boolean;
  due?: string;
  completed?: string;
  updated?: string;
  etag?: string;
  parent?: string;
  position?: string;
  /** The first characters of the title, enough to recognise one's own task. */
  title: string;
  /** FNV-1a of the full title: equal titles are equal here, and nothing can be read back. */
  titleHash: string;
}

export interface PimTaskTrace {
  provider: string;
  listId: string;
  /** Epoch milliseconds of the pull. */
  at: number;
  rows: PimTaskTraceRow[];
}

export type PimTraceSink = (trace: PimTaskTrace) => void;

const TITLE_CHARS = 16;
let sink: PimTraceSink | null = null;

/** Installs (or, with null, removes) the listener. One at a time - the last call wins. */
export function setPimTraceSink(next: PimTraceSink | null): void {
  sink = next;
}

/** Providers ask this first, so a pull pays nothing while the trace is off. */
export function pimTraceEnabled(): boolean {
  return sink !== null;
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Reduces a provider's task to a trace row. Unknown fields never pass: the row is built, not copied. */
export function pimTaskTraceRow(raw: {
  id: string; title?: string; status?: string; hidden?: boolean; deleted?: boolean; due?: string;
  completed?: string; updated?: string; etag?: string; parent?: string; position?: string;
}): PimTaskTraceRow {
  const title = raw.title ?? "";
  const row: PimTaskTraceRow = { id: raw.id, title: title.length > TITLE_CHARS ? `${title.slice(0, TITLE_CHARS)}…` : title, titleHash: fnv1a(title) };
  if (raw.status !== undefined) row.status = raw.status;
  if (raw.hidden !== undefined) row.hidden = raw.hidden;
  if (raw.deleted !== undefined) row.deleted = raw.deleted;
  if (raw.due !== undefined) row.due = raw.due;
  if (raw.completed !== undefined) row.completed = raw.completed;
  if (raw.updated !== undefined) row.updated = raw.updated;
  if (raw.etag !== undefined) row.etag = raw.etag;
  if (raw.parent !== undefined) row.parent = raw.parent;
  if (raw.position !== undefined) row.position = raw.position;
  return row;
}

/** Hands one pull to the listener. A listener that throws must never break a sync. */
export function tracePimTasks(provider: string, listId: string, rows: PimTaskTraceRow[], at: number = Date.now()): void {
  if (!sink) return;
  try {
    sink({ provider, listId, at, rows });
  } catch {
    /* diagnostics are best effort */
  }
}
