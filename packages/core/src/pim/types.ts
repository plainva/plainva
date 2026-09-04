/**
 * PIM object sync (Gesamtplan PIM-Ausbau 2026-07-17): calendars and tasks
 * mirrored from external providers. This is a SEPARATE axis from the file
 * sync — objects are keyed by provider UID, live in cache tables of the index
 * DB (never as thousands of vault files), and only deliberately promoted
 * items become notes. The adapter contract mirrors the ISyncTarget philosophy
 * (injectable fetch, provider-agnostic shapes), but is object- not path-based.
 */

/**
 * Every provider there is, as a value: `providerCoverage.test.ts` reads it
 * and checks that each place that branches on the provider knows each one.
 * `device` is the phone's own calendar store (EventKit / CalendarContract,
 * 2026-09-04) — an account without a credential, held by the device.
 */
export const PIM_PROVIDER_IDS = ["caldav", "google", "microsoft", "device"] as const;
export type PimProviderId = (typeof PIM_PROVIDER_IDS)[number];

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
  /**
   * CalDAV: `false` for a collection that stores NO VEVENT — an Apple/Nextcloud
   * reminder list. Such a collection is a task list only and must never reach
   * the calendar picker: ticking it would make the worker run an event query
   * against a reminder list (issue #34). Undefined/true = event calendar, so
   * Google and Graph (whose calendars are always event calendars) need no flag.
   */
  supportsEvents?: boolean;
  /** Provider marks the calendar read-only for this user. */
  readOnly?: boolean;
}

