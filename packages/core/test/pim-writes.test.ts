import { describe, expect, it, vi } from "vitest";
import { GooglePimTarget } from "../src/pim/GooglePimTarget.ts";
import { GraphPimTarget } from "../src/pim/GraphPimTarget.ts";
import { CalDavPimTarget } from "../src/pim/CalDavPimTarget.ts";
import { PimConflictError, type PimAuthProvider, type PimEventDraft } from "../src/pim/types.ts";
import type { FetchFn } from "../src/sync/WebDavSyncTarget.ts";

/**
 * Write side of the three PIM adapters (stage 3): request shapes, etag guards
 * (412 -> PimConflictError), all-day vs. timed transport and the CalDAV
 * read-modify-put that must preserve foreign properties (alarms, attendees).
 */

const auth = (token = "tok"): PimAuthProvider => ({ getAccessToken: vi.fn(async () => token) });

function jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const timedDraft: PimEventDraft = {
  title: "Planning",
  start: { ts: Date.parse("2026-08-01T10:00:00Z") },
  end: { ts: Date.parse("2026-08-01T11:00:00Z") },
  allDay: false,
  location: "Room 5",
};

const allDayDraft: PimEventDraft = {
  title: "Urlaub",
  start: { ts: Date.parse("2026-08-10T00:00:00Z"), date: "2026-08-10" },
  end: { ts: Date.parse("2026-08-12T00:00:00Z"), date: "2026-08-12" },
  allDay: true,
};

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const h = (init?.headers ?? {}) as Record<string, string>;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

describe("GooglePimTarget writes", () => {
  it("creates a timed event (POST body) and returns uid/etag", async () => {
    let sent: any;
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      expect(String(input)).toContain("/calendars/cal1/events");
      expect(init?.method).toBe("POST");
      sent = JSON.parse(String(init?.body));
      return jsonRes({ id: "new1", etag: '"e1"' });
    });
    const t = new GooglePimTarget(auth(), fetchFn);
    const res = await t.createEvent("cal1", timedDraft);
    expect(res).toEqual({ uid: "new1", etag: '"e1"' });
    expect(sent.summary).toBe("Planning");
    expect(sent.start).toEqual({ dateTime: "2026-08-01T10:00:00.000Z", date: null });
    expect(sent.location).toBe("Room 5");
  });

  it("sends civil dates (and nulls dateTime) for all-day events", async () => {
    let sent: any;
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonRes({ id: "n", etag: '"e"' });
    });
    await new GooglePimTarget(auth(), fetchFn).createEvent("cal1", allDayDraft);
    expect(sent.start).toEqual({ date: "2026-08-10", dateTime: null });
    expect(sent.end).toEqual({ date: "2026-08-12", dateTime: null });
  });

  it("updateEvent PATCHes with If-Match and maps 412 to PimConflictError", async () => {
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      expect(init?.method).toBe("PATCH");
      expect(headerOf(init, "If-Match")).toBe('"old"');
      return new Response("", { status: 412 });
    });
    const t = new GooglePimTarget(auth(), fetchFn);
    await expect(t.updateEvent({ calendarId: "cal1", uid: "e1", etag: '"old"' }, timedDraft)).rejects.toBeInstanceOf(PimConflictError);
  });

  it("deleteEvent treats an already-deleted event (404/410) as success", async () => {
    const fetchFn: FetchFn = vi.fn(async () => new Response("", { status: 410 }));
    await expect(new GooglePimTarget(auth(), fetchFn).deleteEvent({ calendarId: "cal1", uid: "gone" })).resolves.toBeUndefined();
  });

  it("un-completing a task clears the completed stamp and the due when absent", async () => {
    let sent: any;
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonRes({ etag: '"t2"' });
    });
    const t = new GooglePimTarget(auth(), fetchFn);
    const res = await t.updateTask({ listId: "l1", uid: "t1" }, { title: "T", completed: false });
    expect(res).toEqual({ etag: '"t2"' });
    expect(sent.status).toBe("needsAction");
    expect(sent.completed).toBeNull();
    expect(sent.due).toBeNull();
  });

  it("create carries a simple RRULE for recurrence, PATCH never does", async () => {
    const bodies: any[] = [];
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonRes({ id: "x", etag: '"e"' });
    });
    const t = new GooglePimTarget(auth(), fetchFn);
    await t.createEvent("cal1", { ...timedDraft, recurrenceFreq: "monthly" });
    expect(bodies[0].recurrence).toEqual(["RRULE:FREQ=MONTHLY"]);
    await t.updateEvent({ calendarId: "cal1", uid: "x" }, { ...timedDraft, recurrenceFreq: "monthly" });
    expect(bodies[1].recurrence).toBeUndefined();
  });

  it("createTask transports the day-granular due as midnight UTC", async () => {
    let sent: any;
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonRes({ id: "t9" });
    });
    await new GooglePimTarget(auth(), fetchFn).createTask("l1", { title: "Do it", due: "2026-08-05", completed: false });
    expect(sent.due).toBe("2026-08-05T00:00:00.000Z");
    expect(sent.status).toBe("needsAction");
  });
});

