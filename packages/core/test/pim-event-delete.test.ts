import { describe, expect, it, vi } from "vitest";
import { CalDavPimTarget } from "../src/pim/CalDavPimTarget.ts";
import { GooglePimTarget } from "../src/pim/GooglePimTarget.ts";
import { GraphPimTarget } from "../src/pim/GraphPimTarget.ts";
import { eventSubstanceOf, normalizeRRule, sameEventSubstance } from "../src/pim/eventSubstance.ts";
import { PimConflictError, type PimAuthProvider, type PimEventDraft } from "../src/pim/types.ts";
import type { FetchFn } from "../src/sync/WebDavSyncTarget.ts";

/**
 * Deleting an event the server merely spelled anew (issue 119, plan
 * Rückmeldungen 2026-10-26, R2).
 *
 * The report: on the desktop with (probably) iCloud, every delete answered
 * "The event changed remotely — view refreshed", the event came back, and only
 * a second delete more than a minute later went through. Two causes, both
 * provider-side here: a server that rewrites what it is sent hands out a new
 * etag (and per RFC 4791 does not name it in the PUT answer), and a 412 on a
 * delete was taken for a change by somebody else without looking.
 */

const creds = { url: "https://dav.example.org/cal/home/", user: "u", pass: "p" };
const HREF = "https://dav.example.org/cal/home/personal/ev-1.ics";

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const h = (init?.headers ?? {}) as Record<string, string>;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

const single = (summary = "Planning", extra: string[] = []) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Apple Inc.//iCloud//EN",
    "BEGIN:VEVENT",
    "UID:ev-1",
    "DTSTAMP:20260801T000000Z",
    "DTSTART:20260801T100000Z",
    "DTEND:20260801T110000Z",
    `SUMMARY:${summary}`,
    ...extra,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

const series = (overrideSummary?: string) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:series-1",
    "DTSTART:20260801T090000Z",
    "DTEND:20260801T093000Z",
    "RRULE:FREQ=WEEKLY",
    "SUMMARY:Standup",
    "END:VEVENT",
    ...(overrideSummary
      ? ["BEGIN:VEVENT", "UID:series-1", "RECURRENCE-ID:20260808T090000Z", "DTSTART:20260808T090000Z", "DTEND:20260808T093000Z", `SUMMARY:${overrideSummary}`, "END:VEVENT"]
      : []),
    "END:VCALENDAR",
  ].join("\r\n");

/** What the person saw: the row a pull produced from the object as Plainva wrote it. */
const seen = {
  uid: "ev-1",
  title: "Planning",
  start: { ts: Date.parse("2026-08-01T10:00:00Z") },
  allDay: false,
};

type Call = { method: string; ifMatch?: string };

/** A CalDAV server holding one object; `answer` decides per request. */
function server(answer: (call: Call, index: number) => Response) {
  const calls: Call[] = [];
  const fetchFn: FetchFn = vi.fn(async (_input, init) => {
    const call = { method: init?.method ?? "GET", ifMatch: headerOf(init, "If-Match") };
    calls.push(call);
    return answer(call, calls.length - 1);
  });
  return { calls, target: new CalDavPimTarget(creds, fetchFn) };
}

describe("CalDAV: a refused delete is looked at before it is called a conflict", () => {
  it("an etag the server changed on its own: one more read, one retry with the new etag", async () => {
    const { calls, target } = server((call) => {
      if (call.method === "GET") return new Response(single("Planning", ["X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC"]), { status: 200, headers: { ETag: '"v2"' } });
      return new Response(null, { status: call.ifMatch === '"v2"' ? 204 : 412 });
    });
    await target.deleteEvent({ calendarId: "c", uid: "ev-1", etag: '"v1"', href: HREF, expect: eventSubstanceOf(seen) });
    expect(calls).toEqual([
      { method: "DELETE", ifMatch: '"v1"' },
      { method: "GET", ifMatch: undefined },
      { method: "DELETE", ifMatch: '"v2"' },
    ]);
  });

  it("an event changed in substance is a conflict that names the new etag - and nothing is deleted", async () => {
    const { calls, target } = server((call) =>
      call.method === "GET" ? new Response(single("Planning (moved to Friday)"), { status: 200, headers: { ETag: '"v2"' } }) : new Response(null, { status: 412 }),
    );
    const refused = await target.deleteEvent({ calendarId: "c", uid: "ev-1", etag: '"v1"', href: HREF, expect: eventSubstanceOf(seen) }).catch((e) => e);
    expect(refused).toBeInstanceOf(PimConflictError);
    expect(refused.currentEtag).toBe('"v2"');
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });

  it("an event that is already gone after the refusal is deleted", async () => {
    const { target } = server((call) => new Response(null, { status: call.method === "GET" ? 404 : 412 }));
    await expect(target.deleteEvent({ calendarId: "c", uid: "ev-1", etag: '"v1"', href: HREF, expect: eventSubstanceOf(seen) })).resolves.toBeUndefined();
  });

  it("retries once only: a guard refused twice is the caller's conflict", async () => {
    let n = 0;
    const { calls, target } = server((call) =>
      call.method === "GET" ? new Response(single(), { status: 200, headers: { ETag: `"v${++n + 1}"` } }) : new Response(null, { status: 412 }),
    );
    const refused = await target.deleteEvent({ calendarId: "c", uid: "ev-1", etag: '"v1"', href: HREF, expect: eventSubstanceOf(seen) }).catch((e) => e);
    expect(refused).toBeInstanceOf(PimConflictError);
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
  });

  it("without the caller's view of the event a refusal stays a conflict - with the etag for 'delete anyway'", async () => {
    const { target } = server((call) =>
      call.method === "GET" ? new Response(single(), { status: 200, headers: { ETag: '"v2"' } }) : new Response(null, { status: 412 }),
    );
    const refused = await target.deleteEvent({ calendarId: "c", uid: "ev-1", etag: '"v1"', href: HREF }).catch((e) => e);
    expect(refused).toBeInstanceOf(PimConflictError);
    expect(refused.currentEtag).toBe('"v2"');
  });
});

