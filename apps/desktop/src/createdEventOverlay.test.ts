import { describe, expect, it, vi } from "vitest";
import { CalDavPimTarget, expandEventDraft, expandIcsEvents, NOT_SHOWN_YET_MS, PimNotShownYetError, type FetchFn, type PimAccountRow, type PimCalendar, type PimEventCreate, type PimEventRow } from "@plainva/core";

const bus = vi.hoisted(() => ({ request: (() => Promise.reject(new Error("no bus"))) as unknown }));
vi.mock("./services/windowBus", () => ({ getWindowBus: async () => bus }));

import { createRemotePimTarget } from "./services/pim/remotePimTarget";
import { loadEventBackdrop } from "./services/pim/eventBackdrop";
import i18n from "@plainva/ui/i18n";
import {
  applyPendingEventWrites,
  CREATED_EVENT_ASK_EVERY_MS,
  reportCreatedEventGone,
  settleCreatedEvents,
  toast,
  updateEventWithBlockers,
  watchCreatedEvents,
  createCalendarEvent,
  createChange,
  draftToRow,
  isPendingEventUid,
  pendingEventRow,
  PendingEventWrites,
  SETTLED_EVENT_WRITE_TTL_MS,
  writeEventOptimistically,
  eventWriteRefusalText,
  errorText,
  formCreateTries,
  listShownEvents,
  pendingEventWrites,
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
    createChange(pendingEventRow(id, shown), draft, expandEventDraft),
    () => createCalendarEvent(targets, "a1", CAL, draft),
    (written) => written.rows.map((row) => createChange(row, draft, expandEventDraft)),
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
    store.begin(createChange(pendingEventRow(id, shown), weekly, expandEventDraft), id);
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
    const change = createChange(google, weekly, expandEventDraft);
    expect(change.occurrences?.length).toBeGreaterThan(0);
    expect(change.occurrences!.every((row) => isPendingEventUid(row.uid) && row.seriesMaster === "evt123")).toBe(true);
  });

  it("without the expansion (a caller that does not load the calendar), a series is drawn as its first occurrence - nothing written differs", () => {
    expect.hasAssertions();
    expect(createChange(draftToRow("a1", CAL, "u1", weekly), weekly).occurrences).toBeUndefined();
  });

  it("a single event stays one row", () => {
    expect.hasAssertions();
    const single = { ...weekly, recurrence: undefined };
    expect(createChange(draftToRow("a1", CAL, "u1", single), single, expandEventDraft).occurrences).toBeUndefined();
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
    // From the end of the target's own patience on, every "no" counts.
    const T = NOT_SHOWN_YET_MS;
    for (const t of [T, T + 1, T + ASK, T + 2 * ASK, T + 3 * ASK]) await settleCreatedEvents(store, deps, t);
    // asked at T (no), T+ASK (yes), T+2·ASK (no), T+3·ASK (no): two in a row, not three.
    expect(asked).toHaveBeenCalledTimes(4);
    expect(gone).toEqual([]);
    await settleCreatedEvents(store, deps, T + 4 * ASK);
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

  it("names what was lost, word for word: a new event with 'Try again'; a moved event and a blocker without", () => {
    expect.hasAssertions();
    const error = vi.spyOn(toast, "error").mockImplementation(() => 0);
    const store = new PendingEventWrites();
    reportCreatedEventGone(store, { targetFor: async () => null }, createChange(created, single));
    reportCreatedEventGone(store, { targetFor: async () => null }, { kind: "create", row: created, what: "moved" });
    reportCreatedEventGone(store, { targetFor: async () => null }, { kind: "create", row: created, what: "blocker" });
    expect(error.mock.calls.map((call) => [call[0], call[1]?.label ?? null])).toEqual([
      [i18n.t("pim.eventCreateLost", { title: "Team sync" }), i18n.t("pim.eventWriteRetry")],
      [i18n.t("pim.eventMoveLost", { title: "Team sync" }), null],
      [i18n.t("pim.blockerCreateLost", { title: "Team sync" }), null],
    ]);
    expect(new Set(error.mock.calls.map((call) => call[0])).size).toBe(3);
    error.mockRestore();
  });

  it("the copy a move made is named a moved event, and is reported only after the provider's third 'no' for its id", async () => {
    expect.hasAssertions();
    const source = { ...created, calendarId: "old", uid: "ev-1", href: undefined } as PimEventRow;
    const copy = { ...created, uid: "plainva-copy", href: `${CAL}plainva-copy.ics` };
    const targets = { targetFor: async () => ({ provider: "caldav", createEvent: async (_c: string, d: PimEventCreate) => ({ uid: d.createAs, etag: '"c1"', href: copy.href }), deleteEvent: async () => undefined }) as never };
    const store = new PendingEventWrites();
    const deps = { targets, blockersOf: async () => [], eventsByUid: async () => [], busyLabel: "Busy", store };
    await updateEventWithBlockers(deps, source, { ...single, recurrence: undefined }, { moveTo: { accountId: "a1", calendarId: CAL } });
    const [write] = store.settledCreates();
    expect(write?.what).toBe("moved");
    const gone: CreatedEventChange[] = [];
    const asked: Array<{ uid: string }> = [];
    const targetFor = async () => ({ provider: "caldav", eventExists: async (ref: { uid: string }) => (asked.push(ref), false) }) as never;
    for (const t of [NOT_SHOWN_YET_MS, NOT_SHOWN_YET_MS + ASK]) await settleCreatedEvents(store, { cache: cache(), targetFor, onGone: (c) => gone.push(c) }, write!.settledAt + t);
    expect(gone).toEqual([]);
    await settleCreatedEvents(store, { cache: cache(), targetFor, onGone: (c) => gone.push(c) }, write!.settledAt + NOT_SHOWN_YET_MS + 2 * ASK);
    expect(gone.map((c) => [c.what, c.row.uid])).toEqual([["moved", write!.row.uid]]);
    expect(asked.every((ref) => ref.uid === write!.row.uid)).toBe(true);
  });

  it("a cache that cannot be read is no evidence: the event stays, nobody is asked, nothing is said", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    settledNew(store);
    const gone: CreatedEventChange[] = [];
    const { asked, targetFor } = asking([false, false, false, false]);
    const broken = { ...cache(), findEventsByUid: async () => Promise.reject(new Error("database is locked")) };
    for (const t of [ASK, 2 * ASK, 3 * ASK, 4 * ASK]) await settleCreatedEvents(store, { cache: broken, targetFor, onGone: (c) => gone.push(c) }, t);
    expect(asked).not.toHaveBeenCalled();
    expect(gone).toEqual([]);
    expect(shownNow(store)).toHaveLength(1);
  });
});

