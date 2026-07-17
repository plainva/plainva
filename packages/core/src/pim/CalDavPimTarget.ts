import { XMLParser, XMLValidator } from "fast-xml-parser";
import ICAL from "ical.js";
import type { FetchFn, WebDavCredentials } from "../sync/WebDavSyncTarget.js";
import type { IPimTarget, PimCalendar, PimEvent, PimTask, PimTaskList, PullEventsResult, PullTasksResult } from "./types.js";

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
