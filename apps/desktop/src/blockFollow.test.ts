import { describe, expect, it } from "vitest";
import { PimConflictError, PimRequestError, type IPimTarget, type PimBlockRef, type PimEventDraft, type PimEventLinks, type PimEventRef, type PimEventRow } from "@plainva/core";
import {
  PendingEventWrites,
  applyPendingEventWrites,
  blockerRowsOf,
  deleteEventWithBlockers,
  detachBlockerAndUpdate,
  linkCalendarBlocks,
  mayChangeEvent,
  recordBlockers,
  resolveBlockers,
  runCalendarBlocks,
  sourceDraftFromBlockerEdit,
  sourceOfBlocker,
  undoDraftFor,
  updateEventWithBlockers,
  type BlockFollowDeps,
} from "@plainva/ui";

/**
 * Blockers follow their event (K3, plan Befunde 2026-10-06) — the shared rule
 * both shells call, against a stood-in provider.
 *
 * Before: a blocker knew its event and nothing followed from that. Move the
 * event and the blockers stood where they were, delete it and they stayed, and
 * a blocker in a calendar that is not shown could not even be found.
 */

const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-06T13:00:00Z");

function row(accountId: string, calendarId: string, uid: string, extra: Partial<PimEventRow> = {}): PimEventRow {
  return { accountId, calendarId, uid, title: uid, start: { ts: T0 }, end: { ts: T0 + HOUR }, allDay: false, etag: `"${uid}-1"`, ...extra };
}

type Call =
  | { what: "update"; accountId: string; ref: PimEventRef; draft: PimEventDraft }
  | { what: "delete"; accountId: string; ref: PimEventRef }
  | { what: "create"; accountId: string; calendarId: string; draft: PimEventDraft }
  | { what: "link"; accountId: string; ref: PimEventRef; links: PimEventLinks };

/** A provider world: every write is recorded; `fail` decides what one of them answers. */
function world(cache: PimEventRow[], options: { fail?: (call: Call) => unknown; canLink?: boolean } = {}) {
  const calls: Call[] = [];
  const store = new PendingEventWrites();
  let created = 0;
  const answer = (call: Call) => {
    calls.push(call);
    const error = options.fail?.(call);
    if (error) throw error;
  };
  const target = (accountId: string): IPimTarget =>
    ({
      provider: "google",
      updateEvent: async (ref: PimEventRef, draft: PimEventDraft) => {
        answer({ what: "update", accountId, ref, draft });
        return { etag: '"next"' };
      },
      deleteEvent: async (ref: PimEventRef) => answer({ what: "delete", accountId, ref }),
      createEvent: async (calendarId: string, draft: PimEventDraft) => {
        answer({ what: "create", accountId, calendarId, draft });
        return { uid: `created-${++created}`, etag: '"c"' };
      },
      ...(options.canLink === false
        ? {}
        : {
            linkEvent: async (ref: PimEventRef, links: PimEventLinks) => {
              answer({ what: "link", accountId, ref, links });
              return {};
            },
          }),
    }) as unknown as IPimTarget;
  const deps: BlockFollowDeps = {
    targets: { targetFor: async (accountId) => target(accountId) },
    // Deliberately sloppy, like the E2E mock of the database: it answers with
    // every row. What points at an event is the rule's decision, not the query's.
    blockersOf: async () => cache,
    eventsByUid: async () => cache,
    busyLabel: "Busy",
    store,
  };
  const updates = () => calls.filter((c): c is Extract<Call, { what: "update" }> => c.what === "update");
  return { deps, calls, store, updates };
}

const moved = (source: PimEventRow, by = 2 * HOUR): PimEventDraft => ({
  title: source.title,
  allDay: false,
  start: { ts: source.start.ts + by },
  end: { ts: source.end.ts + by },
  location: source.location,
});

const source = row("work", "cal-work", "src", { title: "Board meeting", location: "Room 5" });
const busy = row("home", "cal-private", "blk-busy", { title: "Busy", blockOf: "src" });
const details = row("home", "cal-family", "blk-details", { title: "Board meeting", location: "Room 5", blockOf: "src" });
const stranger = row("home", "cal-private", "lunch", { title: "Lunch" });