describe("a new series shows what the sync will show (issue 119)", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");

  it("a yearly event that started years ago shows this year's occurrence", () => {
    expect.hasAssertions();
    const birthday: PimEventCreate = { title: "Birthday", start: { ts: Date.parse("2000-05-10T00:00:00Z"), date: "2000-05-10" }, end: { ts: Date.parse("2000-05-11T00:00:00Z"), date: "2000-05-11" }, allDay: true, recurrence: { freq: "yearly", interval: 1 }, createAs: "plainva-bday" };
    const change = createChange({ ...draftToRow("a1", CAL, "plainva-bday", birthday), href: `${CAL}plainva-bday.ics` }, birthday, expandEventDraft, now);
    const may = applyPendingEventWrites([], [{ ...change, id: 1, state: "settled" }], { startTs: Date.parse("2027-05-01T00:00:00Z"), endTs: Date.parse("2027-06-01T00:00:00Z") });
    expect(may).toHaveLength(1);
  });

  it("no occurrence beyond the window the sync fetches", () => {
    expect.hasAssertions();
    const later = now + 300 * DAY;
    const series: PimEventCreate = { ...weekly, start: { ts: later }, end: { ts: later + 30 * 60_000 }, createAs: "plainva-later" };
    const change = createChange({ ...draftToRow("a1", CAL, "plainva-later", series), href: `${CAL}plainva-later.ics` }, series, expandEventDraft, now);
    expect(change.occurrences!.every((row) => row.start.ts < now + 400 * DAY)).toBe(true);
    expect(change.occurrences!.length).toBeGreaterThan(0);
  });
});

