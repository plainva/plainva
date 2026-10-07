import { beforeEach, describe, expect, it, vi } from "vitest";
import { GooglePimTarget, GOOGLE_BLOCK_SLOTS } from "../src/pim/GooglePimTarget.ts";
import { GraphPimTarget, GRAPH_BLOCK_OF_PROPERTY_ID, GRAPH_BLOCKS_PROPERTY_ID } from "../src/pim/GraphPimTarget.ts";
import { CalDavPimTarget, expandIcsEvents } from "../src/pim/CalDavPimTarget.ts";
import { PimCacheRepository } from "../src/pim/PimCacheRepository.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import { decodeBlockRef, decodeBlockRefs, encodeBlockRef, encodeBlockRefs, uniqueBlockRefs } from "../src/pim/blockLinks.ts";
import { PimRequestError } from "../src/pim/requestError.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import type { PimAuthProvider, PimBlockRef, PimEvent, PimEventDraft } from "../src/pim/types.ts";
import type { FetchFn } from "../src/sync/WebDavSyncTarget.ts";

/**
 * The reverse half of the blocker linkage (K3): an event carries the list of
 * its blockers at the provider. Per provider, that the list is written, that
 * it is read back, and that writing it touches nothing else — and for
 * Microsoft, that it survives the change feed, which is where the forward half
 * used to get lost.
 */

const auth = (): PimAuthProvider => ({ getAccessToken: vi.fn(async () => "tok") });

function jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const draft: PimEventDraft = {
  title: "Board meeting",
  start: { ts: Date.parse("2026-10-06T13:00:00Z") },
  end: { ts: Date.parse("2026-10-06T14:00:00Z") },
  allDay: false,
};

const inPrivate: PimBlockRef = { accountId: "acc-b", calendarId: "private@example.org", uid: "blk-1", mode: "busy" };
const inFamily: PimBlockRef = {
  accountId: "acc-c",
  calendarId: "https://dav.example.org/cal/home/family/",
  uid: "blk-2",
  href: "https://dav.example.org/cal/home/family/blk-2.ics",
  mode: "details",
};

describe("the stored form of a blocker list", () => {
  it("round-trips a list, with the href CalDAV needs and the mode", () => {
    expect(decodeBlockRefs(encodeBlockRefs([inPrivate, inFamily]))).toEqual([inPrivate, inFamily]);
    expect(decodeBlockRef(encodeBlockRef(inFamily))).toEqual(inFamily);
  });

  it("reads anything that is not a list as 'no blockers known', never as an error", () => {
    expect(decodeBlockRefs(undefined)).toBeUndefined();
    expect(decodeBlockRefs("")).toBeUndefined();
    expect(decodeBlockRefs("not json")).toBeUndefined();
    expect(decodeBlockRefs('{"a":"x"}')).toBeUndefined();
    expect(decodeBlockRefs('[{"a":"x"},17,null]')).toBeUndefined();
    expect(decodeBlockRef("[]")).toBeNull();
  });

  it("keeps one entry per blocker, the later one winning", () => {
    expect(uniqueBlockRefs([inPrivate, { ...inPrivate, mode: "details" }])).toEqual([{ ...inPrivate, mode: "details" }]);
  });
});