describe("an event is moved", () => {
  it("takes its blockers along: the time always, title and place only 'with details'", async () => {
    const w = world([source, busy, details, stranger]);
    const draft = { ...moved(source), title: "Board meeting (moved)", location: "Room 7" };
    const out = await updateEventWithBlockers(w.deps, source, draft, { loaded: [source, busy, details, stranger] });

    expect(out.kind).toBe("written");
    expect(out.blockers.followed.map((ref) => ref.uid).sort()).toEqual(["blk-busy", "blk-details"]);
    expect(out.blockers.failed).toEqual([]);

    const byUid = new Map(w.updates().map((call) => [call.ref.uid, call]));
    expect([...byUid.keys()].sort()).toEqual(["blk-busy", "blk-details", "src"]);
    // "Busy" keeps what it says and moves.
    expect(byUid.get("blk-busy")!.draft).toMatchObject({ title: "Busy", start: draft.start, end: draft.end, location: undefined });
    // The copy with details mirrors title and place too.
    expect(byUid.get("blk-details")!.draft).toMatchObject({ title: "Board meeting (moved)", location: "Room 7", start: draft.start, end: draft.end });
    // A blocker keeps pointing where it pointed: no link is rewritten in place.
    expect(byUid.get("blk-busy")!.draft).not.toHaveProperty("blockOf");
    // And the unrelated event in the same calendar was never touched.
    expect(byUid.has("lunch")).toBe(false);
  });

  it("is on screen with its blockers before anything is awaited", () => {
    const w = world([source, busy, details]);
    const loaded = [source, busy, details];
    void updateEventWithBlockers(w.deps, source, moved(source), { loaded });
    // No await has run: the overlay already holds all three.
    const shown = applyPendingEventWrites(loaded, w.store.snapshot());
    expect(shown.map((r) => [r.uid, r.start.ts, r.pending])).toEqual([
      ["src", T0 + 2 * HOUR, true],
      ["blk-busy", T0 + 2 * HOUR, true],
      ["blk-details", T0 + 2 * HOUR, true],
    ]);
  });

  it("writes the list of its blockers onto the event — so blockers from before the list existed are found from then on", async () => {
    const w = world([source, busy, details]);
    await updateEventWithBlockers(w.deps, source, moved(source), { loaded: [] });
    const written = w.updates().find((call) => call.ref.uid === "src")!.draft.blocks!;
    expect(written.map((ref) => [ref.accountId, ref.calendarId, ref.uid, ref.mode])).toEqual([
      ["home", "cal-private", "blk-busy", "busy"],
      ["home", "cal-family", "blk-details", "details"],
    ]);
  });

  it("an event without blockers is written exactly as it always was", async () => {
    const w = world([source, stranger]);
    const draft = moved(source);
    const out = await updateEventWithBlockers(w.deps, source, draft, { loaded: [source, stranger] });
    expect(w.calls).toHaveLength(1);
    expect(w.updates()[0].draft).toBe(draft);
    expect(out.blockers).toEqual({ followed: [], failed: [] });
  });

  it("reaches a blocker in a calendar that is not shown — through the event's own list", async () => {
    const hidden: PimBlockRef = { accountId: "home", calendarId: "cal-hidden", uid: "blk-hidden", href: "https://dav/hidden/blk.ics", mode: "busy" };
    const listed = { ...source, blocks: [hidden] };
    // The cache holds nothing of the hidden calendar.
    const w = world([listed]);
    const out = await updateEventWithBlockers(w.deps, listed, moved(listed), { loaded: [listed] });
    expect(out.blockers.followed).toEqual([hidden]);
    const call = w.updates().find((c) => c.ref.uid === "blk-hidden")!;
    expect(call.accountId).toBe("home");
    // No row, so no etag — and the href CalDAV needs comes from the list.
    expect(call.ref).toEqual({ calendarId: "cal-hidden", uid: "blk-hidden", etag: undefined, href: "https://dav/hidden/blk.ics" });
    expect(call.draft.title).toBe("Busy");
    // The list was right already: the event is written without repeating it.
    expect(w.updates().find((c) => c.ref.uid === "src")!.draft).not.toHaveProperty("blocks");
  });

  it("leaves a detached blocker alone and takes it off the list", async () => {
    const detached = { ...busy, blockOf: undefined };
    const listed = { ...source, blocks: [{ accountId: "home", calendarId: "cal-private", uid: "blk-busy", mode: "busy" as const }] };
    const w = world([listed, detached]);
    const out = await updateEventWithBlockers(w.deps, listed, moved(listed), { loaded: [listed, detached] });
    expect(out.blockers.followed).toEqual([]);
    expect(w.updates().map((c) => c.ref.uid)).toEqual(["src"]);
    expect(w.updates()[0].draft.blocks).toEqual([]);
  });

  it("passes over a blocker that was deleted elsewhere, without a word", async () => {
    const w = world([source, busy, details], { fail: (call) => (call.what === "update" && call.ref.uid === "blk-busy" ? new PimRequestError("gone", 404) : null) });
    const out = await updateEventWithBlockers(w.deps, source, moved(source), { loaded: [source, busy, details] });
    expect(out.blockers.followed.map((ref) => ref.uid)).toEqual(["blk-details"]);
    expect(out.blockers.failed).toEqual([]);
  });

  it("names a blocker the provider would not change, and puts it back on screen where it is", async () => {
    const w = world([source, busy, details], { fail: (call) => (call.what === "update" && call.ref.uid === "blk-busy" ? new PimRequestError("403 Forbidden", 403) : null) });
    const loaded = [source, busy, details];
    const out = await updateEventWithBlockers(w.deps, source, moved(source), { loaded });
    expect(out.blockers.followed.map((ref) => ref.uid)).toEqual(["blk-details"]);
    expect(out.blockers.failed.map((f) => [f.ref.uid, f.status, f.reason])).toEqual([["blk-busy", 403, "403 Forbidden"]]);
    const shown = applyPendingEventWrites(loaded, w.store.snapshot());
    expect(shown.find((r) => r.uid === "blk-busy")!.start.ts).toBe(T0);
    expect(shown.find((r) => r.uid === "blk-details")!.start.ts).toBe(T0 + 2 * HOUR);
  });

  it("does not let a stale etag stop a mirror: the write is repeated without the guard", async () => {
    let first = true;
    const w = world([source, busy], {
      fail: (call) => {
        if (call.what !== "update" || call.ref.uid !== "blk-busy" || !first) return null;
        first = false;
        return new PimConflictError();
      },
    });
    const out = await updateEventWithBlockers(w.deps, source, moved(source), { loaded: [source, busy] });
    expect(out.blockers.followed.map((ref) => ref.uid)).toEqual(["blk-busy"]);
    expect(w.updates().filter((c) => c.ref.uid === "blk-busy").map((c) => c.ref.etag)).toEqual(['"blk-busy-1"', undefined]);
  });

  it("moves nothing when the event itself was changed elsewhere first", async () => {
    const w = world([source, busy], { fail: (call) => (call.what === "update" && call.ref.uid === "src" ? new PimConflictError() : null) });
    const out = await updateEventWithBlockers(w.deps, source, moved(source), { loaded: [source, busy] });
    expect(out.kind).toBe("conflict");
    expect(w.updates().map((c) => c.ref.uid)).toEqual(["src"]);
    expect(w.store.snapshot()).toEqual([]);
  });

  it("moves nothing when the event's write is refused, and says so", async () => {
    const w = world([source, busy], { fail: (call) => (call.what === "update" && call.ref.uid === "src" ? new PimRequestError("500", 500) : null) });
    await expect(updateEventWithBlockers(w.deps, source, moved(source), { loaded: [source, busy] })).rejects.toThrow("500");
    expect(w.updates().map((c) => c.ref.uid)).toEqual(["src"]);
    expect(w.store.snapshot()).toEqual([]);
  });
});

