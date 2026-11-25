import { describe, expect, it, vi } from "vitest";
import { CalDavPimTarget, expandIcsEvents, type FetchFn, type PimAccountRow, type PimCalendar, type PimEventCreate, type PimEventDraft, type PimEventRow } from "@plainva/core";

const bus = vi.hoisted(() => ({ request: (() => Promise.reject(new Error("no bus"))) as unknown }));
vi.mock("./services/windowBus", () => ({ getWindowBus: async () => bus }));

import { createRemotePimTarget } from "./services/pim/remotePimTarget";
import {
  applyPendingEventWrites,
  CREATED_EVENT_GIVE_UP_MS,
  settleCreatedEvents,
  watchCreatedEvents,
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
const weekly: PimEventCreate = {
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

/**
 * A CalDAV server like iCloud: it rewrites what it stores, names no etag in
 * its answer, honours If-None-Match, and shows a new object only `lagMs` after
 * it took it - on its own clock, which moves while the client waits.
 */
function davServer({ lagMs }: { lagMs: number } = { lagMs: 1_000 }) {
  let now = 0;
  const objects = new Map<string, { text: string; etag: string; visibleAt: number }>();
  let revision = 0;
  const fetchFn: FetchFn = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const held = objects.get(url);
    if (method === "PUT") {
      if (headerOf(init, "If-None-Match") === "*" && held) return new Response(null, { status: 412 });
      revision += 1;
      objects.set(url, { text: String(init?.body).replace("PRODID:-//Plainva//Plainva//EN", "PRODID:-//Example//Server//EN"), etag: `"r${revision}"`, visibleAt: now + lagMs });
      return new Response(null, { status: 201 });
    }
    if (method === "GET") return held && now >= held.visibleAt ? new Response(held.text, { status: 200, headers: { ETag: held.etag } }) : new Response("Not Found", { status: 404 });
    if (method === "DELETE") {
      objects.delete(url);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };
  return { objects, target: new CalDavPimTarget({ url: "https://dav.example.org/cal/home/", user: "u", pass: "p" }, fetchFn, async (ms) => void (now += ms)) };
}

async function createOnScreen(store: PendingEventWrites, target: CalDavPimTarget, draft: PimEventCreate) {
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
    store.reconcile([listed], 1_000);
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
  const single: PimEventCreate = { ...weekly, recurrence: undefined, createAs: "plainva-1" };
  const created = { ...draftToRow("a1", CAL, "plainva-1", single), href: `${CAL}plainva-1.ics` };
  const settledCreate = (store: PendingEventWrites, row: PimEventRow, at: number, draft: PimEventDraft = single) => {
    const id = store.begin(createChange(row, draft));
    store.settle(id, undefined, at);
  };

  /** The cache as the vault holds it: every range, shown or not. */
  function cache(init: { rows?: PimEventRow[]; enabled?: boolean; selected?: boolean; account?: boolean } = {}) {
    const state = { rows: init.rows ?? [], enabled: init.enabled ?? true, selected: init.selected ?? true, account: init.account ?? true };
    return {
      state,
      findEventsByUid: async (uid: string) => state.rows.filter((row) => row.uid === uid || row.seriesMaster === uid),
      listAccounts: async () => (state.account ? [{ id: "a1", provider: "caldav", label: "x", config: {}, enabled: state.enabled } as unknown as PimAccountRow] : []),
      listCalendars: async () => [{ accountId: "a1", id: CAL, name: "Personal", selected: state.selected } as PimCalendar & { accountId: string; selected: boolean }],
    };
  }
  const shownNow = (store: PendingEventWrites) => applyPendingEventWrites([], store.snapshot());

  it("is not taken off the screen when the overlay's time runs out", () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledCreate(store, created, 0);
    store.reconcile([], SETTLED_EVENT_WRITE_TTL_MS * 10);
    expect(shownNow(store).map((row) => row.uid)).toEqual(["plainva-1"]);
  });

  it("ends once a sync has it - in any range, not only the one shown - and is never called lost after that", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledCreate(store, created, 0);
    // The week on screen does not hold it; the cache does (next month).
    const vault = cache({ rows: [{ ...created, etag: '"r1"' }] });
    const gone: CreatedEventChange[] = [];
    const exists = vi.fn(async () => false);
    await settleCreatedEvents(store, { cache: vault, targetFor: async () => ({ provider: "caldav", eventExists: exists }) as never, onGone: (c) => gone.push(c) }, 60_000);
    expect(shownNow(store)).toEqual([]);
    // Deleted elsewhere later: the cache is the truth, nothing is "lost".
    vault.state.rows = [];
    await settleCreatedEvents(store, { cache: vault, targetFor: async () => ({ provider: "caldav", eventExists: exists }) as never, onGone: (c) => gone.push(c) }, SETTLED_EVENT_WRITE_TTL_MS * 2);
    expect(gone).toEqual([]);
    expect(exists).not.toHaveBeenCalled();
  });

  it("no sync has it: the provider is asked after the overlay's time - held, it stays, asked again only after another such time", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledCreate(store, created, 0);
    const asked: number[] = [];
    const deps = { cache: cache(), targetFor: async () => ({ provider: "caldav", eventExists: async () => (asked.push(1), true) }) as never, onGone: () => undefined };
    await settleCreatedEvents(store, deps, SETTLED_EVENT_WRITE_TTL_MS - 1);
    await settleCreatedEvents(store, deps, SETTLED_EVENT_WRITE_TTL_MS + 1);
    await settleCreatedEvents(store, deps, SETTLED_EVENT_WRITE_TTL_MS + 2);
    expect(asked).toHaveLength(1);
    expect(shownNow(store)).toHaveLength(1);
  });

  it("no sync ever had it and the provider does not hold it: it leaves with what the person typed, for 'Try again'", async () => {
    expect.hasAssertions();
    const { target } = davServer({ lagMs: 0 });
    const store = new PendingEventWrites();
    settledCreate(store, created, 0);
    const gone: CreatedEventChange[] = [];
    await settleCreatedEvents(store, { cache: cache(), targetFor: async () => target, onGone: (c) => gone.push(c) }, SETTLED_EVENT_WRITE_TTL_MS + 1);
    expect(shownNow(store)).toEqual([]);
    expect(gone.map((c) => [c.row.uid, c.draft?.title, c.draft?.createAs])).toEqual([["plainva-1", "Team sync", "plainva-1"]]);
  });

  it("a hidden calendar, an account switched off or removed: it leaves without a word", async () => {
    expect.hasAssertions();
    for (const state of [{ selected: false }, { enabled: false }, { account: false }]) {
      const store = new PendingEventWrites();
      settledCreate(store, created, 0);
      const gone: CreatedEventChange[] = [];
      await settleCreatedEvents(store, { cache: cache(state), targetFor: async () => null, onGone: (c) => gone.push(c) }, 60_000);
      expect([state, shownNow(store).length, gone.length]).toEqual([state, 0, 0]);
    }
  });

  it("a provider that does not answer keeps it - but nothing is drawn from here longer than the hourly full refresh needs", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledCreate(store, created, 0);
    const deps = { cache: cache(), targetFor: async () => ({ provider: "caldav", eventExists: async () => Promise.reject(new Error("offline")) }) as never, onGone: () => undefined };
    await settleCreatedEvents(store, deps, SETTLED_EVENT_WRITE_TTL_MS * 3);
    expect(shownNow(store)).toHaveLength(1);
    await settleCreatedEvents(store, deps, CREATED_EVENT_GIVE_UP_MS + 1);
    expect(shownNow(store)).toEqual([]);
  });

  it("the device's own calendars cannot be asked: the overlay ends after its time, as before", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledCreate(store, created, 0);
    const deps = { cache: cache(), targetFor: async () => ({ provider: "device" }) as never, onGone: () => undefined };
    await settleCreatedEvents(store, deps, SETTLED_EVENT_WRITE_TTL_MS + 1);
    expect(shownNow(store)).toEqual([]);
  });

  it("an auxiliary window asks through the central one", async () => {
    expect.hasAssertions();
    const sent: unknown[] = [];
    bus.request = vi.fn(async (_kind: string, args: { op: { kind: string } }) => (sent.push(args.op), { ok: true, exists: false })) as never;
    const remote = createRemotePimTarget({ id: "a1", provider: "caldav" } as unknown as PimAccountRow);
    const store = new PendingEventWrites();
    settledCreate(store, created, 0);
    const gone: CreatedEventChange[] = [];
    await settleCreatedEvents(store, { cache: cache(), targetFor: async () => remote, onGone: (c) => gone.push(c) }, SETTLED_EVENT_WRITE_TTL_MS + 1);
    expect(sent).toEqual([{ kind: "eventExists", ref: { calendarId: CAL, uid: "plainva-1", href: `${CAL}plainva-1.ics` } }]);
    expect(gone).toHaveLength(1);
  });

  it("closing the vault stops the watch and takes the overlay along", () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledCreate(store, created, 0);
    const stop = watchCreatedEvents(store, { cache: cache(), targetFor: async () => null });
    stop();
    expect(store.snapshot()).toEqual([]);
  });
});
