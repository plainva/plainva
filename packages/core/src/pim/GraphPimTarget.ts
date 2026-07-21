import type { FetchFn } from "../sync/WebDavSyncTarget.js";
import type {
  IPimTarget,
  PimAttendee,
  PimAttendeeStatus,
  PimAuthProvider,
  PimCalendar,
  PimEvent,
  PimEventDraft,
  PimRecurrence,
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
import { htmlToMarkdown } from "./htmlToMarkdown.js";

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
  body?: { content?: string; contentType?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  type?: string; // singleInstance | occurrence | exception | seriesMaster
  seriesMasterId?: string;
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  attendees?: Array<{ emailAddress?: { name?: string; address?: string }; status?: { response?: string }; type?: string }>;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  responseStatus?: { response?: string };
  recurrence?: { pattern?: { type?: string } } | null;
  "@odata.etag"?: string;
  singleValueExtendedProperties?: Array<{ id?: string; value?: string }>;
}

/** Stable named-property id used for Plainva blocker linkage. */
export const GRAPH_BLOCK_OF_PROPERTY_ID = "String {4F21D2AE-7A5A-4B66-9E47-7F2B96AB0C31} Name plainva-block-of";
const GRAPH_BLOCK_EXPAND = `$expand=singleValueExtendedProperties($filter=id eq '${GRAPH_BLOCK_OF_PROPERTY_ID}')`;

/** Graph attendee response -> normalised PARTSTAT. */
function graphResponseToStatus(r: string | undefined): PimAttendeeStatus {
  switch (r) {
    case "accepted":
    case "organizer":
      return "accepted";
    case "declined":
      return "declined";
    case "tentativelyAccepted":
      return "tentative";
    default:
      return "needsAction";
  }
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
      `?startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}&$top=200&${GRAPH_BLOCK_EXPAND}`;
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
          `${GRAPH_BASE}/me/events/${encodeURIComponent(id)}?${GRAPH_BLOCK_EXPAND}`,
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

  // ---- write side (stage 3) ----------------------------------------------

  async createEvent(calendarId: string, draft: PimEventDraft): Promise<PimWriteResult> {
    const res = await this.request(`${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(graphEventBody(draft)),
    });
    if (!res.ok) throw new Error(`graph create event ${res.status}`);
    const data = (await res.json()) as { id: string; "@odata.etag"?: string };
    return { uid: data.id, etag: data["@odata.etag"] };
  }

  async updateEvent(ref: PimEventRef, draft: PimEventDraft): Promise<{ etag?: string }> {
    const res = await this.request(`${GRAPH_BASE}/me/events/${encodeURIComponent(ref.uid)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(ref.etag ? { "If-Match": ref.etag } : {}) },
      // Never sends `recurrence` (a PATCH must not rewrite an existing rule).
      body: JSON.stringify(graphEventBody(draft)),
    });
    if (res.status === 412) throw new PimConflictError();
    if (!res.ok) throw new Error(`graph update event ${res.status}`);
    const data = (await res.json()) as { "@odata.etag"?: string };
    return { etag: data["@odata.etag"] };
  }

  async deleteEvent(ref: PimEventRef): Promise<void> {
    const res = await this.request(`${GRAPH_BASE}/me/events/${encodeURIComponent(ref.uid)}`, {
      method: "DELETE",
      headers: ref.etag ? { "If-Match": ref.etag } : undefined,
    });
    if (res.status === 412) throw new PimConflictError();
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`graph delete event ${res.status}`);
  }

  /** RSVP via the dedicated Graph actions; sendResponse notifies the organiser. */
  async respondToEvent(ref: PimEventRef, response: "accepted" | "declined" | "tentative"): Promise<void> {
    const action = response === "accepted" ? "accept" : response === "declined" ? "decline" : "tentativelyAccept";
    const res = await this.request(`${GRAPH_BASE}/me/events/${encodeURIComponent(ref.uid)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sendResponse: true }),
    });
    if (!res.ok && res.status !== 200 && res.status !== 202) throw new Error(`graph rsvp ${res.status}`);
  }

  async createTask(listId: string, draft: PimTaskDraft): Promise<PimWriteResult> {
    const res = await this.request(`${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(listId)}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(graphTaskBody(draft)),
    });
    if (!res.ok) throw new Error(`graph create task ${res.status}`);
    const data = (await res.json()) as { id: string; "@odata.etag"?: string };
    return { uid: data.id, etag: data["@odata.etag"] };
  }

  async updateTask(ref: PimTaskRef, draft: PimTaskDraft): Promise<{ etag?: string }> {
    const res = await this.request(
      `${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(ref.listId)}/tasks/${encodeURIComponent(ref.uid)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(ref.etag ? { "If-Match": ref.etag } : {}) },
        body: JSON.stringify(graphTaskBody(draft)),
      }
    );
    if (res.status === 412) throw new PimConflictError();
    if (!res.ok) throw new Error(`graph update task ${res.status}`);
    const data = (await res.json()) as { "@odata.etag"?: string };
    return { etag: data["@odata.etag"] };
  }
}

/** Event write body. Graph wants UTC wall-clock dateTimes with an explicit
 * timeZone; all-day events must be midnight-to-midnight (end exclusive). */
function graphEventBody(draft: PimEventDraft): Record<string, unknown> {
  const time = (t: PimEventDraft["start"]) =>
    draft.allDay && t.date
      ? { dateTime: `${t.date}T00:00:00`, timeZone: "UTC" }
      : { dateTime: new Date(t.ts).toISOString().replace(/Z$/, ""), timeZone: "UTC" };
  return {
    subject: draft.title,
    isAllDay: draft.allDay,
    start: time(draft.start),
    end: time(draft.end),
    location: { displayName: draft.location ?? "" },
    ...(draft.description !== undefined ? { body: { contentType: "html", content: draft.descriptionHtml ?? draft.description } } : {}),
    // A provided list replaces the invitees; undefined leaves them (drag).
    ...(draft.attendees !== undefined
      ? { attendees: draft.attendees.filter((e) => e.trim()).map((email) => ({ emailAddress: { address: email.trim() }, type: "required" })) }
      : {}),
    // undefined leaves the rule, null clears it, an object sets/replaces it —
    // so an existing series' rule CAN now be edited from the field dialog.
    ...(draft.recurrence !== undefined ? { recurrence: draft.recurrence ? graphRecurrence(draft.recurrence, draft) : null } : {}),
    ...(draft.blockOf
      ? { singleValueExtendedProperties: [{ id: GRAPH_BLOCK_OF_PROPERTY_ID, value: draft.blockOf }] }
      : {}),
  };
}

const GRAPH_DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const RRULE_DAY_TO_GRAPH: Record<string, string> = {
  MO: "monday", TU: "tuesday", WE: "wednesday", TH: "thursday", FR: "friday", SA: "saturday", SU: "sunday",
};

/** Graph has no raw-RRULE transport — the structured PimRecurrence maps to the
 * pattern/range pair (interval, weekly days, and the end condition), anchored on
 * the event's start day. */
function graphRecurrence(r: PimRecurrence, draft: PimEventDraft): Record<string, unknown> {
  const allDayDate = draft.allDay && draft.start.date ? draft.start.date : null;
  const local = new Date(draft.start.ts);
  const startDate = allDayDate ?? new Date(draft.start.ts).toISOString().slice(0, 10);
  const dayOfWeek = allDayDate ? GRAPH_DAY_NAMES[new Date(`${allDayDate}T00:00:00Z`).getUTCDay()] : GRAPH_DAY_NAMES[local.getDay()];
  const dayOfMonth = allDayDate ? Number(allDayDate.slice(8, 10)) : local.getDate();
  const month = allDayDate ? Number(allDayDate.slice(5, 7)) : local.getMonth() + 1;
  const interval = r.interval && r.interval > 1 ? Math.floor(r.interval) : 1;
  const daysOfWeek = r.byWeekday && r.byWeekday.length > 0 ? r.byWeekday.map((d) => RRULE_DAY_TO_GRAPH[d] ?? dayOfWeek) : [dayOfWeek];
  const pattern =
    r.freq === "daily"
      ? { type: "daily", interval }
      : r.freq === "weekly"
        ? { type: "weekly", interval, daysOfWeek }
        : r.freq === "monthly"
          ? { type: "absoluteMonthly", interval, dayOfMonth }
          : { type: "absoluteYearly", interval, dayOfMonth, month };
  const range =
    r.count && r.count > 0
      ? { type: "numbered", startDate, numberOfOccurrences: Math.floor(r.count) }
      : r.until
        ? { type: "endDate", startDate, endDate: r.until }
        : { type: "noEnd", startDate };
  return { pattern, range };
}

function graphTaskBody(draft: PimTaskDraft): Record<string, unknown> {
  return {
    title: draft.title,
    status: draft.completed ? "completed" : "notStarted",
    dueDateTime: draft.due ? { dateTime: `${draft.due}T00:00:00`, timeZone: "UTC" } : null,
    ...(draft.notes !== undefined ? { body: { contentType: "text", content: draft.notes } } : {}),
  };
}

function withAuth(init: RequestInit | undefined, token: string): RequestInit {
  return { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } };
}

/** Event description as Markdown: Graph returns the full HTML `body` by default
 * (contentType "html"); fall back to the truncated `bodyPreview` only when the
 * full body is absent. Reading the full body fixes the drag/edit truncation. */
function graphDescription(item: GraphEventItem): string | undefined {
  const body = item.body;
  if (body && typeof body.content === "string") {
    const content = body.content;
    if (!content.trim()) return undefined;
    return (body.contentType ?? "").toLowerCase() === "html" ? htmlToMarkdown(content) || undefined : content.trim() || undefined;
  }
  return item.bodyPreview?.trim() || undefined;
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
    description: graphDescription(item),
    attendees: (item.attendees ?? [])
      .map((a) => a.emailAddress?.name || a.emailAddress?.address || "")
      .filter(Boolean),
    rsvps: graphRsvps(item),
    selfResponse:
      item.responseStatus?.response && !["none", "organizer"].includes(item.responseStatus.response)
        ? graphResponseToStatus(item.responseStatus.response)
        : undefined,
    status: item.showAs === "tentative" ? "tentative" : "confirmed",
    etag: item["@odata.etag"],
    seriesMaster: item.seriesMasterId,
    blockOf: item.singleValueExtendedProperties?.find((p) => p.id === GRAPH_BLOCK_OF_PROPERTY_ID)?.value || undefined,
  };
}

function graphRsvps(item: GraphEventItem): PimAttendee[] | undefined {
  const list: PimAttendee[] = [];
  const organizerAddr = item.organizer?.emailAddress?.address?.toLowerCase();
  for (const a of item.attendees ?? []) {
    const name = a.emailAddress?.name || a.emailAddress?.address || "";
    if (!name) continue;
    list.push({
      name,
      email: a.emailAddress?.address,
      status: graphResponseToStatus(a.status?.response),
      organizer: !!organizerAddr && a.emailAddress?.address?.toLowerCase() === organizerAddr,
    });
  }
  return list.length > 0 ? list : undefined;
}

function graphTime(t: { dateTime?: string; timeZone?: string } | undefined, allDay: boolean): PimEvent["start"] | null {
  if (!t?.dateTime) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(t.dateTime) ? t.dateTime : `${t.dateTime}Z`;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return allDay ? { ts, date: t.dateTime.slice(0, 10) } : { ts };
}