describe("an event changes its calendar", () => {
  it("gets a new id there — and its blockers are told", async () => {
    const w = world([source, busy, details]);
    const out = await updateEventWithBlockers(w.deps, source, moved(source, 0), { moveTo: { accountId: "work", calendarId: "cal-other" }, loaded: [source, busy, details] });
    expect(out.kind).toBe("written");
    const create = w.calls.find((c): c is Extract<Call, { what: "create" }> => c.what === "create")!;
    expect(create.calendarId).toBe("cal-other");
    // The copy carries the list from its first moment.
    expect(create.draft.blocks!.map((ref) => ref.uid)).toEqual(["blk-busy", "blk-details"]);
    expect(w.calls.some((c) => c.what === "delete" && c.ref.uid === "src")).toBe(true);
    // Before, every blocker went on naming an id that no longer existed.
    expect(w.updates().map((c) => [c.ref.uid, c.draft.blockOf])).toEqual([
      ["blk-busy", "created-1"],
      ["blk-details", "created-1"],
    ]);
  });
});

describe("a series", () => {
  const master = row("work", "cal-work", "series", { title: "Standup", recurrence: "RRULE:FREQ=DAILY" });
  const occ = (n: number) => row("work", "cal-work", `series_${n}`, { title: "Standup", seriesMaster: "series", start: { ts: T0 + n * 24 * HOUR }, end: { ts: T0 + n * 24 * HOUR + HOUR } });
  const blkMaster = row("home", "cal-private", "blk-series", { title: "Busy", blockOf: "series", recurrence: "RRULE:FREQ=DAILY" });
  const blkOcc = (n: number) =>
    row("home", "cal-private", `blk-series_${n}`, { title: "Busy", blockOf: "series", seriesMaster: "blk-series", start: { ts: T0 + n * 24 * HOUR }, end: { ts: T0 + n * 24 * HOUR + HOUR } });
  const cache = [master, occ(0), occ(1), occ(2), blkMaster, blkOcc(0), blkOcc(1), blkOcc(2)];

  it("'only this event' moves the blocker occurrence of the same day, and no other", async () => {
    const w = world(cache);
    const out = await updateEventWithBlockers(w.deps, occ(1), moved(occ(1)), { loaded: [occ(0), occ(1), occ(2), blkOcc(0), blkOcc(1), blkOcc(2)] });
    expect(out.blockers.followed.map((ref) => ref.uid)).toEqual(["blk-series_1"]);
    expect(w.updates().map((c) => c.ref.uid)).toEqual(["series_1", "blk-series_1"]);
    // The list belongs to the series: an occurrence is never given one.
    expect(w.updates()[0].draft).not.toHaveProperty("blocks");
  });

  it("'all events' moves the blocker series at its master, rule included", async () => {
    const w = world(cache);
    const draft: PimEventDraft = { ...moved(master), recurrence: { freq: "weekly" } };
    const out = await updateEventWithBlockers(w.deps, master, draft, { loaded: [] });
    expect(out.blockers.followed.map((ref) => ref.uid)).toEqual(["blk-series"]);
    const call = w.updates().find((c) => c.ref.uid === "blk-series")!;
    expect(call.draft).toMatchObject({ title: "Busy", start: draft.start, recurrence: { freq: "weekly" } });
    expect(w.updates().find((c) => c.ref.uid === "series")!.draft.blocks!.map((ref) => ref.uid)).toEqual(["blk-series"]);
  });

  it("says so when the blocker series lies in a calendar that is not shown: an occurrence there has no id to write against", async () => {
    const listedMaster = { ...master, blocks: [{ accountId: "home", calendarId: "cal-hidden", uid: "blk-far", mode: "busy" as const }] };
    const w = world([listedMaster, occ(0), occ(1)]);
    const out = await updateEventWithBlockers(w.deps, occ(1), moved(occ(1)), { loaded: [occ(0), occ(1)] });
    expect(out.blockers.followed).toEqual([]);
    expect(out.blockers.failed.map((f) => [f.ref.uid, f.hidden])).toEqual([["blk-far", true]]);
  });

  it("stays silent about a blocker occurrence that was moved on its own before", async () => {
    const strayed = { ...blkOcc(1), start: { ts: T0 + 30 * HOUR }, end: { ts: T0 + 31 * HOUR } };
    const listedMaster = { ...master, blocks: [{ accountId: "home", calendarId: "cal-private", uid: "blk-series", mode: "busy" as const }] };
    const w = world([listedMaster, occ(1), blkMaster, blkOcc(0), strayed]);
    const out = await updateEventWithBlockers(w.deps, occ(1), moved(occ(1)), { loaded: [occ(1), strayed] });
    expect(out.blockers).toEqual({ followed: [], failed: [] });
  });

  it("tells the blockers of one event apart from those of its series", () => {
    expect(blockerRowsOf(occ(1), cache).map((r) => r.uid)).toEqual(["blk-series_1"]);
    expect(blockerRowsOf(master, cache).map((r) => r.uid)).toEqual(["blk-series"]);
    expect(blockerRowsOf(source, [busy, details, blkMaster]).map((r) => r.uid)).toEqual(["blk-busy", "blk-details"]);
  });
});

