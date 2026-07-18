import type { FetchFn } from "../sync/WebDavSyncTarget.js";
import type {
  IPimTarget,
  PimAuthProvider,
  PimCalendar,
  PimEvent,
  PimEventDraft,
  PimEventRef,
  PimTask,
  PimTaskDraft,
  PimTaskList,
  PimTaskRef,
  PimWriteResult,
  PullEventsResult,
  PullTasksResult,
} from "./types.js";
import { PimConflictError } from "./types.js";

/**
 * Google read adapter (stage 2): Calendar API v3 + Tasks API v1. Recurring
 * series arrive EXPANDED via `singleEvents=true` (server-side occurrence
 * expansion — no client RRULE math); one extra pass fetches the series
 * masters in the window so the UI can badge recurrence. OAuth scopes are
 * "sensitive" (not restricted): calendar + tasks; token supply/rotation is
 * the shell's job via PimAuthProvider.
 */

const CAL_BASE = "https://www.googleapis.com/calendar/v3";
const TASKS_BASE = "https://tasks.googleapis.com/tasks/v1";
export const GOOGLE_CALENDAR_SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks";

interface GoogleEventItem {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  etag?: string;
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string; organizer?: boolean }>;
  organizer?: { email?: string; self?: boolean };
  colorId?: string;
  recurringEventId?: string;
  recurrence?: string[];
}

/** Google's fixed 11 event colours (colorId -> hex). Per-event colours use this
 * palette; a colour outside it clears the id (falls back to the calendar). */
const GOOGLE_EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb", "2": "#33b679", "3": "#8e24aa", "4": "#e67c73",
  "5": "#f6bf26", "6": "#f4511e", "7": "#039be5", "8": "#616161",
  "9": "#3f51b5", "10": "#0b8043", "11": "#d50000",
};
function hexToGoogleColorId(hex: string | undefined): string | null {
  if (!hex) return null;
  const norm = hex.toLowerCase();
  for (const [id, h] of Object.entries(GOOGLE_EVENT_COLORS)) if (h === norm) return id;
  return null;
}

export class GooglePimTarget implements IPimTarget {
  readonly provider = "google" as const;

  constructor(
    private auth: PimAuthProvider,
    private fetchFn: FetchFn = (...args) => globalThis.fetch(...args)
  ) {}

  private async request(url: string, init?: RequestInit): Promise<Response> {
    let token = await this.auth.getAccessToken();
    let res = await this.fetchFn(url, withAuth(init, token));
    if (res.status === 401) {
      token = await this.auth.getAccessToken(true);
      res = await this.fetchFn(url, withAuth(init, token));
    }
    return res;
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await this.request(url);
    if (!res.ok) throw new Error(`google api ${res.status} for ${url.split("?")[0]}`);
    return (await res.json()) as T;
  }

