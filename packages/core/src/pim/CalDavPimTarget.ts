import { XMLParser, XMLValidator } from "fast-xml-parser";
import { pimRequestError } from "./requestError.js";
import ICAL from "ical.js";
import { recurrenceToRRule } from "./recurrence.js";
import type { FetchFn, WebDavCredentials } from "../sync/WebDavSyncTarget.js";
import type {
  IPimTarget,
  PimAttendee,
  PimAttendeeStatus,
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
  PullEventsDeltaResult,
  PullTasksResult,
} from "./types.js";
import { PimConflictError } from "./types.js";
import { htmlToMarkdown } from "./htmlToMarkdown.js";
import { normalizeTitle } from "./seriesTitle.js";
import { sortedMinutes } from "./eventFields.js";

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
      // A collection that only stores VTODO is a reminder list, not a calendar.
      // Both flags travel; the WORKER decides which picker a collection reaches
      // (issue #34: an Apple "Reminders" list used to show up as a calendar).
      // A server that omits the component set means "everything" per RFC 4791.
      const hasEvents = comps.length === 0 || comps.includes("VEVENT");
      const hasTasks = comps.length === 0 || comps.includes("VTODO");
      if (!hasEvents && !hasTasks) continue;
      out.push({
        id: this.resolve(e.href),
        name: e.displayName || decodeURIComponent(e.href.replace(/\/+$/, "").split("/").pop() ?? e.href),
        color: e.color,
        supportsTasks: hasTasks,
        supportsEvents: hasEvents,
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
    markSelfRsvps(events, this.selfEmail());
    return { events };
  }

  /**
   * Incremental pull over `sync-collection` (RFC 6578, C2/S18).
   *
   * Two things make this different from Graph's feed. The report is
   * COLLECTION-wide, not windowed, so every changed object is re-filtered
   * against the window by `expandIcsEvents` — a cursor must never widen what
   * the cache holds. And a removed object is reported by HREF with a 404
   * status; its UID cannot be read any more, so deletions travel as
   * `deletedHrefs` (one resource can hold a series plus its overrides, and all
   * of them go together).
   *
   * The seed is the same report with an EMPTY token, which is how RFC 6578
   * says to start. That costs one listing of etags, and it buys the important
   * property: a server without the extension fails HERE, gets no cursor, and
   * is therefore never asked for a delta again — instead of failing on every
   * delta cycle and parking a permanent error on a calendar that works.
   */
  async pullEventsDelta(
    calendarId: string,
    cursor: string | null,
    rangeStartTs: number,
    rangeEndTs: number
  ): Promise<PullEventsDeltaResult> {
    const xml = await this.davRequest(
      calendarId,
      "REPORT",
      "1",
      `<?xml version="1.0" encoding="utf-8"?>
       <d:sync-collection xmlns:d="DAV:">
         <d:sync-token>${cursor ? escapeXmlText(cursor) : ""}</d:sync-token>
         <d:sync-level>1</d:sync-level>
         <d:prop><d:getetag/></d:prop>
       </d:sync-collection>`
    );
    const { changed, removed, token } = parseCalDavSyncCollection(xml);
    // A report without a token cannot be resumed; "" tells the caller to keep
    // refreshing fully rather than store something it cannot continue from.
    if (!token) return { events: [], deletedUids: [], nextCursor: "" };
    // The seed only wants the token — the full pull runs in the same cycle and
    // already has the window, so fetching these bodies would be wasted work.
    if (!cursor) return { events: [], deletedUids: [], nextCursor: token };

    const events: PimEvent[] = [];
    for (const group of chunkList(changed, 50)) {
      const body =
        `<?xml version="1.0" encoding="utf-8"?>
         <c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
           <d:prop><d:getetag/><c:calendar-data/></d:prop>
           ` +
        group.map((h) => `<d:href>${escapeXmlText(h)}</d:href>`).join("\n           ") +
        `
         </c:calendar-multiget>`;
      const multi = await this.davRequest(calendarId, "REPORT", "1", body);
      for (const e of parseCalDavMultistatus(multi)) {
        if (!e.href || !e.calendarData) continue;
        try {
          const expanded = expandIcsEvents(
            e.calendarData,
            calendarId,
            this.resolve(e.href),
            e.etag,
            rangeStartTs,
            rangeEndTs
          );
          // `expandIcsEvents` bounds the OCCURRENCES of a series, but leaves a
          // single event as it is — for `pullEvents` the server's `time-range`
          // already did that filtering. `sync-collection` has no filter at all,
          // so the window has to be applied here or a cursor would slowly pull
          // the whole calendar's history into a windowed cache.
          //
          // The series MASTER row is kept regardless: it carries the recurrence
          // badge, its DTSTART may sit years in the past, and the cache query
          // keeps it out of the day grid anyway.
          for (const ev of expanded) {
            const inWindow = ev.start.ts < rangeEndTs && ev.end.ts > rangeStartTs;
            if (inWindow || ev.recurrence) events.push(ev);
          }
        } catch (err) {
          console.warn(`[CalDavPimTarget] skipping unparseable object ${e.href}:`, err);
        }
      }
    }
    markSelfRsvps(events, this.selfEmail());
    return {
      events,
      deletedUids: [],
      deletedHrefs: removed.map((h) => this.resolve(h)),
      nextCursor: token,
    };
  }

  /** The account email for self-RSVP detection (only if the user is an email). */
  private selfEmail(): string | undefined {
    return this.creds.user.includes("@") ? this.creds.user.toLowerCase() : undefined;
  }

  /** RSVP: set the own ATTENDEE's PARTSTAT and PUT back. RFC 6638
   * auto-scheduling servers then notify the organiser; others simply record it. */
  async respondToEvent(ref: PimEventRef, response: "accepted" | "declined" | "tentative"): Promise<void> {
    if (!ref.href) return;
    const me = this.selfEmail();
    if (!me) return; // cannot identify the account attendee (user is not an email)
    const partstat = response === "accepted" ? "ACCEPTED" : response === "declined" ? "DECLINED" : "TENTATIVE";
    await this.readModifyPut(ref.href, ref.etag, "vevent", (comp) => {
      for (const p of comp.getAllProperties("attendee")) {
        if (mailtoEmail(p) === me) {
          p.setParameter("partstat", partstat);
          break;
        }
      }
      bumpRevision(comp);
    });
  }

  // ---- tasks --------------------------------------------------------------

  /**
   * CalDAV task lists ARE calendar collections that store VTODO — so a listing
   * the caller already holds answers this without a second PROPFIND (and
   * without a second chance to fail; see `IPimTarget.listTaskLists`).
   */
  async listTaskLists(collections?: PimCalendar[]): Promise<PimTaskList[]> {
    const calendars = collections ?? (await this.listCalendars());
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
    if (!res.ok) throw await pimRequestError("caldav create event", res);
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
    if (!res.ok) throw await pimRequestError("caldav create task", res);
    return { uid, etag: res.headers.get("ETag") ?? undefined, href };
  }

  async updateTask(ref: PimTaskRef, draft: PimTaskDraft): Promise<{ etag?: string }> {
    return this.readModifyPut(ref.href, ref.etag, "vtodo", (comp) => applyTaskDraft(comp, draft));
  }

  async deleteTask(ref: PimTaskRef): Promise<void> {
    if (!ref.href) throw new Error("caldav delete needs the object href");
    const res = await this.rawRequest(ref.href, {
      method: "DELETE",
      headers: ref.etag ? { "If-Match": ref.etag } : {},
    });
    if (res.status === 412) throw new PimConflictError();
    if (!res.ok && res.status !== 404 && res.status !== 410) throw await pimRequestError("caldav delete task", res);
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
  // Description follows the touched-guard: undefined leaves DESCRIPTION (and any
  // X-ALT-DESC) untouched; a value writes the Markdown source as the plain
  // DESCRIPTION plus an HTML alternative (X-ALT-DESC), so HTML-aware clients show
  // formatting while others read the readable Markdown.
  if (draft.description !== undefined) {
    vevent.removeAllProperties("x-alt-desc");
    if (draft.description) {
      vevent.updatePropertyWithValue("description", draft.description);
      if (draft.descriptionHtml) {
        const alt = vevent.addPropertyWithValue("x-alt-desc", draft.descriptionHtml);
        alt.setParameter("fmttype", "text/html");
      }
    } else {
      vevent.removeAllProperties("description");
    }
  }
  // Per-event colour (RFC 7986 COLOR). We store a CSS colour / hex; other
  // clients that expect a CSS3 name simply ignore an unknown value.
  if (draft.color) vevent.updatePropertyWithValue("color", draft.color);
  else vevent.removeAllProperties("color");
  // Invitees: a provided list REPLACES the ATTENDEE lines (undefined = leave
  // them, e.g. a drag reschedule). New invitees are marked NEEDS-ACTION; iMIP
  // scheduling stays with the mail client.
  if (draft.attendees !== undefined) {
    vevent.removeAllProperties("attendee");
    for (const email of draft.attendees) {
      const addr = email.trim();
      if (!addr) continue;
      const p = vevent.addPropertyWithValue("attendee", `mailto:${addr}`);
      p.setParameter("cn", addr);
      p.setParameter("role", "REQ-PARTICIPANT");
      p.setParameter("partstat", "NEEDS-ACTION");
      p.setParameter("rsvp", "TRUE");
    }
  }
  // Recurrence: undefined leaves the rule, null clears it, an object sets it —
  // so an existing series' rule CAN now be edited from the field dialog.
  if (draft.recurrence !== undefined) {
    if (draft.recurrence === null) vevent.removeAllProperties("rrule");
    else vevent.updatePropertyWithValue("rrule", ICAL.Recur.fromString(recurrenceToRRule(draft.recurrence)));
  }
  if (draft.blockOf) vevent.updatePropertyWithValue("x-plainva-block-of", draft.blockOf);
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
      // `??` was not enough (S7, measured at ical.js): a MISSING `SUMMARY:` line
      // yields null and falls through, but an EMPTY one yields "" and does not.
      // A client that clears the title of a single occurrence writes exactly the
      // second shape.
      title: normalizeTitle(details.item.summary) || normalizeTitle(masterEvent.summary),
      start: { ts: startTs, date: allDay ? icalDateString(details.startDate) : undefined },
      end: { ts: endTs, date: allDay && details.endDate ? icalDateString(details.endDate) : undefined },
      allDay,
      location: details.item.location ?? undefined,
      description: caldavDescription(details.item.component, details.item.description),
      attendees: veventAttendees(details.item.component),
      status: veventStatus(details.item.component),
      etag,
      seriesMaster: uid,
      href,
      blockOf: (details.item.component.getFirstPropertyValue("x-plainva-block-of") as string | null) ?? undefined,
      // An occurrence without an override IS the master component here, so it
      // inherits the series' alarms and transparency — which is what a calendar
      // means by a recurring reminder.
      ...veventExtras(details.item.component),
    });
  }
  return out;
}

