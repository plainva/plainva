import { PimConflictError } from "./types.js";
import type {
  IPimTarget, PimCalendar, PimEvent, PimEventDraft, PimEventRef, PimTask, PimTaskDraft, PimTaskList, PimTaskRef,
  PimTaskUpdateResult, PimWriteResult, PullEventsResult, PullTasksResult,
} from "./types.js";
import { recurrenceToRRule } from "./recurrence.js";

/**
 * The device's own calendars and reminder lists as the fourth PIM provider
 * (plan EventKit / CalendarContract, 2026-09-03; E1–E9 confirmed 2026-09-04).
 *
 * On iOS this is EventKit (calendars AND reminders), on Android the
 * CalendarContract provider (calendars only — Android has no system task
 * store). The target itself knows neither: it speaks to a `DevicePimPort`
 * the shell injects, exactly as the other targets speak to a `fetch`. That is
 * what keeps this file testable on any machine with a fake port, and what
 * keeps the rest of the app untouched — the worker, the cache, the calendar
 * views and the task sync see one more `IPimTarget`.
 *
 * What the port owes the target, and why:
 *
 * - **A version per record.** EventKit has no etags; it has `lastModifiedDate`.
 *   CalendarContract has neither for clients. So the port stamps every record
 *   with a `version` string it can reproduce: the modification time where the
 *   platform has one, a hash of the visible fields where it has not. The
 *   target treats the version as the etag, and `updateEvent`/`updateTask`
 *   re-read the record before writing and throw `PimConflictError` when the
 *   version moved — the promise the contract makes stays true. The Android
 *   hash is the one place the device provider is honestly weaker (a change
 *   that leaves every visible field alone is invisible); it is in the parity
 *   catalog, not in the small print.
 * - **Expanded instances plus the series they belong to.** Both platforms
 *   expand recurring series themselves. An instance arrives with the id of
 *   its series and its own start; the target gives every instance a uid of
 *   its own (`<series>@<start>`, because the platform's identifier is the same
 *   for all occurrences) and emits ONE master row per series carrying the
 *   RRULE, which is the shape the cache and the views already know.
 * - **No change feed.** `EKEventStoreChanged` and the ContentObserver say
 *   "something changed", not what — so `pullEventsDelta` is deliberately not
 *   implemented and the worker does windowed full refreshes, as for CalDAV.
 *   The signal is used as a trigger instead (the shell listens and asks the
 *   worker for an immediate cycle).
 */
export interface DeviceCollection {
  id: string;
  title: string;
  color?: string;
  /** The account the platform files it under ("iCloud", "Exchange", a Google login). */
  source?: string;
  /** `allowsContentModifications` / `CALENDAR_ACCESS_LEVEL` — the card says "read only". */
  writable: boolean;
  kind: "event" | "reminder";
}

export interface DeviceEventRecord {
  /** The platform identifier — shared by every occurrence of a series. */
  id: string;
  /** Set on an occurrence of a recurring series (then equal to `id` of the master). */
  seriesId?: string;
  title: string;
  startTs: number;
  endTs: number;
  allDay: boolean;
  location?: string;
  notes?: string;
  url?: string;
  /** The series rule, on the master and on every occurrence ("FREQ=WEEKLY;BYDAY=MO"). */
  rrule?: string;
  /** The port's version stamp (see above). */
  version: string;
  status?: "confirmed" | "tentative" | "cancelled";
}

export interface DeviceEventDraft {
  title: string;
  startTs: number;
  endTs: number;
  allDay: boolean;
  location?: string;
  notes?: string;
  /** `null` removes a rule, `undefined` leaves it alone (a drag must not rewrite a series). */
  rrule?: string | null;
}

export interface DeviceReminderRecord {
  id: string;
  listId: string;
  title: string;
  notes?: string;
  /** Civil date or date-time the platform stores (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`). */
  due?: string;
  completed: boolean;
  version: string;
  /** `hasRecurrenceRules`: the reminder repeats. */
  recurring?: boolean;
}

/**
 * What a reminder write carries. A field left out is no instruction - with one
 * exception that is the PIM contract for every provider: a missing `due` means
 * "no due date". Left-out `notes` keep the reminder's notes; an empty string
 * clears them. The plugin's `apply` follows exactly this (finding 2026-10-24:
 * it used to clear the notes on every write that did not carry them).
 */
export interface DeviceReminderDraft {
  title: string;
  notes?: string;
  due?: string;
  completed: boolean;
}

/** Names one occurrence of a series, or a single event. */
export interface DeviceEventHandle {
  id: string;
  /** The occurrence's own start — the platform needs it to find one occurrence among many. */
  occurrenceStartTs?: number;
}

