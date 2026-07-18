import { XMLParser, XMLValidator } from "fast-xml-parser";
import ICAL from "ical.js";
import type { FetchFn, WebDavCredentials } from "../sync/WebDavSyncTarget.js";
import type {
  IPimTarget,
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
 * CalDAV read adapter (stage 2): RFC 4791 on top of the WebDAV conventions the
 * file sync already established (Basic auth app passwords, fast-xml-parser
 * with strict validation, namespace-stripped multistatus). Discovery follows
 * the standard chain — current-user-principal → calendar-home-set → the home's
 * calendar collections — and falls back to treating the configured URL as a
 * calendar collection directly. Recurring VEVENTs are expanded CLIENT-side via
 * ical.js (Thunderbird's calendar core) within the requested window; the
 * master is emitted once with its RRULE text for the recurrence badge.
 */

/** Safety valve: a broken RRULE must never spin the expansion forever. */
const MAX_INSTANCES_PER_SERIES = 500;

export class CalDavPimTarget implements IPimTarget {
  readonly provider = "caldav" as const;
  private base: URL;

  constructor(
    private creds: WebDavCredentials,
    private fetchFn: FetchFn = (...args) => globalThis.fetch(...args)
  ) {
    this.base = new URL(creds.url.endsWith("/") ? creds.url : creds.url + "/");
  }

  private authHeader(): string {
    return "Basic " + btoa(`${this.creds.user}:${this.creds.pass}`);
  }

  private async davRequest(url: string, method: string, depth: string, body: string): Promise<string> {
    const res = await this.fetchFn(url, {
      method,
      headers: {
        Authorization: this.authHeader(),
        Depth: depth,
        "Content-Type": "application/xml; charset=utf-8",
      },
      body,
    });
    if (res.status === 207) return await res.text();
    throw new Error(`caldav ${method} ${res.status} for ${new URL(url).pathname}`);
  }

  /** Resolves an href from a multistatus against the server origin. */
  private resolve(href: string): string {
    return new URL(href, this.base).toString();
  }

  // ---- discovery ----------------------------------------------------------

  /**
   * Calendar collections of the account. Chain: configured URL → principal →
   * calendar home → Depth:1 listing. Every step tolerates servers that answer
   * the richer question directly (a configured calendar URL short-circuits).
   */
  async listCalendars(): Promise<PimCalendar[]> {
    const home = await this.findCalendarHome();
    const xml = await this.davRequest(
      home,
      "PROPFIND",
      "1",
      `<?xml version="1.0" encoding="utf-8"?>
       <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://apple.com/ns/ical/">
         <d:prop>
           <d:resourcetype/>
           <d:displayname/>
           <cs:calendar-color/>
           <c:supported-calendar-component-set/>
           <d:current-user-privilege-set/>
         </d:prop>
       </d:propfind>`
    );
    const entries = parseCalDavMultistatus(xml);
    const out: PimCalendar[] = [];
    for (const e of entries) {
      if (!e.href || !e.isCalendar) continue;
      const comps = e.components ?? [];
      // A collection that only stores VTODO/VJOURNAL is a task list, not a
      // calendar — it still surfaces (supportsTasks) for the task-list picker.
      const hasEvents = comps.length === 0 || comps.includes("VEVENT");
      const hasTasks = comps.includes("VTODO");
      if (!hasEvents && !hasTasks) continue;
      out.push({
        id: this.resolve(e.href),
        name: e.displayName || decodeURIComponent(e.href.replace(/\/+$/, "").split("/").pop() ?? e.href),
        color: e.color,
        supportsTasks: hasTasks,
        readOnly: e.readOnly,
      });
    }
    return out;
  }

  private async findCalendarHome(): Promise<string> {
    // 1) Is the configured URL itself a calendar (or a home)? Ask minimally.
    try {
      const xml = await this.davRequest(
        this.base.toString(),
        "PROPFIND",
        "0",
        `<?xml version="1.0" encoding="utf-8"?>
         <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
           <d:prop><d:resourcetype/><d:current-user-principal/><c:calendar-home-set/></d:prop>
         </d:propfind>`
      );
      const entries = parseCalDavMultistatus(xml);
      const self = entries[0];
      if (self?.calendarHomeSet) return this.resolve(self.calendarHomeSet);
      if (self?.isCalendar) return this.base.toString();
      if (self?.principal) {
        const principalUrl = this.resolve(self.principal);
        const homeXml = await this.davRequest(
          principalUrl,
          "PROPFIND",
          "0",
          `<?xml version="1.0" encoding="utf-8"?>
           <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
             <d:prop><c:calendar-home-set/></d:prop>
           </d:propfind>`
        );
        const homeEntries = parseCalDavMultistatus(homeXml);
        if (homeEntries[0]?.calendarHomeSet) return this.resolve(homeEntries[0].calendarHomeSet);
      }
    } catch {
      /* fall through to using the configured URL directly */
    }
    return this.base.toString();
  }

  // ---- events -------------------------------------------------------------

  async pullEvents(calendarId: string, rangeStartTs: number, rangeEndTs: number): Promise<PullEventsResult> {
    const xml = await this.davRequest(
      calendarId,
      "REPORT",
      "1",
      `<?xml version="1.0" encoding="utf-8"?>
       <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
         <d:prop><d:getetag/><c:calendar-data/></d:prop>
         <c:filter>
           <c:comp-filter name="VCALENDAR">
             <c:comp-filter name="VEVENT">
               <c:time-range start="${caldavStamp(rangeStartTs)}" end="${caldavStamp(rangeEndTs)}"/>
             </c:comp-filter>
           </c:comp-filter>
         </c:filter>
       </c:calendar-query>`
    );
    const entries = parseCalDavMultistatus(xml);
    const events: PimEvent[] = [];
    for (const e of entries) {
      if (!e.href || !e.calendarData) continue;
      try {
        events.push(...expandIcsEvents(e.calendarData, calendarId, this.resolve(e.href), e.etag, rangeStartTs, rangeEndTs));
      } catch (err) {
        // One unparseable object must not lose the calendar (permissive
        // consumption, like the frontmatter reader).
        console.warn(`[CalDavPimTarget] skipping unparseable object ${e.href}:`, err);
      }
    }
    return { events };
  }

  // ---- tasks --------------------------------------------------------------

  /** CalDAV task lists ARE calendar collections that store VTODO. */
  async listTaskLists(): Promise<PimTaskList[]> {
    const calendars = await this.listCalendars();
    return calendars.filter((c) => c.supportsTasks).map((c) => ({ id: c.id, name: c.name }));
  }

  async pullTasks(listId: string): Promise<PullTasksResult> {
    const xml = await this.davRequest(
      listId,
      "REPORT",
      "1",
      `<?xml version="1.0" encoding="utf-8"?>
       <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
         <d:prop><d:getetag/><c:calendar-data/></d:prop>
         <c:filter>
           <c:comp-filter name="VCALENDAR">
             <c:comp-filter name="VTODO"/>
           </c:comp-filter>
         </c:filter>
       </c:calendar-query>`
    );
    const entries = parseCalDavMultistatus(xml);
    const tasks: PimTask[] = [];
    for (const e of entries) {
      if (!e.href || !e.calendarData) continue;
      try {
        const jcal = ICAL.parse(e.calendarData);
        const comp = new ICAL.Component(jcal);
        for (const vtodo of comp.getAllSubcomponents("vtodo")) {
          const uid = String(vtodo.getFirstPropertyValue("uid") ?? e.href);
          const due = vtodo.getFirstPropertyValue("due");
          const status = String(vtodo.getFirstPropertyValue("status") ?? "");
          const lastMod = vtodo.getFirstPropertyValue("last-modified");
          tasks.push({
            uid,
            listId,
            title: String(vtodo.getFirstPropertyValue("summary") ?? ""),
            notes: str(vtodo.getFirstPropertyValue("description")),
            due: due instanceof ICAL.Time ? icalDateString(due) : undefined,
            completed: status.toUpperCase() === "COMPLETED",
            etag: e.etag,
            updatedTs: lastMod instanceof ICAL.Time ? lastMod.toJSDate().getTime() : undefined,
            href: this.resolve(e.href),
          });
        }
      } catch (err) {
        console.warn(`[CalDavPimTarget] skipping unparseable todo ${e.href}:`, err);
      }
    }
    return { tasks };
  }

  // ---- write side (stage 3) ----------------------------------------------

  /** Raw authorized request (writes bypass the 207-only davRequest helper). */
  private async rawRequest(url: string, init: RequestInit & { headers?: Record<string, string> }): Promise<Response> {
    return this.fetchFn(url, {
      ...init,
      headers: { Authorization: this.authHeader(), ...init.headers },
    });
  }

  async createEvent(calendarId: string, draft: PimEventDraft): Promise<PimWriteResult> {
    const uid = generateUid();
    const href = this.resolve(joinCollection(calendarId, `${uid}.ics`));
    const res = await this.rawRequest(href, {
      method: "PUT",
      headers: { "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*" },
      body: buildIcsObject(uid, "vevent", (vevent) => applyEventDraft(vevent, draft)),
    });
    if (!res.ok) throw new Error(`caldav create event ${res.status}`);
    return { uid, etag: res.headers.get("ETag") ?? undefined, href };
  }

  async updateEvent(ref: PimEventRef, draft: PimEventDraft): Promise<{ etag?: string }> {
    const recurrenceId = instanceRecurrenceId(ref.uid);
    if (recurrenceId) {
      // "Only this event": write/refresh the RECURRENCE-ID override component
      // inside the series object; the master (and every other instance) stays.
      return this.readModifyPutObject(ref.href, ref.etag, (cal) => {
        const master = findComponent(cal, "vevent", null);
        if (!master) throw new Error("caldav object has no vevent");
        let override = findComponent(cal, "vevent", recurrenceId);
        if (!override) {
          override = new ICAL.Component("vevent");
          override.updatePropertyWithValue("uid", String(master.getFirstPropertyValue("uid") ?? ""));
          // toString()/fromString round-trips the expansion's key; a zoned
          // master yields a floating value here — servers match overrides on
          // the local time value (native gate verifies per server).
          override.updatePropertyWithValue("recurrence-id", icalTimeFromKey(recurrenceId));
          override.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
          cal.addSubcomponent(override);
        }
        applyEventDraft(override, draft);
        bumpRevision(override);
      });
    }
    return this.readModifyPut(ref.href, ref.etag, "vevent", (comp) => applyEventDraft(comp, draft));
  }

  async deleteEvent(ref: PimEventRef): Promise<void> {
    if (!ref.href) throw new Error("caldav delete needs the object href");
    const recurrenceId = instanceRecurrenceId(ref.uid);
    if (recurrenceId) {
      // "Only this event": EXDATE on the master + drop a matching override.
      // The series object itself survives.
      await this.readModifyPutObject(ref.href, ref.etag, (cal) => {
        const master = findComponent(cal, "vevent", null);
        if (!master) throw new Error("caldav object has no vevent");
        master.addPropertyWithValue("exdate", icalTimeFromKey(recurrenceId));
        const override = findComponent(cal, "vevent", recurrenceId);
        if (override) cal.removeSubcomponent(override);
        bumpRevision(master);
      });
      return;
    }
    const res = await this.rawRequest(ref.href, {
      method: "DELETE",
      headers: ref.etag ? { "If-Match": ref.etag } : {},
    });
    if (res.status === 412) throw new PimConflictError();
    // Already gone = success (the file sync's not-found-on-delete lesson).
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`caldav delete ${res.status}`);
  }

  async createTask(listId: string, draft: PimTaskDraft): Promise<PimWriteResult> {
    const uid = generateUid();
    const href = this.resolve(joinCollection(listId, `${uid}.ics`));
    const res = await this.rawRequest(href, {
      method: "PUT",
      headers: { "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*" },
      body: buildIcsObject(uid, "vtodo", (vtodo) => applyTaskDraft(vtodo, draft)),
    });
    if (!res.ok) throw new Error(`caldav create task ${res.status}`);
    return { uid, etag: res.headers.get("ETag") ?? undefined, href };
  }

  async updateTask(ref: PimTaskRef, draft: PimTaskDraft): Promise<{ etag?: string }> {
    return this.readModifyPut(ref.href, ref.etag, "vtodo", (comp) => applyTaskDraft(comp, draft));
  }

  /**
   * GET–modify–PUT on the MASTER component: fetch the current object, mutate
   * ONLY the draft-carried properties (alarms, attendees and unknown
   * properties survive untouched), then PUT with If-Match.
   */
  private async readModifyPut(
    href: string | undefined,
    knownEtag: string | undefined,
    componentName: "vevent" | "vtodo",
    mutate: (comp: InstanceType<typeof ICAL.Component>) => void
  ): Promise<{ etag?: string }> {
    return this.readModifyPutObject(href, knownEtag, (cal) => {
      const target = findComponent(cal, componentName, null);
      if (!target) throw new Error(`caldav object has no ${componentName}`);
      mutate(target);
      bumpRevision(target);
    });
  }

  /**
   * Whole-object GET–modify–PUT (series overrides/EXDATEs need access beyond
   * the master). Both the etag pre-check (fetched vs. known) and a 412 raise
   * PimConflictError.
   */
  private async readModifyPutObject(
    href: string | undefined,
    knownEtag: string | undefined,
    mutate: (cal: InstanceType<typeof ICAL.Component>) => void
  ): Promise<{ etag?: string }> {
    if (!href) throw new Error("caldav update needs the object href");
    const getRes = await this.rawRequest(href, { method: "GET", headers: {} });
    if (!getRes.ok) throw new Error(`caldav read ${getRes.status} before update`);
    const currentEtag = getRes.headers.get("ETag") ?? undefined;
    if (knownEtag && currentEtag && knownEtag !== currentEtag) throw new PimConflictError();

    const jcal = ICAL.parse(await getRes.text());
    const cal = new ICAL.Component(jcal);
    mutate(cal);

    const guard = knownEtag ?? currentEtag;
    const putRes = await this.rawRequest(href, {
      method: "PUT",
      headers: { "Content-Type": "text/calendar; charset=utf-8", ...(guard ? { "If-Match": guard } : {}) },
      body: cal.toString(),
    });
    if (putRes.status === 412) throw new PimConflictError();
    if (!putRes.ok) throw new Error(`caldav update ${putRes.status}`);
    return { etag: putRes.headers.get("ETag") ?? undefined };
  }
}

/** Instance key suffix of an expanded occurrence uid (`uid#<recurrenceId>`). */
function instanceRecurrenceId(uid: string): string | null {
  const idx = uid.indexOf("#");
  return idx > 0 ? uid.slice(idx + 1) : null;
}

/** ICAL.Time from the expansion's toString() key ("2026-08-08T09:00:00" or
 * "2026-08-08"). fromString's typings demand the optional property argument;
 * the runtime accepts one. */
function icalTimeFromKey(key: string): InstanceType<typeof ICAL.Time> {
  return (ICAL.Time.fromString as unknown as (v: string) => InstanceType<typeof ICAL.Time>)(key);
}

/** RECURRENCE-ID of a component as the expansion's toString() key; a broken
 * foreign value must not blow up the lookup. */
function recurrenceIdString(comp: InstanceType<typeof ICAL.Component>): string {
  try {
    return String(comp.getFirstPropertyValue("recurrence-id") ?? "");
  } catch {
    return "";
  }
}

/** Component lookup: `recurrenceId === null` finds the master (no
 * RECURRENCE-ID; falls back to the first component), a string finds the
 * matching override — matching on the expansion's toString() convention. */
function findComponent(
  cal: InstanceType<typeof ICAL.Component>,
  name: "vevent" | "vtodo",
  recurrenceId: string | null
): InstanceType<typeof ICAL.Component> | null {
  const comps = cal.getAllSubcomponents(name);
  if (recurrenceId === null) {
    return comps.find((c) => recurrenceIdString(c) === "") ?? comps[0] ?? null;
  }
  return comps.find((c) => recurrenceIdString(c) === recurrenceId) ?? null;
}

// ---- write helpers --------------------------------------------------------

function generateUid(): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `plainva-${rand}`;
}

