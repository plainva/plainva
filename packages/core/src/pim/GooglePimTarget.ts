import type { FetchFn } from "../sync/WebDavSyncTarget.js";
import type { IPimTarget, PimAuthProvider, PimCalendar, PimEvent, PimTask, PimTaskList, PullEventsResult, PullTasksResult } from "./types.js";

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
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean; resource?: boolean }>;
  recurringEventId?: string;
  recurrence?: string[];
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
  };
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
