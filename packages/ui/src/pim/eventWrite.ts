import { eventSubstanceOf, PimConflictError, type PimEventDraft, type PimEventRef, type PimEventRow, type IPimTarget } from "@plainva/core";
import { logDiagnostic } from "../services/diagnosticsLog";
import type { EtagStamp } from "./pendingEventWrites";

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
    // Only where the draft says something about the linkage (K3). The views
    // lay this row over the one they hold, and a key that is merely absent
    // from an ordinary edit took the blocker's link off the row until the
    // next pull — the chain mark went, and so did everything that reads it.
    ...(draft.blockOf !== undefined ? { blockOf: draft.blockOf ?? undefined } : {}),
    ...(draft.blocks !== undefined ? { blocks: draft.blocks.length > 0 ? draft.blocks : undefined } : {}),
  };
}

/**
 * The etag a write left an event with, as the change the views hold until the
 * next pull (issue 119, R2) - or nothing, where the provider named none or the
 * etag did not change. See `EtagStamp`.
 */
export function etagStamp(
  event: Pick<PimEventRow, "accountId" | "calendarId" | "uid" | "etag" | "href">,
  etag: string | undefined,
): EtagStamp[] {
  if (!etag || etag === event.etag) return [];
  return [{ kind: "stamp", ref: { accountId: event.accountId, calendarId: event.calendarId, uid: event.uid }, ...(event.href ? { href: event.href } : {}), from: event.etag, etag }];
}

/** What a delete is sent with: the event's guard, and what the person saw of it (R2). */
type DeleteSubject = Pick<PimEventRow, "accountId" | "calendarId" | "uid" | "etag" | "href"> &
  Partial<Pick<PimEventRow, "title" | "start" | "allDay" | "recurrence" | "seriesMaster">>;