/** Object path inside a collection (collection ids/hrefs end with "/"). */
function joinCollection(collection: string, name: string): string {
  return (collection.endsWith("/") ? collection : collection + "/") + name;
}

/** Minimal VCALENDAR wrapper around one freshly built component. */
function buildIcsObject(uid: string, componentName: "vevent" | "vtodo", fill: (comp: InstanceType<typeof ICAL.Component>) => void): string {
  const cal = new ICAL.Component(["vcalendar", [], []]);
  cal.updatePropertyWithValue("prodid", "-//Plainva//Plainva//EN");
  cal.updatePropertyWithValue("version", "2.0");
  const comp = new ICAL.Component(componentName);
  comp.updatePropertyWithValue("uid", uid);
  comp.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  fill(comp);
  cal.addSubcomponent(comp);
  return cal.toString();
}

/** Sets a DTSTART/DTEND/DUE property to either a civil date (all-day, keeps
 * VALUE=DATE) or a UTC datetime — stripping a stale TZID either way (a TZID
 * parameter next to a Z time or a date is invalid). */
function setTimeProperty(comp: InstanceType<typeof ICAL.Component>, name: string, t: { ts: number; date?: string }, allDay: boolean): void {
  const value = allDay && t.date ? ICAL.Time.fromDateString(t.date) : ICAL.Time.fromJSDate(new Date(t.ts), true);
  comp.updatePropertyWithValue(name, value);
  comp.getFirstProperty(name)?.removeParameter("tzid");
}

