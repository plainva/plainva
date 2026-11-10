import { describe, expect, it } from "vitest";
import { CalDavPimTarget, type PimEventRow } from "@plainva/core";
import { applyPendingEventWrites, deleteEventWithBlockers, PendingEventWrites, seriesDeleteSubject, type BlockFollowDeps } from "@plainva/ui";

/**
 * Deleting a whole series (issue 119, R7).
 *
 * The report after 0.8.7: "There is still some time lag between deleting a
 * recurring event, and it happening. Sometimes the first time you delete it,
 * it doesn't work." The 0.8.7 fix made the DELETE itself go through. What was
 * left is what the screen does after it: "delete all events" is written against
 * the series, and the views show only its occurrences. The overlay that hides
 * a deleted event matched it by uid, so it hid nothing; the series stayed on
 * screen until a pull removed it, and where that first pull still listed the
 * deleted object, until the next one.
 *
 * The double below behaves like iCloud does in the sequence the reporter ran:
 * it rewrites what it is sent (new etag, none named in the PUT answer, RFC 4791
 * 5.3.4), honours If-Match on DELETE, and its listings lag behind its own
 * writes by one read - the first calendar query after a delete still returns
 * the object. Only a run against iCloud can say how long that lag really is;
 * the rule tested here holds whatever it is.
 */

const BASE = "https://caldav.example.test/123/calendars/";
const CAL = `${BASE}home/`;
const HREF = `${CAL}standup.ics`;
const DAY = 24 * 3600_000;
const T0 = Date.parse("2026-11-02T09:00:00Z");

const seriesIcs = (stamp: string) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Apple Inc.//iCloud//EN",
    "BEGIN:VEVENT",
    "UID:standup",
    "DTSTAMP:20261101T000000Z",
    "DTSTART:20261102T090000Z",
    "DTEND:20261102T093000Z",
    "RRULE:FREQ=DAILY;COUNT=5",
    "SUMMARY:Standup",
    // What the server adds on the way in: the reason its etag is new.
    `X-APPLE-STAMP:${stamp}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

const headerOf = (init: RequestInit | undefined, name: string): string | undefined => {
  const h = (init?.headers ?? {}) as Record<string, string>;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
};

/** One CalDAV calendar whose listings show its own writes one read late. */
function laggingCalDav() {
  let object: { ics: string; etag: string } | null = { ics: seriesIcs("1"), etag: '"e-1"' };
  // What a listing returns: the state BEFORE the latest write, for one read.
  let listed: { ics: string; etag: string } | null = object;
  let lagReads = 0;
  const log: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    log.push(`${method} ${new URL(url).pathname}${headerOf(init, "If-Match") ? ` If-Match ${headerOf(init, "If-Match")}` : ""}`);
    if (method === "REPORT") {
      const view = lagReads > 0 ? listed : object;
      if (lagReads > 0) lagReads--;
      const body = view
        ? `<d:response><d:href>${new URL(HREF).pathname}</d:href><d:propstat><d:prop><d:getetag>${view.etag}</d:getetag><c:calendar-data>${view.ics}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
        : "";
      return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`, { status: 207 });
    }
    if (method === "DELETE") {
      if (!object) return new Response(null, { status: 404 });
      const guard = headerOf(init, "If-Match");
      if (guard && guard !== object.etag) return new Response(null, { status: 412 });
      listed = object;
      lagReads = 1;
      object = null;
      return new Response(null, { status: 204 });
    }
    if (method === "GET") {
      if (!object) return new Response(null, { status: 404 });
      return new Response(object.ics, { status: 200, headers: { ETag: object.etag } });
    }
    return new Response(null, { status: 405 });
  };
  return { fetch, log };
}

/** What the calendar view holds: a pull, with the series' own row left out as the cache query does. */
async function viewRows(target: CalDavPimTarget): Promise<PimEventRow[]> {
  const { events } = await target.pullEvents(CAL, T0 - DAY, T0 + 7 * DAY);
  return events.filter((e) => !e.recurrence).map((e) => ({ ...e, accountId: "icloud" }) as PimEventRow);
}

describe("deleting a whole series (issue 119, R7)", () => {
  it("takes every occurrence off screen at once, and keeps it off while the provider still lists it", async () => {
    const dav = laggingCalDav();
    const target = new CalDavPimTarget({ url: BASE, user: "u", pass: "p" }, dav.fetch);
    const store = new PendingEventWrites();
    const deps: BlockFollowDeps = {
      targets: { targetFor: async () => target },
      blockersOf: async () => [],
      eventsByUid: async () => [],
      busyLabel: "Busy",
      store,
    };

    const before = await viewRows(target);
    expect(before.map((r) => r.uid)).toHaveLength(5);
    const clicked = before[2];
    expect(clicked.seriesMaster).toBe("standup");

    // "Delete all events" on an occurrence whose series row the cache lacks.
    const subject = seriesDeleteSubject(clicked, null, "caldav")!;
    const sending = deleteEventWithBlockers(deps, subject, []);
    const shownWhileSending = applyPendingEventWrites(before, store.snapshot()).map((r) => r.uid);
    await sending;

    // The provider deleted it with the first request.
    expect(dav.log.filter((l) => l.startsWith("DELETE"))).toEqual([`DELETE ${new URL(HREF).pathname} If-Match "e-1"`]);
    // Gone from the screen with the confirmation, not with the next pull.
    expect(shownWhileSending).toEqual([]);

    // The pull right after the delete still lists the series (the lag): the
    // screen keeps it away, and nobody has to delete a second time.
    const stale = await viewRows(target);
    expect(stale).toHaveLength(5);
    store.reconcile(stale);
    expect(applyPendingEventWrites(stale, store.snapshot())).toEqual([]);

    // The next pull no longer lists it: the overlay has nothing left to say.
    const fresh = await viewRows(target);
    expect(fresh).toEqual([]);
    store.reconcile(fresh);
    expect(store.snapshot()).toEqual([]);
  });

  it("lets the occurrences come back when the provider refuses the delete", async () => {
    const dav = laggingCalDav();
    const target = new CalDavPimTarget({ url: BASE, user: "u", pass: "p" }, dav.fetch);
    const store = new PendingEventWrites();
    const refusing = {
      provider: "caldav",
      deleteEvent: async () => {
        throw new Error("caldav delete 403");
      },
    };
    const deps: BlockFollowDeps = { targets: { targetFor: async () => refusing as never }, blockersOf: async () => [], eventsByUid: async () => [], busyLabel: "Busy", store };
    const rows = await viewRows(target);
    await expect(deleteEventWithBlockers(deps, seriesDeleteSubject(rows[0], null, "caldav")!, [])).rejects.toThrow("403");
    expect(applyPendingEventWrites(rows, store.snapshot())).toHaveLength(5);
  });
});