/** Event description as Markdown: prefer an HTML alternative (X-ALT-DESC, e.g.
 * from Outlook/Apple) converted to Markdown, else the plain DESCRIPTION which is
 * already valid Markdown source. */
function caldavDescription(component: InstanceType<typeof ICAL.Component>, plain: string | null | undefined): string | undefined {
  const html = component.getFirstPropertyValue("x-alt-desc");
  if (typeof html === "string" && html.trim()) return htmlToMarkdown(html) || undefined;
  return plain?.trim() || undefined;
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
    description: caldavDescription(ev.component, ev.description),
    attendees: veventAttendees(ev.component),
    rsvps: veventRsvps(ev.component),
    status: veventStatus(ev.component),
    etag,
    href,
    color: (ev.component.getFirstPropertyValue("color") as string | null) ?? undefined,
    blockOf: (ev.component.getFirstPropertyValue("x-plainva-block-of") as string | null) ?? undefined,
    ...veventExtras(ev.component),
  };
}

/**
 * The four fields every provider carries and Plainva used to drop (S9), read
 * from the standard iCalendar properties.
 *
 * VALARM triggers come in three shapes and only one of them answers "how many
 * minutes before the start": a negative duration relative to the START.
 * `RELATED=END` would need the event's duration and an absolute DATE-TIME only
 * ever describes the FIRST occurrence of a series — turning either into a
 * number here would be arithmetic on an assumption, so they are skipped rather
 * than guessed at. A POSITIVE duration fires after the start and is not a
 * reminder in this sense at all.
 */