function applyEventDraft(vevent: InstanceType<typeof ICAL.Component>, draft: PimEventDraft): void {
  vevent.updatePropertyWithValue("summary", draft.title);
  setTimeProperty(vevent, "dtstart", draft.start, draft.allDay);
  // DURATION and DTEND are mutually exclusive — the draft always carries an
  // explicit end, so a master using DURATION switches representation.
  vevent.removeAllProperties("duration");
  setTimeProperty(vevent, "dtend", draft.end, draft.allDay);
  if (draft.location) vevent.updatePropertyWithValue("location", draft.location);
  else vevent.removeAllProperties("location");
  if (draft.description) vevent.updatePropertyWithValue("description", draft.description);
  else vevent.removeAllProperties("description");
  // Per-event colour (RFC 7986 COLOR). We store a CSS colour / hex; other
  // clients that expect a CSS3 name simply ignore an unknown value.
  if (draft.color) vevent.updatePropertyWithValue("color", draft.color);
  else vevent.removeAllProperties("color");
  // Create only (stage 4): a simple no-end rule. An EXISTING rule is never
  // rewritten here — series edits go through overrides or the master fields.
  if (draft.recurrenceFreq && !vevent.getFirstPropertyValue("rrule")) {
    vevent.updatePropertyWithValue("rrule", ICAL.Recur.fromString(`FREQ=${draft.recurrenceFreq.toUpperCase()}`));
  }
}