describe("an event is deleted", () => {
  it("takes its blockers with it where the box stayed ticked", async () => {
    const w = world([source, busy, details]);
    const { blockers } = await resolveBlockers(w.deps, source, [source, busy, details]);
    expect(blockers).toHaveLength(2);
    const report = await deleteEventWithBlockers(w.deps, source, blockers);
    expect(w.calls.filter((c) => c.what === "delete").map((c) => c.ref.uid)).toEqual(["src", "blk-busy", "blk-details"]);
    expect(report.followed.map((ref) => ref.uid)).toEqual(["blk-busy", "blk-details"]);
    // All three are gone from view until the cache agrees.
    expect(applyPendingEventWrites([source, busy, details], w.store.snapshot())).toEqual([]);
  });

  it("leaves them standing where it was unticked", async () => {
    const w = world([source, busy, details]);
    const report = await deleteEventWithBlockers(w.deps, source, []);
    expect(w.calls.map((c) => [c.what, c.what === "delete" ? c.ref.uid : ""])).toEqual([["delete", "src"]]);
    expect(report).toEqual({ followed: [], failed: [] });
  });

  it("names a blocker that could not be deleted, and it comes back into view", async () => {
    const w = world([source, busy, details], { fail: (call) => (call.what === "delete" && call.ref.uid === "blk-details" ? new PimRequestError("403", 403) : null) });
    const { blockers } = await resolveBlockers(w.deps, source, []);
    const report = await deleteEventWithBlockers(w.deps, source, blockers);
    expect(report.failed.map((f) => f.ref.uid)).toEqual(["blk-details"]);
    expect(applyPendingEventWrites([source, busy, details], w.store.snapshot()).map((r) => r.uid)).toEqual(["blk-details"]);
  });

  it("deletes nothing else when the event's own delete is refused", async () => {
    const w = world([source, busy], { fail: (call) => (call.what === "delete" && call.ref.uid === "src" ? new PimRequestError("500", 500) : null) });
    const { blockers } = await resolveBlockers(w.deps, source, []);
    await expect(deleteEventWithBlockers(w.deps, source, blockers)).rejects.toThrow("500");
    expect(w.calls.filter((c) => c.what === "delete").map((c) => c.ref.uid)).toEqual(["src"]);
    expect(w.store.snapshot()).toEqual([]);
  });

  it("a deleted blocker leaves its event's list", async () => {
    const listed = { ...source, blocks: [{ accountId: "home", calendarId: "cal-private", uid: "blk-busy", mode: "busy" as const }, { accountId: "home", calendarId: "cal-family", uid: "blk-details" }] };
    const w = world([listed, busy, details]);
    await deleteEventWithBlockers(w.deps, busy, []);
    const link = w.calls.find((c): c is Extract<Call, { what: "link" }> => c.what === "link")!;
    expect(link.ref.uid).toBe("src");
    expect(link.links.blocks!.map((ref) => ref.uid)).toEqual(["blk-details"]);
  });
});

