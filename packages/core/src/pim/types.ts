/**
 * PIM object sync (Gesamtplan PIM-Ausbau 2026-07-17): calendars and tasks
 * mirrored from external providers. This is a SEPARATE axis from the file
 * sync — objects are keyed by provider UID, live in cache tables of the index
 * DB (never as thousands of vault files), and only deliberately promoted
 * items become notes. The adapter contract mirrors the ISyncTarget philosophy
 * (injectable fetch, provider-agnostic shapes), but is object- not path-based.
 */

export type PimProviderId = "caldav" | "google" | "microsoft";

export interface PimCalendar {
  /** Provider-side calendar id (Google id, Graph id, CalDAV collection href). */
  id: string;
  name: string;
  /** Provider hex color when available (display tint). */
  color?: string;
  /** Primary/default calendar of the account. */
  primary?: boolean;
  /** CalDAV: the collection also stores VTODO items (task list capability). */
  supportsTasks?: boolean;
  /** Provider marks the calendar read-only for this user. */
  readOnly?: boolean;
}

export interface PimEventTime {
  /** UTC instant in ms for timed events; for all-day events the UTC midnight
   * of `date` (kept filled so SQL range queries need one column pair). */
  ts: number;
  /** All-day events carry the civil date (YYYY-MM-DD) — a date must never
   * shift through timezone conversion. */
  date?: string;
}

/** iCal PARTSTAT-style participation status, provider-normalised. */
export type PimAttendeeStatus = "accepted" | "declined" | "tentative" | "needsAction";

export interface PimAttendee {
  name: string;
  email?: string;
  status: PimAttendeeStatus;
  /** True for the account user's own attendee entry. */
  self?: boolean;
  organizer?: boolean;
}

export interface PimEvent {
  /** Instance key: the provider event/instance id; expanded recurrence
   * instances carry their own id (Google/Graph) or `uid#<recurrenceId>`
   * (CalDAV expansion). */
  uid: string;
  calendarId: string;
  title: string;
  start: PimEventTime;
  end: PimEventTime;
  allDay: boolean;
  location?: string;
  description?: string;
  /** Display names or addresses, provider-normalized. */
  attendees?: string[];
  /** Detailed attendees with their RSVP status — the "back-channel" that shows
   * who accepted/declined an invitation. `attendees` stays the plain name list
   * for compact display. */
  rsvps?: PimAttendee[];
  /** The account user's own RSVP status when they are an invited attendee
   * (drives the accept/decline buttons); undefined when they are the organiser
   * or not on the attendee list. */
  selfResponse?: PimAttendeeStatus;
  status?: "confirmed" | "tentative" | "cancelled";
  etag?: string;
  /** Master uid when this row is an expanded instance of a series. */
  seriesMaster?: string;
  /** RRULE text on series masters (display badge; expansion is provider- or
   * ical.js-side). */
  recurrence?: string;
  /** CalDAV object href (the write path addresses objects by href). */
  href?: string;
  /** Per-event colour override (CSS colour / hex), overriding the calendar
   * colour on the grid. CalDAV `COLOR` (RFC 7986) / Google `colorId` mapping. */
  color?: string;
}

export interface PimTaskList {
  id: string;
  name: string;
}

export interface PimTask {
  uid: string;
  listId: string;
  title: string;
  notes?: string;
  /** ISO date (YYYY-MM-DD); providers with datetimes are truncated to the day
   * (Plainva's task due is day-granular, matching the 📅 convention). */
  due?: string;
  completed: boolean;
  etag?: string;
  /** Provider modification stamp (ms) when available. */
  updatedTs?: number;
  /** CalDAV VTODO object href. */
  href?: string;
}

/** Injectable token supply: the shell owns refresh + rotation persistence;
 * adapters just ask (force=true after a 401 to bypass caches). */
export interface PimAuthProvider {
  getAccessToken(force?: boolean): Promise<string>;
}

export interface PullEventsResult {
  events: PimEvent[];
}

export interface PullTasksResult {
  tasks: PimTask[];
}