function applyTaskDraft(vtodo: InstanceType<typeof ICAL.Component>, draft: PimTaskDraft): void {
  vtodo.updatePropertyWithValue("summary", draft.title);
  if (draft.due) setTimeProperty(vtodo, "due", { ts: 0, date: draft.due }, true);
  else vtodo.removeAllProperties("due");
  if (draft.notes) vtodo.updatePropertyWithValue("description", draft.notes);
  else vtodo.removeAllProperties("description");
  if (draft.completed) {
    vtodo.updatePropertyWithValue("status", "COMPLETED");
    vtodo.updatePropertyWithValue("completed", ICAL.Time.fromJSDate(new Date(), true));
    vtodo.updatePropertyWithValue("percent-complete", 100);
  } else {
    vtodo.updatePropertyWithValue("status", "NEEDS-ACTION");
    vtodo.removeAllProperties("completed");
    vtodo.removeAllProperties("percent-complete");
  }
}

/** SEQUENCE bump + fresh LAST-MODIFIED/DTSTAMP on every rewrite (RFC 5545's
 * change-management contract; clients use it to detect updates). */
function bumpRevision(comp: InstanceType<typeof ICAL.Component>): void {
  const seq = Number(comp.getFirstPropertyValue("sequence") ?? 0);
  comp.updatePropertyWithValue("sequence", Number.isFinite(seq) ? seq + 1 : 1);
  const now = ICAL.Time.fromJSDate(new Date(), true);
  comp.updatePropertyWithValue("last-modified", now);
  comp.updatePropertyWithValue("dtstamp", now);
}

