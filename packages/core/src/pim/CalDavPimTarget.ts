import { parseDavListing } from "../sync/xmlListing.js";
import { pimRequestError, PimRequestError } from "./requestError.js";
import { splitAtWordTags, tagAttributeWords, wordTagContent } from "./davTagScan.js";
import { trimEndChars } from "../textScan.js";
import ICAL from "ical.js";
import { recurrenceToRRule } from "./recurrence.js";
import type { FetchFn, WebDavCredentials } from "../sync/WebDavSyncTarget.js";
import type { ConfirmedAccess } from "./confirmedAccess.js";
import type {
  IPimTarget,
  PimAttendee,
  PimAttendeeStatus,
  PimBlockRef,
  PimCalendar,
  PimEvent,
  PimEventCreate,
  PimEventDraft,
  PimEventLinks,
  PimEventRef,
  PimTask,
  PimTaskCreate,
  PimTaskDraft,
  PimTaskList,
  PimTaskRef,
  PimWriteResult,
  PullEventsResult,
  PullEventsDeltaResult,
  PullTasksResult,
} from "./types.js";
import { PimConflictError, PimNotShownYetError } from "./types.js";
import { htmlToMarkdown } from "./htmlToMarkdown.js";
import { normalizeTitle } from "./seriesTitle.js";
import { sortedMinutes } from "./eventFields.js";
import { decodeBlockRefs, encodeBlockRefs } from "./blockLinks.js";
import { eventSubstanceOf, sameEventSubstance, type PimEventSubstance } from "./eventSubstance.js";

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

/**
 * How long a read gives an object Plainva has just written to show up (issue
 * 119): the pauses between the reads, about five and a half seconds in all.
 * iCloud accepts a new object and answers a GET for it with 404 for a moment
 * after; a server that shows its writes at once never waits.
 */
const READ_AFTER_WRITE_WAITS_MS = [250, 750, 1_500, 3_000] as const;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The objects this app created a moment ago, by address, and when (issue 119).
 * A target is built per write, so this lives beside the class: the edit that
 * follows a create meets a new target. Only these objects get the patience of
 * the read-back before an edit; for every other object a 404 means gone, at
 * once (a blocker deleted elsewhere is passed over without waiting).
 */
const justCreated = new Map<string, number>();
const JUST_CREATED_MS = 10 * 60_000;

/**
 * The addresses a create has been sent to, and when (issue 119): an answer
 * 412 to a create counts as "landed" only for an address sent to before - in
 * the same call, or in an earlier try of the same create. Kept for a day.
 */
const sentCreates = new Map<string, number>();
const SENT_CREATES_MS = 24 * 3600_000;

/** Marks `href` as sent to; returns whether it had been sent to before. */
function createSent(href: string, now: number): boolean {
  for (const [known, at] of sentCreates) if (now - at > SENT_CREATES_MS) sentCreates.delete(known);
  const before = sentCreates.has(href);
  sentCreates.set(href, now);
  return before;
}

function noteCreated(href: string, now: number): void {
  for (const [known, at] of justCreated) if (now - at > JUST_CREATED_MS) justCreated.delete(known);
  justCreated.set(href, now);
}

function createdMomentsAgo(href: string, now: number): boolean {
  const at = justCreated.get(href);
  return at !== undefined && now - at <= JUST_CREATED_MS;
}

export class CalDavPimTarget implements IPimTarget {
  readonly provider = "caldav" as const;
  private base: URL;
  /** The principal the server named during the last discovery (`confirmedAccess`). */
  private principal: string | undefined;
  /** Whether a `listCalendars` succeeded: only then is the access confirmed. */
  private discovered = false;