describe("a round of the watch outlives nothing (issue 119)", () => {
  const single: PimEventCreate = { title: "Probe one", start: { ts: 1 }, end: { ts: 2 }, allDay: false, createAs: "plainva-s1" };
  const created = { ...draftToRow("a1", CAL, "plainva-s1", single), href: `${CAL}plainva-s1.ics` };
  const vault = () => ({
    findEventsByUid: async () => [],
    listAccounts: async () => [{ id: "a1", enabled: true } as PimAccountRow],
    listCalendars: async () => [{ accountId: "a1", id: CAL, selected: true } as PimCalendar & { accountId: string; selected: boolean }],
  });

  it("a vault left while the provider is asked: no message, no change to the overlay", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    store.settle(store.begin(createChange(created, single)), undefined, 0);
    const id = store.settledCreates()[0]!.id;
    store.markAsked(id, 1, true);
    store.markAsked(id, 2, true);
    let live = true;
    let answer!: (held: boolean) => void;
    const asked = new Promise<boolean>((resolve) => (answer = resolve));
    const gone: CreatedEventChange[] = [];
    const round = settleCreatedEvents(store, { cache: vault(), targetFor: async () => ({ provider: "caldav", eventExists: () => asked }) as never, onGone: (c) => gone.push(c), current: () => live }, 60 * 60_000);
    await vi.waitFor(() => expect(answer).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 0));
    live = false; // the vault is left
    answer(false); // the third "no"
    await round;
    expect(gone).toEqual([]);
    expect(store.settledCreates()[0]!.denials).toBe(2);
  });

  it("the overlay emptied while the provider is asked (the vault left): the round says nothing about what is gone", async () => {
    expect.hasAssertions();
    const error = vi.spyOn(toast, "error").mockImplementation(() => 0);
    const store = new PendingEventWrites();
    store.settle(store.begin(createChange(created, single)), undefined, 0);
    const id = store.settledCreates()[0]!.id;
    store.markAsked(id, 1, true);
    store.markAsked(id, 2, true);
    let answer!: (held: boolean) => void;
    const asked = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const round = settleCreatedEvents(store, { cache: vault(), targetFor: async () => ({ provider: "caldav", eventExists: asked }) as never }, 60 * 60_000);
    await vi.waitFor(() => expect(asked).toHaveBeenCalled());
    store.clear();
    answer(false);
    await round;
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("the message is not shown for a vault that was left, and its 'Try again' creates nothing once the vault is left", () => {
    expect.hasAssertions();
    const error = vi.spyOn(toast, "error").mockImplementation(() => 0);
    const createEvent = vi.fn();
    const store = new PendingEventWrites();
    let live = false;
    reportCreatedEventGone(store, { targetFor: async () => ({ createEvent }) as never, current: () => live }, createChange(created, single));
    expect(error).not.toHaveBeenCalled();
    live = true;
    reportCreatedEventGone(store, { targetFor: async () => ({ createEvent }) as never, current: () => live }, createChange(created, single));
    live = false;
    error.mock.calls[0]![1]!.run();
    expect(createEvent).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual([]);
    error.mockRestore();
  });

  it("stopping the watch ends a round in flight", async () => {
    expect.hasAssertions();
    vi.useFakeTimers({ now: 60 * 60_000 });
    try {
      const store = new PendingEventWrites();
      store.settle(store.begin(createChange(created, single)), undefined, 0);
      const id = store.settledCreates()[0]!.id;
      store.markAsked(id, 1, true);
      store.markAsked(id, 2, true);
      let answer!: (held: boolean) => void;
      const gone: CreatedEventChange[] = [];
      const stop = watchCreatedEvents(store, { cache: vault(), targetFor: async () => ({ provider: "caldav", eventExists: () => new Promise<boolean>((r) => (answer = r)) }) as never, onGone: (c) => gone.push(c) });
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => expect(answer).toBeDefined());
      stop();
      answer(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(gone).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a row in the cache with the same id in ANOTHER calendar is not this event: it is still asked about", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    store.settle(store.begin(createChange(created, single)), undefined, 0);
    const asked = vi.fn(async () => true);
    const cache = { ...vault(), findEventsByUid: async () => [{ ...created, calendarId: "elsewhere" }] };
    await settleCreatedEvents(store, { cache, targetFor: async () => ({ provider: "caldav", eventExists: asked }) as never, onGone: () => undefined }, 60 * 60_000);
    expect(asked).toHaveBeenCalledTimes(1);
    expect(store.settledCreates()).toHaveLength(1);
  });
});

describe("a change to a new event the provider does not show yet says so in the reader's words (issue 119)", () => {
  it("the event IS saved: the sentence says the change was not, or that nothing was deleted - also when only the message crossed a window", () => {
    expect.hasAssertions();
    for (const [what, action, key] of [
      ["event", "change", "pim.notShownYetEventChange"],
      ["event", "delete", "pim.notShownYetEventDelete"],
      ["task", "change", "pim.notShownYetTaskChange"],
      ["task", "delete", "pim.notShownYetTaskDelete"],
    ] as const) {
      const error = new PimNotShownYetError(what, action);
      expect(eventWriteRefusalText(error, action === "delete" ? "delete" : "save")).toBe(i18n.t(key));
      expect(eventWriteRefusalText(new Error(error.message), "save")).toBe(i18n.t(key));
    }
    expect(eventWriteRefusalText(new Error("caldav update 500"), "save")).toBe(i18n.t("pim.eventWriteRefused", { reason: "caldav update 500" }));
  });
});

describe("every surface reads the events on their way the same way (issue 119)", () => {
  const created = { accountId: "a1", calendarId: CAL, uid: "plainva-m6", title: "Team sync", start: { ts: Date.parse("2026-12-03T09:00:00Z") }, end: { ts: Date.parse("2026-12-03T10:00:00Z") }, allDay: false } as PimEventRow;
  const cache = (selected: boolean) => ({
    listEvents: async () => [] as PimEventRow[],
    listAccounts: async () => [{ id: "a1", enabled: true }],
    listCalendars: async () => [{ accountId: "a1", id: CAL, selected }],
  });
  const dec = { startTs: Date.parse("2026-12-01T00:00:00Z"), endTs: Date.parse("2027-01-01T00:00:00Z") };

  it("a created event in a shown calendar and in range is listed; hidden or out of range, it is not", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    store.settle(store.begin({ kind: "create", row: created }), undefined, 0);
    expect((await listShownEvents(cache(true), dec.startTs, dec.endTs, store)).map((r) => r.uid)).toEqual(["plainva-m6"]);
    expect(await listShownEvents(cache(false), dec.startTs, dec.endTs, store)).toEqual([]);
    expect(await listShownEvents(cache(true), dec.endTs, dec.endTs + 31 * DAY, store)).toEqual([]);
  });

  it("the desktop's database backdrop counts it, as the phone's does", async () => {
    expect.hasAssertions();
    pendingEventWrites.settle(pendingEventWrites.begin({ kind: "create", row: created }), undefined, 0);
    try {
      const days = await loadEventBackdrop({ cache: cache(true) }, 2026, 11);
      expect([...days.values()].reduce((n, d) => n + d.count, 0)).toBe(1);
    } finally {
      pendingEventWrites.clear();
    }
  });
});