// ---- ics → PimEvent -------------------------------------------------------

/**
 * Expands the VEVENTs of one ics object into window instances. Non-recurring
 * events map 1:1. Recurring events emit their master (recurrence badge) plus
 * every occurrence inside [rangeStartTs, rangeEndTs) — RECURRENCE-ID overrides
 * are honored by ical.js' RecurExpansion.
 */
export function expandIcsEvents(
  ics: string,
  calendarId: string,
  href: string,
  etag: string | undefined,
  rangeStartTs: number,
  rangeEndTs: number
): PimEvent[] {
  const jcal = ICAL.parse(ics);
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents("vevent");
  if (vevents.length === 0) return [];

  const out: PimEvent[] = [];
  const master = vevents.find((v) => !v.getFirstPropertyValue("recurrence-id")) ?? vevents[0];
  const masterEvent = new ICAL.Event(master);
  const uid = String(master.getFirstPropertyValue("uid") ?? href);

  if (!masterEvent.isRecurring()) {
    const mapped = mapVevent(masterEvent, uid, calendarId, href, etag);
    if (mapped) out.push(mapped);
    return out;
  }

  // Master row: carries the RRULE text for the badge; excluded from the
  // day-grid by the cache query (`recurrence IS NULL` filter).
  const rrule = master.getFirstPropertyValue("rrule");
  const masterRow = mapVevent(masterEvent, uid, calendarId, href, etag);
  if (masterRow) {
    masterRow.recurrence = rrule ? `RRULE:${String(rrule)}` : "RRULE";
    out.push(masterRow);
  }

  const expansion = new ICAL.RecurExpansion({ component: master, dtstart: masterEvent.startDate });
  const durationSec = masterEvent.duration ? masterEvent.duration.toSeconds() : 0;
  let guard = 0;
  let next: InstanceType<typeof ICAL.Time> | null;
  while ((next = expansion.next()) && guard < MAX_INSTANCES_PER_SERIES) {
    guard++;
    const occStart = next.toJSDate().getTime();
    if (occStart >= rangeEndTs) break;
    const details = masterEvent.getOccurrenceDetails(next);
    const startTs = details.startDate.toJSDate().getTime();
    const endTs = details.endDate ? details.endDate.toJSDate().getTime() : startTs + durationSec * 1000;
    if (endTs <= rangeStartTs) continue;
    const allDay = details.startDate.isDate;
    out.push({
      uid: `${uid}#${details.recurrenceId.toString()}`,
      calendarId,
      title: details.item.summary ?? masterEvent.summary ?? "",
      start: { ts: startTs, date: allDay ? icalDateString(details.startDate) : undefined },
      end: { ts: endTs, date: allDay && details.endDate ? icalDateString(details.endDate) : undefined },
      allDay,
      location: details.item.location ?? undefined,
      description: details.item.description ?? undefined,
      attendees: veventAttendees(details.item.component),
      status: veventStatus(details.item.component),
      etag,
      seriesMaster: uid,
      href,
    });
  }
  return out;
}

