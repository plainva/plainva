import { describe, expect, it, vi } from "vitest";
import { CalDavPimTarget, expandIcsEvents, parseCalDavMultistatus, parseCalDavSyncCollection } from "../src/pim/CalDavPimTarget.ts";
import { eventCalendarsOf } from "../src/pim/types.ts";
import type { FetchFn } from "../src/sync/WebDavSyncTarget.ts";

const CREDS = { url: "https://cloud.example.org/remote.php/dav/", user: "marco", pass: "app-pass" };

function davRes(xml: string): Response {
  return new Response(xml, { status: 207, headers: { "Content-Type": "application/xml" } });
}

const HOME_LIST = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://apple.com/ns/ical/">
  <d:response>
    <d:href>/remote.php/dav/calendars/marco/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/calendars/marco/personal/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <d:displayname>Privat</d:displayname>
      <cs:calendar-color>#00FF00FF</cs:calendar-color>
      <c:supported-calendar-component-set><c:comp name="VEVENT"/><c:comp name="VTODO"/></c:supported-calendar-component-set>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/calendars/marco/work/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <d:displayname>Arbeit</d:displayname>
      <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;

const SIMPLE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//EN",
  "BEGIN:VEVENT",
  "UID:simple-1",
  "SUMMARY:Zahnarzt",
  "DTSTART:20260801T080000Z",
  "DTEND:20260801T083000Z",
  "LOCATION:Praxis",
  "STATUS:CONFIRMED",
  "ATTENDEE;CN=Anna:mailto:anna@example.org",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const CANCELLED_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//EN",
  "BEGIN:VEVENT",
  "UID:off-1",
  "SUMMARY:Abgesagt",
  "DTSTART:20260802T080000Z",
  "DTEND:20260802T083000Z",
  "STATUS:CANCELLED",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const RECURRING_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//EN",
  "BEGIN:VEVENT",
  "UID:standup-1",
  "SUMMARY:Standup",
  "DTSTART:20260803T090000Z",
  "DTEND:20260803T091500Z",
  "RRULE:FREQ=WEEKLY;BYDAY=MO",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:standup-1",
  "RECURRENCE-ID:20260810T090000Z",
  "SUMMARY:Standup (verschoben)",
  "DTSTART:20260810T100000Z",
  "DTEND:20260810T101500Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

// Same series, but the override's SUMMARY line is PRESENT and EMPTY — what a
// client writes when someone clears the title of a single occurrence. S7
// measured at ical.js that this is the shape the old `??` chain let through: a
// MISSING line yields null and falls back, an empty one yields "" and does not.
const EMPTY_OVERRIDE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//EN",
  "BEGIN:VEVENT",
  "UID:standup-1",
  "SUMMARY:Standup",
  "DTSTART:20260803T090000Z",
  "DTEND:20260803T091500Z",
  "RRULE:FREQ=WEEKLY;BYDAY=MO",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:standup-1",
  "RECURRENCE-ID:20260810T090000Z",
  "SUMMARY:",
  "DTSTART:20260810T100000Z",
  "DTEND:20260810T101500Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

