import { describe, expect, it, vi } from "vitest";
import {
  applyPendingEventWrites,
  isPendingEventUid,
  pendingEventRow,
  PendingEventWrites,
  SETTLED_EVENT_WRITE_TTL_MS,
  seriesDeleteSubject,
  showWrittenEvents,
  unsettledEventWrites,
  writeEventOptimistically,
} from "@plainva/ui";

const row = (uid: string, extra: Record<string, unknown> = {}) =>
  ({ accountId: "a1", calendarId: "c1", uid, title: uid, start: { ts: 1 }, end: { ts: 2 }, allDay: false, ...extra }) as any;
const ref = (uid: string) => ({ accountId: "a1", calendarId: "c1", uid });

describe("pending calendar writes (issue 119)", () => {
  it("shows a new event before the provider has answered, and marks it", async () => {
    const store = new PendingEventWrites();
    const id = store.reserve();
    const placeholder = pendingEventRow(id, row("x"));
    let answer!: (uid: string) => void;
    const provider = new Promise<string>((resolve) => (answer = resolve));

    const written = writeEventOptimistically(store, { kind: "create", row: placeholder }, () => provider, (uid) => [{ kind: "create", row: row(uid) }], id);

    const during = applyPendingEventWrites([row("old")], store.snapshot());
    expect(during.map((e) => e.uid)).toEqual(["old", `pending:${id}`]);
    expect(during[1].pending).toBe(true);
    expect(isPendingEventUid(during[1].uid)).toBe(true);

    answer("u9");
    await written;
    const after = applyPendingEventWrites([row("old")], store.snapshot());
    expect(after.map((e) => e.uid)).toEqual(["old", "u9"]);
    expect(after[1].pending).toBeUndefined();
  });

  it("takes the event back when the provider refuses, and hands the reason on", async () => {
    const store = new PendingEventWrites();
    const failing = writeEventOptimistically(store, { kind: "create", row: pendingEventRow(1, row("x")) }, async () => {
      throw new Error("quota");
    });
    expect(applyPendingEventWrites([], store.snapshot())).toHaveLength(1);
    await expect(failing).rejects.toThrow("quota");
    expect(applyPendingEventWrites([], store.snapshot())).toEqual([]);
  });

  it("is neither doubled nor swallowed by a cycle that lands while the write is settled", () => {
    const store = new PendingEventWrites();
    const id = store.begin({ kind: "create", row: pendingEventRow(7, row("x")) });
    store.settle(id, [{ kind: "create", row: row("u9") }], 1000);

    // A cycle that started before the write reloads the cache without the event: it stays.
    store.reconcile([row("old")], 2000);
    expect(applyPendingEventWrites([row("old")], store.snapshot()).map((e) => e.uid)).toEqual(["old", "u9"]);

    // The cycle that fetched it lands: the cached row is the one shown, once.
    const cached = [row("old"), row("u9", { etag: "e9" })];
    expect(applyPendingEventWrites(cached, store.snapshot()).map((e) => e.uid)).toEqual(["old", "u9"]);
    store.reconcile(cached, 3000);
    expect(store.snapshot()).toEqual([]);
  });

  it("moves, edits and deletes at once and lets go when the cache agrees", () => {
    const store = new PendingEventWrites();
    const edit = store.begin({ kind: "update", ref: ref("u1"), patch: { title: "New title", start: { ts: 50 } as any } });
    const gone = store.begin({ kind: "delete", ref: ref("u2") });

    const base = [row("u1"), row("u2")];
    const shown = applyPendingEventWrites(base, store.snapshot());
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ uid: "u1", title: "New title", start: { ts: 50 }, pending: true });

    store.settle(edit, undefined, 0);
    store.settle(gone, undefined, 0);
    // The cache still has the old state: both stay laid over it, no longer marked.
    store.reconcile(base, 10);
    expect(applyPendingEventWrites(base, store.snapshot())).toEqual([{ ...row("u1"), title: "New title", start: { ts: 50 } }]);

    store.reconcile([row("u1", { title: "New title", start: { ts: 50 } })], 20);
    expect(store.snapshot()).toEqual([]);
  });

  it("turns a move into there-now and gone-here, and a conflict into nothing", async () => {
    const store = new PendingEventWrites();
    await writeEventOptimistically(
      store,
      { kind: "update", ref: ref("u1"), patch: { calendarId: "c2" } },
      async () => "u1b",
      (uid) => [{ kind: "create", row: row(uid, { calendarId: "c2" }) }, { kind: "delete", ref: ref("u1") }],
    );
    expect(applyPendingEventWrites([row("u1")], store.snapshot())).toEqual([row("u1b", { calendarId: "c2" })]);

    const conflicted = new PendingEventWrites();
    await writeEventOptimistically(conflicted, { kind: "update", ref: ref("u1"), patch: { title: "mine" } }, async () => "conflict", () => []);
    expect(conflicted.snapshot()).toEqual([]);
  });

  it("does not leave a ghost when the provider accepted a write the cache never lists", () => {
    const writes = [{ id: 1, state: "settled" as const, settledAt: 0, kind: "create" as const, row: row("u9") }];
    expect(unsettledEventWrites([], writes, SETTLED_EVENT_WRITE_TTL_MS)).toHaveLength(1);
    expect(unsettledEventWrites([], writes, SETTLED_EVENT_WRITE_TTL_MS + 1)).toEqual([]);
  });

  it("lays over only what a patch sets: a field left undefined keeps its cached value, and the overlay lets go", () => {
    const store = new PendingEventWrites();
    const cached = [row("u1", { description: "kept", location: "Room 5" })];
    // A patch built from a draft: the description is "do not touch".
    const id = store.begin({ kind: "update", ref: ref("u1"), patch: { title: "New", description: undefined, location: undefined } });
    expect(applyPendingEventWrites(cached, store.snapshot())[0]).toMatchObject({ title: "New", description: "kept", location: "Room 5" });
    store.settle(id, undefined, 0);
    store.reconcile([row("u1", { title: "New", description: "kept", location: "Room 5" })], 10);
    expect(store.snapshot()).toEqual([]);
  });

  it("knows a created series by its occurrences: no second copy on its first day (issue 119)", () => {
    const store = new PendingEventWrites();
    const id = store.begin({ kind: "create", row: pendingEventRow(3, row("x")) });
    store.settle(id, [{ kind: "create", row: row("s1") }], 0);
    // A day query lists the occurrences, never the series' own row.
    const cached = [row("s1#20261020T090000", { seriesMaster: "s1" })];
    expect(applyPendingEventWrites(cached, store.snapshot()).map((e) => e.uid)).toEqual(["s1#20261020T090000"]);
    store.reconcile(cached, 10);
    expect(store.snapshot()).toEqual([]);
  });

  it("shows what was written outside the optimistic path until the cache has it", () => {
    const store = new PendingEventWrites();
    showWrittenEvents(store, [{ kind: "create", row: row("b1") }, { kind: "update", ref: ref("u1"), patch: { title: "Linked" } }]);
    // A reload from a cycle that started earlier: both stay.
    expect(applyPendingEventWrites([row("u1")], store.snapshot()).map((e) => [e.uid, e.title])).toEqual([
      ["u1", "Linked"],
      ["b1", "b1"],
    ]);
    store.reconcile([row("u1", { title: "Linked" }), row("b1")], 10);
    expect(store.snapshot()).toEqual([]);
  });

  it("deletes a series whose own row is not cached through its occurrence", () => {
    const caldav = row("s1#20261020T090000", { seriesMaster: "s1", href: "https://dav/cal/s1.ics", etag: '"7"' });
    expect(seriesDeleteSubject(caldav, null)).toMatchObject({ uid: "s1", href: "https://dav/cal/s1.ics", etag: '"7"', seriesMaster: undefined });
    // Another provider's occurrence carries its own etag - it is not the series'.
    expect(seriesDeleteSubject(row("g1_20261020", { seriesMaster: "g1", etag: '"o"' }), null)).toMatchObject({ uid: "g1", etag: undefined });
    const master = row("s1", { recurrence: "RRULE:FREQ=WEEKLY" });
    expect(seriesDeleteSubject(caldav, master)).toBe(master);
    expect(seriesDeleteSubject(row("single"), null)).toBeNull();
    // The device's own calendars delete a whole series by its id alone
    // (3.130 no. 3): "All events" there failed every time.
    expect(seriesDeleteSubject(row("e1@1700000000000", { seriesMaster: "e1" }), null, "device")).toMatchObject({ uid: "e1", seriesMaster: undefined, etag: undefined });
  });

  it("a series addressed through its occurrence is a series whose rule and start are not known here (R2)", () => {
    const caldav = row("s1#20261020T090000", { seriesMaster: "s1", href: "https://dav/cal/s1.ics", etag: '"7"' });
    // `RRULE` without a rule: the cache's own word for that. A delete that
    // has to judge a moved etag must not compare the occurrence's start.
    expect(seriesDeleteSubject(caldav, null)?.recurrence).toBe("RRULE");
  });

  it("a written etag reaches every row of its object that still holds the old one, and only those (R2)", () => {
    const href = "https://dav/cal/s1.ics";
    const rows = [
      row("s1#1", { seriesMaster: "s1", href, etag: '"7"' }),
      row("s1#2", { seriesMaster: "s1", href, etag: '"7"' }),
      row("other", { href: "https://dav/cal/other.ics", etag: '"7"' }),
    ];
    const writes = [{ kind: "stamp" as const, ref: ref("s1#1"), href, from: '"7"', etag: '"8"', id: 1, state: "settled" as const, settledAt: 0 }];
    expect(applyPendingEventWrites(rows, writes).map((e) => e.etag)).toEqual(['"8"', '"8"', '"7"']);
    // Without an href (Google, Microsoft) only the event itself.
    const google = [row("g1", { etag: "a" }), row("g2", { etag: "a" })];
    expect(applyPendingEventWrites(google, [{ ...writes[0], ref: ref("g1"), href: undefined, from: "a", etag: "b" }]).map((e) => e.etag)).toEqual(["b", "a"]);
  });

  it("a pull that moved the etag on is the newer word: the stamp steps aside and then leaves (R2)", () => {
    const href = "https://dav/cal/s1.ics";
    const stamp = { kind: "stamp" as const, ref: ref("s1"), href, from: '"7"', etag: '"8"', id: 1, state: "settled" as const, settledAt: 0 };
    const pulled = [row("s1", { href, etag: '"9"' })];
    expect(applyPendingEventWrites(pulled, [stamp])[0].etag).toBe('"9"');
    expect(unsettledEventWrites(pulled, [stamp], 1)).toEqual([]);
    expect(unsettledEventWrites([row("s1", { href, etag: '"7"' })], [stamp], 1)).toHaveLength(1);
  });

  it("a write against an event the cache has not listed yet goes into its create overlay (R2)", async () => {
    // Laid beside it, the write was let go at the first reconcile - a cache
    // that never saw the event agrees with nothing: a fresh event lost its new
    // etag at once, and a deleted one came back from its create overlay.
    const store = new PendingEventWrites();
    const fresh = row("u9", { href: "https://dav/cal/u9.ics", etag: '"v1"' });
    await writeEventOptimistically(store, { kind: "create", row: fresh }, async () => fresh, () => [{ kind: "create", row: fresh }]);
    const recolour = { kind: "update" as const, ref: ref("u9"), patch: { color: "#d50000" } };
    await writeEventOptimistically(store, recolour, async () => ({ etag: '"v2"' }), (w) => [recolour, { kind: "stamp", ref: ref("u9"), href: fresh.href, from: '"v1"', etag: w.etag }]);
    store.reconcile([]);
    expect(applyPendingEventWrites([], store.snapshot()).map((e) => [e.uid, e.color, e.etag])).toEqual([["u9", "#d50000", '"v2"']]);
    await writeEventOptimistically(store, { kind: "delete", ref: ref("u9") }, async () => undefined, () => [{ kind: "delete", ref: ref("u9") }]);
    store.reconcile([]);
    expect(applyPendingEventWrites([], store.snapshot())).toEqual([]);
  });

  it("a deleted series leaves the screen with every occurrence, whatever the provider (R7)", () => {
    // CalDAV occurrences (`uid#...`), Google/Microsoft ids, the device's own ids:
    // all of them name the series as `seriesMaster`.
    const shown = [
      row("s1#1", { seriesMaster: "s1" }),
      row("g1_20261110", { seriesMaster: "g1" }),
      row("e1@1700000000000", { seriesMaster: "e1" }),
      row("s1#1-other-calendar", { seriesMaster: "s1", calendarId: "c2" }),
      row("single"),
    ];
    const writes = ["s1", "g1", "e1"].map((uid, i) => ({ kind: "delete" as const, ref: ref(uid), id: i + 1, state: "settled" as const, settledAt: 0 }));
    expect(applyPendingEventWrites(shown, writes).map((e) => e.uid)).toEqual(["s1#1-other-calendar", "single"]);
    // Kept while a pull still lists an occurrence, gone when none does.
    expect(unsettledEventWrites(shown, writes, 1).map((w) => (w.kind === "delete" ? w.ref.uid : null))).toEqual(["s1", "g1", "e1"]);
    expect(unsettledEventWrites([row("single")], writes, 1)).toEqual([]);
    // Deleting ONE occurrence still takes only that one.
    const one = [{ kind: "delete" as const, ref: ref("s1#1"), id: 9, state: "settled" as const, settledAt: 0 }];
    expect(applyPendingEventWrites([row("s1#1", { seriesMaster: "s1" }), row("s1#2", { seriesMaster: "s1" })], one).map((e) => e.uid)).toEqual(["s1#2"]);
  });

  it("a changed series shows its new title on every occurrence at once, but no occurrence moves before the provider says where (R7)", async () => {
    const store = new PendingEventWrites();
    const occurrences = [row("s1#1", { seriesMaster: "s1", start: { ts: 100 } }), row("s1#2", { seriesMaster: "s1", start: { ts: 200 } })];
    let answer!: () => void;
    const provider = new Promise<void>((resolve) => (answer = resolve));
    const change = { kind: "update" as const, ref: ref("s1"), patch: { title: "Daily", start: { ts: 999 } as any, end: { ts: 1999 } as any } };
    const writing = writeEventOptimistically(store, change, () => provider);
    const during = applyPendingEventWrites(occurrences, store.snapshot());
    expect(during.map((e) => [e.uid, e.title, e.start.ts, e.pending])).toEqual([
      ["s1#1", "Daily", 100, true],
      ["s1#2", "Daily", 200, true],
    ]);
    answer();
    await writing;
    // A pull that started before the write: still the old title, the overlay stays.
    store.reconcile(occurrences, Date.now());
    expect(applyPendingEventWrites(occurrences, store.snapshot()).map((e) => e.title)).toEqual(["Daily", "Daily"]);
    // The pull that brought the change: the overlay leaves.
    store.reconcile(occurrences.map((o) => ({ ...o, title: "Daily" })), Date.now());
    expect(store.snapshot()).toEqual([]);
  });

  it("a deleted series that was just created leaves with its create overlay (R7)", async () => {
    const store = new PendingEventWrites();
    const created = row("s9", { recurrence: "RRULE:FREQ=DAILY" });
    showWrittenEvents(store, [{ kind: "create", row: created }]);
    await writeEventOptimistically(store, { kind: "delete", ref: ref("s9") }, async () => undefined, () => [{ kind: "delete", ref: ref("s9") }]);
    const stale = [row("s9#1", { seriesMaster: "s9" })];
    expect(applyPendingEventWrites(stale, store.snapshot())).toEqual([]);
  });

  it("tells its listeners about every change and keeps a stable snapshot in between", () => {
    const store = new PendingEventWrites();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    const before = store.snapshot();
    store.reconcile([]);
    expect(store.snapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    const id = store.begin({ kind: "delete", ref: ref("u1") });
    store.drop(id);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    store.begin({ kind: "delete", ref: ref("u1") });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
