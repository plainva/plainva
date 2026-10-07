import type { FetchFn } from "../sync/WebDavSyncTarget.js";
import { pimRequestError } from "./requestError.js";
import type {
  IPimTarget,
  PimAttendee,
  PimAttendeeStatus,
  PimAuthProvider,
  PimCalendar,
  PimEvent,
  PimEventDraft,
  PimEventLinks,
  PimRecurrence,
  PimEventRef,
  PimTask,
  PimTaskDraft,
  PimTaskList,
  PimTaskRef,
  PimWriteResult,
  PullEventsResult,
  PullEventsDeltaResult,
  PullTasksResult,
} from "./types.js";
import { PimConflictError } from "./types.js";
import { htmlToMarkdown } from "./htmlToMarkdown.js";
import { decodeBlockRefs, encodeBlockRefs } from "./blockLinks.js";

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
  isReminderOn?: boolean;
  reminderMinutesBeforeStart?: number;
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
  categories?: string[];
  "@odata.etag"?: string;
  singleValueExtendedProperties?: Array<{ id?: string; value?: string }>;
}

/** Stable named-property id used for Plainva blocker linkage. */
export const GRAPH_BLOCK_OF_PROPERTY_ID = "String {4F21D2AE-7A5A-4B66-9E47-7F2B96AB0C31} Name plainva-block-of";
/** The reverse half (K3): the event's own list of its blockers, in the same property set. */
export const GRAPH_BLOCKS_PROPERTY_ID = "String {4F21D2AE-7A5A-4B66-9E47-7F2B96AB0C31} Name plainva-blocks";
const GRAPH_BLOCK_EXPAND =
  `$expand=singleValueExtendedProperties($filter=id eq '${GRAPH_BLOCK_OF_PROPERTY_ID}' or id eq '${GRAPH_BLOCKS_PROPERTY_ID}')`;
