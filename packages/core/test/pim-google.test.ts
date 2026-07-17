import { describe, expect, it, vi } from "vitest";
import { GooglePimTarget } from "../src/pim/GooglePimTarget.ts";
import type { FetchFn } from "../src/sync/WebDavSyncTarget.ts";
import type { PimAuthProvider } from "../src/pim/types.ts";

const auth = (token = "tok"): PimAuthProvider => ({ getAccessToken: vi.fn(async () => token) });

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("GooglePimTarget", () => {
  it("lists calendars across pages with color/primary/readOnly mapping", async () => {
    const fetchFn: FetchFn = vi.fn(async (input) => {
      const url = String(input);
      if (!url.includes("pageToken")) {
        return jsonRes({ items: [{ id: "primary-id", summary: "Privat", backgroundColor: "#16a765", primary: true, accessRole: "owner" }], nextPageToken: "p2" });
      }
      return jsonRes({ items: [{ id: "team", summary: "Team", accessRole: "reader" }] });
    });
    const t = new GooglePimTarget(auth(), fetchFn);
    const cals = await t.listCalendars();
    expect(cals).toEqual([
      { id: "primary-id", name: "Privat", color: "#16a765", primary: true, readOnly: false },
      { id: "team", name: "Team", color: undefined, primary: false, readOnly: true },
    ]);
  });

  it("pulls expanded events, skips cancelled and fetches the series master with its RRULE", async () => {
    const calls: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/events?") || url.includes("singleEvents")) {
        return jsonRes({
          items: [
            {
              id: "e1",
              summary: "Zahnarzt",
              start: { dateTime: "2026-08-01T10:00:00+02:00" },
              end: { dateTime: "2026-08-01T10:30:00+02:00" },
              etag: '"v1"',
              attendees: [{ displayName: "Anna" }, { email: "raum@example.org", resource: true }],
            },
            { id: "gone", status: "cancelled", start: { dateTime: "2026-08-01T11:00:00Z" }, end: { dateTime: "2026-08-01T12:00:00Z" } },
            {
              id: "s1_inst1",
              summary: "Standup",
              recurringEventId: "s1",
              start: { dateTime: "2026-08-03T09:00:00Z" },
              end: { dateTime: "2026-08-03T09:15:00Z" },
            },
            { id: "allday", summary: "Urlaub", start: { date: "2026-08-10" }, end: { date: "2026-08-11" } },
          ],
        });
      }
      if (url.endsWith("/events/s1")) {
        return jsonRes({
          id: "s1",
          summary: "Standup",
          start: { dateTime: "2026-08-03T09:00:00Z" },
          end: { dateTime: "2026-08-03T09:15:00Z" },
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        });
      }
      return jsonRes({}, 404);
    });
    const t = new GooglePimTarget(auth(), fetchFn);
    const { events } = await t.pullEvents("cal1", Date.parse("2026-08-01T00:00:00Z"), Date.parse("2026-09-01T00:00:00Z"));

    const byUid = new Map(events.map((e) => [e.uid, e]));
    expect(byUid.has("gone")).toBe(false);
    const e1 = byUid.get("e1")!;
    expect(e1.start.ts).toBe(Date.parse("2026-08-01T08:00:00Z"));
    expect(e1.attendees).toEqual(["Anna"]); // resources dropped
    expect(e1.etag).toBe('"v1"');
    const inst = byUid.get("s1_inst1")!;
    expect(inst.seriesMaster).toBe("s1");
    expect(inst.recurrence).toBeUndefined();
    const master = byUid.get("s1")!;
    expect(master.recurrence).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO");
    const allday = byUid.get("allday")!;
    expect(allday.allDay).toBe(true);
    expect(allday.start.date).toBe("2026-08-10");
    // Window bounds went out as ISO timeMin/timeMax on the list call.
    expect(calls[0]).toContain("timeMin=2026-08-01T00%3A00%3A00.000Z");
  });

  it("retries exactly once with a forced token after a 401", async () => {
    const getAccessToken = vi.fn(async (force?: boolean) => (force ? "fresh" : "stale"));
    const seen: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      const authz = (init?.headers as Record<string, string>).Authorization;
      seen.push(authz);
      return authz === "Bearer fresh" ? jsonRes({ items: [] }) : jsonRes({}, 401);
    });
    const t = new GooglePimTarget({ getAccessToken }, fetchFn);
    await t.listCalendars();
    expect(seen).toEqual(["Bearer stale", "Bearer fresh"]);
    expect(getAccessToken).toHaveBeenCalledWith(true);
  });

  it("maps tasks with day-granular due dates and skips deleted ones", async () => {
    const fetchFn: FetchFn = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/users/@me/lists")) return jsonRes({ items: [{ id: "l1", title: "Meine Aufgaben" }] });
      return jsonRes({
        items: [
          { id: "t1", title: "Angebot", due: "2026-08-01T00:00:00.000Z", status: "needsAction", etag: "e1", updated: "2026-07-17T10:00:00.000Z" },
          { id: "t2", title: "Fertig", status: "completed" },
          { id: "t3", title: "Weg", deleted: true },
        ],
      });
    });
    const t = new GooglePimTarget(auth(), fetchFn);
    expect(await t.listTaskLists()).toEqual([{ id: "l1", name: "Meine Aufgaben" }]);
    const { tasks } = await t.pullTasks("l1");
    expect(tasks.map((x) => x.uid)).toEqual(["t1", "t2"]);
    expect(tasks[0].due).toBe("2026-08-01");
    expect(tasks[0].completed).toBe(false);
    expect(tasks[1].completed).toBe(true);
  });
});