describe("GraphPimTarget writes", () => {
  it("creates an event with UTC dateTimes and isAllDay for all-day drafts", async () => {
    let sent: any;
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      expect(String(input)).toContain("/me/calendars/calX/events");
      sent = JSON.parse(String(init?.body));
      return jsonRes({ id: "g1", "@odata.etag": 'W/"1"' });
    });
    const res = await new GraphPimTarget(auth(), fetchFn).createEvent("calX", allDayDraft);
    expect(res).toEqual({ uid: "g1", etag: 'W/"1"' });
    expect(sent.isAllDay).toBe(true);
    expect(sent.start).toEqual({ dateTime: "2026-08-10T00:00:00", timeZone: "UTC" });
    expect(sent.end).toEqual({ dateTime: "2026-08-12T00:00:00", timeZone: "UTC" });
  });

  it("updateEvent uses If-Match and maps 412 to PimConflictError", async () => {
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      expect(String(input)).toContain("/me/events/ev9");
      expect(headerOf(init, "If-Match")).toBe('W/"old"');
      return new Response("", { status: 412 });
    });
    await expect(
      new GraphPimTarget(auth(), fetchFn).updateEvent({ calendarId: "calX", uid: "ev9", etag: 'W/"old"' }, timedDraft)
    ).rejects.toBeInstanceOf(PimConflictError);
  });

  it("create maps recurrence to the structured Graph pattern (weekly anchors on the start day)", async () => {
    const bodies: any[] = [];
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonRes({ id: "x", "@odata.etag": 'W/"1"' });
    });
    const t = new GraphPimTarget(auth(), fetchFn);
    // 2026-08-10 is a Monday (all-day anchors via the civil date).
    await t.createEvent("calX", { ...allDayDraft, recurrenceFreq: "weekly" });
    expect(bodies[0].recurrence).toEqual({
      pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] },
      range: { type: "noEnd", startDate: "2026-08-10" },
    });
    await t.updateEvent({ calendarId: "calX", uid: "x" }, { ...allDayDraft, recurrenceFreq: "weekly" });
    expect(bodies[1].recurrence).toBeUndefined();
  });

  it("task updates carry status + dueDateTime (null clears the due)", async () => {
    let sent: any;
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonRes({ "@odata.etag": 'W/"2"' });
    });
    const res = await new GraphPimTarget(auth(), fetchFn).updateTask({ listId: "L", uid: "T" }, { title: "T", completed: true });
    expect(res).toEqual({ etag: 'W/"2"' });
    expect(sent.status).toBe("completed");
    expect(sent.dueDateTime).toBeNull();
  });
});