function deleteRef(event: DeleteSubject, anyway: boolean): PimEventRef {
  const ref: PimEventRef = { calendarId: event.calendarId, uid: event.uid, etag: event.etag, href: event.href };
  // "Delete anyway" was asked about a state that had changed: no second
  // judgement of it, only the guard the person was shown.
  if (anyway || event.start === undefined || event.title === undefined) return ref;
  return { ...ref, expect: eventSubstanceOf({ uid: event.uid, title: event.title, start: event.start, allDay: !!event.allDay, recurrence: event.recurrence, seriesMaster: event.seriesMaster }) };
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

/**
 * One line per write for the diagnostics log (issue 119): which provider, how
 * long the target took to build and how long the call itself took. The target
 * is built per write — reading the sign-in, for the cloud providers refreshing
 * it — and without the two numbers side by side nobody can tell which half of
 * a slow save to look at. No title, no calendar name.
 */
async function timedWrite<T>(targets: EventTargets, accountId: string, what: string, call: (target: IPimTarget) => Promise<T>, missing: string): Promise<T> {
  const started = Date.now();
  const target = await targets.targetFor(accountId);
  if (!target) throw new Error(missing);
  const built = Date.now();
  let outcome = "ok";
  try {
    return await call(target);
  } catch (error) {
    outcome = error instanceof PimConflictError ? "conflict" : "refused";
    throw error;
  } finally {
    logDiagnostic("pim", `event ${what} (${target.provider}): target ${built - started} ms, provider ${Date.now() - built} ms, ${outcome}`);
  }
}

export async function createCalendarEvent(
  targets: EventTargets,
  accountId: string,
  calendarId: string,
  draft: PimEventDraft,
  // A create cannot conflict: there is nothing there yet to have moved.
): Promise<{ kind: "written"; rows: PimEventRow[] }> {
  const res = await timedWrite(targets, accountId, "create", (target) => target.createEvent(calendarId, draft), "no writable target for this account");
  return { kind: "written", rows: [{ ...draftToRow(accountId, calendarId, res.uid, draft), etag: res.etag, href: res.href }] };
}

/**
 * Updates an event — including a move to another calendar, which every
 * provider models as "create there, delete here" rather than a move.
 */
export async function updateCalendarEvent(
  targets: EventTargets,
  event: DeleteSubject,
  draft: PimEventDraft,
  moveTo?: { accountId: string; calendarId: string } | null,
): Promise<EventWriteOutcome> {
  const moving = !!moveTo && (moveTo.accountId !== event.accountId || moveTo.calendarId !== event.calendarId);
  if (moving) {
    const res = await timedWrite(targets, moveTo!.accountId, "move/create", (target) => target.createEvent(moveTo!.calendarId, draft), "no writable target for the destination account");
    const rows = [{ ...draftToRow(moveTo!.accountId, moveTo!.calendarId, res.uid, draft), etag: res.etag, href: res.href }];
    const removed = { accountId: event.accountId, calendarId: event.calendarId, uid: event.uid };
    try {
      const oldTarget = await targets.targetFor(event.accountId);
      if (oldTarget) {
        await oldTarget.deleteEvent(deleteRef(event, false));
      }
    } catch (error) {
      // The copy exists. A failed source delete leaves a duplicate after the
      // refresh — visible and fixable, unlike a lost event.
      return { kind: "duplicate", rows, error };
    }
    return { kind: "written", rows, removed };
  }

  let written: { etag?: string };
  try {
    written = await timedWrite(
      targets,
      event.accountId,
      "update",
      (target) => target.updateEvent({ calendarId: event.calendarId, uid: event.uid, etag: event.etag, href: event.href }, draft),
      "no writable target for this account",
    );
  } catch (err) {
    if (err instanceof PimConflictError) return { kind: "conflict" };
    throw err;
  }
  // The etag the provider answered with, never the one the write was sent
  // with (issue 119, R2): that one is exactly what the write made stale, and
  // the next delete sent with it was refused as "changed elsewhere".
  return {
    kind: "written",
    rows: [{ ...draftToRow(event.accountId, event.calendarId, event.uid, draft), etag: written.etag, href: event.href }],
  };
}

/**
 * What "delete all events" of a series is written against (issue 119). The
 * series' own row where the cache has it. Where it does not, the occurrence
 * still names everything the provider needs: the series id (`seriesMaster`)
 * and, for CalDAV, the object the series lives in (`href`) - with its etag,
 * which the object shares with every occurrence of it. The other providers
 * give an occurrence its own etag, so none is sent there. Until now a missing
 * master row ended in "Saving to the provider failed." and nothing was deleted.
 * The device's own calendars are the exception (see below).
 */
export function seriesDeleteSubject(occurrence: PimEventRow, master: PimEventRow | null, provider?: string): PimEventRow | null {
  if (master) return master;
  if (!occurrence.seriesMaster) return null;
  // The device's calendar store addresses a series only through an
  // occurrence: its "series id" names the FIRST occurrence, and deleting that
  // removes one event, not the series. No fallback there - the refusal stays.
  if (provider === "device") return null;
  // `RRULE` without a rule is how the cache names a series whose rule it has
  // not read: this IS a series, only its rule and its first start are not
  // known here - and a delete that has to judge a moved etag (R2) must not
  // take the occurrence's start for the series'.
  return { ...occurrence, uid: occurrence.seriesMaster, seriesMaster: undefined, recurrence: "RRULE", etag: occurrence.href ? occurrence.etag : undefined };
}

/**
 * Deletes an event. The provider is told what the person saw of it, so a guard
 * that is only behind - the server spelled the event anew - costs one more
 * request instead of a "changed elsewhere" (R2). A real change still comes back
 * as `PimConflictError`, carrying the etag to send when the person says
 * "delete anyway"; that second call passes `anyway` with that etag on `event`.
 *
 * Returns the etag a series was left with when ONE occurrence was deleted.
 */
export async function deleteCalendarEvent(
  targets: EventTargets,
  event: DeleteSubject,
  options: { anyway?: boolean } = {},
): Promise<{ etag?: string } | void> {
  return timedWrite(
    targets,
    event.accountId,
    "delete",
    (target) => target.deleteEvent(deleteRef(event, options.anyway === true)),
    "no writable target for this account",
  );
}