describe("a blocker is moved or changed", () => {
  it("finds the event it mirrors — and none for an entry whose event is gone", async () => {
    const w = world([source, busy, details]);
    expect((await sourceOfBlocker(w.deps, busy))?.uid).toBe("src");
    expect(await sourceOfBlocker(w.deps, stranger)).toBeNull();
    expect(await sourceOfBlocker(world([busy]).deps, busy)).toBeNull();
  });

  it("finds the occurrence a blocker occurrence mirrors", async () => {
    const occ = row("work", "cal-work", "series_1", { seriesMaster: "series", start: { ts: T0 + 24 * HOUR }, end: { ts: T0 + 25 * HOUR } });
    const other = row("work", "cal-work", "series_2", { seriesMaster: "series", start: { ts: T0 + 48 * HOUR }, end: { ts: T0 + 49 * HOUR } });
    const blk = row("home", "cal-private", "blk_1", { blockOf: "series", seriesMaster: "blk", start: { ts: T0 + 24 * HOUR }, end: { ts: T0 + 25 * HOUR } });
    expect((await sourceOfBlocker(world([other, occ, blk]).deps, blk))?.uid).toBe("series_1");
  });

  it("'move the event': the event takes the blocker's new time, never a Busy blocker's title", () => {
    const edit: PimEventDraft = { ...moved(busy), title: "Busy (renamed)", location: "Elsewhere" };
    expect(sourceDraftFromBlockerEdit(source, busy, edit)).toMatchObject({ title: "Board meeting", location: "Room 5", start: edit.start, end: edit.end });
    // A copy with details is the event in another calendar: its text counts.
    const copyEdit: PimEventDraft = { ...moved(details), title: "Board meeting, new", location: "Room 9" };
    expect(sourceDraftFromBlockerEdit(source, details, copyEdit)).toMatchObject({ title: "Board meeting, new", location: "Room 9" });
  });

  it("'move the event' then moves the event and every blocker, the dragged one included", async () => {
    const w = world([source, busy, details]);
    const loaded = [source, busy, details];
    const out = await updateEventWithBlockers(w.deps, source, sourceDraftFromBlockerEdit(source, busy, moved(busy)), { loaded });
    expect(out.blockers.followed.map((ref) => ref.uid).sort()).toEqual(["blk-busy", "blk-details"]);
    expect(w.updates().map((c) => c.draft.start.ts)).toEqual([T0 + 2 * HOUR, T0 + 2 * HOUR, T0 + 2 * HOUR]);
  });

  it("'only this blocker': it is written without its link and taken off the event's list", async () => {
    const listed = { ...source, blocks: [{ accountId: "home", calendarId: "cal-private", uid: "blk-busy", mode: "busy" as const }] };
    const w = world([listed, busy]);
    const out = await detachBlockerAndUpdate(w.deps, busy, moved(busy), { source: listed });
    expect(out.kind).toBe("written");
    const update = w.updates()[0];
    expect(update.ref.uid).toBe("blk-busy");
    expect(update.draft.blockOf).toBeNull();
    // The event itself is not rewritten — only its list, through linkEvent.
    expect(w.updates()).toHaveLength(1);
    const link = w.calls.find((c): c is Extract<Call, { what: "link" }> => c.what === "link")!;
    expect([link.ref.uid, link.links]).toEqual(["src", { blocks: [] }]);
    // The loaded row loses the link at once (the row a view lays over its own).
    expect(out.kind === "written" && "blockOf" in out.rows[0] && out.rows[0].blockOf).toBe(undefined);
  });

  it("an occurrence of a blocker series is only moved: the link belongs to the series", async () => {
    const blk = row("home", "cal-private", "blk_1", { blockOf: "series", seriesMaster: "blk" });
    const w = world([blk]);
    await detachBlockerAndUpdate(w.deps, blk, moved(blk), {});
    expect(w.updates()[0].draft).not.toHaveProperty("blockOf");
    expect(w.calls).toHaveLength(1);
  });

  it("an invitation of somebody else is not the user's to move", () => {
    const writable = new Set(["work cal-work"]);
    expect(mayChangeEvent(source, writable)).toBe(true);
    expect(mayChangeEvent({ ...source, selfResponse: "accepted" }, writable)).toBe(false);
    expect(mayChangeEvent(row("work", "cal-shared", "x"), writable)).toBe(false);
  });
});