  async listCalendars(): Promise<PimCalendar[]> {
    const out: PimCalendar[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${CAL_BASE}/users/me/calendarList`);
      url.searchParams.set("maxResults", "250");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await this.getJson<{ items?: Array<{ id: string; summary?: string; backgroundColor?: string; primary?: boolean; accessRole?: string }>; nextPageToken?: string }>(url.toString());
      for (const c of data.items ?? []) {
        out.push({
          id: c.id,
          name: c.summary ?? c.id,
          color: c.backgroundColor,
          primary: c.primary === true,
          readOnly: c.accessRole === "reader" || c.accessRole === "freeBusyReader",
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  async pullEvents(calendarId: string, rangeStartTs: number, rangeEndTs: number): Promise<PullEventsResult> {
    const events: PimEvent[] = [];
    const seriesIds = new Set<string>();
    let pageToken: string | undefined;
    do {
      const url = new URL(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("timeMin", new Date(rangeStartTs).toISOString());
      url.searchParams.set("timeMax", new Date(rangeEndTs).toISOString());
      url.searchParams.set("maxResults", "2500");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await this.getJson<{ items?: GoogleEventItem[]; nextPageToken?: string }>(url.toString());
      for (const item of data.items ?? []) {
        if (item.status === "cancelled") continue;
        const mapped = mapGoogleEvent(item, calendarId);
        if (mapped) {
          events.push(mapped);
          if (item.recurringEventId) seriesIds.add(item.recurringEventId);
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    // Master rows for the series present in the window: they carry the RRULE
    // text (recurrence badge + the stage-4 "edit all" target). Fetched
    // individually — the window rarely holds more than a handful of series.
    for (const id of seriesIds) {
      try {
        const master = await this.getJson<GoogleEventItem>(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`);
        const rrule = (master.recurrence ?? []).find((r) => r.toUpperCase().startsWith("RRULE"));
        const mapped = mapGoogleEvent(master, calendarId);
        if (mapped) {
          mapped.recurrence = rrule ?? "RRULE";
          events.push(mapped);
        }
      } catch {
        /* master unreadable — instances alone still render */
      }
    }
    return { events };
  }

  async listTaskLists(): Promise<PimTaskList[]> {
    const out: PimTaskList[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${TASKS_BASE}/users/@me/lists`);
      url.searchParams.set("maxResults", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await this.getJson<{ items?: Array<{ id: string; title?: string }>; nextPageToken?: string }>(url.toString());
      for (const l of data.items ?? []) out.push({ id: l.id, name: l.title ?? l.id });
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  async pullTasks(listId: string): Promise<PullTasksResult> {
    const tasks: PimTask[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${TASKS_BASE}/lists/${encodeURIComponent(listId)}/tasks`);
      url.searchParams.set("maxResults", "100");
      url.searchParams.set("showCompleted", "true");
      url.searchParams.set("showHidden", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await this.getJson<{ items?: Array<{ id: string; title?: string; notes?: string; due?: string; status?: string; etag?: string; updated?: string; deleted?: boolean }>; nextPageToken?: string }>(url.toString());
      for (const t of data.items ?? []) {
        if (t.deleted) continue;
        tasks.push({
          uid: t.id,
          listId,
          title: t.title ?? "",
          notes: t.notes || undefined,
          // Google due is a date-only value transported as midnight datetime.
          due: t.due ? t.due.slice(0, 10) : undefined,
          completed: t.status === "completed",
          etag: t.etag,
          updatedTs: t.updated ? Date.parse(t.updated) || undefined : undefined,
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return { tasks };
  }

  // ---- write side (stage 3) ----------------------------------------------

  async createEvent(calendarId: string, draft: PimEventDraft): Promise<PimWriteResult> {
    const res = await this.request(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(googleEventBody(draft, true)),
    });
    if (!res.ok) throw new Error(`google create event ${res.status}`);
    const data = (await res.json()) as { id: string; etag?: string };
    return { uid: data.id, etag: data.etag };
  }

  async updateEvent(ref: PimEventRef, draft: PimEventDraft): Promise<{ etag?: string }> {
    const res = await this.request(
      `${CAL_BASE}/calendars/${encodeURIComponent(ref.calendarId)}/events/${encodeURIComponent(ref.uid)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(ref.etag ? { "If-Match": ref.etag } : {}) },
        // Never sends `recurrence`: a PATCH must not rewrite an existing rule
        // (series edits are "this instance" via the instance id, or the
        // master's non-rule fields via the master id).
        body: JSON.stringify(googleEventBody(draft, false)),
      }
    );
    if (res.status === 412) throw new PimConflictError();
    if (!res.ok) throw new Error(`google update event ${res.status}`);
    const data = (await res.json()) as { etag?: string };
    return { etag: data.etag };
  }

  async deleteEvent(ref: PimEventRef): Promise<void> {
    const res = await this.request(
      `${CAL_BASE}/calendars/${encodeURIComponent(ref.calendarId)}/events/${encodeURIComponent(ref.uid)}`,
      { method: "DELETE", headers: ref.etag ? { "If-Match": ref.etag } : undefined }
    );
    if (res.status === 412) throw new PimConflictError();
    // Already gone = success (the file sync's not-found-on-delete lesson).
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`google delete event ${res.status}`);
  }

  async createTask(listId: string, draft: PimTaskDraft): Promise<PimWriteResult> {
    const res = await this.request(`${TASKS_BASE}/lists/${encodeURIComponent(listId)}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(googleTaskBody(draft, false)),
    });
    if (!res.ok) throw new Error(`google create task ${res.status}`);
    const data = (await res.json()) as { id: string; etag?: string };
    return { uid: data.id, etag: data.etag };
  }

  async updateTask(ref: PimTaskRef, draft: PimTaskDraft): Promise<{ etag?: string }> {
    // Google Tasks does not enforce If-Match — last write wins by design here.
    const res = await this.request(
      `${TASKS_BASE}/lists/${encodeURIComponent(ref.listId)}/tasks/${encodeURIComponent(ref.uid)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(googleTaskBody(draft, true)),
      }
    );
    if (!res.ok) throw new Error(`google update task ${res.status}`);
    const data = (await res.json()) as { etag?: string };
    return { etag: data.etag };
  }
}

function withAuth(init: RequestInit | undefined, token: string): RequestInit {
  return { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } };
}

function mapGoogleEvent(item: GoogleEventItem, calendarId: string): PimEvent | null {
  const start = googleTime(item.start);
  const end = googleTime(item.end);
  if (!start || !end) return null;
  const allDay = !!item.start?.date;
  return {
    uid: item.id,
    calendarId,
    title: item.summary ?? "",
    start,
    end,
    allDay,
    location: item.location || undefined,
    description: item.description || undefined,
    attendees: (item.attendees ?? [])
      .filter((a) => !a.resource)
      .map((a) => a.displayName || a.email || "")
      .filter(Boolean),
    status: item.status === "tentative" ? "tentative" : item.status === "cancelled" ? "cancelled" : "confirmed",
    etag: item.etag,
    seriesMaster: item.recurringEventId,
    color: item.colorId ? GOOGLE_EVENT_COLORS[item.colorId] : undefined,
  };
}

/** Event write body. All-day sends civil `date`s (end exclusive); switching
 * between all-day and timed must NULL the other field explicitly (Google keeps
 * the stale one otherwise). Location/description always travel so clearing a
 * field in the editor clears it remotely; untouched fields (attendees,
 * reminders …) are preserved by the PATCH semantics. */
function googleEventBody(draft: PimEventDraft, includeRecurrence: boolean): Record<string, unknown> {
  const time = (t: PimEventDraft["start"]) =>
    draft.allDay && t.date ? { date: t.date, dateTime: null } : { dateTime: new Date(t.ts).toISOString(), date: null };
  return {
    summary: draft.title,
    start: time(draft.start),
    end: time(draft.end),
    location: draft.location ?? "",
    description: draft.description ?? "",
    colorId: hexToGoogleColorId(draft.color),
    ...(includeRecurrence && draft.recurrenceFreq
      ? { recurrence: [`RRULE:FREQ=${draft.recurrenceFreq.toUpperCase()}`] }
      : {}),
  };
}

/** Task body. Google due is date-only (midnight UTC transport); un-completing
 * must clear the `completed` stamp alongside the status flip. */
function googleTaskBody(draft: PimTaskDraft, isPatch: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: draft.title,
    status: draft.completed ? "completed" : "needsAction",
  };
  if (draft.notes !== undefined) body.notes = draft.notes;
  if (draft.due) body.due = `${draft.due}T00:00:00.000Z`;
  else if (isPatch) body.due = null;
  if (isPatch && !draft.completed) body.completed = null;
  return body;
}

function googleTime(t: { date?: string; dateTime?: string } | undefined): PimEvent["start"] | null {
  if (!t) return null;
  if (t.dateTime) {
    const ts = Date.parse(t.dateTime);
    return Number.isFinite(ts) ? { ts } : null;
  }
  if (t.date) {
    const ts = Date.parse(`${t.date}T00:00:00Z`);
    return Number.isFinite(ts) ? { ts, date: t.date } : null;
  }
  return null;
}