describe("CalDAV: deleting ONE occurrence follows the same rule", () => {
  const occurrence = {
    uid: "series-1#2026-08-08T09:00:00Z",
    title: "Standup",
    start: { ts: Date.parse("2026-08-08T09:00:00Z") },
    allDay: false,
    seriesMaster: "series-1",
  };

  it("a series the server spelled anew still gets its EXDATE - against the new etag, which is handed back", async () => {
    let putIfMatch: string | undefined;
    let putBody = "";
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      if (!init?.method || init.method === "GET") return new Response(series(), { status: 200, headers: { ETag: '"v2"' } });
      putIfMatch = headerOf(init, "If-Match");
      putBody = String(init.body);
      return new Response(null, { status: 204, headers: { ETag: '"v3"' } });
    });
    const target = new CalDavPimTarget(creds, fetchFn);
    const res = await target.deleteEvent({ calendarId: "c", uid: occurrence.uid, etag: '"v1"', href: HREF, expect: eventSubstanceOf(occurrence) });
    expect(putIfMatch).toBe('"v2"');
    expect(putBody).toContain("EXDATE");
    expect(res).toEqual({ etag: '"v3"' });
  });

  it("an occurrence changed elsewhere is a conflict that names the new etag", async () => {
    let put = false;
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      if (!init?.method || init.method === "GET") return new Response(series("Standup - with the CEO"), { status: 200, headers: { ETag: '"v2"' } });
      put = true;
      return new Response(null, { status: 204 });
    });
    const refused = await new CalDavPimTarget(creds, fetchFn)
      .deleteEvent({ calendarId: "c", uid: occurrence.uid, etag: '"v1"', href: HREF, expect: eventSubstanceOf(occurrence) })
      .catch((e) => e);
    expect(refused).toBeInstanceOf(PimConflictError);
    expect(refused.currentEtag).toBe('"v2"');
    expect(put).toBe(false);
  });

  it("a series that is gone has no occurrence left to delete", async () => {
    const fetchFn: FetchFn = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      new CalDavPimTarget(creds, fetchFn).deleteEvent({ calendarId: "c", uid: occurrence.uid, etag: '"v1"', href: HREF, expect: eventSubstanceOf(occurrence) }),
    ).resolves.toEqual({});
  });
});

describe("CalDAV: the etag after Plainva's own write", () => {
  const draft: PimEventDraft = { title: "Planning", start: { ts: Date.parse("2026-08-01T10:00:00Z") }, end: { ts: Date.parse("2026-08-01T11:00:00Z") }, allDay: false };

  it("a create the server answers without an etag (it rewrote the object) reads the etag back", async () => {
    const { calls, target } = server((call) =>
      call.method === "GET" ? new Response(single(), { status: 200, headers: { ETag: '"rewritten"' } }) : new Response(null, { status: 201 }),
    );
    const res = await target.createEvent("https://dav.example.org/cal/home/personal/", draft);
    expect(res.etag).toBe('"rewritten"');
    expect(calls.map((c) => c.method)).toEqual(["PUT", "GET"]);
  });

  it("an update answered without an etag reads it back as well", async () => {
    let putDone = false;
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      if (!init?.method || init.method === "GET") return new Response(single(), { status: 200, headers: { ETag: putDone ? '"v2"' : '"v1"' } });
      putDone = true;
      return new Response(null, { status: 204 });
    });
    const res = await new CalDavPimTarget(creds, fetchFn).updateEvent({ calendarId: "c", uid: "ev-1", etag: '"v1"', href: HREF }, draft);
    expect(res).toEqual({ etag: '"v2"' });
  });

  it("an etag the answer names is taken as it is, without a second request", async () => {
    const { calls, target } = server(() => new Response(null, { status: 201, headers: { ETag: '"fresh"' } }));
    const res = await target.createEvent("https://dav.example.org/cal/home/personal/", draft);
    expect(res.etag).toBe('"fresh"');
    expect(calls).toHaveLength(1);
  });
});