  constructor(
    private creds: WebDavCredentials,
    private fetchFn: FetchFn = (...args) => globalThis.fetch(...args),
    /** The pause between two reads of a just-written object (tests pass their own clock). */
    private wait: (ms: number) => Promise<void> = pause
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
  confirmedAccess(): ConfirmedAccess | undefined {
    if (!this.discovered) return undefined;
    return { url: this.creds.url, user: this.creds.user, ...(this.principal ? { principal: this.principal } : {}) };
  }

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
    this.discovered = true;
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
        name: e.displayName || decodeURIComponent(trimEndChars(e.href, "/").split("/").pop() ?? e.href),
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
      // Recorded before any early return: a server that answers the home or
      // the calendar directly still says whose it is.
      if (self?.principal) this.principal = this.resolve(self.principal);
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
  async respondToEvent(ref: PimEventRef, response: "accepted" | "declined" | "tentative"): Promise<{ etag?: string } | void> {
    if (!ref.href) return;
    const me = this.selfEmail();
    if (!me) return; // cannot identify the account attendee (user is not an email)
    const partstat = response === "accepted" ? "ACCEPTED" : response === "declined" ? "DECLINED" : "TENTATIVE";
    return this.readModifyPut(ref.href, ref.etag, "vevent", (comp) => {
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
        // One calendar object is one task (RFC 5545 § 3.8.4.4): a recurring
        // VTODO keeps its exceptions as further VTODOs with the same UID and a
        // RECURRENCE-ID. The task is the master; without one, the first part.
        const parts = comp.getAllSubcomponents("vtodo");
        const master = parts.find((part) => !part.hasProperty("recurrence-id")) ?? parts[0];
        for (const vtodo of master ? [master] : []) {
          const uid = String(vtodo.getFirstPropertyValue("uid") ?? e.href);
          const due = vtodo.getFirstPropertyValue("due");
          const lastMod = vtodo.getFirstPropertyValue("last-modified");
          tasks.push({
            uid,
            listId,
            title: String(vtodo.getFirstPropertyValue("summary") ?? ""),
            notes: str(vtodo.getFirstPropertyValue("description")),
            due: due instanceof ICAL.Time ? icalDateString(due) : undefined,
            completed: vtodoCompleted(vtodo),
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

  async createEvent(calendarId: string, draft: PimEventCreate): Promise<PimWriteResult> {
    const uid = draft.createAs;
    const { href, etag } = await this.createObject(this.resolve(joinCollection(calendarId, `${uid}.ics`)), "event", buildIcsObject(uid, "vevent", (vevent) => applyEventDraft(vevent, draft)));
    return { uid, etag, href };
  }

  /**
   * PUTs a new object (issue 119) and hands back where it stands and, where
   * the server shows it, its etag.
   *
   * A server that rewrites what it is sent names no etag in its answer (RFC
   * 4791 5.3.4), so the object is read back. iCloud answers that read with 404
   * for a moment after the create; taken for "etag unknown", the first edit
   * read it again, met the same 404 and said "caldav read 404 before update".
   * Now the read gives the object time to show. One that still does not is
   * sent once more with `If-None-Match: *` - a server that dropped it takes it
   * now; one that holds it answers 412 or, where its write side is as late as
   * its read side, takes the same object again at the same address. After two
   * accepted sends the object counts as held, its etag unknown: an edit of it
   * then waits for it (`justCreated`), and the screen asks the provider later
   * whether it is there (`watchCreatedEvents`). Nothing is refused that the
   * server accepted.
   *
   * A 412 counts as "this create, landed" only where this address was sent
   * before - in this call, or in an earlier try of the same create
   * (`createAs` is the same for every try). On a first send it is somebody
   * else's object, and an error. A server that puts the object under its own
   * address and says so (`Location`) is read there, and never sent again.
   */
  private async createObject(href: string, what: "event" | "task", body: string): Promise<{ href: string; etag?: string }> {
    const placed = await this.putNewObject(href, what, body);
    noteCreated(placed.href, Date.now());
    return placed;
  }

  private async putNewObject(href: string, what: "event" | "task", body: string): Promise<{ href: string; etag?: string }> {
    const put = async () => {
      const sentBefore = createSent(href, Date.now());
      const res = await this.rawRequest(href, {
        method: "PUT",
        headers: { "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*" },
        body,
      });
      if (res.status === 412 && !sentBefore) throw await pimRequestError(`caldav create ${what}: the address is taken`, res);
      if (res.status !== 412 && !res.ok) throw await pimRequestError(`caldav create ${what}`, res);
      return res;
    };
    let res = await put();
    for (let sends = 1; ; sends++) {
      const location = res.ok ? res.headers.get("Location") : null;
      const at = location ? this.resolve(location) : href;
      const said = res.ok ? res.headers.get("ETag") : null;
      if (said && at === href) return { href, etag: said };
      let read: Response;
      try {
        read = await this.readAfterWrite(at);
      } catch {
        // No answer at all: the server took the object, its etag is unknown.
        return { href: at };
      }
      if (read.status !== 404 && read.status !== 410) return { href: at, ...(read.ok && read.headers.get("ETag") ? { etag: read.headers.get("ETag")! } : {}) };
      // Not shown. Held where the server said so (412), where it lives under
      // an address of the server's own, or after the second accepted send.
      if (res.status === 412 || at !== href || sends >= 2) return { href: at };
      res = await put();
    }
  }

  /**
   * GET of an object Plainva has just created. A 404 is asked again after a
   * pause, a few times, before it counts: a server that shows its own writes
   * late (iCloud) must not turn a create into "written" that it does not hold.
   * Edits and deletes wait only for an object this app created a moment ago
   * (`justCreated`); for any other an event gone there is gone at once (a
   * blocker deleted elsewhere is passed over without waiting).
   */
  private async readAfterWrite(href: string): Promise<Response> {
    let res = await this.rawRequest(href, { method: "GET", headers: {} });
    for (const ms of READ_AFTER_WRITE_WAITS_MS) {
      if (res.status !== 404 && res.status !== 410) return res;
      await this.wait(ms);
      res = await this.rawRequest(href, { method: "GET", headers: {} });
    }
    return res;
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

  /**
   * The linkage lives on the series, never on a single occurrence: an
   * occurrence ref is answered on its master component. No SEQUENCE bump —
   * nothing an attendee would care about has changed.
   */
  async linkEvent(ref: PimEventRef, links: PimEventLinks): Promise<{ etag?: string }> {
    return this.readModifyPutObject(ref.href, ref.etag, (cal) => {
      const master = findComponent(cal, "vevent", null);
      if (!master) throw new Error("caldav object has no vevent");
      applyEventLinks(master, links);
    });
  }

  /**
   * Deletes an event, or one occurrence of a series.
   *
   * A refused guard (412) is not yet a conflict (issue 119, R2). The object is
   * read once more: gone means deleted; still the event the caller saw
   * (`ref.expect`, compared by `sameEventSubstance`) means the server only
   * spelled it anew - iCloud rewrites what it is sent - and the delete is
   * repeated once with the new etag. Anything else is a conflict that carries
   * the new etag, so the person can be asked and "delete anyway" is sent
   * against exactly the state they were told about.
   */
  async deleteEvent(ref: PimEventRef): Promise<{ etag?: string } | void> {
    const href = ref.href;
    if (!href) throw new Error("caldav delete needs the object href");
    const recurrenceId = instanceRecurrenceId(ref.uid);
    if (recurrenceId) {
      // "Only this event": EXDATE on the master + drop a matching override.
      // The series object itself survives - with a new etag, which every other
      // occurrence shares and which is therefore handed back.
      return this.readModifyPutObject(
        href,
        ref.etag,
        (cal) => {
          const master = findComponent(cal, "vevent", null);
          if (!master) throw new Error("caldav object has no vevent");
          master.addPropertyWithValue("exdate", icalTimeFromKey(recurrenceId));
          const override = findComponent(cal, "vevent", recurrenceId);
          if (override) cal.removeSubcomponent(override);
          bumpRevision(master);
        },
        { expect: ref.expect ? { substance: ref.expect, calendarId: ref.calendarId, uid: ref.uid } : undefined, goneIsDone: true },
      );
    }
    let guard = ref.etag;
    for (let attempt = 0; ; attempt++) {
      const res = await this.rawRequest(href, {
        method: "DELETE",
        headers: guard ? { "If-Match": guard } : {},
      });
      // Already gone = success (the file sync's not-found-on-delete lesson).
      if (res.ok || res.status === 404 || res.status === 410) return;
      if (res.status !== 412) throw new Error(`caldav delete ${res.status}`);
      const current = await this.readObject(href);
      if (current.gone) return;
      const same = attempt === 0 && !!ref.expect && current.text !== undefined && this.isStill(current.text, href, ref.calendarId, ref.uid, ref.expect);
      if (!same) throw new PimConflictError(undefined, current.etag);
      guard = current.etag;
    }
  }

  async eventExists(ref: PimEventRef): Promise<boolean> {
    if (!ref.href) throw new Error("caldav lookup needs the object href");
    const res = await this.rawRequest(ref.href, { method: "GET", headers: {} });
    if (res.status === 404 || res.status === 410) return false;
    if (!res.ok) throw new PimRequestError(`caldav read ${res.status}`, res.status);
    return true;
  }

  async createTask(listId: string, draft: PimTaskCreate): Promise<PimWriteResult> {
    const uid = draft.createAs;
    const { href, etag } = await this.createObject(this.resolve(joinCollection(listId, `${uid}.ics`)), "task", buildIcsObject(uid, "vtodo", (vtodo) => applyTaskDraft(vtodo, draft)));
    return { uid, etag, href };
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
    mutate: (cal: InstanceType<typeof ICAL.Component>) => void,
    options: {
      /** Deleting an occurrence (R2): an object that moved but is still this event is written anyway, once. */
      expect?: { substance: PimEventSubstance; calendarId: string; uid: string };
      /** Deleting an occurrence: a series that is gone has nothing left to delete. */
      goneIsDone?: boolean;
    } = {}
  ): Promise<{ etag?: string }> {
    if (!href) throw new Error("caldav update needs the object href");
    const expect = options.expect;
    let known = knownEtag;
    for (let attempt = 0; ; attempt++) {
      // An object this app created a moment ago may not show yet (issue 119):
      // it is given the read-back's patience - also a delete of one of its
      // occurrences, which would otherwise take "not shown" for "done".
      const fresh = createdMomentsAgo(href, Date.now());
      const getRes = fresh ? await this.readAfterWrite(href) : await this.rawRequest(href, { method: "GET", headers: {} });
      // Still not shown, though this app just created it: not gone, not
      // refused - the provider has not caught up yet, and the person is told
      // exactly that (`PimNotShownYetError`).
      if (fresh && (getRes.status === 404 || getRes.status === 410)) throw new PimNotShownYetError();
      if (options.goneIsDone && (getRes.status === 404 || getRes.status === 410)) return {};
      // With its status (K3): a blocker that is gone answers 404 here, and the
      // caller has to tell "gone" from "refused".
      if (!getRes.ok) throw new PimRequestError(`caldav read ${getRes.status} before update`, getRes.status);
      const currentEtag = getRes.headers.get("ETag") ?? undefined;
      const text = await getRes.text();
      // The guard the caller holds is behind. Only a write that may go ahead
      // over a moved object that is still the same event (`expect`) does -
      // with the etag just read, so a third writer is still caught by the PUT.
      if (known && currentEtag && known !== currentEtag) {
        if (!expect || !this.isStill(text, href, expect.calendarId, expect.uid, expect.substance)) {
          throw new PimConflictError(undefined, currentEtag);
        }
        known = currentEtag;
      }

      const jcal = ICAL.parse(text);
      const cal = new ICAL.Component(jcal);
      mutate(cal);

      const guard = known ?? currentEtag;
      const putRes = await this.rawRequest(href, {
        method: "PUT",
        headers: { "Content-Type": "text/calendar; charset=utf-8", ...(guard ? { "If-Match": guard } : {}) },
        body: cal.toString(),
      });
      if (putRes.status === 412) {
        // Moved between the read and the write: where the caller allows it,
        // read once more and judge the new state (one more PUT at most);
        // otherwise it is a conflict.
        if (expect && attempt === 0) {
          known = guard;
          continue;
        }
        throw new PimConflictError();
      }
      if (!putRes.ok) throw new Error(`caldav update ${putRes.status}`);
      return { etag: await this.etagAfterWrite(href, putRes) };
    }
  }

  /**
   * The etag an object has after Plainva wrote it (issue 119, R2).
   *
   * RFC 4791 section 5.3.4: a server that stores what it was sent may name its
   * etag in the answer; one that changed it on the way in must NOT. iCloud is
   * the second kind. Without the etag the views held the previous one - or
   * none - and the next delete or edit was refused as "changed elsewhere". So
   * where the answer is silent, the object is read back. A read that fails
   * leaves the etag unknown, which the 412 handling of a delete copes with.
   */
  private async etagAfterWrite(href: string, res: Response): Promise<string | undefined> {
    const said = res.headers.get("ETag");
    if (said) return said;
    try {
      return (await this.readObject(href)).etag;
    } catch {
      return undefined;
    }
  }

  /** One object as the server holds it now: gone, or its etag and text. */
  private async readObject(href: string): Promise<{ gone: boolean; etag?: string; text?: string }> {
    const res = await this.rawRequest(href, { method: "GET", headers: {} });
    if (res.status === 404 || res.status === 410) return { gone: true };
    if (!res.ok) throw new PimRequestError(`caldav read ${res.status}`, res.status);
    return { gone: false, etag: res.headers.get("ETag") ?? undefined, text: await res.text() };
  }

  /**
   * Whether the object text still holds the event the caller saw. Read through
   * the same expansion a pull uses, so the comparison is between two things
   * spelled alike: the row the view holds and the row a pull would produce now.
   */
  private isStill(ics: string, href: string, calendarId: string, uid: string, expected: PimEventSubstance): boolean {
    try {
      const key = instanceRecurrenceId(uid);
      // An occurrence is looked for around its original time - a moved one up
      // to a year either side. A series or a single event is emitted whatever
      // the window.
      const around = key ? icalTimeFromKey(key).toJSDate().getTime() : 0;
      const year = 366 * 24 * 3600_000;
      const rows = expandIcsEvents(ics, calendarId, href, undefined, around - year, around + year);
      const now = rows.find((row) => row.uid === uid);
      return !!now && sameEventSubstance(expected, eventSubstanceOf(now));
    } catch {
      return false;
    }
  }
}

/**
 * The occurrences a new series has in a window, expanded exactly as a pull
 * expands it (issue 119): the object Plainva sends for the draft, read by
 * `expandIcsEvents`. The series' own row is left out, as the day query leaves
 * it out. For the screen until a sync lists the series - not a second
 * expansion that could disagree with the one after it.
 */
export function expandEventDraft(
  draft: PimEventDraft,
  ids: { uid: string; calendarId: string; href?: string; etag?: string },
  rangeStartTs: number,
  rangeEndTs: number,
): PimEvent[] {
  const ics = buildIcsObject(ids.uid, "vevent", (vevent) => applyEventDraft(vevent, draft));
  return expandIcsEvents(ics, ids.calendarId, ids.href ?? "", ids.etag, rangeStartTs, rangeEndTs).filter((row) => !!row.seriesMaster);
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

/**
 * The uid for ONE create of the person (`PimEventDraft.createAs`): made once
 * when the form is saved, sent with every try of it, so "Try again" after an
 * answer that never came or a read-back that failed cannot leave the event on
 * the server twice (issue 119).
 */
export function newPimCreateUid(): string {
  return `plainva-${globalThis.crypto.randomUUID()}`;
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
  applyEventLinks(vevent, draft);
}

function applyEventLinks(vevent: InstanceType<typeof ICAL.Component>, links: PimEventLinks): void {
  // `undefined` leaves the link, `null` removes it (a detached blocker).
  if (links.blockOf) vevent.updatePropertyWithValue("x-plainva-block-of", links.blockOf);
  else if (links.blockOf === null) vevent.removeAllProperties("x-plainva-block-of");
  // The reverse half (K3): the event's own list of its blockers.
  if (links.blocks !== undefined) {
    if (links.blocks.length > 0) vevent.updatePropertyWithValue("x-plainva-blocks", icalBlocksValue(links.blocks));
    else vevent.removeAllProperties("x-plainva-blocks");
  }
}

/**
 * The blocker list as an iCalendar property value. Percent-encoded: the list
 * is JSON, full of commas, colons, quotes and — in a CalDAV href — slashes,
 * and an `X-` property has no declared value type, so neither ical.js nor a
 * server in between would know how to escape it. What is left is plain ASCII
 * that every line folder leaves alone.
 */
function icalBlocksValue(refs: PimBlockRef[]): string {
  return encodeURIComponent(encodeBlockRefs(refs));
}

type IcalComponent = InstanceType<typeof ICAL.Component>;

/**
 * Both halves of the blocker linkage of a component. An occurrence that has
 * its own override component (a single moved occurrence) does not repeat the
 * series' `X-` properties, so `fallback` — the master — answers for it:
 * the link belongs to the series.
 */
function icalLinks(component: IcalComponent, fallback?: IcalComponent): Pick<PimEvent, "blockOf" | "blocks"> {
  const read = (name: string): string | undefined => {
    const own = component.getFirstPropertyValue(name);
    if (typeof own === "string" && own) return own;
    const inherited = fallback?.getFirstPropertyValue(name);
    return typeof inherited === "string" && inherited ? inherited : undefined;
  };
  const stored = read("x-plainva-blocks");
  let blocks: PimBlockRef[] | undefined;
  if (stored) {
    try {
      blocks = decodeBlockRefs(decodeURIComponent(stored));
    } catch {
      blocks = undefined; // not ours, or mangled on the way: no blockers known
    }
  }
  return { blockOf: read("x-plainva-block-of"), blocks };
}

/**
 * Whether a VTODO is done (finding B2, 19.10.). `STATUS` says it where it is
 * present, and then it is the answer — a client that reopens a task sets
 * `NEEDS-ACTION` and may leave a stale `COMPLETED` stamp behind. Without
 * `STATUS`, RFC 5545 still has two ways to say it, and clients use them: a
 * `COMPLETED` date-time and `PERCENT-COMPLETE:100`. Both were read as "open",
 * so a task ticked off by such a client stayed open in Plainva for good.
 */
export function vtodoCompleted(vtodo: InstanceType<typeof ICAL.Component>): boolean {
  const status = vtodo.getFirstPropertyValue("status");
  if (status != null && String(status).trim() !== "") return String(status).trim().toUpperCase() === "COMPLETED";
  if (vtodo.getFirstProperty("completed")) return true;
  const percent = Number(vtodo.getFirstPropertyValue("percent-complete"));
  return Number.isFinite(percent) && percent >= 100;
}

function applyTaskDraft(vtodo: InstanceType<typeof ICAL.Component>, draft: PimTaskDraft): void {
  vtodo.updatePropertyWithValue("summary", draft.title);
  if (draft.due) setTimeProperty(vtodo, "due", { ts: 0, date: draft.due.slice(0, 10) }, true);
  else vtodo.removeAllProperties("due");
  // Notes left out of the draft are no instruction: the task sync never sends
  // them, and reading "absent" as "empty" erased the description of every
  // task it ticked. Only an empty string clears it.
  if (draft.notes) vtodo.updatePropertyWithValue("description", draft.notes);
  else if (draft.notes !== undefined) vtodo.removeAllProperties("description");
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
      ...icalLinks(details.item.component, master),
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
    ...icalLinks(ev.component),
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
  const ms = parseDavListing(xml);
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
  const multistatus = parseDavListing(xml, ["comp", "privilege"]);
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
 *
 * The three tag patterns this used to run are read by linear scans now
 * (davTagScan): as patterns, a server answer with a long run of "<" cost
 * quadratic time. What they match is unchanged.
 */
function componentNamesPerResponse(xml: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const block of splitAtWordTags(xml, "response")) {
    const href = wordTagContent(block, "href");
    if (href === undefined) continue;
    const names = new Set<string>();
    for (const name of tagAttributeWords(block, "comp", "name")) names.add(name.toUpperCase());
    // A block without a component set stays absent from the map: "not stated"
    // must not collapse into "stated as empty" (RFC 4791: absent = all types).
    // The key is entity-decoded so it matches the href the XML parser produced
    // (a collection path containing "&" would otherwise never line up).
    if (names.size > 0) out.set(decodeXmlEntities(href.trim()), [...names]);
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
