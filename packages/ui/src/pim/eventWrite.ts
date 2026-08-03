import { PimConflictError, type PimEventDraft, type PimEventRow, type IPimTarget } from "@plainva/core";

/**
 * Writing a calendar event, in ONE place (S24).
 *
 * The interesting parts are not the provider calls — those live in the targets.
 * They are the three rules around them, and all three were desktop-only:
 *
 *  - a MOVE to another calendar is a create plus a delete, in that order, and a
 *    failed delete leaves a duplicate rather than losing the event,
 *  - a remote that moved under us (`PimConflictError`) is not an error to show
 *    but a signal to re-pull and let the user edit the fresh state,
 *  - a just-written event appears at once, from a row synthesized out of the
 *    draft, because waiting for the next provider pull feels broken.
 *
 * A second shell guessing at these produces duplicates and lost edits on
 * somebody's real calendar, so the phone calls this rather than its own copy.
 */

/** A single-occurrence row synthesized from a draft, for instant feedback. */
export function draftToRow(
  accountId: string,
  calendarId: string,
  uid: string,
  draft: PimEventDraft,
): PimEventRow {
  return {
    uid,
    accountId,
    calendarId,
    title: draft.title,
    start: draft.start,
    end: draft.end,
    allDay: draft.allDay,
    location: draft.location,
    description: draft.description,
    color: draft.color,
    attendees: draft.attendees,
    blockOf: draft.blockOf,
  };
}

/** Match a cache row to a provider ref (account + calendar + instance uid). */
export function sameEventRef(
  e: PimEventRow,
  ref: { accountId: string; calendarId: string; uid: string },
): boolean {
  return e.accountId === ref.accountId && e.calendarId === ref.calendarId && e.uid === ref.uid;
}

export type EventWriteOutcome =
  /** Written; `rows` replaces the affected rows optimistically. */
  | { kind: "written"; rows: PimEventRow[]; removed?: { accountId: string; calendarId: string; uid: string } }
  /** The remote moved first — nothing was written, re-pull and reopen. */
  | { kind: "conflict" }
  /** Written, but the source copy of a move could not be deleted. */
  | { kind: "duplicate"; rows: PimEventRow[]; error: unknown };

export interface EventTargets {
  /** The provider target of an account, or null when it cannot be built. */
  targetFor(accountId: string): Promise<IPimTarget | null>;
}

export async function createCalendarEvent(
  targets: EventTargets,
  accountId: string,
  calendarId: string,
  draft: PimEventDraft,
  // A create cannot conflict: there is nothing there yet to have moved.
): Promise<{ kind: "written"; rows: PimEventRow[] }> {
  const target = await targets.targetFor(accountId);
  if (!target) throw new Error("no writable target for this account");
  const res = await target.createEvent(calendarId, draft);
  return { kind: "written", rows: [{ ...draftToRow(accountId, calendarId, res.uid, draft), etag: res.etag, href: res.href }] };
}

/**
 * Updates an event — including a move to another calendar, which every
 * provider models as "create there, delete here" rather than a move.
 */
export async function updateCalendarEvent(
  targets: EventTargets,
  event: Pick<PimEventRow, "accountId" | "calendarId" | "uid" | "etag" | "href">,
  draft: PimEventDraft,
  moveTo?: { accountId: string; calendarId: string } | null,
): Promise<EventWriteOutcome> {
  const moving = !!moveTo && (moveTo.accountId !== event.accountId || moveTo.calendarId !== event.calendarId);
  if (moving) {
    const newTarget = await targets.targetFor(moveTo!.accountId);
    if (!newTarget) throw new Error("no writable target for the destination account");
    const res = await newTarget.createEvent(moveTo!.calendarId, draft);
    const rows = [{ ...draftToRow(moveTo!.accountId, moveTo!.calendarId, res.uid, draft), etag: res.etag, href: res.href }];
    const removed = { accountId: event.accountId, calendarId: event.calendarId, uid: event.uid };
    try {
      const oldTarget = await targets.targetFor(event.accountId);
      if (oldTarget) {
        await oldTarget.deleteEvent({ calendarId: event.calendarId, uid: event.uid, etag: event.etag, href: event.href });
      }
    } catch (error) {
      // The copy exists. A failed source delete leaves a duplicate after the
      // refresh — visible and fixable, unlike a lost event.
      return { kind: "duplicate", rows, error };
    }
    return { kind: "written", rows, removed };
  }

  const target = await targets.targetFor(event.accountId);
  if (!target) throw new Error("no writable target for this account");
  try {
    await target.updateEvent(
      { calendarId: event.calendarId, uid: event.uid, etag: event.etag, href: event.href },
      draft,
    );
  } catch (err) {
    if (err instanceof PimConflictError) return { kind: "conflict" };
    throw err;
  }
  return {
    kind: "written",
    rows: [{ ...draftToRow(event.accountId, event.calendarId, event.uid, draft), etag: event.etag, href: event.href }],
  };
}

export async function deleteCalendarEvent(
  targets: EventTargets,
  event: Pick<PimEventRow, "accountId" | "calendarId" | "uid" | "etag" | "href">,
): Promise<void> {
  const target = await targets.targetFor(event.accountId);
  if (!target) throw new Error("no writable target for this account");
  await target.deleteEvent({ calendarId: event.calendarId, uid: event.uid, etag: event.etag, href: event.href });
}