describe("Google and Microsoft: an answer to an invitation hands back the event's new etag", () => {
  const auth = (): PimAuthProvider => ({ getAccessToken: vi.fn(async () => "tok") });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("Google: the etag of the PATCH answer", async () => {
    const fetchFn: FetchFn = vi.fn(async (_input, init) =>
      init?.method === "PATCH" ? json({ etag: '"g2"' }) : json({ attendees: [{ email: "me@x.org", self: true, responseStatus: "needsAction" }] }),
    );
    await expect(new GooglePimTarget(auth(), fetchFn).respondToEvent({ calendarId: "c1", uid: "e1", etag: '"g1"' }, "accepted")).resolves.toEqual({ etag: '"g2"' });
  });

  it("Microsoft: the action says nothing, so the etag is read back", async () => {
    const urls: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (input) => {
      urls.push(String(input));
      return String(input).includes("/accept") ? new Response(null, { status: 202 }) : json({ id: "e1", "@odata.etag": 'W/"m2"' });
    });
    await expect(new GraphPimTarget(auth(), fetchFn).respondToEvent({ calendarId: "c1", uid: "e1" }, "accepted")).resolves.toEqual({ etag: 'W/"m2"' });
    expect(urls[1]).toContain("/me/events/e1?");
  });
});

describe("the substance of an event", () => {
  const row = { uid: "ev-1", title: " Planning ", start: { ts: 10 }, allDay: false } as const;

  it("is the instance, the start, the rule and the title - not the spelling", () => {
    expect(sameEventSubstance(eventSubstanceOf(row), eventSubstanceOf({ ...row, title: "Planning" }))).toBe(true);
    expect(sameEventSubstance(eventSubstanceOf(row), eventSubstanceOf({ ...row, start: { ts: 11 } }))).toBe(false);
    expect(sameEventSubstance(eventSubstanceOf(row), eventSubstanceOf({ ...row, title: "Other" }))).toBe(false);
    expect(sameEventSubstance(eventSubstanceOf(row), eventSubstanceOf({ ...row, uid: "ev-2" }))).toBe(false);
    // A single event that now repeats is not the event that was meant.
    expect(sameEventSubstance(eventSubstanceOf(row), eventSubstanceOf({ ...row, recurrence: "RRULE:FREQ=DAILY" }))).toBe(false);
  });

  it("reads a rule in any order of its parts", () => {
    expect(normalizeRRule("RRULE:FREQ=WEEKLY;BYDAY=MO")).toBe(normalizeRRule("BYDAY=MO;FREQ=WEEKLY"));
    expect(normalizeRRule(undefined)).toBe("");
    // The cache's "a series whose rule was not read".
    expect(normalizeRRule("RRULE")).toBeUndefined();
  });

  it("compares an occurrence without the rule it does not carry, and a series addressed through an occurrence without its start", () => {
    const occ = { uid: "s#1", title: "Standup", start: { ts: 5 }, allDay: false, seriesMaster: "s" };
    expect(eventSubstanceOf(occ).recurrence).toBeUndefined();
    const subject = eventSubstanceOf({ uid: "s", title: "Standup", start: { ts: 5 }, allDay: false, recurrence: "RRULE" });
    expect(subject.start).toBeUndefined();
    expect(sameEventSubstance(subject, eventSubstanceOf({ uid: "s", title: "Standup", start: { ts: 1 }, allDay: false, recurrence: "RRULE:FREQ=WEEKLY" }))).toBe(true);
  });

  it("an all-day event is compared by its civil date", () => {
    const day = { uid: "d", title: "Off", start: { ts: 0, date: "2026-08-01" }, allDay: true };
    expect(sameEventSubstance(eventSubstanceOf(day), eventSubstanceOf({ ...day, start: { ts: 3600_000, date: "2026-08-01" } }))).toBe(true);
    expect(sameEventSubstance(eventSubstanceOf(day), eventSubstanceOf({ ...day, allDay: false }))).toBe(false);
  });
});
