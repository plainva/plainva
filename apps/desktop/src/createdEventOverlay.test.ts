import { describe, expect, it } from "vitest";
import { CalDavPimTarget, expandIcsEvents, type FetchFn, type PimEventDraft, type PimEventRow } from "@plainva/core";
import {
  applyPendingEventWrites,
  checkUnlistedCreates,
  createCalendarEvent,
  createChange,
  draftToRow,
  isPendingEventUid,
  pendingEventRow,
  PendingEventWrites,
  SETTLED_EVENT_WRITE_TTL_MS,
  writeEventOptimistically,
  type CreatedEventChange,
} from "@plainva/ui";

/**
 * A new event on screen until a sync lists it (issue 119).
 *
 * The report: a repeating event added on the desktop against iCloud "didn't
 * stick around at first". Two parts of it lived in the overlay that holds a
 * new event on screen: it let go of a created event after three minutes
 * whether or not the provider still held it, and it drew a new series as ONE
 * event at its first start, so the repeat looked lost too.
 */

const CAL = "https://dav.example.org/cal/home/personal/";
const DAY = 24 * 3600_000;
const start = Date.parse("2026-12-01T09:00:00Z");
const weekly: PimEventDraft = {
  title: "Team sync",
  start: { ts: start },
  end: { ts: start + 30 * 60_000 },
  allDay: false,
  recurrence: { freq: "weekly", interval: 1 },
  createAs: "plainva-series-1",
};

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const h = (init?.headers ?? {}) as Record<string, string>;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

/** A CalDAV server like iCloud: it rewrites what it stores, names no etag in its answer, honours If-None-Match. */
function davServer() {
  const objects = new Map<string, { text: string; etag: string }>();
  let revision = 0;
  const fetchFn: FetchFn = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const held = objects.get(url);
    if (method === "PUT") {
      if (headerOf(init, "If-None-Match") === "*" && held) return new Response(null, { status: 412 });
      revision += 1;
      objects.set(url, { text: String(init?.body).replace("PRODID:-//Plainva//Plainva//EN", "PRODID:-//Example//Server//EN"), etag: `"r${revision}"` });
      return new Response(null, { status: 201 });
    }
    if (method === "GET") return held ? new Response(held.text, { status: 200, headers: { ETag: held.etag } }) : new Response("Not Found", { status: 404 });
    if (method === "DELETE") {
      objects.delete(url);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };
  return { objects, target: new CalDavPimTarget({ url: "https://dav.example.org/cal/home/", user: "u", pass: "p" }, fetchFn, async () => {}) };
}

async function createOnScreen(store: PendingEventWrites, target: CalDavPimTarget, draft: PimEventDraft) {
  const id = store.reserve();
  const { uid: _uid, ...shown } = draftToRow("a1", CAL, "", draft);
  const targets = { targetFor: async () => target };
  const out = await writeEventOptimistically(
    store,
    createChange(pendingEventRow(id, shown), draft),
    () => createCalendarEvent(targets, "a1", CAL, draft),
    (written) => written.rows.map((row) => createChange(row, draft)),
    id,
  );
  return out.rows[0]!;
}