describe("the way back", () => {
  it("is the same write in reverse: the event as it was, and its blockers follow it there", async () => {
    const w = world([source, busy, details]);
    const draft = moved(source);
    const out = await updateEventWithBlockers(w.deps, source, draft, { loaded: [] });
    const back = undoDraftFor(source, draft)!;
    expect(back).toMatchObject({ title: "Board meeting", start: source.start, end: source.end, description: undefined });
    const after = { ...source, start: draft.start, end: draft.end, etag: undefined, blocks: out.blockers.followed };
    const undone = await updateEventWithBlockers(w.deps, after, back, { loaded: [] });
    expect(undone.blockers.followed.map((ref) => ref.uid).sort()).toEqual(["blk-busy", "blk-details"]);
    expect(w.updates().slice(3).map((c) => [c.ref.uid, c.draft.start.ts])).toEqual([
      ["src", T0],
      ["blk-busy", T0],
      ["blk-details", T0],
    ]);
    // The modes survive the round trip: Busy is still Busy.
    expect(w.updates().slice(3).map((c) => c.draft.title)).toEqual(["Board meeting", "Busy", "Board meeting"]);
  });

  it("is not offered where it could not be faithful", () => {
    expect(undoDraftFor(source, { ...moved(source), attendees: ["a@example.org"] })).toBeNull();
    expect(undoDraftFor(source, { ...moved(source), recurrence: { freq: "daily" } })).toBeNull();
    // A description that was written is put back; an untouched one is left to the provider.
    expect(undoDraftFor({ ...source, description: "Agenda" }, { ...moved(source), description: "New" })).toMatchObject({ description: "Agenda" });
  });
});