describe("CalDavPimTarget writes", () => {
  const creds = { url: "https://dav.example.org/cal/home/", user: "u", pass: "p" };

  it("creates an event: PUT <collection>/<uid>.ics with If-None-Match:*", async () => {
    let putUrl = "";
    let putBody = "";
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      putUrl = String(input);
      putBody = String(init?.body);
      expect(init?.method).toBe("PUT");
      expect(headerOf(init, "If-None-Match")).toBe("*");
      return new Response("", { status: 201, headers: { ETag: '"fresh"' } });
    });
    const t = new CalDavPimTarget(creds, fetchFn);
    const res = await t.createEvent("https://dav.example.org/cal/home/personal/", timedDraft);
    expect(res.etag).toBe('"fresh"');
    expect(res.href).toBe(putUrl);
    expect(putUrl).toMatch(/^https:\/\/dav\.example\.org\/cal\/home\/personal\/plainva-[^/]+\.ics$/);
    expect(putBody).toContain("BEGIN:VEVENT");
    expect(putBody).toContain("SUMMARY:Planning");
    expect(putBody).toContain("DTSTART:20260801T100000Z");
    expect(putBody).toContain("DTEND:20260801T110000Z");
    expect(putBody).toContain("LOCATION:Room 5");
    expect(putBody).toContain(`UID:${res.uid}`);
  });

  it("creates an all-day event with VALUE=DATE civil dates", async () => {
    let putBody = "";
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      putBody = String(init?.body);
      return new Response("", { status: 201 });
    });
    await new CalDavPimTarget(creds, fetchFn).createEvent("https://dav.example.org/cal/home/personal/", allDayDraft);
    expect(putBody).toContain("DTSTART;VALUE=DATE:20260810");
    expect(putBody).toContain("DTEND;VALUE=DATE:20260812");
  });

  it("update = GET-modify-PUT: preserves alarms/attendees, bumps SEQUENCE, guards with If-Match", async () => {
    const existing = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Foreign//Client//EN",
      "BEGIN:VEVENT",
      "UID:ev-1",
      "SEQUENCE:3",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260801T090000Z",
      "DTEND:20260801T093000Z",
      "SUMMARY:Old title",
      "DESCRIPTION:Old desc",
      "ATTENDEE;CN=Anna:mailto:anna@example.org",
      "BEGIN:VALARM",
      "TRIGGER:-PT10M",
      "ACTION:DISPLAY",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    let putBody = "";
    let putIfMatch: string | undefined;
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      if (!init?.method || init.method === "GET") {
        return new Response(existing, { status: 200, headers: { ETag: '"v3"' } });
      }
      expect(init.method).toBe("PUT");
      putBody = String(init.body);
      putIfMatch = headerOf(init, "If-Match");
      return new Response(null, { status: 204, headers: { ETag: '"v4"' } });
    });
    const t = new CalDavPimTarget(creds, fetchFn);
    const res = await t.updateEvent(
      { calendarId: "c", uid: "ev-1", etag: '"v3"', href: "https://dav.example.org/cal/home/personal/ev-1.ics" },
      timedDraft
    );
    expect(res).toEqual({ etag: '"v4"' });
    expect(putIfMatch).toBe('"v3"');
    expect(putBody).toContain("SUMMARY:Planning");
    expect(putBody).toContain("DTSTART:20260801T100000Z");
    expect(putBody).toContain("SEQUENCE:4");
    // Foreign properties survive the rewrite; the cleared description is gone.
    expect(putBody).toContain("BEGIN:VALARM");
    expect(putBody).toContain("ATTENDEE;CN=Anna:mailto:anna@example.org");
    expect(putBody).not.toContain("DESCRIPTION:Old desc");
  });

  it("update raises PimConflictError when the object moved past the known etag (pre-check, no PUT)", async () => {
    let putHappened = false;
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      if (!init?.method || init.method === "GET") {
        return new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:20260801T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR", {
          status: 200,
          headers: { ETag: '"newer"' },
        });
      }
      putHappened = true;
      return new Response(null, { status: 204 });
    });
    const t = new CalDavPimTarget(creds, fetchFn);
    await expect(
      t.updateEvent({ calendarId: "c", uid: "x", etag: '"old"', href: "https://dav.example.org/x.ics" }, timedDraft)
    ).rejects.toBeInstanceOf(PimConflictError);
    expect(putHappened).toBe(false);
  });

  it("completing a task writes STATUS/COMPLETED/PERCENT and un-completing removes them", async () => {
    const existing = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VTODO",
      "UID:t-1",
      "SUMMARY:Old",
      "END:VTODO",
      "END:VCALENDAR",
    ].join("\r\n");
    const puts: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      if (!init?.method || init.method === "GET") {
        // Second round-trip re-reads the (mutated) first PUT body.
        return new Response(puts.length === 0 ? existing : puts[0], { status: 200 });
      }
      puts.push(String(init.body));
      return new Response(null, { status: 204 });
    });
    const t = new CalDavPimTarget(creds, fetchFn);
    const ref = { listId: "l", uid: "t-1", href: "https://dav.example.org/t-1.ics" };
    await t.updateTask(ref, { title: "Do it", due: "2026-08-05", completed: true });
    expect(puts[0]).toContain("STATUS:COMPLETED");
    expect(puts[0]).toContain("PERCENT-COMPLETE:100");
    expect(puts[0]).toContain("DUE;VALUE=DATE:20260805");
    await t.updateTask(ref, { title: "Do it", completed: false });
    expect(puts[1]).toContain("STATUS:NEEDS-ACTION");
    expect(puts[1]).not.toContain("COMPLETED:2");
    expect(puts[1]).not.toContain("PERCENT-COMPLETE");
    expect(puts[1]).not.toContain("DUE;");
  });

  it("update of a series INSTANCE writes a RECURRENCE-ID override and leaves the master alone", async () => {
    const existing = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:series-1",
      "DTSTART:20260801T090000Z",
      "DTEND:20260801T093000Z",
      "RRULE:FREQ=WEEKLY",
      "SUMMARY:Standup",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    let putBody = "";
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      if (!init?.method || init.method === "GET") return new Response(existing, { status: 200, headers: { ETag: '"v1"' } });
      putBody = String(init.body);
      return new Response(null, { status: 204 });
    });
    const t = new CalDavPimTarget(creds, fetchFn);
    await t.updateEvent(
      { calendarId: "c", uid: "series-1#2026-08-08T09:00:00", etag: '"v1"', href: "https://dav.example.org/series-1.ics" },
      { ...timedDraft, title: "Standup (verschoben)", start: { ts: Date.parse("2026-08-08T10:00:00Z") }, end: { ts: Date.parse("2026-08-08T10:30:00Z") } }
    );
    // Master keeps its rule and summary…
    expect(putBody).toContain("RRULE:FREQ=WEEKLY");
    expect(putBody).toContain("SUMMARY:Standup\r\n");
    // …the override carries the instance key + the new values.
    expect(putBody).toContain("RECURRENCE-ID:20260808T090000");
    expect(putBody).toContain("SUMMARY:Standup (verschoben)");
    expect(putBody).toContain("DTSTART:20260808T100000Z");
    expect((putBody.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
  });

  it("re-editing the same instance mutates the EXISTING override instead of stacking a second one", async () => {
    const existing = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:series-1",
      "DTSTART:20260801T090000Z",
      "RRULE:FREQ=WEEKLY",
      "SUMMARY:Standup",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:series-1",
      "RECURRENCE-ID:20260808T090000",
      "DTSTART:20260808T100000Z",
      "SUMMARY:Moved once",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    let putBody = "";
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      if (!init?.method || init.method === "GET") return new Response(existing, { status: 200 });
      putBody = String(init.body);
      return new Response(null, { status: 204 });
    });
    const t = new CalDavPimTarget(creds, fetchFn);
    await t.updateEvent(
      { calendarId: "c", uid: "series-1#2026-08-08T09:00:00", href: "https://dav.example.org/series-1.ics" },
      { ...timedDraft, title: "Moved twice", start: { ts: Date.parse("2026-08-08T11:00:00Z") }, end: { ts: Date.parse("2026-08-08T11:30:00Z") } }
    );
    expect((putBody.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect(putBody).toContain("SUMMARY:Moved twice");
    expect(putBody).not.toContain("Moved once");
  });

  it("delete of a series INSTANCE adds an EXDATE and drops a matching override — series survives", async () => {
    const existing = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:series-1",
      "DTSTART:20260801T090000Z",
      "RRULE:FREQ=WEEKLY",
      "EXDATE:20260715T090000Z",
      "SUMMARY:Standup",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:series-1",
      "RECURRENCE-ID:20260808T090000",
      "SUMMARY:Moved",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const calls: string[] = [];
    let putBody = "";
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      calls.push(init?.method ?? "GET");
      if (!init?.method || init.method === "GET") return new Response(existing, { status: 200 });
      putBody = String(init.body);
      return new Response(null, { status: 204 });
    });
    const t = new CalDavPimTarget(creds, fetchFn);
    await t.deleteEvent({ calendarId: "c", uid: "series-1#2026-08-08T09:00:00", href: "https://dav.example.org/series-1.ics" });
    // Never a DELETE request — the series object is rewritten instead.
    expect(calls).not.toContain("DELETE");
    expect(putBody).toContain("RRULE:FREQ=WEEKLY");
    expect(putBody).toContain("EXDATE:20260715T090000Z"); // pre-existing kept
    expect(putBody).toContain("EXDATE:20260808T090000");
    expect((putBody.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1); // override gone
  });

  it("createEvent attaches a simple RRULE when the draft asks for recurrence", async () => {
    let putBody = "";
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      putBody = String(init?.body);
      return new Response("", { status: 201 });
    });
    await new CalDavPimTarget(creds, fetchFn).createEvent("https://dav.example.org/cal/home/personal/", {
      ...timedDraft,
      recurrenceFreq: "weekly",
    });
    expect(putBody).toContain("RRULE:FREQ=WEEKLY");
  });

  it("deleteEvent sends If-Match and treats 404 as success", async () => {
    const calls: Array<{ method?: string; ifMatch?: string }> = [];
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      calls.push({ method: init?.method, ifMatch: headerOf(init, "If-Match") });
      return new Response("", { status: 404 });
    });
    const t = new CalDavPimTarget(creds, fetchFn);
    await expect(
      t.deleteEvent({ calendarId: "c", uid: "x", etag: '"e"', href: "https://dav.example.org/x.ics" })
    ).resolves.toBeUndefined();
    expect(calls[0]).toEqual({ method: "DELETE", ifMatch: '"e"' });
  });
});