describe("a new series on screen (issue 119)", () => {
  it("is drawn by the occurrences the next sync will show - not once at its first start", async () => {
    expect.hasAssertions();
    const { objects, target } = davServer();
    const store = new PendingEventWrites();
    const created = await createOnScreen(store, target, weekly);
    const range = { startTs: start - DAY, endTs: start + 28 * DAY };

    const shown = applyPendingEventWrites([], store.snapshot(), range);
    // What a pull makes of the object the server holds, in the same window.
    const stored = objects.get(created.href!)!;
    const pulled = expandIcsEvents(stored.text, CAL, created.href!, stored.etag, range.startTs, range.endTs).filter((row) => row.seriesMaster);
    expect(shown.map((row) => [row.uid, row.start.ts, row.end.ts, row.title, row.seriesMaster])).toEqual(
      pulled.map((row) => [row.uid, row.start.ts, row.end.ts, row.title, row.seriesMaster]),
    );
    expect(shown).toHaveLength(4);
    // Addressed like a pull's occurrences, so "only this event" can be written against them.
    expect(shown.every((row) => row.href === created.href && !isPendingEventUid(row.uid))).toBe(true);
  });

  it("shows its occurrences while the provider has not answered yet - and those cannot be written against", () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    const id = store.reserve();
    const { uid: _uid, ...shown } = draftToRow("a1", CAL, "", weekly);
    store.begin(createChange(pendingEventRow(id, shown), weekly), id);
    const rows = applyPendingEventWrites([], store.snapshot(), { startTs: start - DAY, endTs: start + 14 * DAY });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.pending && isPendingEventUid(row.uid))).toBe(true);
  });

  it("steps aside, whole, once a sync lists the series", async () => {
    expect.hasAssertions();
    const { target } = davServer();
    const store = new PendingEventWrites();
    const created = await createOnScreen(store, target, weekly);
    const listed: PimEventRow = { ...created, uid: `${created.uid}#2026-12-08T09:00:00Z`, seriesMaster: created.uid, start: { ts: start + 7 * DAY }, end: { ts: start + 7 * DAY + 30 * 60_000 } };
    store.reconcile([listed], Date.now());
    expect(applyPendingEventWrites([listed], store.snapshot(), { startTs: start - DAY, endTs: start + 28 * DAY })).toEqual([listed]);
  });

  it("from a provider that names its own occurrences, they are shown but not written against", () => {
    expect.hasAssertions();
    const google = draftToRow("a1", "primary", "evt123", weekly);
    const change = createChange(google, weekly);
    expect(change.occurrences?.length).toBeGreaterThan(0);
    expect(change.occurrences!.every((row) => isPendingEventUid(row.uid) && row.seriesMaster === "evt123")).toBe(true);
  });

  it("a single event stays one row", () => {
    expect.hasAssertions();
    const single = { ...weekly, recurrence: undefined };
    expect(createChange(draftToRow("a1", CAL, "u1", single), single).occurrences).toBeUndefined();
  });
});

describe("a new event no sync lists yet (issue 119)", () => {
  const single: PimEventDraft = { ...weekly, recurrence: undefined };
  const settledCreate = (store: PendingEventWrites, row: PimEventRow, at: number, draft: PimEventDraft = single) => {
    const id = store.begin(createChange(row, draft));
    store.settle(id, undefined, at);
  };
  const created = { ...draftToRow("a1", CAL, "plainva-1", { ...weekly, recurrence: undefined }), href: `${CAL}plainva-1.ics` };

  it("is not taken off the screen when the overlay's time runs out", () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledCreate(store, created, 0);
    store.reconcile([], SETTLED_EVENT_WRITE_TTL_MS * 10);
    expect(applyPendingEventWrites([], store.snapshot()).map((row) => row.uid)).toEqual(["plainva-1"]);
  });

  it("is asked about after that time - held, it stays, and is asked again only after another such time", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledCreate(store, created, 0);
    const asked: string[] = [];
    const targetFor = async () => ({ eventExists: async (ref: { uid: string }) => (asked.push(ref.uid), true) });
    const gone: CreatedEventChange[] = [];
    await checkUnlistedCreates(store, targetFor, (c) => gone.push(c), SETTLED_EVENT_WRITE_TTL_MS - 1);
    expect(asked).toEqual([]);
    await checkUnlistedCreates(store, targetFor, (c) => gone.push(c), SETTLED_EVENT_WRITE_TTL_MS + 1);
    await checkUnlistedCreates(store, targetFor, (c) => gone.push(c), SETTLED_EVENT_WRITE_TTL_MS + 2);
    expect(asked).toEqual(["plainva-1"]);
    expect(gone).toEqual([]);
    expect(applyPendingEventWrites([], store.snapshot())).toHaveLength(1);
  });

  it("leaves only when the provider says it is not there - with what the person typed, for 'Try again'", async () => {
    expect.hasAssertions();
    const { target } = davServer();
    const store = new PendingEventWrites();
    settledCreate(store, created, 0);
    const gone: CreatedEventChange[] = [];
    await checkUnlistedCreates(store, async () => target, (c) => gone.push(c), SETTLED_EVENT_WRITE_TTL_MS + 1);
    expect(applyPendingEventWrites([], store.snapshot())).toEqual([]);
    expect(gone.map((c) => [c.row.uid, c.draft?.title])).toEqual([["plainva-1", "Team sync"]]);
  });

  it("a provider that cannot be asked, or does not answer, keeps it", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledCreate(store, created, 0);
    const gone: CreatedEventChange[] = [];
    await checkUnlistedCreates(store, async () => ({}), (c) => gone.push(c), SETTLED_EVENT_WRITE_TTL_MS + 1);
    await checkUnlistedCreates(
      store,
      async () => ({ eventExists: async () => Promise.reject(new Error("offline")) }),
      (c) => gone.push(c),
      SETTLED_EVENT_WRITE_TTL_MS * 3,
    );
    expect(gone).toEqual([]);
    expect(applyPendingEventWrites([], store.snapshot())).toHaveLength(1);
  });
});