function mapVevent(ev: InstanceType<typeof ICAL.Event>, uid: string, calendarId: string, href: string, etag: string | undefined): PimEvent | null {
  if (!ev.startDate) return null;
  const allDay = ev.startDate.isDate;
  const startTs = ev.startDate.toJSDate().getTime();
  const endTs = ev.endDate ? ev.endDate.toJSDate().getTime() : startTs;
  return {
    uid,
    calendarId,
    title: ev.summary ?? "",
    start: { ts: startTs, date: allDay ? icalDateString(ev.startDate) : undefined },
    end: { ts: endTs, date: allDay && ev.endDate ? icalDateString(ev.endDate) : undefined },
    allDay,
    location: ev.location ?? undefined,
    description: ev.description ?? undefined,
    attendees: veventAttendees(ev.component),
    status: veventStatus(ev.component),
    etag,
    href,
    color: (ev.component.getFirstPropertyValue("color") as string | null) ?? undefined,
  };
}

function veventAttendees(vevent: InstanceType<typeof ICAL.Component>): string[] | undefined {
  const props = vevent.getAllProperties("attendee");
  if (props.length === 0) return undefined;
  const out: string[] = [];
  for (const p of props) {
    const cn = p.getParameter("cn");
    const value = String(p.getFirstValue() ?? "");
    out.push(typeof cn === "string" && cn ? cn : value.replace(/^mailto:/i, ""));
  }
  return out.filter(Boolean);
}