/** Event calendars of a collection listing — see `PimCalendar.supportsEvents`. */
export function eventCalendarsOf(collections: PimCalendar[]): PimCalendar[] {
  return collections.filter((c) => c.supportsEvents !== false);
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
  /** Stable provider-side id of the original event when this event is a
   * Plainva-created blocker in another calendar. */
  blockOf?: string;
  /** Derived by the UI/cache consumer for originals; never written remotely. */
  blockedIn?: Array<{ accountId: string; calendarId: string; uid: string }>;
  /**
   * Minutes before the start at which the provider reminds, ascending and
   * de-duplicated (S9). The distinction between the two empty answers carries
   * meaning and must survive: `[]` is the event saying "remind me of NOTHING",
   * `undefined` is the event saying nothing at all — because it leans on the
   * calendar's own default, or because the provider does not expose one. A
   * reminder rule that falls back to a vault setting needs to tell those apart.
   */
  reminders?: number[];
  /** Whether the event blocks the calendar or leaves it free — CalDAV `TRANSP`,
   * Google `transparency`, Graph `showAs`. Absence means busy in all three
   * specs, so the adapters fill this in rather than leaving it open. */
  busy?: "busy" | "free";
  /** Join link of an online meeting, taken only from the field the provider
   * dedicates to it. Never guessed out of the location or the description. */
  meetingUrl?: string;
  /** Provider-side categories: Graph `categories`, CalDAV `CATEGORIES`. Google
   * Calendar has no equivalent — its colour is the closest thing, and that is
   * already `color`. */
  categories?: string[];
  /**
   * Google's status events (S24, plan P8b): a working location, focus time or
   * out-of-office entry. These are NOT appointments — nobody meets anybody at a
   * working location — so they get their own presentation rather than another
   * block in the grid.
   *
   * Only Google has them; Graph and CalDAV leave this open, and `undefined`
   * means "an ordinary event", never "unknown". Plainva reads them and never
   * writes them: creating an out-of-office entry has provider-side effects
   * (auto-decline of invitations) that a calendar view has no business
   * triggering as a side effect.
   */
  statusKind?: "workingLocation" | "focusTime" | "outOfOffice";
  /** For a working location: the place Google names — home, office or a text. */
  workingLocation?: string;
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

/**
 * One incremental step over a calendar (C2/S18).
 *
 * Modelled on the file sync's cursor pull, and it inherits its one hard rule:
 * **a delta run never derives a deletion from absence.** Only `deletedUids`
 * removes anything; an event that simply is not in this page is untouched.
 * Getting that wrong would empty a calendar quietly, and a windowed refresh —
 * which is what this replaces — cannot express "unchanged" at all.
 *
 * `nextCursor` is what to continue from. A provider that cannot answer
 * incrementally does not implement `pullEventsDelta` at all; the worker then
 * keeps doing the windowed full refresh, unchanged.
 */
export interface PullEventsDeltaResult {
  /** Events created or changed since the cursor, already expanded like `pullEvents`. */
  events: PimEvent[];
  /** Explicitly removed (or moved out of range). The ONLY source of deletions. */
  deletedUids: string[];
  /** Same, for providers that can only name the removed RESOURCE, not its UID.
   * CalDAV's `sync-collection` reports a deleted href with 404 — the object is
   * gone, so its UID cannot be read any more. */
  deletedHrefs?: string[];
  /** Cursor for the next run. Empty string means "this collection cannot do
   * deltas" — the caller stores no cursor and keeps refreshing fully. */
  nextCursor: string;
}

export interface PullTasksResult {
  tasks: PimTask[];
}

// ---- write side (stage 3: single events + tasks; recurrence is stage 4) ----

/** Simple recurrence choice for freshly CREATED events (stage 4). Editing an
 * existing series' rule stays provider-side — the write paths only ever touch
 * a series via "this instance" overrides or the master's non-rule fields. */
export type PimRecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

/** Structured recurrence (Outlook-style). Serialized to an RRULE (CalDAV/Google)
 * or Graph's recurrence object per adapter. */
export interface PimRecurrence {
  freq: PimRecurrenceFreq;
  /** Every N periods (default 1). */
  interval?: number;
  /** Weekly only: weekday codes MO,TU,WE,TH,FR,SA,SU (empty = the start day). */
  byWeekday?: string[];
  /** End condition — at most one of `until` / `count`; neither = no end. */
  until?: string; // civil date YYYY-MM-DD (inclusive)
  count?: number;
}

/** The editable fields of an event. */
export interface PimEventDraft {
  title: string;
  start: PimEventTime;
  end: PimEventTime;
  allDay: boolean;
  location?: string;
  description?: string;
  /** Pre-rendered HTML of `description` (canonical Markdown) for providers that
   * accept HTML bodies (Graph, Google, CalDAV X-ALT-DESC). Set by the desktop
   * layer alongside `description`; undefined when the description is untouched. */
  descriptionHtml?: string;
  /** Per-event colour (CSS colour / hex). Written to the provider where
   * supported (CalDAV COLOR, Google colorId); undefined clears it. */
  color?: string;
  /** Invitees (email addresses). `undefined` leaves the remote list untouched
   * (drag reschedule); an array (incl. empty) REPLACES it — new invitees are
   * added as "needs action". iMIP sending stays with the mail client. */
  attendees?: string[];
  /** Recurrence rule. `undefined` = leave the remote rule untouched (drag /
   * single-instance edits); `null` = clear it; an object = set/replace it. */
  recurrence?: PimRecurrence | null;
  /** Ask the provider to email its attendees about this create/update (Google
   * `sendUpdates=all` — the native, standards-compliant invite Gmail renders as
   * an event with the SAME uid so RSVPs sync back). Providers without server
   * scheduling (CalDAV) ignore it; there the caller sends an iMIP email itself. */
  notifyAttendees?: boolean;
  /** Original provider event id for a mirrored blocker. Adapters persist this
   * in a provider-private/custom property so it survives round-trips. */
  blockOf?: string;
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
  /** Every collection of the account — event calendars AND (CalDAV) reminder
   * lists, told apart by `supportsEvents` / `supportsTasks`. */
  listCalendars(): Promise<PimCalendar[]>;
  /** All event instances of the calendar overlapping [rangeStart, rangeEnd)
   * (UTC ms). Recurring series arrive EXPANDED (server-side for Google/Graph,
   * ical.js for CalDAV) plus one master row carrying `recurrence`. */
  pullEvents(calendarId: string, rangeStartTs: number, rangeEndTs: number): Promise<PullEventsResult>;
  /**
   * Incremental variant (C2/S18) — optional: a provider without a change feed
   * simply omits it and keeps getting full refreshes.
   *
   * `cursor` is what a previous run returned. Passing `null` asks for a fresh
   * one WITHOUT expecting the events (the worker seeds the cursor next to a
   * full refresh, exactly as the file sync does, so the first delta run cannot
   * miss what happened in between).
   *
   * Throwing is the self-healing move: the worker drops the cursor and the next
   * cycle is a full refresh again. An expired or rejected cursor must therefore
   * never be swallowed.
   */
  pullEventsDelta?(
    calendarId: string,
    cursor: string | null,
    rangeStartTs: number,
    rangeEndTs: number
  ): Promise<PullEventsDeltaResult>;
  /**
   * Task lists of the account. `collections` is the result of a `listCalendars`
   * call the caller already made: for CalDAV task lists ARE collections, so
   * passing it saves a second full PROPFIND per cycle — and, more importantly,
   * removes a second failure point that used to swallow the task lists whole
   * (issue #34). Providers whose task lists live behind their own API (Google
   * Tasks, Microsoft To Do) ignore the argument.
   */
  listTaskLists(collections?: PimCalendar[]): Promise<PimTaskList[]>;
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
  /**
   * Deletes a task at the provider.
   *
   * Etag-guarded where the provider supports it. A task that is already gone
   * counts as deleted (404/410 are success) — the not-found-on-delete lesson
   * the file sync learned: the caller's goal is "it is not there", and an error
   * would make a retry loop out of an achieved state.
   */
  deleteTask(ref: PimTaskRef): Promise<void>;
}