function veventExtras(vevent: InstanceType<typeof ICAL.Component>): Pick<PimEvent, "reminders" | "busy" | "meetingUrl" | "categories"> {
  const alarms = vevent.getAllSubcomponents("valarm");
  const minutes: number[] = [];
  for (const alarm of alarms) {
    const trigger = alarm.getFirstProperty("trigger");
    if (!trigger) continue;
    const related = String(trigger.getParameter("related") ?? "").toUpperCase();
    const value = trigger.getFirstValue();
    if (related === "END" || !(value instanceof ICAL.Duration)) continue;
    const seconds = value.toSeconds();
    if (seconds > 0) continue;
    minutes.push(Math.round(-seconds / 60));
  }

  const categories: string[] = [];
  for (const prop of vevent.getAllProperties("categories")) {
    for (const value of prop.getValues()) {
      const text = String(value ?? "").trim();
      if (text) categories.push(text);
    }
  }

  return {
    // No VALARM at all is the event saying "no reminder" — iCalendar has no
    // "inherit from the calendar", so absence here is a statement, not silence.
    reminders: sortedMinutes(minutes),
    // RFC 5545: TRANSP defaults to OPAQUE, so an absent property means busy.
    busy: String(vevent.getFirstPropertyValue("transp") ?? "").toUpperCase() === "TRANSPARENT" ? "free" : "busy",
    // RFC 7986 CONFERENCE. Deliberately not scraped out of LOCATION or the
    // description — a link found by guessing is a link we cannot stand behind.
    meetingUrl: (vevent.getFirstPropertyValue("conference") as string | null) || undefined,
    categories: categories.length > 0 ? [...new Set(categories)] : undefined,
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

/** iCal PARTSTAT -> normalised status. */
function partstatToStatus(partstat: string | undefined): PimAttendeeStatus {
  switch ((partstat ?? "").toUpperCase()) {
    case "ACCEPTED":
      return "accepted";
    case "DECLINED":
      return "declined";
    case "TENTATIVE":
      return "tentative";
    default:
      return "needsAction";
  }
}

/** The mailto email from an ATTENDEE/ORGANIZER property value, lowercased. */
function mailtoEmail(p: InstanceType<typeof ICAL.Property> | null): string | undefined {
  if (!p) return undefined;
  const v = String(p.getFirstValue() ?? "").toLowerCase();
  return v.startsWith("mailto:") ? v.slice(7) : undefined;
}

function veventRsvps(vevent: InstanceType<typeof ICAL.Component>): PimAttendee[] | undefined {
  const props = vevent.getAllProperties("attendee");
  if (props.length === 0) return undefined;
  const organizerEmail = mailtoEmail(vevent.getFirstProperty("organizer"));
  const out: PimAttendee[] = [];
  for (const p of props) {
    const cn = p.getParameter("cn");
    const email = mailtoEmail(p);
    const name = typeof cn === "string" && cn ? cn : email ?? "";
    if (!name) continue;
    out.push({
      name,
      email,
      status: partstatToStatus(p.getParameter("partstat") as string | undefined),
      organizer: !!organizerEmail && email === organizerEmail,
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Marks the account user's own attendee entry and derives selfResponse. */
export function markSelfRsvps(events: PimEvent[], selfEmail: string | undefined): void {
  if (!selfEmail) return;
  const me = selfEmail.toLowerCase();
  for (const e of events) {
    const mine = e.rsvps?.find((a) => a.email === me);
    if (mine) {
      mine.self = true;
      if (!mine.organizer) e.selfResponse = mine.status;
    }
  }
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
/** Escapes text destined for an XML element body (sync tokens and hrefs both
 * legitimately contain `&`, and an unescaped one makes the whole report
 * invalid — the same class of bug as the `&amp;` filenames in WebDAV PROPFIND). */
export function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function chunkList<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The `sync-collection` answer: changed hrefs, removed hrefs, and the token for
 * the next run.
 *
 * Kept apart from `parseCalDavMultistatus` on purpose — that one drops the
 * per-response `<d:status>` (which is exactly what marks a deletion) and the
 * collection-level `<d:sync-token>`, and it has seven callers whose behaviour
 * must not shift for this.
 *
 * A response counts as REMOVED only on an explicit 404/410 status. Anything
 * else — including a status this parser does not recognise — counts as changed,
 * so an unfamiliar answer costs a re-fetch rather than a deletion.
 */
export function parseCalDavSyncCollection(xml: string): {
  changed: string[];
  removed: string[];
  token: string;
} {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`invalid XML (line ${valid.err.line}): ${valid.err.msg}`);
  const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: (name) => name === "response" || name === "propstat",
  });
  const doc = parser.parse(xml);
  const ms = doc?.multistatus;
  if (!ms) return { changed: [], removed: [], token: "" };
  const changed: string[] = [];
  const removed: string[] = [];
  for (const resp of (Array.isArray(ms.response) ? ms.response : []) as Array<Record<string, unknown>>) {
    const href = typeof resp?.href === "string" ? resp.href : "";
    if (!href) continue;
    const status = typeof resp?.status === "string" ? resp.status : "";
    if (/\b(404|410)\b/.test(status)) removed.push(href);
    else changed.push(href);
  }
  const token = typeof ms["sync-token"] === "string" ? ms["sync-token"] : "";
  return { changed, removed, token };
}

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
  const componentNamesByHref = componentNamesPerResponse(xml);

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
      if (prop["supported-calendar-component-set"] !== undefined) {
        // With ignoreAttributes the <c:comp name="VEVENT"/> elements parse to
        // empty strings — re-extract the names from the raw XML instead. The
        // presence check must not require an ARRAY: a collection that supports
        // exactly one component type can parse to a plain value, and demanding
        // an array there is what let Apple's VTODO-only reminder lists pass as
        // ordinary calendars (issue #34).
        entry.components = componentNamesByHref.get(entry.href ?? "") ?? [];
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
 * namespace-stripped, attribute-ignoring parse drops — so they are recovered
 * from the raw XML. The multistatus is split into its response blocks ONCE and
 * each block's names are keyed by its own href.
 *
 * Splitting beats the previous per-entry search on two counts (issue #34):
 * a failed lookup used to fall back to scanning the WHOLE document, which
 * handed every collection the union of all component names; and the attribute
 * pattern only matched double quotes, so a server writing name='VTODO' left the
 * set empty — which reads as "no component set" and turns a reminder list into
 * a calendar. Quoting style and attribute order no longer matter here.
 */
function componentNamesPerResponse(xml: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const block of xml.split(/<[^>]*\bresponse\b[^>]*>/i)) {
    const hrefMatch = block.match(/<[^>]*\bhref\b[^>]*>([\s\S]*?)<\/[^>]*\bhref\b[^>]*>/i);
    if (!hrefMatch) continue;
    const names = new Set<string>();
    for (const m of block.matchAll(/<[^>]*\bcomp\b[^>]*\sname\s*=\s*["']?([A-Za-z]+)/gi)) {
      names.add(m[1].toUpperCase());
    }
    // A block without a component set stays absent from the map: "not stated"
    // must not collapse into "stated as empty" (RFC 4791: absent = all types).
    // The key is entity-decoded so it matches the href the XML parser produced
    // (a collection path containing "&" would otherwise never line up).
    if (names.size > 0) out.set(decodeXmlEntities(hrefMatch[1].trim()), [...names]);
  }
  return out;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