// ---- write side (stage 3: single events + tasks; recurrence is stage 4) ----

/** Simple recurrence choice for freshly CREATED events (stage 4). Editing an
 * existing series' rule stays provider-side — the write paths only ever touch
 * a series via "this instance" overrides or the master's non-rule fields. */
export type PimRecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

/** The editable fields of an event. */
export interface PimEventDraft {
  title: string;
  start: PimEventTime;
  end: PimEventTime;
  allDay: boolean;
  location?: string;
  description?: string;
  /** Per-event colour (CSS colour / hex). Written to the provider where
   * supported (CalDAV COLOR, Google colorId); undefined clears it. */
  color?: string;
  /** Create only: attach a simple no-end recurrence rule. Ignored on update
   * (an existing rule is never rewritten by the field editor). */
  recurrenceFreq?: PimRecurrenceFreq;
}

/** Addresses an existing event for update/delete. `etag` (when known) arms
 * the optimistic-concurrency guard; CalDAV additionally needs the `href`. */
export interface PimEventRef {
  calendarId: string;
  uid: string;
  etag?: string;
  href?: string;
}

export interface PimTaskDraft {
  title: string;
  /** ISO date (YYYY-MM-DD), day-granular like PimTask.due. */
  due?: string;
  notes?: string;
  completed: boolean;
}

export interface PimTaskRef {
  listId: string;
  uid: string;
  etag?: string;
  href?: string;
}

export interface PimWriteResult {
  uid: string;
  etag?: string;
  href?: string;
}

/** The remote object changed since we last saw it (HTTP 412 / etag mismatch).
 * Callers re-pull and re-reconcile instead of overwriting blindly — the same
 * philosophy as the file sync's remoteEtag guard. */
export class PimConflictError extends Error {
  constructor(message = "remote object changed (etag mismatch)") {
    super(message);
    this.name = "PimConflictError";
  }
}

/**
 * Read side of a PIM provider (stage 2). Event pulls are WINDOWED full
 * refreshes: the caller passes a rolling time range and replaces the cache
 * window in one transaction — deliberately simpler and more robust than
 * per-provider delta cursors (personal calendars are small; deltas are a
 * later optimization, the cache schema already carries a cursor slot).
 */
export interface IPimTarget {
  readonly provider: PimProviderId;
  listCalendars(): Promise<PimCalendar[]>;
  /** All event instances of the calendar overlapping [rangeStart, rangeEnd)
   * (UTC ms). Recurring series arrive EXPANDED (server-side for Google/Graph,
   * ical.js for CalDAV) plus one master row carrying `recurrence`. */
  pullEvents(calendarId: string, rangeStartTs: number, rangeEndTs: number): Promise<PullEventsResult>;
  listTaskLists(): Promise<PimTaskList[]>;
  pullTasks(listId: string): Promise<PullTasksResult>;
  /** Creates a single event; recurring events are out of scope until stage 4. */
  createEvent(calendarId: string, draft: PimEventDraft): Promise<PimWriteResult>;
  /** Updates a single event. Throws PimConflictError when the remote object
   * moved past `ref.etag`. Providers preserve fields the draft does not carry
   * (partial update / read-modify-write). */
  updateEvent(ref: PimEventRef, draft: PimEventDraft): Promise<{ etag?: string }>;
  deleteEvent(ref: PimEventRef): Promise<void>;
  /** RSVP to an invitation as the account user: set the own PARTSTAT and let
   * the provider notify the organiser. Providers without native scheduling
   * (or where the user is not an attendee) may leave this undefined. */
  respondToEvent?(ref: PimEventRef, response: "accepted" | "declined" | "tentative"): Promise<void>;
  createTask(listId: string, draft: PimTaskDraft): Promise<PimWriteResult>;
  /** Updates a task (title/due/completed/notes). Etag-guarded where the
   * provider supports it (CalDAV, Graph); Google Tasks is last-write-wins. */
  updateTask(ref: PimTaskRef, draft: PimTaskDraft): Promise<{ etag?: string }>;
}
