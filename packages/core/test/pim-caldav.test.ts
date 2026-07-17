import { describe, expect, it, vi } from "vitest";
import { CalDavPimTarget, expandIcsEvents, parseCalDavMultistatus } from "../src/pim/CalDavPimTarget.ts";
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