// S9: the four fields every provider carries. The alarms deliberately cover all
// three TRIGGER shapes — only the negative duration relative to the START says
// "so many minutes before"; the other two would need arithmetic on an assumption.
const EXTRAS_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//EN",
  "BEGIN:VEVENT",
  "UID:extras-1",
  "SUMMARY:Kundentermin",
  "DTSTART:20260803T090000Z",
  "DTEND:20260803T093000Z",
  "TRANSP:TRANSPARENT",
  "CATEGORIES:Arbeit,Kunde",
  "CATEGORIES:Arbeit",
  "CONFERENCE;VALUE=URI;FEATURE=VIDEO:https://meet.example.org/abc",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT15M",
  "DESCRIPTION:Erinnerung",
  "END:VALARM",
  "BEGIN:VALARM",
  "ACTION:EMAIL",
  "TRIGGER:-PT15M",
  "END:VALARM",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT1H",
  "END:VALARM",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER;RELATED=END:-PT5M",
  "END:VALARM",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER;VALUE=DATE-TIME:20260803T080000Z",
  "END:VALARM",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:PT10M",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("CalDavPimTarget discovery", () => {
  it("walks principal → calendar-home-set → collections with names, colors and VTODO capability", async () => {
    const calls: Array<{ url: string; method: string; depth: string }> = [];
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string>;
      calls.push({ url, method: String(init?.method), depth: headers.Depth });
      if (url.endsWith("/remote.php/dav/") && init?.method === "PROPFIND") {
        return davRes(`<?xml version="1.0"?>
          <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
            <d:response><d:href>/remote.php/dav/</d:href>
              <d:propstat><d:prop>
                <d:resourcetype><d:collection/></d:resourcetype>
                <d:current-user-principal><d:href>/remote.php/dav/principals/users/marco/</d:href></d:current-user-principal>
              </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
            </d:response>
          </d:multistatus>`);
      }
      if (url.includes("/principals/users/marco/")) {
        return davRes(`<?xml version="1.0"?>
          <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
            <d:response><d:href>/remote.php/dav/principals/users/marco/</d:href>
              <d:propstat><d:prop>
                <c:calendar-home-set><d:href>/remote.php/dav/calendars/marco/</d:href></c:calendar-home-set>
              </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
            </d:response>
          </d:multistatus>`);
      }
      if (url.includes("/calendars/marco/")) return davRes(HOME_LIST);
      return new Response("nope", { status: 404 });
    });

    const t = new CalDavPimTarget(CREDS, fetchFn);
    const cals = await t.listCalendars();
    expect(cals).toHaveLength(2);
    expect(cals[0]).toMatchObject({ name: "Privat", color: "#00FF00", supportsTasks: true });
    expect(cals[0].id).toBe("https://cloud.example.org/remote.php/dav/calendars/marco/personal/");
    expect(cals[1]).toMatchObject({ name: "Arbeit", supportsTasks: false });
    // Auth went out as Basic on every hop.
    expect(calls.length).toBe(3);
  });

  it("task lists are the VTODO-capable calendars", async () => {
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === "PROPFIND" && url.endsWith("/remote.php/dav/")) {
        // The configured URL IS the calendar home (short-circuit branch).
        return davRes(`<?xml version="1.0"?>
          <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
            <d:response><d:href>/remote.php/dav/</d:href>
              <d:propstat><d:prop>
                <c:calendar-home-set><d:href>/remote.php/dav/calendars/marco/</d:href></c:calendar-home-set>
              </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
            </d:response>
          </d:multistatus>`);
      }
      if (url.includes("/calendars/marco/")) return davRes(HOME_LIST);
      return new Response("nope", { status: 404 });
    });
    const t = new CalDavPimTarget(CREDS, fetchFn);
    const lists = await t.listTaskLists();
    expect(lists).toEqual([{ id: "https://cloud.example.org/remote.php/dav/calendars/marco/personal/", name: "Privat" }]);
  });

  // Issue #34: an iCloud "Reminders" list is a VTODO-ONLY collection. It used
  // to arrive as an ordinary calendar (the component set was read with a regex
  // that only matched double quotes, and the presence check demanded an array),
  // so it showed up in the calendar picker and never in the task-list picker.
  it("classifies an Apple-shaped VTODO-only collection as a task list, not a calendar", async () => {
    const APPLE = `<?xml version="1.0" encoding="UTF-8"?>
      <multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
        <response>
          <href>/1234567890/calendars/home/</href>
          <propstat><prop>
            <resourcetype><collection/><C:calendar/></resourcetype>
            <displayname>Home</displayname>
            <C:supported-calendar-component-set><C:comp name='VEVENT'/></C:supported-calendar-component-set>
          </prop><status>HTTP/1.1 200 OK</status></propstat>
        </response>
        <response>
          <href>/1234567890/calendars/reminders/</href>
          <propstat><prop>
            <resourcetype><collection/><C:calendar/></resourcetype>
            <displayname>Reminders</displayname>
            <C:supported-calendar-component-set><C:comp name='VTODO'/></C:supported-calendar-component-set>
          </prop><status>HTTP/1.1 200 OK</status></propstat>
        </response>
      </multistatus>`;
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === "PROPFIND" && url.endsWith("/remote.php/dav/")) {
        return davRes(`<?xml version="1.0"?>
          <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
            <d:response><d:href>/remote.php/dav/</d:href>
              <d:propstat><d:prop>
                <c:calendar-home-set><d:href>/1234567890/calendars/</d:href></c:calendar-home-set>
              </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
            </d:response>
          </d:multistatus>`);
      }
      if (url.includes("/1234567890/calendars/")) return davRes(APPLE);
      return new Response("nope", { status: 404 });
    });

    const t = new CalDavPimTarget(CREDS, fetchFn);
    const cols = await t.listCalendars();
    expect(cols.map((c) => [c.name, c.supportsEvents, c.supportsTasks])).toEqual([
      ["Home", true, false],
      ["Reminders", false, true],
    ]);
    // The reminder list is the ONLY task list — and it is not an event calendar.
    expect((await t.listTaskLists(cols)).map((l) => l.name)).toEqual(["Reminders"]);
    expect(eventCalendarsOf(cols).map((c) => c.name)).toEqual(["Home"]);
    // Reusing the listing spares the second PROPFIND that used to swallow the
    // task lists whole when it failed.
    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.length;
    await t.listTaskLists(cols);
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });

  it("keeps each collection's component set to itself and survives a missing one", () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:response>
          <d:href>/dav/cal/a&amp;b/</d:href>
          <d:propstat><d:prop>
            <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
            <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
          </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
        </d:response>
        <d:response>
          <d:href>/dav/cal/plain/</d:href>
          <d:propstat><d:prop>
            <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
          </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
        </d:response>
      </d:multistatus>`;
    const entries = parseCalDavMultistatus(xml);
    // The "&" href lines up despite entity encoding, and the neighbour does NOT
    // inherit its VTODO (the old whole-document fallback handed it over).
    expect(entries[0].components).toEqual(["VTODO"]);
    expect(entries[1].components).toBeUndefined();
  });
});

describe("CalDAV event pull + ics expansion", () => {
  it("REPORTs the time range and maps plain events with etag/href/attendees", async () => {
    let reportBody = "";
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      reportBody = String(init?.body ?? "");
      return davRes(`<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/remote.php/dav/calendars/marco/personal/simple-1.ics</d:href>
            <d:propstat><d:prop>
              <d:getetag>"tag-1"</d:getetag>
              <c:calendar-data>${SIMPLE_ICS.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</c:calendar-data>
            </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
          </d:response>
        </d:multistatus>`);
    });
    const t = new CalDavPimTarget(CREDS, fetchFn);
    const calId = "https://cloud.example.org/remote.php/dav/calendars/marco/personal/";
    const { events } = await t.pullEvents(calId, Date.parse("2026-08-01T00:00:00Z"), Date.parse("2026-09-01T00:00:00Z"));
    expect(reportBody).toContain('start="20260801T000000Z"');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: "simple-1",
      title: "Zahnarzt",
      location: "Praxis",
      etag: '"tag-1"',
      attendees: ["Anna"],
      allDay: false,
    });
    expect(events[0].start.ts).toBe(Date.parse("2026-08-01T08:00:00Z"));
    expect(events[0].href).toBe("https://cloud.example.org/remote.php/dav/calendars/marco/personal/simple-1.ics");
  });

  /**
   * CalDAV states the cancellation as STATUS:CANCELLED and a deleted object is
   * simply gone, so the two are never confused — the event arrives and the views
   * render it as cancelled. This is the regression guard for F7 (report
   * 2026-07-29): CalDAV was already right, and must stay right.
   */
  it("maps STATUS:CANCELLED to a cancelled event instead of dropping it", async () => {
    const fetchFn: FetchFn = vi.fn(async () =>
      davRes(`<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/remote.php/dav/calendars/marco/personal/off-1.ics</d:href>
            <d:propstat><d:prop>
              <d:getetag>"tag-off"</d:getetag>
              <c:calendar-data>${CANCELLED_ICS.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</c:calendar-data>
            </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
          </d:response>
        </d:multistatus>`)
    );
    const t = new CalDavPimTarget(CREDS, fetchFn);
    const { events } = await t.pullEvents(
      "https://cloud.example.org/remote.php/dav/calendars/marco/personal/",
      Date.parse("2026-08-01T00:00:00Z"),
      Date.parse("2026-09-01T00:00:00Z")
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ uid: "off-1", title: "Abgesagt", status: "cancelled" });
  });

  it("expands a weekly series inside the window, honors the override and emits one master row", () => {
    const events = expandIcsEvents(
      RECURRING_ICS,
      "cal",
      "https://x/standup.ics",
      '"e9"',
      Date.parse("2026-08-01T00:00:00Z"),
      Date.parse("2026-08-18T00:00:00Z")
    );
    const master = events.find((e) => e.recurrence);
    expect(master).toBeDefined();
    expect(master!.recurrence).toContain("FREQ=WEEKLY");
    const instances = events.filter((e) => !e.recurrence);
    // Mondays 03.08. + 10.08. + 17.08. lie in the window.
    expect(instances).toHaveLength(3);
    expect(instances.every((i) => i.seriesMaster === "standup-1")).toBe(true);
    const moved = instances.find((i) => i.uid.includes("#") && i.title.includes("verschoben"));
    expect(moved).toBeDefined();
    expect(moved!.start.ts).toBe(Date.parse("2026-08-10T10:00:00Z")); // override wins over the pattern slot
    const regular = instances.find((i) => i.start.ts === Date.parse("2026-08-03T09:00:00Z"));
    expect(regular).toBeDefined();
  });

  it("reads reminders, busy/free, the meeting link and categories (S9)", () => {
    const [e] = expandIcsEvents(
      EXTRAS_ICS,
      "cal",
      "https://x/extras.ics",
      undefined,
      Date.parse("2026-08-01T00:00:00Z"),
      Date.parse("2026-08-05T00:00:00Z")
    );
    // 15 min appears twice (popup + email) and collapses; one hour joins it.
    // RELATED=END, the absolute trigger and the +10 min one are all skipped.
    expect(e.reminders).toEqual([15, 60]);
    expect(e.busy).toBe("free");
    expect(e.meetingUrl).toBe("https://meet.example.org/abc");
    expect(e.categories).toEqual(["Arbeit", "Kunde"]);
  });

  it("treats a missing TRANSP as busy and no VALARM as no reminder (S9)", () => {
    const [e] = expandIcsEvents(
      SIMPLE_ICS,
      "cal",
      "https://x/simple.ics",
      undefined,
      Date.parse("2026-08-01T00:00:00Z"),
      Date.parse("2026-08-02T00:00:00Z")
    );
    // RFC 5545 defaults TRANSP to OPAQUE, and iCalendar has no "inherit from
    // the calendar" — so both absences are statements, not silence.
    expect(e.busy).toBe("busy");
    expect(e.reminders).toEqual([]);
    expect(e.meetingUrl).toBeUndefined();
    expect(e.categories).toBeUndefined();
  });

  it("lets a series occurrence inherit the master's alarms and transparency (S9)", () => {
    const ics = EXTRAS_ICS.replace("DTEND:20260803T093000Z", "DTEND:20260803T093000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO");
    const instances = expandIcsEvents(
      ics,
      "cal",
      "https://x/extras.ics",
      undefined,
      Date.parse("2026-08-01T00:00:00Z"),
      Date.parse("2026-08-18T00:00:00Z")
    ).filter((e) => !e.recurrence);
    expect(instances.length).toBeGreaterThan(1);
    // A recurring reminder is exactly what a person means by one alarm on a
    // weekly appointment — every occurrence carries it.
    expect(instances.every((i) => i.reminders?.join() === "15,60" && i.busy === "free")).toBe(true);
  });

  it("falls back to the series title when an override clears its own (S8)", () => {
    const events = expandIcsEvents(
      EMPTY_OVERRIDE_ICS,
      "cal",
      "https://x/standup.ics",
      '"e9"',
      Date.parse("2026-08-01T00:00:00Z"),
      Date.parse("2026-08-18T00:00:00Z")
    );
    const cleared = events.find((e) => e.start.ts === Date.parse("2026-08-10T10:00:00Z"));
    expect(cleared).toBeDefined();
    expect(cleared!.title).toBe("Standup");
    // The other occurrences are unaffected — they were never the problem.
    expect(events.filter((e) => !e.recurrence).every((e) => e.title === "Standup")).toBe(true);
  });

  it("expansion never leaves the window and survives a broken object without losing the calendar", async () => {
    const events = expandIcsEvents(
      RECURRING_ICS,
      "cal",
      "https://x/standup.ics",
      undefined,
      Date.parse("2026-08-04T00:00:00Z"),
      Date.parse("2026-08-09T00:00:00Z")
    );
    // No monday inside 04.–08.08. — only the master row remains.
    expect(events.filter((e) => !e.recurrence)).toHaveLength(0);

    const fetchFn: FetchFn = vi.fn(async () =>
      davRes(`<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/cal/broken.ics</d:href>
            <d:propstat><d:prop><d:getetag>"b"</d:getetag><c:calendar-data>NOT AN ICS</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
          </d:response>
          <d:response>
            <d:href>/cal/simple-1.ics</d:href>
            <d:propstat><d:prop><d:getetag>"ok"</d:getetag><c:calendar-data>${SIMPLE_ICS.replace(/</g, "&lt;")}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
          </d:response>
        </d:multistatus>`)
    );
    const t = new CalDavPimTarget(CREDS, fetchFn);
    const { events: pulled } = await t.pullEvents("https://cloud.example.org/cal/", 0, Date.parse("2027-01-01T00:00:00Z"));
    expect(pulled.map((e) => e.uid)).toEqual(["simple-1"]);
  });

  it("VTODOs map to tasks with due date, status and href", async () => {
    const todoIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VTODO",
      "UID:todo-1",
      "SUMMARY:Angebot schreiben",
      "DESCRIPTION:Details",
      "DUE;VALUE=DATE:20260801",
      "STATUS:NEEDS-ACTION",
      "LAST-MODIFIED:20260717T100000Z",
      "END:VTODO",
      "END:VCALENDAR",
    ].join("\r\n");
    const fetchFn: FetchFn = vi.fn(async () =>
      davRes(`<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
          <d:response>
            <d:href>/cal/todo-1.ics</d:href>
            <d:propstat><d:prop><d:getetag>"t1"</d:getetag><c:calendar-data>${todoIcs.replace(/</g, "&lt;")}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
          </d:response>
        </d:multistatus>`)
    );
    const t = new CalDavPimTarget(CREDS, fetchFn);
    const { tasks } = await t.pullTasks("https://cloud.example.org/cal/");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      uid: "todo-1",
      title: "Angebot schreiben",
      notes: "Details",
      due: "2026-08-01",
      completed: false,
      etag: '"t1"',
      href: "https://cloud.example.org/cal/todo-1.ics",
    });
  });
});

describe("parseCalDavMultistatus", () => {
  it("rejects garbage bodies loudly (captive-portal HTML must never read as empty)", () => {
    expect(() => parseCalDavMultistatus("<html><body>login</body>")).toThrow(/invalid XML/);
  });
});

describe("CalDavPimTarget delta pull (S18)", () => {
  const SEED = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/cal/a.ics</d:href><d:propstat><d:prop><d:getetag>"1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:sync-token>http://example.org/sync/1</d:sync-token>
</d:multistatus>`;

  it("seeds with an empty token and takes only the token, not the bodies", async () => {
    const bodies: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (_u, init) => {
      bodies.push(String(init?.body ?? ""));
      return davRes(SEED);
    });
    const t = new CalDavPimTarget(CREDS, fetchFn);
    const res = await t.pullEventsDelta("https://cloud.example.org/cal/", null, 0, 9e12);
    expect(bodies).toHaveLength(1); // no multiget — the full pull has the window
    expect(bodies[0]).toContain("<d:sync-token></d:sync-token>");
    expect(res.nextCursor).toBe("http://example.org/sync/1");
    expect(res.events).toEqual([]);
    expect(res.deletedHrefs ?? []).toEqual([]);
  });

  it("escapes a token that contains an ampersand instead of breaking the report", async () => {
    // Sync tokens are opaque server strings; an unescaped `&` makes the whole
    // XML invalid — the same class of bug as the `&amp;` filenames in PROPFIND.
    const bodies: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (_u, init) => {
      bodies.push(String(init?.body ?? ""));
      return davRes(SEED);
    });
    const t = new CalDavPimTarget(CREDS, fetchFn);
    await t.pullEventsDelta("https://cloud.example.org/cal/", "http://ex.org/s?a=1&b=2", 0, 9e12);
    expect(bodies[0]).toContain("a=1&amp;b=2");
    expect(() => parseCalDavMultistatus(`<d:multistatus xmlns:d="DAV:">${bodies[0]}</d:multistatus>`)).not.toThrow();
  });

  it("fetches only the changed hrefs and reports removals by href, filtered to the window", async () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:in-window
DTSTART:20260115T090000Z
DTEND:20260115T100000Z
SUMMARY:Drin
END:VEVENT
END:VCALENDAR`;
    const outside = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:way-out
DTSTART:20990115T090000Z
DTEND:20990115T100000Z
SUMMARY:Weit weg
END:VEVENT
END:VCALENDAR`;
    const CHANGES = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/cal/a.ics</d:href><d:propstat><d:prop><d:getetag>"2"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:response><d:href>/cal/b.ics</d:href><d:propstat><d:prop><d:getetag>"9"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:response><d:href>/cal/gone.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>
  <d:sync-token>http://example.org/sync/2</d:sync-token>
</d:multistatus>`;
    const bodies: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (_u, init) => {
      const body = String(init?.body ?? "");
      bodies.push(body);
      if (body.includes("sync-collection")) return davRes(CHANGES);
      return davRes(`<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/cal/a.ics</d:href><d:propstat><d:prop><d:getetag>"2"</d:getetag><c:calendar-data>${ics}</c:calendar-data></d:prop></d:propstat></d:response>
  <d:response><d:href>/cal/b.ics</d:href><d:propstat><d:prop><d:getetag>"9"</d:getetag><c:calendar-data>${outside}</c:calendar-data></d:prop></d:propstat></d:response>
</d:multistatus>`);
    });
    const t = new CalDavPimTarget(CREDS, fetchFn);
    const res = await t.pullEventsDelta(
      "https://cloud.example.org/cal/",
      "http://example.org/sync/1",
      Date.parse("2026-01-01T00:00:00Z"),
      Date.parse("2026-02-01T00:00:00Z")
    );
    // The multiget asks for the two CHANGED hrefs and never for the removed one.
    expect(bodies[1]).toContain("/cal/a.ics");
    expect(bodies[1]).toContain("/cal/b.ics");
    expect(bodies[1]).not.toContain("gone.ics");
    // `sync-collection` is collection-wide, not windowed: an object outside the
    // window must not enter the cache through the cursor.
    expect(res.events.map((e) => e.uid)).toEqual(["in-window"]);
    // The object is gone, so its UID cannot be read — the href identifies it.
    expect(res.deletedHrefs).toEqual(["https://cloud.example.org/cal/gone.ics"]);
    expect(res.deletedUids).toEqual([]);
    expect(res.nextCursor).toBe("http://example.org/sync/2");
  });

  it("keeps a series master whose own start is outside the window", async () => {
    // The master carries the recurrence badge and its DTSTART can sit years
    // back; dropping it as "out of window" would cost the badge and, since S8,
    // the fallback title of every occurrence.
    const series = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:weekly
DTSTART:20200106T090000Z
DTEND:20200106T100000Z
RRULE:FREQ=WEEKLY
SUMMARY:Jour fixe
END:VEVENT
END:VCALENDAR`;
    const CHANGES = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/cal/s.ics</d:href><d:propstat><d:prop><d:getetag>"3"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:sync-token>http://example.org/sync/4</d:sync-token>
</d:multistatus>`;
    const fetchFn: FetchFn = vi.fn(async (_u, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("sync-collection")) return davRes(CHANGES);
      return davRes(`<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/cal/s.ics</d:href><d:propstat><d:prop><c:calendar-data>${series}</c:calendar-data></d:prop></d:propstat></d:response>
</d:multistatus>`);
    });
    const t = new CalDavPimTarget(CREDS, fetchFn);
    const res = await t.pullEventsDelta(
      "https://cloud.example.org/cal/",
      "http://example.org/sync/3",
      Date.parse("2026-01-01T00:00:00Z"),
      Date.parse("2026-02-01T00:00:00Z")
    );
    expect(res.events.some((e) => e.uid === "weekly" && e.recurrence)).toBe(true);
    const occ = res.events.filter((e) => e.uid.startsWith("weekly#"));
    expect(occ.length).toBeGreaterThan(0);
    expect(occ.every((e) => e.start.ts < Date.parse("2026-02-01T00:00:00Z"))).toBe(true);
  });

  it("treats an unrecognised per-response status as changed, never as a deletion", async () => {
    const ODD = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/cal/odd.ics</d:href><d:status>HTTP/1.1 507 Insufficient Storage</d:status></d:response>
  <d:sync-token>http://example.org/sync/3</d:sync-token>
</d:multistatus>`;
    const { changed, removed } = parseCalDavSyncCollection(ODD);
    expect(changed).toEqual(["/cal/odd.ics"]);
    expect(removed).toEqual([]);
  });

  it("returns no cursor when the server answers without a sync token", async () => {
    const NO_TOKEN = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`;
    const fetchFn: FetchFn = vi.fn(async () => davRes(NO_TOKEN));
    const t = new CalDavPimTarget(CREDS, fetchFn);
    expect((await t.pullEventsDelta("https://cloud.example.org/cal/", null, 0, 9e12)).nextCursor).toBe("");
  });

  it("does not fetch bodies when the answer carries no token to continue from", async () => {
    // Without a token the next cycle refreshes fully anyway, so the multiget
    // would be paid for and thrown away.
    const bodies: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (_u, init) => {
      bodies.push(String(init?.body ?? ""));
      return davRes(`<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/cal/a.ics</d:href><d:propstat><d:prop><d:getetag>"1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`);
    });
    const t = new CalDavPimTarget(CREDS, fetchFn);
    const res = await t.pullEventsDelta("https://cloud.example.org/cal/", "http://example.org/sync/1", 0, 9e12);
    expect(bodies).toHaveLength(1);
    expect(res.nextCursor).toBe("");
  });

  it("fails the SEED when the server cannot do sync-collection, so no cursor is ever stored", async () => {
    // A server without RFC 6578 must fail here, once per full refresh — not on
    // every delta cycle, where it would park a permanent error on a calendar
    // that otherwise works fine.
    const fetchFn: FetchFn = vi.fn(async () => new Response("", { status: 403 }));
    const t = new CalDavPimTarget(CREDS, fetchFn);
    await expect(t.pullEventsDelta("https://cloud.example.org/cal/", null, 0, 9e12)).rejects.toThrow(/403/);
  });
});
