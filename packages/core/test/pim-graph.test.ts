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
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      const url = String(input);
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
      if (url.includes("/me/events/sm1")) {
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
    const byUid = new Map(events.map((e) => [e.uid, e]));
    expect(byUid.has("cx")).toBe(false);
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
});