/**
 * How a platform stores the day of an all-day event. Android's CalendarContract
 * keeps it at UTC midnight (EVENT_TIMEZONE "UTC"); EventKit at local midnight.
 * Read the wrong way, an all-day event lies a day early wherever the clock is
 * behind UTC - the Americas - and one written the wrong way lands there too
 * (found 2026-11-10 with the tests at 23:59 in New York).
 */
export type DeviceAllDayAnchor = "utc" | "local";

export interface DevicePimPort {
  /** False on Android: no system task store. The target then lists no task lists. */
  readonly supportsReminders: boolean;
  /** Where the platform puts an all-day day (see `DeviceAllDayAnchor`); EventKit's local midnight when absent. */
  readonly allDayAt?: DeviceAllDayAnchor;
  listCollections(): Promise<DeviceCollection[]>;
  /** Instances overlapping [fromTs, toTs), series expanded by the platform. */
  events(calendarId: string, fromTs: number, toTs: number): Promise<DeviceEventRecord[]>;
  event(handle: DeviceEventHandle): Promise<DeviceEventRecord | null>;
  createEvent(calendarId: string, draft: DeviceEventDraft): Promise<DeviceEventRecord>;
  updateEvent(handle: DeviceEventHandle, draft: DeviceEventDraft): Promise<DeviceEventRecord>;
  /** A record that is already gone counts as deleted. */
  deleteEvent(handle: DeviceEventHandle): Promise<void>;
  reminders(listId: string): Promise<DeviceReminderRecord[]>;
  reminder(id: string): Promise<DeviceReminderRecord | null>;
  createReminder(listId: string, draft: DeviceReminderDraft): Promise<DeviceReminderRecord>;
  updateReminder(id: string, draft: DeviceReminderDraft): Promise<DeviceReminderRecord>;
  deleteReminder(id: string): Promise<void>;
}

/** Separator between a series id and an occurrence start in an instance uid. */
const OCCURRENCE_SEP = "@";

/** `<series>@<startTs>` → the handle the port needs; a plain id passes through. */
export function deviceHandleOf(uid: string): DeviceEventHandle {
  const at = uid.lastIndexOf(OCCURRENCE_SEP);
  if (at <= 0) return { id: uid };
  const ts = Number(uid.slice(at + 1));
  return Number.isFinite(ts) ? { id: uid.slice(0, at), occurrenceStartTs: ts } : { id: uid };
}

/**
 * What a device-calendar save applies to. A handle without an occurrence start
 * names the whole event (for a series: its master row, "All events"); a draft
 * that carries a rule also changes the series. Only an occurrence handle with
 * the rule left alone is "this event" (finding 2026-11-02: "All events" without
 * a rule change saved one occurrence on the iPhone).
 */
export type DeviceUpdateSpan = "occurrence" | "series";

export function deviceUpdateSpan(handle: DeviceEventHandle, draft: DeviceEventDraft): DeviceUpdateSpan {
  if (handle.occurrenceStartTs === undefined || handle.occurrenceStartTs === null) return "series";
  return "rrule" in draft ? "series" : "occurrence";
}

/** Local wall-clock reading of a timestamp as a plain number, so differences ignore DST shifts. */
function wallClock(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/** The timestamp whose local wall-clock reading is `wall`. */
function fromWallClock(wall: number): number {
  const d = new Date(wall);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()).getTime();
}

/**
 * A series-wide save arrives with the row the person edited: the series'
 * master row, whose start is the first occurrence in the pulled window - not
 * the series' own first start (finding 2026-11-02: saving "All events" moved
 * the series' start to that occurrence). The sheet opened with start W, the
 * draft carries D, the platform's true series start is F: the new start is
 * F + (D - W), computed on the wall clock so a DST change keeps the time of
 * day. A title-only edit (D = W) keeps F, a time change keeps the first date,
 * a date move moves the series by as many days. The end keeps the draft's
 * duration. Without W only the time of day is taken from the draft.
 */
export function anchorSeriesDraft(
  first: Pick<DeviceEventRecord, "startTs"> & { allDay?: boolean },
  draft: DeviceEventDraft,
  original?: { startTs: number; date?: string },
  at: DeviceAllDayAnchor = "local",
): DeviceEventDraft {
  if (draft.allDay) {
    // All-day: whole days. The draft and an all-day row are in the platform's
    // anchor (`toDeviceDraft` put the draft there); a timed row, and an opened
    // event that carries no date, name their day on the local clock.
    const draftDay = dayNumber(draft.startTs, at);
    const firstDay = dayNumber(first.startTs, first.allDay === false ? "local" : at);
    const originalDay = original ? (original.date ? Date.parse(original.date) / DAY_MS : dayNumber(original.startTs, "local")) : draftDay;
    const startDay = firstDay + (draftDay - originalDay);
    const span = dayNumber(draft.endTs, at) - draftDay;
    return { ...draft, startTs: dayStart(startDay, at), endTs: dayStart(startDay + span, at) };
  }
  const f = wallClock(first.startTs);
  const d = wallClock(draft.startTs);
  const startWall = original === undefined
    ? f - (f % 86_400_000) + (d % 86_400_000)
    : f + (d - wallClock(original.startTs));
  const endWall = startWall + (wallClock(draft.endTs) - d);
  return { ...draft, startTs: fromWallClock(startWall), endTs: fromWallClock(endWall) };
}

