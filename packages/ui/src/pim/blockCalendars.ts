import { PimRequestError, type IPimTarget, type PimEventDraft, type PimEventRow, type PimRecurrence, type PimWriteResult } from "@plainva/core";
import { markdownToHtml } from "../lib/markdownToHtml";

/**
 * "Block in other calendars" — the shared half (C33, 2026-09-04): the draft
 * builder and the runner live here so the phone mirrors an event through
 * exactly the desktop's code; the shells only differ in how the calendars
 * are picked (dialog ↔ multi-select sheet).
 *
 * The runner is the part that can be tested (K9, finding 2026-09-03): one draft written into each chosen calendar, every failure
 * kept WITH its reason. The view used to catch without binding the error, so
 * a 403 for a missing scope, a 404 for a calendar that is gone and a network
 * failure all became the same sentence.
 */
export interface CalendarBlockFailure {
  key: string;
  accountId: string;
  label: string;
  reason: string;
  /** HTTP status where the provider answered; null for a local failure. */
  status: number | null;
}

export interface CalendarBlockOutcome {
  ok: number;
  failed: CalendarBlockFailure[];
}

export interface RunCalendarBlocksInput {
  /** `${accountId} ${calendarId}` keys, as the block dialog hands them out. */
  keys: readonly string[];
  labelFor: (key: string) => string;
  /** The account's target, or the reason there is none. */
  targetFor: (accountId: string) => Promise<{ target: IPimTarget | null; reason?: string }>;
  draft: PimEventDraft;
  onCreated?: (accountId: string, calendarId: string, result: PimWriteResult) => void;
}

export function blockFailureReason(error: unknown): string {
  if (error instanceof PimRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function blockFailureStatus(error: unknown): number | null {
  return error instanceof PimRequestError ? error.status : null;
}

/** True when the provider refused for want of a right: a fresh sign-in is the fix to offer. */
export function isAuthorizationFailure(failure: CalendarBlockFailure): boolean {
  return failure.status === 401 || failure.status === 403;
}

export async function runCalendarBlocks(input: RunCalendarBlocksInput): Promise<CalendarBlockOutcome> {
  let ok = 0;
  const failed: CalendarBlockFailure[] = [];
  for (const key of input.keys) {
    const [accountId, ...rest] = key.split(" ");
    const calendarId = rest.join(" ");
    if (!accountId || !calendarId) continue;
    const label = input.labelFor(key);
    const found = await input.targetFor(accountId);
    if (!found.target) {
      failed.push({ key, accountId, label, reason: found.reason ?? "no target", status: null });
      continue;
    }
    try {
      const result = await found.target.createEvent(calendarId, input.draft);
      input.onCreated?.(accountId, calendarId, result);
      ok += 1;
    } catch (error) {
      failed.push({ key, accountId, label, reason: blockFailureReason(error), status: blockFailureStatus(error) });
    }
  }
  return { ok, failed };
}

/** Builds a draft that mirrors an event into ANOTHER calendar as a blocker
 * (calendar #1, Notion-Calendar style): either an opaque "Busy" placeholder or
 * a full copy with details. A recurrence (from the source series' master) makes
 * the block recur too. Pure. */
export function buildBlockDraft(
  e: Pick<PimEventRow, "uid" | "title" | "allDay" | "start" | "end" | "location" | "description">,
  mode: "busy" | "details",
  busyLabel: string,
  recurrence?: PimRecurrence | null
): PimEventDraft {
  return {
    title: mode === "busy" ? busyLabel : e.title,
    allDay: e.allDay,
    start: e.allDay && e.start.date ? { ts: e.start.ts, date: e.start.date } : { ts: e.start.ts },
    end: e.allDay && e.end.date ? { ts: e.end.ts, date: e.end.date } : { ts: e.end.ts },
    location: mode === "details" ? e.location ?? undefined : undefined,
    description: mode === "details" ? e.description ?? undefined : undefined,
    descriptionHtml: mode === "details" && e.description ? markdownToHtml(e.description) : undefined,
    recurrence: recurrence ?? undefined,
    blockOf: e.uid,
  };
}
