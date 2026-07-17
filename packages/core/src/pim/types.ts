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
  status?: "confirmed" | "tentative" | "cancelled";
  etag?: string;
  /** Master uid when this row is an expanded instance of a series. */
  seriesMaster?: string;
  /** RRULE text on series masters (display badge; expansion is provider- or
   * ical.js-side). */
  recurrence?: string;
  /** CalDAV object href (the write path addresses objects by href). */
  href?: string;
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
}