const DAY_MS = 86_400_000;

/** The day an all-day timestamp names, as days since 1970-01-01, read in the platform's anchor. */
function dayNumber(ts: number, at: DeviceAllDayAnchor): number {
  if (at === "utc") return Math.floor(ts / DAY_MS);
  const d = new Date(ts);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
}

/** The timestamp the platform uses for the start of a day. */
function dayStart(day: number, at: DeviceAllDayAnchor): number {
  if (at === "utc") return day * DAY_MS;
  const d = new Date(day * DAY_MS);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
}

function dayKey(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function toPimEvent(calendarId: string, r: DeviceEventRecord, at: DeviceAllDayAnchor): PimEvent {
  const series = r.seriesId ?? (r.rrule ? r.id : undefined);
  const uid = series ? `${series}${OCCURRENCE_SEP}${r.startTs}` : r.id;
  return {
    uid,
    calendarId,
    title: r.title,
    start: r.allDay ? { ts: r.startTs, date: dayKey(dayNumber(r.startTs, at)) } : { ts: r.startTs },
    end: r.allDay ? { ts: r.endTs, date: dayKey(dayNumber(r.endTs, at)) } : { ts: r.endTs },
    allDay: r.allDay,
    location: r.location,
    description: r.notes,
    meetingUrl: r.url,
    etag: r.version,
    status: r.status,
    ...(series ? { seriesMaster: series } : {}),
  };
}

function toDeviceDraft(d: PimEventDraft, at: DeviceAllDayAnchor): DeviceEventDraft {
  // An all-day draft names its days (`date`, else the UTC midnight the form
  // writes); the platform gets them in its own anchor.
  const day = (point: { ts: number; date?: string }) => (point.date ? Date.parse(point.date) / DAY_MS : Math.floor(point.ts / DAY_MS));
  return {
    title: d.title,
    startTs: d.allDay ? dayStart(day(d.start), at) : d.start.ts,
    endTs: d.allDay ? dayStart(day(d.end), at) : d.end.ts,
    allDay: d.allDay,
    location: d.location,
    notes: d.description,
    ...(d.recurrence !== undefined ? { rrule: d.recurrence ? recurrenceToRRule(d.recurrence) : null } : {}),
  };
}

function toPimTask(r: DeviceReminderRecord): PimTask {
  return {
    uid: r.id,
    listId: r.listId,
    title: r.title,
    notes: r.notes,
    due: r.due,
    completed: r.completed,
    etag: r.version,
    ...(r.recurring !== undefined ? { recurring: r.recurring } : {}),
  };
}

/** The reminder draft: only what the task draft carries (see `DeviceReminderDraft`). */
function toReminderDraft(d: PimTaskDraft): DeviceReminderDraft {
  return {
    title: d.title,
    completed: d.completed,
    ...(d.due !== undefined ? { due: d.due } : {}),
    ...(d.notes !== undefined ? { notes: d.notes } : {}),
  };
}

export class DevicePimTarget implements IPimTarget {
  readonly provider = "device" as const;

  constructor(private readonly port: DevicePimPort) {}

  private get allDayAt(): DeviceAllDayAnchor {
    return this.port.allDayAt ?? "local";
  }

  async listCalendars(): Promise<PimCalendar[]> {
    const all = await this.port.listCollections();
    return all
      .filter((c) => c.kind === "event" || this.port.supportsReminders)
      .map((c) => ({
        id: c.id,
        name: c.source ? `${c.title} · ${c.source}` : c.title,
        color: c.color,
        supportsEvents: c.kind === "event",
        supportsTasks: c.kind === "reminder",
        readOnly: !c.writable,
      }));
  }

  async pullEvents(calendarId: string, rangeStartTs: number, rangeEndTs: number): Promise<PullEventsResult> {
    const records = await this.port.events(calendarId, rangeStartTs, rangeEndTs);
    const events: PimEvent[] = [];
    const masters = new Map<string, PimEvent>();
    for (const r of records) {
      const ev = toPimEvent(calendarId, r, this.allDayAt);
      events.push(ev);
      // One master per series, carrying the rule — the views badge it and the
      // "edit all" path addresses it. Its uid is the series id itself.
      if (ev.seriesMaster && r.rrule && !masters.has(ev.seriesMaster)) {
        masters.set(ev.seriesMaster, {
          ...ev,
          uid: ev.seriesMaster,
          seriesMaster: undefined,
          recurrence: r.rrule.toUpperCase().startsWith("RRULE") ? r.rrule : `RRULE:${r.rrule}`,
        });
      }
    }
    return { events: [...events, ...masters.values()] };
  }

  async listTaskLists(collections?: PimCalendar[]): Promise<PimTaskList[]> {
    if (!this.port.supportsReminders) return [];
    const cols = collections ?? (await this.listCalendars());
    return cols.filter((c) => c.supportsTasks).map((c) => ({ id: c.id, name: c.name }));
  }

  async pullTasks(listId: string): Promise<PullTasksResult> {
    if (!this.port.supportsReminders) return { tasks: [] };
    const records = await this.port.reminders(listId);
    return { tasks: records.map(toPimTask) };
  }

  async createEvent(calendarId: string, draft: PimEventDraft): Promise<PimWriteResult> {
    const r = await this.port.createEvent(calendarId, toDeviceDraft(draft, this.allDayAt));
    return { uid: r.rrule ? `${r.id}${OCCURRENCE_SEP}${r.startTs}` : r.id, etag: r.version };
  }

  async updateEvent(ref: PimEventRef, draft: PimEventDraft): Promise<{ etag?: string }> {
    const handle = deviceHandleOf(ref.uid);
    await this.assertUnchanged(handle, ref.etag);
    let deviceDraft = toDeviceDraft(draft, this.allDayAt);
    // A handle without an occurrence start names the whole event: for a series
    // the port answers with its first occurrence, whose date the series keeps.
    if (handle.occurrenceStartTs === undefined) {
      const first = await this.port.event(handle);
      if (first?.rrule) deviceDraft = anchorSeriesDraft(first, deviceDraft, ref.originalStartTs === undefined ? undefined : { startTs: ref.originalStartTs, date: ref.originalStartDate }, this.allDayAt);
    }
    const r = await this.port.updateEvent(handle, deviceDraft);
    return { etag: r.version };
  }

  async deleteEvent(ref: PimEventRef): Promise<void> {
    // "It is not there" is the goal; a record already gone is the port's success.
    await this.port.deleteEvent(deviceHandleOf(ref.uid));
  }

  async createTask(listId: string, draft: PimTaskDraft): Promise<PimWriteResult> {
    this.needReminders();
    const r = await this.port.createReminder(listId, toReminderDraft(draft));
    return { uid: r.id, etag: r.version };
  }

  async updateTask(ref: PimTaskRef, draft: PimTaskDraft): Promise<PimTaskUpdateResult> {
    this.needReminders();
    if (ref.etag) {
      const current = await this.port.reminder(ref.uid);
      if (current && current.version !== ref.etag) throw new PimConflictError();
    }
    const r = await this.port.updateReminder(ref.uid, toReminderDraft(draft));
    // The reminder as the device holds it after the save. For a recurring
    // reminder that was just completed this is already the NEXT occurrence,
    // open again under the same id - the caller must not take its own draft
    // for the new state (finding 2026-10-24).
    return { etag: r.version, task: toPimTask(r) };
  }

  async deleteTask(ref: PimTaskRef): Promise<void> {
    this.needReminders();
    await this.port.deleteReminder(ref.uid);
  }

  /**
   * The etag promise, kept by hand: the platform has no conditional write, so
   * the target reads first and refuses when the version moved. A record that
   * vanished in between is not a conflict — the write then reports it.
   */
  private async assertUnchanged(handle: DeviceEventHandle, etag: string | undefined): Promise<void> {
    if (!etag) return;
    const current = await this.port.event(handle);
    if (current && current.version !== etag) throw new PimConflictError();
  }

  private needReminders(): void {
    if (!this.port.supportsReminders) throw new Error("this device has no reminder store (Android): tasks are not supported");
  }
}

/**
 * The version stamp for a platform without a modification date (Android):
 * a hash of the fields a person can see. Exported so the port and the tests
 * agree on it byte for byte.
 */
export function deviceFieldVersion(fields: { title: string; startTs: number; endTs: number; notes?: string; location?: string }): string {
  const text = [fields.title, fields.startTs, fields.endTs, fields.notes ?? "", fields.location ?? ""].join("\u001f");
  // FNV-1a over UTF-16 code units — small, stable, no dependency.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `f${h.toString(16)}`;
}