function veventStatus(vevent: InstanceType<typeof ICAL.Component>): PimEvent["status"] {
  const s = String(vevent.getFirstPropertyValue("status") ?? "").toUpperCase();
  if (s === "TENTATIVE") return "tentative";
  if (s === "CANCELLED") return "cancelled";
  return "confirmed";
}

function icalDateString(t: InstanceType<typeof ICAL.Time>): string {
  const y = String(t.year).padStart(4, "0");
  const m = String(t.month).padStart(2, "0");
  const d = String(t.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function str(v: unknown): string | undefined {
  const s = v == null ? "" : String(v);
  return s.trim() ? s : undefined;
}

function caldavStamp(ts: number): string {
  // 20260801T000000Z — RFC 5545 UTC stamp.
  return new Date(ts).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// ---- multistatus parsing --------------------------------------------------

interface CalDavEntry {
  href?: string;
  etag?: string;
  isCalendar: boolean;
  displayName?: string;
  color?: string;
  components?: string[];
  calendarData?: string;
  principal?: string;
  calendarHomeSet?: string;
  readOnly?: boolean;
}

/** CalDAV-aware multistatus parse (superset of the file sync's props). */
export function parseCalDavMultistatus(xml: string): CalDavEntry[] {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new Error(`invalid XML (line ${valid.err.line}): ${valid.err.msg}`);
  }
  const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: (name) => name === "response" || name === "propstat" || name === "comp" || name === "privilege",
  });
  const doc = parser.parse(xml);
  const multistatus = doc?.multistatus;
  if (!multistatus) return [];
  const rawResponses: any[] = Array.isArray(multistatus.response) ? multistatus.response : [];

  const entries: CalDavEntry[] = [];
  for (const resp of rawResponses) {
    const entry: CalDavEntry = { isCalendar: false };
    entry.href = typeof resp?.href === "string" ? resp.href : undefined;
    const propstats: any[] = Array.isArray(resp?.propstat) ? resp.propstat : [];
    for (const ps of propstats) {
      const prop = ps?.prop;
      if (!prop) continue;
      if (prop.resourcetype && typeof prop.resourcetype === "object" && "calendar" in prop.resourcetype) {
        entry.isCalendar = true;
      }
      if (typeof prop.displayname === "string" && prop.displayname) entry.displayName = prop.displayname;
      const color = prop["calendar-color"];
      if (typeof color === "string" && color) entry.color = color.slice(0, 7);
      if (prop.getetag != null) entry.etag = String(prop.getetag);
      const calData = prop["calendar-data"];
      if (typeof calData === "string" && calData) entry.calendarData = calData;
      const comps = prop["supported-calendar-component-set"]?.comp;
      if (Array.isArray(comps)) {
        // With ignoreAttributes the <c:comp name="VEVENT"/> elements parse to
        // empty strings — re-extract the names from the raw XML instead.
        entry.components = extractComponentNames(xml, entry.href);
      }
      const principal = prop["current-user-principal"]?.href;
      if (typeof principal === "string" && principal) entry.principal = principal;
      const home = prop["calendar-home-set"]?.href;
      if (typeof home === "string" && home) entry.calendarHomeSet = home;
      const privileges = ps?.prop?.["current-user-privilege-set"]?.privilege;
      if (Array.isArray(privileges)) {
        const canWrite = privileges.some((p: any) => p && typeof p === "object" && ("write" in p || "write-content" in p || "all" in p));
        entry.readOnly = !canWrite;
      }
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * The component names live in ATTRIBUTES (<c:comp name="VEVENT"/>), which the
 * namespace-stripped, attribute-ignoring parse drops. A scoped regex over the
 * response block of `href` recovers them; hrefs are unique per multistatus.
 */
function extractComponentNames(xml: string, href: string | undefined): string[] {
  if (!href) return [];
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const respMatch = xml.match(new RegExp(`<[^>]*response[^>]*>(?:(?!</[^>]*response>)[\\s\\S])*${escaped}(?:(?!</[^>]*response>)[\\s\\S])*</[^>]*response>`, "i"));
  const scope = respMatch ? respMatch[0] : xml;
  const names = new Set<string>();
  for (const m of scope.matchAll(/<[^>]*comp\s+name="([A-Z]+)"/gi)) names.add(m[1].toUpperCase());
  return [...names];
}