describe("new blockers are recorded on their event", () => {
  it("runCalendarBlocks returns what it made, with the mode", async () => {
    const w = world([]);
    const outcome = await runCalendarBlocks({
      keys: ["home cal-private"],
      labelFor: (key) => key,
      targetFor: async (accountId) => ({ target: await w.deps.targets.targetFor(accountId) }),
      draft: moved(source, 0),
      mode: "details",
    });
    expect(outcome.created).toEqual([{ accountId: "home", calendarId: "cal-private", uid: "created-1", mode: "details" }]);
  });

  it("the event's list gains them through linkEvent — nothing else about the event is written", async () => {
    const w = world([source, busy]);
    const fresh: PimBlockRef = { accountId: "home", calendarId: "cal-family", uid: "blk-new", mode: "details" };
    expect(await recordBlockers(w.deps, source, [fresh])).toBe(true);
    expect(w.calls).toHaveLength(1);
    const link = w.calls[0] as Extract<Call, { what: "link" }>;
    expect(link.what).toBe("link");
    expect(link.links.blocks!.map((ref) => ref.uid)).toEqual(["blk-busy", "blk-new"]);
  });

  it("a provider with no place for the link is left alone; the blockers still work through the cache", async () => {
    const w = world([source], { canLink: false });
    expect(await recordBlockers(w.deps, source, [{ accountId: "home", calendarId: "cal-family", uid: "blk-new" }])).toBe(false);
    expect(w.calls).toEqual([]);
  });
});

describe("the chain mark", () => {
  it("shows on an event whose blocker is loaded, and on one whose list names a blocker that is not", () => {
    const listed = { ...row("work", "cal-work", "other"), blocks: [{ accountId: "home", calendarId: "cal-hidden", uid: "far", mode: "busy" as const }] };
    const linked = linkCalendarBlocks([source, busy, listed, stranger]);
    expect(linked.find((r) => r.uid === "src")!.blockedIn).toEqual([{ accountId: "home", calendarId: "cal-private", uid: "blk-busy" }]);
    expect(linked.find((r) => r.uid === "other")!.blockedIn).toEqual([{ accountId: "home", calendarId: "cal-hidden", uid: "far" }]);
    expect(linked.find((r) => r.uid === "lunch")!.blockedIn).toBeUndefined();
    expect(linked.find((r) => r.uid === "blk-busy")!.blockedIn).toBeUndefined();
  });

  it("shows on the occurrences of a series that has a blocker series", () => {
    const occ = row("work", "cal-work", "series_1", { seriesMaster: "series" });
    const blk = row("home", "cal-private", "blk_1", { blockOf: "series", seriesMaster: "blk" });
    expect(linkCalendarBlocks([occ, blk])[0].blockedIn).toEqual([{ accountId: "home", calendarId: "cal-private", uid: "blk_1" }]);
  });
});