describe("Google: one private property per blocker", () => {
  it("writes the list into slots and clears the slots it no longer fills", async () => {
    let sent: any;
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonRes({ id: "src", etag: '"e"' });
    });
    await new GooglePimTarget(auth(), fetchFn).updateEvent({ calendarId: "work", uid: "src" }, { ...draft, blocks: [inPrivate, inFamily] });
    const properties = sent.extendedProperties.private;
    expect(decodeBlockRef(properties["plainva-block-0"])).toEqual(inPrivate);
    expect(decodeBlockRef(properties["plainva-block-1"])).toEqual(inFamily);
    // A PATCH merges private properties key by key: what a shorter list leaves
    // behind has to be removed by name.
    for (let index = 2; index < GOOGLE_BLOCK_SLOTS; index++) expect(properties[`plainva-block-${index}`]).toBeNull();
    // Every value fits Google's limit of 1024 characters, key included.
    for (const [key, value] of Object.entries(properties)) if (value) expect(key.length + String(value).length).toBeLessThan(1024);
    expect(properties).not.toHaveProperty("plainva-block-of");
  });

  it("leaves an ordinary write exactly as it was: no link properties at all", async () => {
    let sent: any;
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonRes({ id: "src", etag: '"e"' });
    });
    await new GooglePimTarget(auth(), fetchFn).updateEvent({ calendarId: "work", uid: "src" }, draft);
    expect(sent).not.toHaveProperty("extendedProperties");
  });

  it("reads the list back, and a detached blocker loses its link", async () => {
    const fetchFn: FetchFn = vi.fn(async () =>
      jsonRes({
        items: [
          {
            id: "src",
            summary: "Board meeting",
            start: { dateTime: "2026-10-06T13:00:00Z" },
            end: { dateTime: "2026-10-06T14:00:00Z" },
            extendedProperties: { private: { "plainva-block-0": encodeBlockRef(inPrivate), "plainva-block-1": encodeBlockRef(inFamily), other: "x" } },
          },
        ],
      }),
    );
    const { events } = await new GooglePimTarget(auth(), fetchFn).pullEvents("work", 0, Date.parse("2027-01-01T00:00:00Z"));
    expect(events[0].blocks).toEqual([inPrivate, inFamily]);
    expect(events[0].blockOf).toBeUndefined();

    let sent: any;
    const write: FetchFn = vi.fn(async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonRes({ id: "blk-1", etag: '"e"' });
    });
    await new GooglePimTarget(auth(), write).updateEvent({ calendarId: "private@example.org", uid: "blk-1" }, { ...draft, blockOf: null });
    expect(sent.extendedProperties.private).toEqual({ "plainva-block-of": null });
  });

  it("linkEvent writes the linkage and nothing else about the event", async () => {
    let sent: any;
    let method = "";
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      expect(String(input)).toContain("/calendars/work/events/src");
      method = String(init?.method);
      sent = JSON.parse(String(init?.body));
      return jsonRes({ id: "src", etag: '"e2"' });
    });
    const res = await new GooglePimTarget(auth(), fetchFn).linkEvent({ calendarId: "work", uid: "src" }, { blocks: [inPrivate] });
    expect(method).toBe("PATCH");
    expect(Object.keys(sent)).toEqual(["extendedProperties"]);
    expect(decodeBlockRef(sent.extendedProperties.private["plainva-block-0"])).toEqual(inPrivate);
    expect(res.etag).toBe('"e2"');
  });
});

