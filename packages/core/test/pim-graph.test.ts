import { describe, expect, it, vi } from "vitest";
import { GraphPimTarget } from "../src/pim/GraphPimTarget.ts";
import type { FetchFn } from "../src/sync/WebDavSyncTarget.ts";
import type { PimAuthProvider } from "../src/pim/types.ts";

const auth = (): PimAuthProvider => ({ getAccessToken: vi.fn(async () => "tok") });

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("GraphPimTarget", () => {
  it("lists calendars with default/color/canEdit mapping and follows nextLink", async () => {
    const fetchFn: FetchFn = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("skiptoken")) return jsonRes({ value: [{ id: "c2", name: "Team", canEdit: false }] });
      return jsonRes({
        value: [{ id: "c1", name: "Kalender", hexColor: "#aa00aa", isDefaultCalendar: true, canEdit: true }],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=x",
      });
    });
    const t = new GraphPimTarget(auth(), fetchFn);
    const cals = await t.listCalendars();
    expect(cals).toEqual([
      { id: "c1", name: "Kalender", color: "#aa00aa", primary: true, readOnly: false },
      { id: "c2", name: "Team", color: undefined, primary: false, readOnly: true },
    ]);
  });

  it("pulls the calendarView with UTC preference, maps all-day/series and badges the master", async () => {
    const headersSeen: Array<Record<string, string>> = [];
    const urlsSeen: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      const url = String(input);
      urlsSeen.push(url);
      headersSeen.push((init?.headers ?? {}) as Record<string, string>);
      if (url.includes("/calendarView")) {
        return jsonRes({
          value: [
            {
              id: "occ1",
              subject: "Standup",
              type: "occurrence",
              seriesMasterId: "sm1",
              start: { dateTime: "2026-08-03T09:00:00.0000000", timeZone: "UTC" },
              end: { dateTime: "2026-08-03T09:15:00.0000000", timeZone: "UTC" },
              attendees: [{ emailAddress: { name: "Anna", address: "anna@x.de" } }],
              "@odata.etag": 'W/"1"',
            },
            {
              id: "free1",
              subject: "Urlaub",
              isAllDay: true,
              start: { dateTime: "2026-08-10T00:00:00.0000000", timeZone: "UTC" },
              end: { dateTime: "2026-08-11T00:00:00.0000000", timeZone: "UTC" },
              showAs: "tentative",
            },
            { id: "cx", isCancelled: true, subject: "Weg", start: { dateTime: "2026-08-04T10:00:00" }, end: { dateTime: "2026-08-04T11:00:00" } },
          ],
        });
      }
      if (url.includes("/me/calendars/c1/events/sm1")) {
        return jsonRes({
          id: "sm1",
          subject: "Standup",
          type: "seriesMaster",
          recurrence: { pattern: { type: "weekly" } },
          start: { dateTime: "2026-08-03T09:00:00.0000000", timeZone: "UTC" },
          end: { dateTime: "2026-08-03T09:15:00.0000000", timeZone: "UTC" },
        });
      }
      return jsonRes({}, 404);
    });
    const t = new GraphPimTarget(auth(), fetchFn);
    const { events } = await t.pullEvents("c1", Date.parse("2026-08-01T00:00:00Z"), Date.parse("2026-09-01T00:00:00Z"));

    expect(headersSeen[0].Prefer).toBe('outlook.timezone="UTC"');
    // S8: the master is fetched scoped to its CALENDAR, the way the Google
    // adapter has always done it. `/me/events/{id}` reads the signed-in user's
    // own event collection and can miss a series that lives in a shared or
    // secondary calendar — and a missing master costs the recurrence badge and
    // the fallback title of every occurrence.
    expect(urlsSeen.some((u) => u.includes("/me/calendars/c1/events/sm1"))).toBe(true);
    expect(urlsSeen.some((u) => /\/me\/events\//.test(u))).toBe(false);
    const byUid = new Map(events.map((e) => [e.uid, e]));
    // Deliberate change of behaviour (report 2026-07-29 F7): a cancelled event
    // used to be dropped here. It now arrives, marked as cancelled, because the
    // whole point is seeing that the appointment is off.
    expect(byUid.get("cx")?.status).toBe("cancelled");
    const occ = byUid.get("occ1")!;
    expect(occ.start.ts).toBe(Date.parse("2026-08-03T09:00:00Z")); // suffix-free UTC parsed as UTC
    expect(occ.seriesMaster).toBe("sm1");
    expect(occ.attendees).toEqual(["Anna"]);
    const master = byUid.get("sm1")!;
    expect(master.recurrence).toBe("weekly");
    const allDay = byUid.get("free1")!;
    expect(allDay.allDay).toBe(true);
    expect(allDay.start.date).toBe("2026-08-10");
    expect(allDay.status).toBe("tentative");
  });

  it("reads reminders, busy/free, the meeting link and categories (S9)", async () => {
    const fetchFn: FetchFn = vi.fn(async (input) =>
      String(input).includes("/calendarView")
        ? jsonRes({
            value: [
              {
                id: "e1",
                subject: "Kundentermin",
                start: { dateTime: "2026-08-03T09:00:00.0000000" },
                end: { dateTime: "2026-08-03T09:30:00.0000000" },
                showAs: "free",
                isReminderOn: true,
                reminderMinutesBeforeStart: 15,
                onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/abc" },
                categories: ["Kunde", "Reise"],
              },
              {
                id: "e2",
                subject: "Abwesend",
                start: { dateTime: "2026-08-03T11:00:00.0000000" },
                end: { dateTime: "2026-08-03T12:00:00.0000000" },
                // Out of office blocks the calendar just as busy does.
                showAs: "oof",
                isReminderOn: false,
                reminderMinutesBeforeStart: 15,
              },
            ],
          })
        : jsonRes({}, 404)
    );
    const t = new GraphPimTarget(auth(), fetchFn);
    const { events } = await t.pullEvents("c1", Date.parse("2026-08-01T00:00:00Z"), Date.parse("2026-09-01T00:00:00Z"));
    const byUid = new Map(events.map((e) => [e.uid, e]));

    expect(byUid.get("e1")).toMatchObject({
      reminders: [15],
      busy: "free",
      meetingUrl: "https://teams.microsoft.com/l/abc",
      categories: ["Kunde", "Reise"],
    });
    // "Reminder off" is a statement, and Graph leaves the minutes standing —
    // reading them anyway would announce an appointment nobody asked about.
    expect(byUid.get("e2")!.reminders).toEqual([]);
    expect(byUid.get("e2")!.busy).toBe("busy");
  });

  it("maps todo lists and tasks (civil due date, text body, etag)", async () => {
    const fetchFn: FetchFn = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/todo/lists?")) return jsonRes({ value: [{ id: "L1", displayName: "Aufgaben" }] });
      return jsonRes({
        value: [
          {
            id: "T1",
            title: "Rechnung",
            status: "notStarted",
            body: { content: "Details hier", contentType: "text" },
            dueDateTime: { dateTime: "2026-08-01T00:00:00.0000000", timeZone: "Europe/Berlin" },
            lastModifiedDateTime: "2026-07-17T09:00:00Z",
            "@odata.etag": 'W/"9"',
          },
          { id: "T2", title: "Done", status: "completed", body: { content: "", contentType: "text" } },
        ],
      });
    });
    const t = new GraphPimTarget(auth(), fetchFn);
    expect(await t.listTaskLists()).toEqual([{ id: "L1", name: "Aufgaben" }]);
    const { tasks } = await t.pullTasks("L1");
    expect(tasks[0]).toMatchObject({ uid: "T1", title: "Rechnung", due: "2026-08-01", completed: false, notes: "Details hier", etag: 'W/"9"' });
    expect(tasks[1]).toMatchObject({ uid: "T2", completed: true, notes: undefined });
  });

  it("maps attendee responses and the user's own status (the RSVP back-channel)", async () => {
    const fetchFn: FetchFn = vi.fn(async (input) => {
      if (String(input).includes("/calendarView")) {
        return jsonRes({
          value: [
            {
              id: "e1",
              subject: "Review",
              start: { dateTime: "2026-08-01T09:00:00.0000000" },
              end: { dateTime: "2026-08-01T10:00:00.0000000" },
              organizer: { emailAddress: { name: "Chef", address: "chef@example.org" } },
              responseStatus: { response: "tentativelyAccepted" },
              attendees: [
                { emailAddress: { name: "Chef", address: "chef@example.org" }, status: { response: "organizer" } },
                { emailAddress: { name: "Me", address: "me@example.org" }, status: { response: "tentativelyAccepted" } },
                { emailAddress: { name: "Kim", address: "kim@example.org" }, status: { response: "declined" } },
              ],
            },
          ],
        });
      }
      return jsonRes({ value: [] });
    });
    const t = new GraphPimTarget(auth(), fetchFn);
    const { events } = await t.pullEvents("c1", Date.UTC(2026, 6, 1), Date.UTC(2026, 8, 1));
    expect(events[0].selfResponse).toBe("tentative");
    expect(events[0].rsvps).toEqual([
      { name: "Chef", email: "chef@example.org", status: "accepted", organizer: true },
      { name: "Me", email: "me@example.org", status: "tentative", organizer: false },
      { name: "Kim", email: "kim@example.org", status: "declined", organizer: false },
    ]);
  });

  /**
   * A cancelled Outlook appointment has to REACH the views: seeing it is the
   * point (the calendar renders it as an outline with a struck-through title).
   * It used to be dropped while reading, which is why the cancelled state could
   * never take effect for Outlook (report 2026-07-29 F7). Graph separates
   * "cancelled" from "deleted", so keeping it cannot resurrect a removed event.
   */
  it("keeps a cancelled event and marks it as cancelled", async () => {
    const fetchFn: FetchFn = vi.fn(async (input) => {
      if (String(input).includes("/calendarView")) {
        return jsonRes({
          value: [
            {
              id: "off",
              subject: "Abgesagtes Meeting",
              isCancelled: true,
              start: { dateTime: "2026-08-01T09:00:00.0000000" },
              end: { dateTime: "2026-08-01T10:00:00.0000000" },
            },
            {
              id: "maybe",
              subject: "Vielleicht",
              showAs: "tentative",
              start: { dateTime: "2026-08-02T09:00:00.0000000" },
              end: { dateTime: "2026-08-02T10:00:00.0000000" },
            },
            {
              id: "sure",
              subject: "Fest",
              start: { dateTime: "2026-08-03T09:00:00.0000000" },
              end: { dateTime: "2026-08-03T10:00:00.0000000" },
            },
          ],
        });
      }
      return jsonRes({ value: [] });
    });
    const t = new GraphPimTarget(auth(), fetchFn);
    const { events } = await t.pullEvents("c1", Date.UTC(2026, 6, 1), Date.UTC(2026, 8, 1));
    expect(events.map((e) => [e.title, e.status])).toEqual([
      ["Abgesagtes Meeting", "cancelled"],
      ["Vielleicht", "tentative"],
      ["Fest", "confirmed"],
    ]);
    // A cancelled event that is ALSO tentative in showAs stays cancelled: the
    // cancellation is the stronger statement.
    expect(events[0].status).toBe("cancelled");
  });

  it("responds to an invitation via the dedicated accept/decline actions", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return jsonRes({}, 202);
    });
    const t = new GraphPimTarget(auth(), fetchFn);
    await t.respondToEvent({ calendarId: "c1", uid: "e1" }, "declined");
    expect(calls[0].url).toContain("/me/events/e1/decline");
    expect(calls[0].body).toEqual({ sendResponse: true });
    await t.respondToEvent({ calendarId: "c1", uid: "e1" }, "tentative");
    expect(calls[1].url).toContain("/me/events/e1/tentativelyAccept");
  });
});