describe("review 5 of issue 119: one clock, nothing after leaving, nothing drawn in doubt", () => {
  const single: PimEventCreate = { title: "Probe two", start: { ts: 1 }, end: { ts: 2 }, allDay: false, createAs: "plainva-r5" };
  const created = { ...draftToRow("a1", CAL, "plainva-r5", single), href: `${CAL}plainva-r5.ics` };
  const vault = () => ({
    findEventsByUid: async () => [],
    listAccounts: async () => [{ id: "a1", enabled: true } as PimAccountRow],
    listCalendars: async () => [{ accountId: "a1", id: CAL, selected: true } as PimCalendar & { accountId: string; selected: boolean }],
  });
  const ASK = CREATED_EVENT_ASK_EVERY_MS;

  it("a 'not there' counts only once the target no longer takes a 404 for 'not shown yet' - one clock for both", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    store.settle(store.begin(createChange(created, single)), undefined, 0);
    const gone: CreatedEventChange[] = [];
    const deps = { cache: vault(), targetFor: async () => ({ provider: "caldav", eventExists: async () => false }) as never, onGone: (c: CreatedEventChange) => gone.push(c) };
    for (let t = ASK; t < NOT_SHOWN_YET_MS; t += ASK) await settleCreatedEvents(store, deps, t);
    expect(store.settledCreates()[0]!.denials).toBe(0);
    for (const t of [NOT_SHOWN_YET_MS, NOT_SHOWN_YET_MS + ASK]) await settleCreatedEvents(store, deps, t);
    expect(gone).toEqual([]);
    await settleCreatedEvents(store, deps, NOT_SHOWN_YET_MS + 2 * ASK);
    expect(gone).toHaveLength(1);
  });

  it("a round that waits for the target when the vault is left does not ask the old provider", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    store.settle(store.begin(createChange(created, single)), undefined, 0);
    let release!: () => void;
    const built = new Promise<void>((resolve) => (release = resolve));
    const asked = vi.fn(async () => false);
    const round = settleCreatedEvents(store, { cache: vault(), targetFor: async () => (await built, { provider: "caldav", eventExists: asked }) as never, onGone: () => undefined }, NOT_SHOWN_YET_MS * 2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.clear(); // the vault is left
    release();
    await round;
    expect(asked).not.toHaveBeenCalled();
  });

  it("the watch takes its messages down with its stop: a button that can no longer act is not left standing", async () => {
    expect.hasAssertions();
    vi.useFakeTimers({ now: NOT_SHOWN_YET_MS * 4 });
    const error = vi.spyOn(toast, "error").mockImplementation(() => 77);
    const dismiss = vi.spyOn(toast, "dismiss").mockImplementation(() => undefined);
    try {
      const store = new PendingEventWrites();
      store.settle(store.begin(createChange(created, single)), undefined, 0);
      const id = store.settledCreates()[0]!.id;
      store.markAsked(id, 1, true);
      store.markAsked(id, 2, true);
      const stop = watchCreatedEvents(store, { cache: vault(), targetFor: async () => ({ provider: "caldav", eventExists: async () => false }) as never });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(error).toHaveBeenCalledTimes(1);
      stop();
      expect(dismiss).toHaveBeenCalledWith(77);
    } finally {
      error.mockRestore();
      dismiss.mockRestore();
      vi.useRealTimers();
    }
  });

  it("where the cache cannot say which calendars are shown, a created event is not drawn", async () => {
    expect.hasAssertions();
    const store = new PendingEventWrites();
    store.settle(store.begin({ kind: "create", row: { ...created, start: { ts: 10 }, end: { ts: 20 } } }), undefined, 0);
    const cache = { listEvents: async () => [] as PimEventRow[], listAccounts: async () => [{ id: "a1", enabled: true }], listCalendars: async () => Promise.reject(new Error("locked")) };
    expect(await listShownEvents(cache, 0, 100, store)).toEqual([]);
  });

  it("'Try again' names what the earlier try sent, and does nothing once the vault is left - also while the expansion loads", async () => {
    expect.hasAssertions();
    const error = vi.spyOn(toast, "error").mockImplementation(() => 0);
    const createEvent = vi.fn(async (_c: string, d: PimEventCreate) => ({ uid: d.createAs, etag: '"x"' }));
    let live = true;
    let loaded!: (expand: undefined) => void;
    const store = new PendingEventWrites();
    reportCreatedEventGone(store, { targetFor: async () => ({ provider: "caldav", createEvent }) as never, current: () => live, expand: () => new Promise((resolve) => (loaded = resolve)) }, createChange(created, single));
    error.mock.calls[0]![1]!.run();
    live = false; // left while the expansion loads
    loaded(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createEvent).not.toHaveBeenCalled();
    live = true;
    reportCreatedEventGone(store, { targetFor: async () => ({ provider: "caldav", createEvent }) as never, current: () => live }, createChange(created, single));
    error.mock.calls[1]![1]!.run();
    await vi.waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    const { createAs: _a, ...sent } = single;
    expect(createEvent.mock.calls[0]![1].createSent).toEqual([sent]);
    error.mockRestore();
  });

  it("a 'Try again' that fails after the vault was left says nothing", async () => {
    expect.hasAssertions();
    const error = vi.spyOn(toast, "error").mockImplementation(() => 0);
    let live = true;
    let fail!: (e: Error) => void;
    const createEvent = vi.fn(() => new Promise((_resolve, reject) => (fail = reject)));
    const store = new PendingEventWrites();
    reportCreatedEventGone(store, { targetFor: async () => ({ provider: "caldav", createEvent }) as never, current: () => live }, createChange(created, single));
    error.mock.calls[0]![1]!.run();
    await vi.waitFor(() => expect(createEvent).toHaveBeenCalled());
    live = false;
    fail(new Error("caldav create event: 500"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("errorText says 'not shown yet' in the reader's words too (a checkbox, a property)", () => {
    expect.hasAssertions();
    expect(errorText(new PimNotShownYetError("task", "change"))).toBe(i18n.t("pim.notShownYetTaskChange"));
  });

  it("a move whose source could not be deleted is no 'moved' event: its copy, if lost, costs nothing and is not reported", async () => {
    expect.hasAssertions();
    const source = { accountId: "a1", calendarId: "old", uid: "ev-src", etag: '"s"', title: "Planning", start: { ts: 1 }, end: { ts: 2 }, allDay: false } as PimEventRow;
    const target = { provider: "caldav", createEvent: async (_c: string, d: PimEventCreate) => ({ uid: d.createAs, etag: '"c"' }), deleteEvent: async () => Promise.reject(new Error("locked")) } as never;
    const store = new PendingEventWrites();
    await updateEventWithBlockers({ targets: { targetFor: async () => target }, blockersOf: async () => [], eventsByUid: async () => [], busyLabel: "Busy", store }, source, { ...single, createAs: undefined } as never, { moveTo: { accountId: "a1", calendarId: CAL } });
    expect(store.settledCreates().map((w) => w.what)).toEqual([undefined]);
  });

  it("the forms' tries: the first sends the draft, every later one names what the one before it sent", () => {
    expect.hasAssertions();
    const next = formCreateTries(single);
    const { createAs: _a, ...sent } = single;
    expect(next().createSent).toBeUndefined();
    expect(next().createSent).toEqual([sent]);
    // The same draft every try: one version, never a list that grows.
    expect(next().createSent).toEqual([sent]);
    expect(next().createAs).toBe("plainva-r5");
  });
});