describe("Microsoft: one extended property, also through the change feed", () => {
  const item = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    subject: id,
    start: { dateTime: "2026-10-06T13:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-10-06T14:00:00.0000000", timeZone: "UTC" },
    ...extra,
  });

  it("writes the list and reads it back from a full pull", async () => {
    let sent: any;
    const write: FetchFn = vi.fn(async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonRes({ id: "src", "@odata.etag": 'W/"1"' });
    });
    await new GraphPimTarget(auth(), write).updateEvent({ calendarId: "work", uid: "src" }, { ...draft, blocks: [inPrivate, inFamily] });
    expect(sent.singleValueExtendedProperties).toEqual([{ id: GRAPH_BLOCKS_PROPERTY_ID, value: encodeBlockRefs([inPrivate, inFamily]) }]);

    const urls: string[] = [];
    const read: FetchFn = vi.fn(async (input) => {
      urls.push(decodeURIComponent(String(input)));
      return jsonRes({
        value: [item("src", { singleValueExtendedProperties: [{ id: GRAPH_BLOCKS_PROPERTY_ID, value: encodeBlockRefs([inPrivate, inFamily]) }] })],
      });
    });
    const { events } = await new GraphPimTarget(auth(), read).pullEvents("work", 0, 1);
    expect(events[0].blocks).toEqual([inPrivate, inFamily]);
    // Both halves are asked for in one expand.
    expect(urls[0]).toContain(GRAPH_BLOCK_OF_PROPERTY_ID);
    expect(urls[0]).toContain(GRAPH_BLOCKS_PROPERTY_ID);
  });

  it("an emptied list and a removed link are written as empty values, and read as none", async () => {
    let sent: any;
    const write: FetchFn = vi.fn(async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return jsonRes({ id: "x", "@odata.etag": 'W/"1"' });
    });
    await new GraphPimTarget(auth(), write).updateEvent({ calendarId: "work", uid: "x" }, { ...draft, blocks: [], blockOf: null });
    expect(sent.singleValueExtendedProperties).toEqual([
      { id: GRAPH_BLOCK_OF_PROPERTY_ID, value: "" },
      { id: GRAPH_BLOCKS_PROPERTY_ID, value: "" },
    ]);
    const read: FetchFn = vi.fn(async () =>
      jsonRes({ value: [item("x", { singleValueExtendedProperties: [{ id: GRAPH_BLOCK_OF_PROPERTY_ID, value: "" }, { id: GRAPH_BLOCKS_PROPERTY_ID, value: "" }] })] }),
    );
    const { events } = await new GraphPimTarget(auth(), read).pullEvents("work", 0, 1);
    expect(events[0].blockOf).toBeUndefined();
    expect(events[0].blocks).toBeUndefined();
  });

  it("the change feed brings both halves along — it used to return a moved blocker without its link", async () => {
    const reads: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (input) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("deltatoken=stored")) {
        // The feed itself takes no $expand: its items carry no extended properties.
        return jsonRes({ value: [item("blk-1"), item("src")], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?$deltatoken=next" });
      }
      reads.push(url);
      if (url.includes("/events/blk-1?")) return jsonRes(item("blk-1", { singleValueExtendedProperties: [{ id: GRAPH_BLOCK_OF_PROPERTY_ID, value: "src" }] }));
      if (url.includes("/events/src?")) return jsonRes(item("src", { singleValueExtendedProperties: [{ id: GRAPH_BLOCKS_PROPERTY_ID, value: encodeBlockRefs([inPrivate]) }] }));
      return jsonRes({}, 500);
    });
    const res = await new GraphPimTarget(auth(), fetchFn).pullEventsDelta("work", "https://graph.microsoft.com/v1.0/delta?$deltatoken=stored", 0, 1);
    expect(res.events.find((e) => e.uid === "blk-1")?.blockOf).toBe("src");
    expect(res.events.find((e) => e.uid === "src")?.blocks).toEqual([inPrivate]);
    expect(reads).toHaveLength(2);
    expect(reads[0]).toContain("/me/calendars/work/events/");
    expect(reads[0]).toContain("$expand=singleValueExtendedProperties");
  });

  it("asks once per series, not once per occurrence", async () => {
    const reads: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (input) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("deltatoken=stored")) {
        return jsonRes({
          value: [item("occ-1", { seriesMasterId: "series" }), item("occ-2", { seriesMasterId: "series" }), item("occ-3", { seriesMasterId: "series" })],
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?$deltatoken=next",
        });
      }
      reads.push(url);
      return jsonRes(item("series", { singleValueExtendedProperties: [{ id: GRAPH_BLOCK_OF_PROPERTY_ID, value: "src-series" }] }));
    });
    const res = await new GraphPimTarget(auth(), fetchFn).pullEventsDelta("work", "https://graph.microsoft.com/v1.0/delta?$deltatoken=stored", 0, 1);
    expect(reads).toHaveLength(1);
    expect(res.events.map((e) => e.blockOf)).toEqual(["src-series", "src-series", "src-series"]);
  });

  it("spends no reads on the run that only seeds the cursor", async () => {
    const urls: string[] = [];
    const fetchFn: FetchFn = vi.fn(async (input) => {
      urls.push(String(input));
      return jsonRes({ value: [item("a"), item("b")], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?$deltatoken=seed" });
    });
    await new GraphPimTarget(auth(), fetchFn).pullEventsDelta("work", null, 0, 1);
    expect(urls).toHaveLength(1);
  });

  it("an event gone again has no link; any other failure fails the step, so the worker refreshes fully", async () => {
    const gone: FetchFn = vi.fn(async (input) =>
      String(input).includes("deltatoken")
        ? jsonRes({ value: [item("a")], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?$deltatoken=n" })
        : jsonRes({ error: { code: "ErrorItemNotFound" } }, 404),
    );
    const res = await new GraphPimTarget(auth(), gone).pullEventsDelta("work", "https://graph.microsoft.com/v1.0/delta?$deltatoken=s", 0, 1);
    expect(res.events[0].blockOf).toBeUndefined();

    const broken: FetchFn = vi.fn(async (input) =>
      String(input).includes("deltatoken")
        ? jsonRes({ value: [item("a")], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?$deltatoken=n" })
        : jsonRes({ error: { code: "ServiceUnavailable" } }, 503),
    );
    await expect(new GraphPimTarget(auth(), broken).pullEventsDelta("work", "https://graph.microsoft.com/v1.0/delta?$deltatoken=s", 0, 1)).rejects.toBeInstanceOf(PimRequestError);
  });

  it("linkEvent writes the linkage and nothing else about the event", async () => {
    let sent: any;
    const fetchFn: FetchFn = vi.fn(async (input, init) => {
      expect(String(input)).toContain("/me/events/src");
      expect(init?.method).toBe("PATCH");
      sent = JSON.parse(String(init?.body));
      return jsonRes({ id: "src", "@odata.etag": 'W/"2"' });
    });
    await new GraphPimTarget(auth(), fetchFn).linkEvent({ calendarId: "work", uid: "src" }, { blocks: [inPrivate] });
    expect(Object.keys(sent)).toEqual(["singleValueExtendedProperties"]);
  });
});

describe("CalDAV: an X- property on the event", () => {
  const creds = { url: "https://dav.example.org/cal/", user: "u", pass: "p" };
  const collection = "https://dav.example.org/cal/home/work/";

  async function createdIcs(d: PimEventDraft): Promise<string> {
    let body = "";
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      body = String(init?.body);
      return new Response("", { status: 201 });
    });
    await new CalDavPimTarget(creds, fetchFn).createEvent(collection, d);
    return body;
  }

  it("writes the list and reads it back — hrefs, commas and quotes included", async () => {
    const ics = await createdIcs({ ...draft, blocks: [inPrivate, inFamily] });
    expect(ics).toContain("X-PLAINVA-BLOCKS:");
    // Percent-encoded: nothing in the value that iCalendar gives a meaning to.
    const unfolded = ics.replace(/\r?\n[ \t]/g, "");
    const value = /X-PLAINVA-BLOCKS:(.*)/.exec(unfolded)?.[1] ?? "";
    expect(value).toMatch(/^[A-Za-z0-9%._~!*'()-]+$/);
    const events = expandIcsEvents(ics, collection, `${collection}x.ics`, '"1"', 0, Date.parse("2027-01-01T00:00:00Z"));
    expect(events[0].blocks).toEqual([inPrivate, inFamily]);
  });

  it("an ordinary event carries neither property", async () => {
    const ics = await createdIcs(draft);
    expect(ics).not.toContain("X-PLAINVA");
  });

  const seriesWithOverride = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Plainva//Plainva//EN",
    "BEGIN:VEVENT",
    "UID:blk-series",
    "DTSTAMP:20261001T000000Z",
    "DTSTART:20261005T130000Z",
    "DTEND:20261005T140000Z",
    "RRULE:FREQ=DAILY;COUNT=3",
    "SUMMARY:Busy",
    "X-PLAINVA-BLOCK-OF:src-series",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:blk-series",
    "DTSTAMP:20261001T000000Z",
    "RECURRENCE-ID:20261006T130000Z",
    "DTSTART:20261006T150000Z",
    "DTEND:20261006T160000Z",
    "SUMMARY:Busy",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("a moved occurrence still belongs to its series' link", () => {
    const events = expandIcsEvents(seriesWithOverride, collection, `${collection}blk-series.ics`, '"1"', 0, Date.parse("2027-01-01T00:00:00Z"));
    const occurrences = events.filter((e) => e.seriesMaster);
    expect(occurrences).toHaveLength(3);
    // The override component does not repeat the X- property; the master answers.
    expect(occurrences.map((e) => e.blockOf)).toEqual(["src-series", "src-series", "src-series"]);
  });

  it("linkEvent rewrites only the linkage; title, time and rule stay as the server had them", async () => {
    const stored = seriesWithOverride.replace("X-PLAINVA-BLOCK-OF:src-series\r\n", "");
    let put = "";
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      if (init?.method === "GET") return new Response(stored, { status: 200, headers: { ETag: '"1"' } });
      put = String(init?.body);
      return new Response(null, { status: 204, headers: { ETag: '"2"' } });
    });
    const href = `${collection}blk-series.ics`;
    const res = await new CalDavPimTarget(creds, fetchFn).linkEvent({ calendarId: collection, uid: "blk-series", href }, { blocks: [inPrivate] });
    expect(res.etag).toBe('"2"');
    expect(put).toContain("RRULE:FREQ=DAILY;COUNT=3");
    expect(put).toContain("DTSTART:20261005T130000Z");
    expect(put).toContain("RECURRENCE-ID:20261006T130000Z");
    // No SEQUENCE bump: nothing an attendee would care about has changed.
    expect(put).not.toContain("SEQUENCE");
    const events = expandIcsEvents(put, collection, href, '"2"', 0, Date.parse("2027-01-01T00:00:00Z"));
    expect(events.every((e) => e.blocks?.[0]?.uid === "blk-1")).toBe(true);
  });

  it("removes a link that is set to null, and says 404 with its status when the object is gone", async () => {
    let put = "";
    const fetchFn: FetchFn = vi.fn(async (_input, init) => {
      if (init?.method === "GET") return new Response(seriesWithOverride, { status: 200, headers: { ETag: '"1"' } });
      put = String(init?.body);
      return new Response(null, { status: 204 });
    });
    const href = `${collection}blk-series.ics`;
    await new CalDavPimTarget(creds, fetchFn).updateEvent({ calendarId: collection, uid: "blk-series", href }, { ...draft, blockOf: null });
    expect(put).not.toContain("X-PLAINVA-BLOCK-OF");

    const missing: FetchFn = vi.fn(async () => new Response("", { status: 404 }));
    const error = await new CalDavPimTarget(creds, missing).updateEvent({ calendarId: collection, uid: "gone", href }, draft).catch((e) => e);
    expect(error).toBeInstanceOf(PimRequestError);
    expect((error as PimRequestError).status).toBe(404);
  });
});

// ---- the cache ---------------------------------------------------------------

const { DatabaseSync } = (await import("node:sqlite")) as any;

class NodeSqliteAdapter implements IDatabaseAdapter {
  constructor(private db: any) {}
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = this.db.prepare(sql).all(...(params as never[])) as T[];
    return rows[0] ?? null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

function ev(uid: string, calendarId: string, extra: Partial<PimEvent> = {}): PimEvent {
  return {
    uid,
    calendarId,
    title: uid,
    start: { ts: Date.parse("2026-10-06T13:00:00Z") },
    end: { ts: Date.parse("2026-10-06T14:00:00Z") },
    allDay: false,
    ...extra,
  };
}

describe("the cache and the blocker linkage", () => {
  let repo: PimCacheRepository;
  const from = Date.parse("2026-10-01T00:00:00Z");
  const to = Date.parse("2026-11-01T00:00:00Z");

  beforeEach(async () => {
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    repo = new PimCacheRepository(db);
    await repo.upsertAccount({ id: "acc1", provider: "google", label: "Work", config: {}, enabled: true });
    await repo.upsertAccount({ id: "acc2", provider: "caldav", label: "Home", config: {}, enabled: true });
    await repo.replaceCalendars("acc1", [{ id: "work", name: "Work" }]);
    await repo.replaceCalendars("acc2", [{ id: "private", name: "Private" }, { id: "family", name: "Family" }]);
  });

  it("keeps the event's own list through a refresh and through a delta step", async () => {
    await repo.replaceEventWindow("acc1", "work", from, to, [ev("src", "work", { blocks: [inPrivate, inFamily] })]);
    expect((await repo.listEvents(from, to))[0].blocks).toEqual([inPrivate, inFamily]);
    await repo.applyEventDelta("acc1", "work", [ev("src", "work", { blocks: [inPrivate] })], []);
    expect((await repo.getEventByUid("acc1", "work", "src"))?.blocks).toEqual([inPrivate]);
  });

  it("finds the blockers of an event in every calendar, shown or not, masters included", async () => {
    await repo.replaceEventWindow("acc1", "work", from, to, [ev("src", "work")]);
    await repo.replaceEventWindow("acc2", "private", from, to, [ev("blk-1", "private", { blockOf: "src" }), ev("other", "private")]);
    await repo.replaceEventWindow("acc2", "family", from, to, [
      ev("blk-series", "family", { blockOf: "src", recurrence: "RRULE:FREQ=DAILY" }),
      ev("blk-series#1", "family", { blockOf: "src", seriesMaster: "blk-series" }),
    ]);
    // Hidden: the grid does not list it …
    await repo.setCalendarSelected("acc2", "family", false);
    expect((await repo.listEvents(from, to)).map((e) => e.uid).sort()).toEqual(["blk-1", "other", "src"]);
    // … and the blocker lookup still does.
    expect((await repo.listBlockersOf(["src"])).map((e) => e.uid).sort()).toEqual(["blk-1", "blk-series", "blk-series#1"]);
    expect(await repo.listBlockersOf([])).toEqual([]);
    expect(await repo.listBlockersOf(["nobody"])).toEqual([]);
  });

  it("leaves out a switched-off account: there is no target to write through", async () => {
    await repo.replaceEventWindow("acc2", "private", from, to, [ev("blk-1", "private", { blockOf: "src" })]);
    await repo.upsertAccount({ id: "acc2", provider: "caldav", label: "Home", config: {}, enabled: false });
    expect(await repo.listBlockersOf(["src"])).toEqual([]);
  });

  it("finds an event by its provider id alone, with the occurrences of a series", async () => {
    await repo.replaceEventWindow("acc1", "work", from, to, [
      ev("series", "work", { recurrence: "RRULE:FREQ=DAILY" }),
      ev("series_1", "work", { seriesMaster: "series" }),
      ev("single", "work"),
    ]);
    expect((await repo.findEventsByUid("series")).map((e) => e.uid).sort()).toEqual(["series", "series_1"]);
    expect((await repo.findEventsByUid("single")).map((e) => e.uid)).toEqual(["single"]);
    expect(await repo.findEventsByUid("")).toEqual([]);
  });

  it("adds the column to a database that was created before it existed", async () => {
    const old = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(old);
    await old.execute(`ALTER TABLE pim_events DROP COLUMN blocks`);
    await initializeSchema(old);
    const columns = (await old.query<{ name: string }>(`PRAGMA table_info(pim_events)`)).map((c) => c.name);
    expect(columns).toContain("blocks");
  });
});
