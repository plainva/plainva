import { describe, expect, it, vi } from "vitest";
import { CalDavPimTarget, expandIcsEvents, type FetchFn, type PimAccountRow, type PimCalendar, type PimEventCreate, type PimEventDraft, type PimEventRow } from "@plainva/core";

const bus = vi.hoisted(() => ({ request: (() => Promise.reject(new Error("no bus"))) as unknown }));
vi.mock("./services/windowBus", () => ({ getWindowBus: async () => bus }));

import { createRemotePimTarget } from "./services/pim/remotePimTarget";
import {
  applyPendingEventWrites,
  CREATED_EVENT_ASK_EVERY_MS,
  reportCreatedEventGone,
  settleCreatedEvents,
  toast,
  updateCalendarEvent,
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
      if (!held || now < held.visibleAt) return new Response(null, { status: 404 });
      objects.delete(url);
      return new Response(null, { status: 204 });
    }
    if (method === "REPORT") {
      // calendar-query on a UID: the objects shown that carry it.
      const uid = /<c:text-match[^>]*>([^<]*)</.exec(String(init?.body))?.[1] ?? "";
      const found = [...objects.entries()].filter(([, o]) => now >= o.visibleAt && o.text.includes(`UID:${uid}`));
      const body = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${found
        .map(([href, o]) => `<d:response><d:href>${new URL(href).pathname}</d:href><d:propstat><d:prop><d:getetag>${o.etag}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`)
        .join("")}</d:multistatus>`;
      return new Response(body, { status: 207 });
    }
    return new Response(null, { status: 405 });
  };
  const advance = (ms: number) => void (now += ms);
  return { objects, advance, target: new CalDavPimTarget({ url: "https://dav.example.org/cal/home/", user: "u", pass: "p" }, fetchFn, async (ms) => advance(ms)) };
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
  const settledCreate = (store: PendingEventWrites, change: CreatedEventChange, at: number) => {
    const id = store.begin(change);
    store.settle(id, undefined, at);
  };
  const settledNew = (store: PendingEventWrites, at = 0) => settledCreate(store, createChange(created, single), at);
  const ASK = CREATED_EVENT_ASK_EVERY_MS;

  /** The cache as the vault holds it: every range, shown or not. */
  function cache(init: { rows?: PimEventRow[]; enabled?: boolean; selected?: boolean; account?: boolean; calendar?: boolean } = {}) {
    const state = { rows: init.rows ?? [], enabled: init.enabled ?? true, selected: init.selected ?? true, account: init.account ?? true, calendar: init.calendar ?? true };
    return {
      state,
      findEventsByUid: async (uid: string) => state.rows.filter((row) => row.uid === uid || row.seriesMaster === uid),
      listAccounts: async () => (state.account ? [{ id: "a1", provider: "caldav", label: "x", config: {}, enabled: state.enabled } as unknown as PimAccountRow] : []),
      listCalendars: async () => (state.calendar ? [{ accountId: "a1", id: CAL, name: "Personal", selected: state.selected } as PimCalendar & { accountId: string; selected: boolean }] : []),
    };
  }
  const shownNow = (store: PendingEventWrites, shownCalendar?: (a: string, c: string) => boolean) => applyPendingEventWrites([], store.snapshot(), undefined, shownCalendar);
  const asking = (answers: Array<boolean | Error>) => {
    const asked = vi.fn(async () => {
      const next = answers.shift() ?? false;
      if (next instanceof Error) throw next;
      return next;
    });
    return { asked, targetFor: async () => ({ provider: "caldav", eventExists: asked }) as never };
  };

  it("is not taken off the screen when the overlay's time runs out", () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledNew(store);
    store.reconcile([], SETTLED_EVENT_WRITE_TTL_MS * 10);
    expect(shownNow(store).map((row) => row.uid)).toEqual(["plainva-1"]);
  });

  it("ends once a sync has it - in any range, not only the one shown - and is never called lost after that", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledNew(store);
    const vault = cache({ rows: [{ ...created, etag: '"r1"' }] });
    const gone: CreatedEventChange[] = [];
    const { asked, targetFor } = asking([false, false, false]);
    await settleCreatedEvents(store, { cache: vault, targetFor, onGone: (c) => gone.push(c) }, 60_000);
    expect(shownNow(store)).toEqual([]);
    vault.state.rows = [];
    for (const t of [ASK, 2 * ASK, 3 * ASK, 4 * ASK]) await settleCreatedEvents(store, { cache: vault, targetFor, onGone: (c) => gone.push(c) }, t);
    expect(gone).toEqual([]);
    expect(asked).not.toHaveBeenCalled();
  });

  it("leaves only on the provider's third 'no' in a row, each at least the asking time apart - a 'yes' starts the count over", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledNew(store);
    const gone: CreatedEventChange[] = [];
    const { asked, targetFor } = asking([false, true, false, false, false]);
    const deps = { cache: cache(), targetFor, onGone: (c: CreatedEventChange) => gone.push(c) };
    await settleCreatedEvents(store, deps, ASK - 1);
    expect(asked).not.toHaveBeenCalled();
    for (const t of [ASK, ASK + 1, 2 * ASK, 3 * ASK, 4 * ASK]) await settleCreatedEvents(store, deps, t);
    // asked at ASK (no), 2·ASK (yes), 3·ASK (no), 4·ASK (no): two in a row, not three.
    expect(asked).toHaveBeenCalledTimes(4);
    expect(gone).toEqual([]);
    await settleCreatedEvents(store, deps, 5 * ASK);
    expect(gone.map((c) => [c.row.uid, c.draft?.createAs])).toEqual([["plainva-1", "plainva-1"]]);
    expect(shownNow(store)).toEqual([]);
  });

  it("asleep far longer than any limit: the first round after waking asks the provider, it does not drop", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledNew(store);
    const { asked, targetFor } = asking([true]);
    await settleCreatedEvents(store, { cache: cache(), targetFor, onGone: () => undefined }, 10 * 3600_000);
    expect(asked).toHaveBeenCalledTimes(1);
    expect(shownNow(store)).toHaveLength(1);
  });

  it("a server that shows a new event only after five minutes is never reported as not having it", async () => {
    expect.hasAssertions();
    const { target, advance } = davServer({ lagMs: 5 * 60_000 });
    const store = new PendingEventWrites();
    await createOnScreen(store, target, { ...single, createAs: "plainva-late-5" });
    const gone: CreatedEventChange[] = [];
    const base = store.settledCreates()[0]!.settledAt;
    for (const t of [ASK, 2 * ASK, 3 * ASK, 4 * ASK]) {
      advance(ASK);
      await settleCreatedEvents(store, { cache: cache(), targetFor: async () => target, onGone: (c) => gone.push(c) }, base + t);
    }
    expect(gone).toEqual([]);
    expect(shownNow(store)).toHaveLength(1);
  });

  it("a hidden calendar or an account switched off: not drawn, kept, still asked - and drawn again when shown", async () => {
    expect.hasAssertions();
    for (const state of [{ selected: false }, { enabled: false }]) {
      const store = new PendingEventWrites();
      settledNew(store);
      const { asked, targetFor } = asking([true]);
      await settleCreatedEvents(store, { cache: cache(state), targetFor, onGone: () => undefined }, ASK);
      expect([state, shownNow(store, () => false).length, asked.mock.calls.length]).toEqual([state, 0, 1]);
      expect(shownNow(store, () => true)).toHaveLength(1);
    }
  });

  it("an account removed or a calendar gone at the provider: it leaves without a word", async () => {
    expect.hasAssertions();
    for (const state of [{ account: false }, { calendar: false }]) {
      const store = new PendingEventWrites();
      settledNew(store);
      const gone: CreatedEventChange[] = [];
      await settleCreatedEvents(store, { cache: cache(state), targetFor: async () => null, onGone: (c) => gone.push(c) }, 60_000);
      expect([state, shownNow(store).length, gone.length]).toEqual([state, 0, 0]);
    }
  });

  it("a provider that does not answer, wants a sign-in, or cannot be asked (the device): kept, without a time limit", async () => {
    expect.hasAssertions();
    for (const targetFor of [asking([new Error("offline"), new Error("401"), new Error("x")]).targetFor, async () => ({ provider: "device" }) as never, async () => null]) {
      const store = new PendingEventWrites();
      settledNew(store);
      for (const t of [ASK, 2 * ASK, 3 * ASK, 100 * ASK]) await settleCreatedEvents(store, { cache: cache(), targetFor, onGone: () => undefined }, t);
      expect(shownNow(store)).toHaveLength(1);
    }
  });

  it("an auxiliary window asks through the central one", async () => {
    expect.hasAssertions();
    const sent: unknown[] = [];
    bus.request = vi.fn(async (_kind: string, args: { op: { kind: string } }) => (sent.push(args.op), { ok: true, exists: true })) as never;
    const remote = createRemotePimTarget({ id: "a1", provider: "caldav" } as unknown as PimAccountRow);
    const store = new PendingEventWrites();
    settledNew(store);
    await settleCreatedEvents(store, { cache: cache(), targetFor: async () => remote, onGone: () => undefined }, ASK);
    expect(sent).toEqual([{ kind: "eventExists", ref: { calendarId: CAL, uid: "plainva-1", href: `${CAL}plainva-1.ics` } }]);
    expect(shownNow(store)).toHaveLength(1);
  });

  it("stopping the watch keeps the overlay (a restart in the same vault); leaving the vault is what empties it", () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledNew(store);
    const stop = watchCreatedEvents(store, { cache: cache(), targetFor: async () => null });
    stop();
    expect(shownNow(store)).toHaveLength(1);
  });

  it("the message for a new event offers 'Try again', which creates exactly it again under the same uid", async () => {
    expect.hasAssertions();
    const error = vi.spyOn(toast, "error").mockImplementation(() => 0);
    const createEvent = vi.fn(async (_c: string, d: PimEventCreate) => ({ uid: d.createAs, etag: '"x"', href: `${CAL}${d.createAs}.ics` }));
    const store = new PendingEventWrites();
    reportCreatedEventGone(store, { targetFor: async () => ({ provider: "caldav", createEvent }) as never }, createChange(created, single));
    const action = error.mock.calls[0]![1]!;
    action.run();
    await vi.waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect(createEvent.mock.calls[0]![1].createAs).toBe("plainva-1");
    error.mockRestore();
  });

  it("names what was lost: a move's copy says the event was not moved, a blocker says blocker - neither offers 'Try again'", () => {
    expect.hasAssertions();
    const error = vi.spyOn(toast, "error").mockImplementation(() => 0);
    const store = new PendingEventWrites();
    reportCreatedEventGone(store, { targetFor: async () => null }, { kind: "create", row: created, what: "moved" });
    reportCreatedEventGone(store, { targetFor: async () => null }, { kind: "create", row: created, what: "blocker" });
    expect(error.mock.calls.map((call) => [call[0].includes("Team sync"), call[1]])).toEqual([
      [true, undefined],
      [true, undefined],
    ]);
    expect(error.mock.calls[0]![0]).not.toBe(error.mock.calls[1]![0]);
    error.mockRestore();
  });
});

describe("a move whose copy the provider does not show yet (issue 119)", () => {
  const source = { accountId: "a1", calendarId: "old", uid: "ev-1", etag: '"s1"', href: "https://dav.example.org/cal/home/old/ev-1.ics", title: "Planning", start: { ts: start }, end: { ts: start + 3600_000 }, allDay: false } as PimEventRow;
  const draft = { title: "Planning", start: { ts: start }, end: { ts: start + 3600_000 }, allDay: false } as PimEventDraft;

  it("a copy shown at once: the source is deleted in the same step", async () => {
    expect.hasAssertions();
    const deleteEvent = vi.fn(async () => undefined);
    const targets = { targetFor: async () => ({ provider: "caldav", createEvent: async (_c: string, d: PimEventCreate) => ({ uid: d.createAs, etag: '"c1"' }), deleteEvent }) as never };
    const out = await updateCalendarEvent(targets, source, draft, { accountId: "a1", calendarId: CAL });
    expect(deleteEvent).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ kind: "written", removed: { uid: "ev-1" } });
  });

  it("a copy not shown yet: the source stays at the provider, the screen shows the move, and the source goes once a sync lists the copy", async () => {
    expect.hasAssertions();
    const deleteEvent = vi.fn(async () => undefined);
    const target = { provider: "caldav", createEvent: async (_c: string, d: PimEventCreate) => ({ uid: d.createAs, href: `${CAL}${d.createAs}.ics` }), deleteEvent } as never;
    const out = await updateCalendarEvent({ targetFor: async () => target }, source, draft, { accountId: "a1", calendarId: CAL });
    expect(deleteEvent).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "written", sourceKept: true });
    const copy = (out as { rows: PimEventRow[] }).rows[0]!;
    const store = new PendingEventWrites();
    const id = store.begin({ kind: "create", row: copy, what: "moved", moveFrom: source });
    store.settle(id, undefined, 0);
    // Cached: the source. Shown: the copy only.
    expect(applyPendingEventWrites([source], store.snapshot()).map((row) => row.uid)).toEqual([copy.uid]);
    store.reconcile([source, copy], 1_000);
    expect(applyPendingEventWrites([source, copy], store.snapshot()).map((row) => row.uid)).toEqual([copy.uid]);
    const vault = {
      findEventsByUid: async (uid: string) => (uid === copy.uid ? [copy] : []),
      listAccounts: async () => [{ id: "a1", enabled: true } as PimAccountRow],
      listCalendars: async () => [{ accountId: "a1", id: CAL, selected: true } as PimCalendar & { accountId: string; selected: boolean }],
    };
    await settleCreatedEvents(store, { cache: vault, targetFor: async () => target }, 60_000);
    expect(deleteEvent).toHaveBeenCalledTimes(1);
    // The source leaves the screen until the cache agrees.
    expect(applyPendingEventWrites([source, copy], store.snapshot()).map((row) => row.uid)).toEqual([copy.uid]);
  });

  it("a copy the provider does not have: the source stands again, and the message says the event was not moved", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    const copy = { ...source, calendarId: CAL, uid: "plainva-copy", href: `${CAL}plainva-copy.ics` };
    const id = store.begin({ kind: "create", row: copy, what: "moved", moveFrom: source });
    store.settle(id, undefined, 0);
    const gone: CreatedEventChange[] = [];
    const vault = {
      findEventsByUid: async () => [],
      listAccounts: async () => [{ id: "a1", enabled: true } as PimAccountRow],
      listCalendars: async () => [{ accountId: "a1", id: CAL, selected: true } as PimCalendar & { accountId: string; selected: boolean }],
    };
    const targetFor = async () => ({ provider: "caldav", eventExists: async () => false }) as never;
    for (const t of [CREATED_EVENT_ASK_EVERY_MS, 2 * CREATED_EVENT_ASK_EVERY_MS, 3 * CREATED_EVENT_ASK_EVERY_MS]) await settleCreatedEvents(store, { cache: vault, targetFor, onGone: (c) => gone.push(c) }, t);
    expect(gone.map((c) => c.what)).toEqual(["moved"]);
    expect(applyPendingEventWrites([source], store.snapshot()).map((row) => row.uid)).toEqual(["ev-1"]);
  });
});

describe("a new series shows what the sync will show (issue 119)", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");

  it("a yearly event that started years ago shows this year's occurrence", () => {
    expect.hasAssertions();
    const birthday: PimEventCreate = { title: "Birthday", start: { ts: Date.parse("2000-05-10T00:00:00Z"), date: "2000-05-10" }, end: { ts: Date.parse("2000-05-11T00:00:00Z"), date: "2000-05-11" }, allDay: true, recurrence: { freq: "yearly", interval: 1 }, createAs: "plainva-bday" };
    const change = createChange({ ...draftToRow("a1", CAL, "plainva-bday", birthday), href: `${CAL}plainva-bday.ics` }, birthday, now);
    const may = applyPendingEventWrites([], [{ ...change, id: 1, state: "settled" }], { startTs: Date.parse("2027-05-01T00:00:00Z"), endTs: Date.parse("2027-06-01T00:00:00Z") });
    expect(may).toHaveLength(1);
  });

  it("no occurrence beyond the window the sync fetches", () => {
    expect.hasAssertions();
    const later = now + 300 * DAY;
    const series: PimEventCreate = { ...weekly, start: { ts: later }, end: { ts: later + 30 * 60_000 }, createAs: "plainva-later" };
    const change = createChange({ ...draftToRow("a1", CAL, "plainva-later", series), href: `${CAL}plainva-later.ics` }, series, now);
    expect(change.occurrences!.every((row) => row.start.ts < now + 400 * DAY)).toBe(true);
    expect(change.occurrences!.length).toBeGreaterThan(0);
  });
});