/** How many single-event reads one delta step may spend on the link properties. */
const GRAPH_DELTA_LINK_READS = 4;

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
        // A cancelled Outlook event is KEPT (report 2026-07-29 F7): the point of
        // seeing it is knowing the appointment is off — the views render it as an
        // outline with a struck-through title. Dropping it here was why F7 could
        // never take effect for Outlook. Unlike Google, Graph separates "cancelled"
        // from "deleted", so this cannot resurrect a removed event.
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
        // Scoped to the CALENDAR, the way the Google adapter has always fetched
        // its masters. `/me/events/{id}` reads the signed-in user's own event
        // collection, so a series that lives in a shared or secondary calendar
        // can miss — and a missing master costs the recurrence badge and, since
        // S8, the fallback title of every occurrence.
        const master: GraphEventItem = await this.getJson(
          `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}?${GRAPH_BLOCK_EXPAND}`,
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

  /**
   * Incremental pull over `calendarView/delta` (C2/S18).
   *
   * Graph is the one provider whose change feed is itself windowed: the delta
   * query takes the same start/end as the full pull, so the cursor never widens
   * what the cache holds. A removed item arrives as an `@removed` entry — the
   * ONLY source of deletions here; nothing is ever inferred from absence.
   *
   * Series masters are deliberately NOT re-fetched: `calendarView` returns
   * expanded occurrences, so a delta page carries the occurrences that changed,
   * and their master rows are already in the cache from the last full refresh —
   * which the worker re-runs at least hourly.
   */
  async pullEventsDelta(
    calendarId: string,
    cursor: string | null,
    rangeStartTs: number,
    rangeEndTs: number
  ): Promise<PullEventsDeltaResult> {
    const startIso = new Date(rangeStartTs).toISOString();
    const endIso = new Date(rangeEndTs).toISOString();
    let url: string | undefined =
      cursor ??
      `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta` +
        `?startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}&$top=200`;
    const events: PimEvent[] = [];
    const deletedUids: string[] = [];
    let nextCursor = "";
    while (url) {
      const data: {
        value?: Array<GraphEventItem & { "@removed"?: unknown }>;
        "@odata.nextLink"?: string;
        "@odata.deltaLink"?: string;
      } = await this.getJson(url, { Prefer: 'outlook.timezone="UTC"' });
      for (const item of data.value ?? []) {
        if (item["@removed"]) {
          if (item.id) deletedUids.push(item.id);
          continue;
        }
        const mapped = mapGraphEvent(item, calendarId);
        if (mapped) events.push(mapped);
      }
      nextCursor = data["@odata.deltaLink"] ?? "";
      url = data["@odata.nextLink"];
    }
    // A `null` cursor only asks for a fresh one; its events are thrown away.
    if (cursor !== null) await this.readDeltaLinks(calendarId, events);
    // No deltaLink means the feed did not finish a round. Returning "" makes the
    // caller keep refreshing fully rather than store a cursor it cannot resume.
    return { events, deletedUids, nextCursor };
  }

  /**
   * The blocker linkage of the events a delta step returned (K3).
   *
   * `calendarView/delta` takes no `$expand`, so its events arrive WITHOUT the
   * two extended properties — and the cache, which upserts whole rows, then
   * wrote "no link" over a blocker that had merely been moved. The link came
   * back with the next full refresh, up to an hour later.
   *
   * So each changed event is read once more with the expand the full pull
   * uses. Occurrences share their series: one read of the master answers for
   * all of them. A delta step is small (it carries what changed since the last
   * cycle), which is what makes single reads affordable here.
   *
   * An event that is gone again by the time it is read simply has no link. Any
   * other failure is thrown, like every failure of a delta step: the worker
   * drops the cursor and the next cycle is a full refresh.
   */
  private async readDeltaLinks(calendarId: string, events: PimEvent[]): Promise<void> {
    const byKey = new Map<string, PimEvent[]>();
    for (const event of events) {
      const key = event.seriesMaster ?? event.uid;
      const list = byKey.get(key);
      if (list) list.push(event);
      else byKey.set(key, [event]);
    }
    const keys = [...byKey.keys()];
    for (let index = 0; index < keys.length; index += GRAPH_DELTA_LINK_READS) {
      await Promise.all(
        keys.slice(index, index + GRAPH_DELTA_LINK_READS).map(async (key) => {
          const res = await this.request(
            `${GRAPH_BASE}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(key)}?$select=id&${GRAPH_BLOCK_EXPAND}`
          );
          if (res.status === 404 || res.status === 410) return;
          if (!res.ok) throw await pimRequestError("graph request", res);
          const links = graphLinks((await res.json()) as GraphEventItem);
          for (const event of byKey.get(key) ?? []) {
            event.blockOf = links.blockOf;
            event.blocks = links.blocks;
          }
        })
      );
    }
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
    if (!res.ok) throw await pimRequestError("graph create event", res);
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
    if (!res.ok) throw await pimRequestError("graph update event", res);
    const data = (await res.json()) as { "@odata.etag"?: string };
    return { etag: data["@odata.etag"] };
  }

  async linkEvent(ref: PimEventRef, links: PimEventLinks): Promise<{ etag?: string }> {
    const res = await this.request(`${GRAPH_BASE}/me/events/${encodeURIComponent(ref.uid)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(ref.etag ? { "If-Match": ref.etag } : {}) },
      // Extended properties only: a PATCH leaves every other field alone.
      body: JSON.stringify(graphLinkProperties(links)),
    });
    if (res.status === 412) throw new PimConflictError();
    if (!res.ok) throw await pimRequestError("graph link event", res);
    const data = (await res.json()) as { "@odata.etag"?: string };
    return { etag: data["@odata.etag"] };
  }

  async deleteEvent(ref: PimEventRef): Promise<void> {
    const res = await this.request(`${GRAPH_BASE}/me/events/${encodeURIComponent(ref.uid)}`, {
      method: "DELETE",
      headers: ref.etag ? { "If-Match": ref.etag } : undefined,
    });
    if (res.status === 412) throw new PimConflictError();
    if (!res.ok && res.status !== 404 && res.status !== 410) throw await pimRequestError("graph delete event", res);
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
    if (!res.ok) throw await pimRequestError("graph create task", res);
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
    if (!res.ok) throw await pimRequestError("graph update task", res);
    const data = (await res.json()) as { "@odata.etag"?: string };
    return { etag: data["@odata.etag"] };
  }

  async deleteTask(ref: PimTaskRef): Promise<void> {
    const res = await this.request(
      `${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(ref.listId)}/tasks/${encodeURIComponent(ref.uid)}`,
      { method: "DELETE", headers: ref.etag ? { "If-Match": ref.etag } : undefined }
    );
    if (res.status === 412) throw new PimConflictError();
    if (!res.ok && res.status !== 404 && res.status !== 410) throw await pimRequestError("graph delete task", res);
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
    ...graphLinkProperties(draft),
  };
}

/**
 * `blockOf` and `blocks` of a draft as extended properties; nothing when the
 * draft sets neither. Graph has no way to remove an extended property through
 * the event, so "none" is written as an empty value — which the reader below
 * takes for what it means.
 */
function graphLinkProperties(draft: PimEventLinks): Record<string, unknown> {
  const properties: Array<{ id: string; value: string }> = [];
  if (draft.blockOf !== undefined) properties.push({ id: GRAPH_BLOCK_OF_PROPERTY_ID, value: draft.blockOf ?? "" });
  if (draft.blocks !== undefined) {
    properties.push({ id: GRAPH_BLOCKS_PROPERTY_ID, value: draft.blocks.length > 0 ? encodeBlockRefs(draft.blocks) : "" });
  }
  return properties.length > 0 ? { singleValueExtendedProperties: properties } : {};
}

function graphLinks(item: GraphEventItem): Pick<PimEvent, "blockOf" | "blocks"> {
  const value = (id: string) => item.singleValueExtendedProperties?.find((p) => p.id === id)?.value;
  return {
    blockOf: value(GRAPH_BLOCK_OF_PROPERTY_ID) || undefined,
    blocks: decodeBlockRefs(value(GRAPH_BLOCKS_PROPERTY_ID)),
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
    status: item.isCancelled ? "cancelled" : item.showAs === "tentative" ? "tentative" : "confirmed",
    etag: item["@odata.etag"],
    seriesMaster: item.seriesMasterId,
    ...graphLinks(item),
    // Graph says both halves separately: whether it reminds at all, and how far
    // ahead. "Reminder off" is a statement — an empty list, not silence.
    reminders:
      item.isReminderOn === false
        ? []
        : typeof item.reminderMinutesBeforeStart === "number"
          ? [item.reminderMinutesBeforeStart]
          : undefined,
    // `showAs` also feeds `status` above (tentative). Here only "free" means
    // free — out of office and working-elsewhere block the calendar just as
    // busy does, and an unknown value must never be read as "the slot is open".
    busy: item.showAs === "free" ? "free" : "busy",
    meetingUrl: item.onlineMeeting?.joinUrl || item.onlineMeetingUrl || undefined,
    categories: item.categories?.length ? item.categories : undefined,
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
