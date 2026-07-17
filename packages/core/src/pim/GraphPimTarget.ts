import type { FetchFn } from "../sync/WebDavSyncTarget.js";
import type { IPimTarget, PimAuthProvider, PimCalendar, PimEvent, PimTask, PimTaskList, PullEventsResult, PullTasksResult } from "./types.js";

/**
 * Microsoft read adapter (stage 2): Graph calendars + To Do. `calendarView`
 * expands recurring series server-side (occurrences/exceptions in the window);
 * the `Prefer: outlook.timezone="UTC"` header pins every dateTime to UTC so
 * parsing needs no timezone table. Uses the SAME Entra app registration as
 * the OneDrive sync (public client, PKCE) — only the requested scopes differ;
 * delegated Calendars/Tasks scopes need no console change for consumers.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
// User.Read only feeds the account label (/me); calendar/tasks are the point.
export const GRAPH_CALENDAR_SCOPES = "User.Read Calendars.ReadWrite Tasks.ReadWrite offline_access";

interface GraphEventItem {
  id: string;
  subject?: string;
  bodyPreview?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  type?: string; // singleInstance | occurrence | exception | seriesMaster
  seriesMasterId?: string;
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  attendees?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  recurrence?: { pattern?: { type?: string } } | null;
  "@odata.etag"?: string;
}

export class GraphPimTarget implements IPimTarget {
  readonly provider = "microsoft" as const;

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

  private async getJson<T>(url: string, extraHeaders?: Record<string, string>): Promise<T> {
    const res = await this.request(url, extraHeaders ? { headers: extraHeaders } : undefined);
    if (!res.ok) throw new Error(`graph api ${res.status} for ${url.split("?")[0]}`);
    return (await res.json()) as T;
  }

  async listCalendars(): Promise<PimCalendar[]> {
    const out: PimCalendar[] = [];
    let url: string | undefined = `${GRAPH_BASE}/me/calendars?$top=50&$select=id,name,hexColor,isDefaultCalendar,canEdit`;
    while (url) {
      const data: { value?: Array<{ id: string; name?: string; hexColor?: string; isDefaultCalendar?: boolean; canEdit?: boolean }>; "@odata.nextLink"?: string } =
        await this.getJson(url);
      for (const c of data.value ?? []) {
        out.push({
          id: c.id,
          name: c.name ?? c.id,
          color: c.hexColor && c.hexColor !== "auto" ? c.hexColor : undefined,
          primary: c.isDefaultCalendar === true,
          readOnly: c.canEdit === false,
        });
      }
      url = data["@odata.nextLink"];
    }
    return out;
  }

  async pullEvents(calendarId: string, rangeStartTs: number, rangeEndTs: number): Promise<PullEventsResult> {
    const events: PimEvent[] = [];
    const seriesIds = new Set<string>();
    const startIso = new Date(rangeStartTs).toISOString();
    const endIso = new Date(rangeEndTs).toISOString();
    let url: string | undefined =
      `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/calendarView` +
      `?startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}&$top=200`;
    while (url) {
      const data: { value?: GraphEventItem[]; "@odata.nextLink"?: string } = await this.getJson(url, {
        Prefer: 'outlook.timezone="UTC"',
      });
      for (const item of data.value ?? []) {
        if (item.isCancelled) continue;
        const mapped = mapGraphEvent(item, calendarId);
        if (mapped) {
          events.push(mapped);
          if (item.seriesMasterId) seriesIds.add(item.seriesMasterId);
        }
      }
      url = data["@odata.nextLink"];
    }

    // Master rows carry the recurrence badge (pattern type — Graph does not
    // expose raw RRULE text; the structured recurrence object is the stage-4
    // write target).
    for (const id of seriesIds) {
      try {
        const master: GraphEventItem = await this.getJson(
          `${GRAPH_BASE}/me/events/${encodeURIComponent(id)}`,
          { Prefer: 'outlook.timezone="UTC"' }
        );
        const mapped = mapGraphEvent(master, calendarId);
        if (mapped) {
          mapped.recurrence = master.recurrence?.pattern?.type ?? "recurring";
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
    let url: string | undefined = `${GRAPH_BASE}/me/todo/lists?$top=100`;
    while (url) {
      const data: { value?: Array<{ id: string; displayName?: string }>; "@odata.nextLink"?: string } = await this.getJson(url);
      for (const l of data.value ?? []) out.push({ id: l.id, name: l.displayName ?? l.id });
      url = data["@odata.nextLink"];
    }
    return out;
  }

  async pullTasks(listId: string): Promise<PullTasksResult> {
    const tasks: PimTask[] = [];
    let url: string | undefined = `${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(listId)}/tasks?$top=100`;
    while (url) {
      const data: {
        value?: Array<{
          id: string;
          title?: string;
          status?: string;
          body?: { content?: string; contentType?: string };
          dueDateTime?: { dateTime?: string; timeZone?: string } | null;
          lastModifiedDateTime?: string;
          "@odata.etag"?: string;
        }>;
        "@odata.nextLink"?: string;
      } = await this.getJson(url);
      for (const t of data.value ?? []) {
        tasks.push({
          uid: t.id,
          listId,
          title: t.title ?? "",
          notes: t.body?.contentType === "text" && t.body.content?.trim() ? t.body.content.trim() : undefined,
          // Graph due is a civil date in the task's timezone — keep the date.
          due: t.dueDateTime?.dateTime ? t.dueDateTime.dateTime.slice(0, 10) : undefined,
          completed: t.status === "completed",
          etag: t["@odata.etag"],
          updatedTs: t.lastModifiedDateTime ? Date.parse(t.lastModifiedDateTime) || undefined : undefined,
        });
      }
      url = data["@odata.nextLink"];
    }
    return { tasks };
  }
}

function withAuth(init: RequestInit | undefined, token: string): RequestInit {
  return { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } };
}

function mapGraphEvent(item: GraphEventItem, calendarId: string): PimEvent | null {
  // With Prefer: outlook.timezone="UTC" the dateTime strings are UTC wall
  // clock without offset suffix — append Z for parsing.
  const start = graphTime(item.start, item.isAllDay === true);
  const end = graphTime(item.end, item.isAllDay === true);
  if (!start || !end) return null;
  return {
    uid: item.id,
    calendarId,
    title: item.subject ?? "",
    start,
    end,
    allDay: item.isAllDay === true,
    location: item.location?.displayName || undefined,
    description: item.bodyPreview?.trim() || undefined,
    attendees: (item.attendees ?? [])
      .map((a) => a.emailAddress?.name || a.emailAddress?.address || "")
      .filter(Boolean),
    status: item.showAs === "tentative" ? "tentative" : "confirmed",
    etag: item["@odata.etag"],
    seriesMaster: item.seriesMasterId,
  };
}

function graphTime(t: { dateTime?: string; timeZone?: string } | undefined, allDay: boolean): PimEvent["start"] | null {
  if (!t?.dateTime) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(t.dateTime) ? t.dateTime : `${t.dateTime}Z`;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return allDay ? { ts, date: t.dateTime.slice(0, 10) } : { ts };
}
