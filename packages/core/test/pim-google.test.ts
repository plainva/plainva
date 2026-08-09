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
    // Google keeps dropping cancelled events, on purpose: there "cancelled" and
    // "deleted" are the same status, so showing them would mean presenting
    // removed appointments as existing ones. Outlook and CalDAV separate the two
    // and DO show the cancellation (report 2026-07-29 F7).
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

  it("reads reminders, busy/free and the meeting link (S9)", async () => {
    const fetchFn: FetchFn = vi.fn(async (input) =>
      String(input).includes("/events?")
        ? jsonRes({
            items: [
              {
                id: "own",
                summary: "Kundentermin",
                start: { dateTime: "2026-08-03T09:00:00Z" },
                end: { dateTime: "2026-08-03T09:30:00Z" },
                transparency: "transparent",
                // A popup and an email at the same moment are one moment.
                reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }, { method: "email", minutes: 15 }, { method: "popup", minutes: 60 }] },
                hangoutLink: "https://meet.google.com/abc-defg-hij",
              },
              {
                id: "inherits",
                summary: "Jour fixe",
                start: { dateTime: "2026-08-03T11:00:00Z" },
                end: { dateTime: "2026-08-03T11:30:00Z" },
                // Defers to the calendar's own setting, which this call does
                // not carry — so the EVENT said nothing.
                reminders: { useDefault: true },
                conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+49" }, { entryPointType: "video", uri: "https://meet.google.com/xyz" }] },
              },
              {
                id: "silent",
                summary: "Fokuszeit",
                start: { dateTime: "2026-08-03T13:00:00Z" },
                end: { dateTime: "2026-08-03T14:00:00Z" },
                reminders: { useDefault: false },
              },
            ],
          })
        : jsonRes({}, 404)
    );
    const t = new GooglePimTarget(auth(), fetchFn);
    const { events } = await t.pullEvents("c1", Date.parse("2026-08-01T00:00:00Z"), Date.parse("2026-09-01T00:00:00Z"));
    const byUid = new Map(events.map((e) => [e.uid, e]));

    expect(byUid.get("own")).toMatchObject({ reminders: [15, 60], busy: "free", meetingUrl: "https://meet.google.com/abc-defg-hij" });
    // The three answers Google can give, and they must stay distinguishable.
    expect(byUid.get("inherits")!.reminders).toBeUndefined();
    expect(byUid.get("silent")!.reminders).toEqual([]);
    // Absent transparency means busy, which is Google's own default.
    expect(byUid.get("inherits")!.busy).toBe("busy");
    // The video entry point, not the phone number that sits before it.
    expect(byUid.get("inherits")!.meetingUrl).toBe("https://meet.google.com/xyz");
    // Google Calendar has no categories — inventing one from the colour would
    // be a different statement than the event makes.
    expect(byUid.get("own")!.categories).toBeUndefined();
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

  it("maps a per-event colour (colorId) and the attendee RSVP back-channel", async () => {
    const fetchFn: FetchFn = vi.fn(async () =>
      jsonRes({
        items: [
          {
            id: "e1",
            summary: "Sync",
            colorId: "6",
            start: { dateTime: "2026-08-01T09:00:00Z" },
            end: { dateTime: "2026-08-01T10:00:00Z" },
            attendees: [
              { email: "chef@x.org", displayName: "Chef", organizer: true, responseStatus: "accepted" },
              { email: "me@x.org", self: true, responseStatus: "declined" },
            ],
          },
        ],
      })
    );
    const t = new GooglePimTarget(auth(), fetchFn);
    const { events } = await t.pullEvents("c1", Date.UTC(2026, 6, 1), Date.UTC(2026, 8, 1));
    expect(events[0].color).toBe("#f4511e"); // colorId 6 = Tangerine
    expect(events[0].selfResponse).toBe("declined");
    expect(events[0].rsvps?.find((a) => a.self)?.status).toBe("declined");
  });

  it("responds to an invitation by patching the own attendee responseStatus", async () => {
    let patchBody: any;
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      if (!init || init.method !== "PATCH") {
        // GET the event first.
        return jsonRes({ attendees: [{ email: "chef@x.org" }, { email: "me@x.org", self: true, responseStatus: "needsAction" }] });
      }
      patchBody = JSON.parse(String(init.body));
      return jsonRes({ etag: "e2" });
    });
    const t = new GooglePimTarget(auth(), fetchFn);
    await t.respondToEvent({ calendarId: "c1", uid: "e1" }, "accepted");
    expect(patchBody).toEqual({
      attendees: [{ email: "chef@x.org" }, { email: "me@x.org", self: true, responseStatus: "accepted" }],
    });
  });
});

describe("GooglePimTarget: what an error says (finding 2026-07-30)", () => {
  it("carries Google's own reason into the message, not just the status", async () => {
    // The maintainer's account failed with a bare `google api 401 for
    // .../calendarList`. That status cannot tell a dead sign-in from a missing
    // scope from an API that was never switched on — the body can, and each of
    // those needs a different answer from the person reading it.
    const body = {
      error: {
        code: 401,
        message: "Request had invalid authentication credentials.",
        status: "UNAUTHENTICATED",
      },
    };
    const fetchFn: FetchFn = vi.fn(async () => jsonRes(body, 401));
    const t = new GooglePimTarget(auth(), fetchFn);
    await expect(t.listCalendars()).rejects.toThrow(
      /google api 401 \(UNAUTHENTICATED: Request had invalid authentication credentials\.\)/,
    );
    // The forced-refresh retry still happened: two attempts, then the throw.
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("reads the older errors[].reason shape as well", async () => {
    const body = { error: { errors: [{ reason: "accessNotConfigured", message: "Calendar API has not been used." }] } };
    const fetchFn: FetchFn = vi.fn(async () => jsonRes(body, 403));
    const t = new GooglePimTarget(auth(), fetchFn);
    await expect(t.listCalendars()).rejects.toThrow(/accessNotConfigured/);
  });

  it("keeps the status when the body is not readable, instead of losing the error", async () => {
    const fetchFn: FetchFn = vi.fn(async () => new Response("<html>gateway</html>", { status: 502 }));
    const t = new GooglePimTarget(auth(), fetchFn);
    await expect(t.listCalendars()).rejects.toThrow(/google api 502 for/);
  });
});
