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
