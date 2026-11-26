import { describe, expect, it, vi } from "vitest";
import type { IPimTarget, IVaultAdapter, PimEventDraft, PimEventRow } from "@plainva/core";
import { createEntryEvent, createProviderTask, createTaskTimeBlock, createTryFor, createUidFor, forgetCreateUid, runCalendarBlocks, updateCalendarEvent } from "@plainva/ui";

/**
 * One uid per create of the person, across its tries (issue 119).
 *
 * A provider that lets the client name the event (CalDAV) finds what an
 * earlier try left only when the next try sends the SAME uid. Each way that
 * creates without a form keeps one per thing it creates, until it landed.
 */

const adapter = (): IVaultAdapter =>
  ({ readTextFile: async () => "---\ntitle: x\n---\n", writeTextFile: async () => {} }) as unknown as IVaultAdapter;

/** A provider that refuses the first create (an answer that never came) and takes the next. */
function flaky(uid = "u1") {
  const uids: string[] = [];
  let first = true;
  const createEvent = vi.fn(async (_cal: string, draft: { createAs: string }) => {
    uids.push(draft.createAs);
    if (first) {
      first = false;
      throw new Error("network connection was lost");
    }
    return { uid, etag: '"e1"' };
  });
  const createTask = vi.fn(async (_list: string, draft: { createAs: string }) => {
    uids.push(draft.createAs);
    if (createTask.mock.calls.length === 1) throw new Error("network connection was lost");
    return { uid };
  });
  return { uids, createEvent, createTask, target: { createEvent, createTask } as unknown as IPimTarget };
}

describe("the uid of a create survives its tries and ends with its landing", () => {
  it("createUidFor: the same thing tried again is the same uid; once forgotten, the next is new", () => {
    expect.hasAssertions();
    const a = createUidFor("probe", "acc cal", { title: "A" }, 0);
    expect(createUidFor("probe", "acc cal", { title: "A" }, 60_000)).toBe(a);
    expect(createUidFor("probe", "acc cal", { title: "B" }, 60_000)).not.toBe(a);
    forgetCreateUid("probe", "acc cal", { title: "A" });
    expect(createUidFor("probe", "acc cal", { title: "A" }, 60_000)).not.toBe(a);
  });

  it("a uid not tried again for a day is let go", () => {
    expect.hasAssertions();
    const a = createUidFor("probe-day", "acc cal", 1, 0);
    expect(createUidFor("probe-day", "acc cal", 1, 25 * 3600_000)).not.toBe(a);
  });

  it("a time block", async () => {
    expect.hasAssertions();
    const p = flaky();
    const opts = { adapter: adapter(), target: p.target, calendarKey: "acc1 cal-work", title: "Write", values: { dayKey: "2026-12-03", startTime: "13:00", durationMinutes: 60 } };
    await expect(createTaskTimeBlock(opts)).rejects.toThrow();
    await createTaskTimeBlock(opts);
    await createTaskTimeBlock(opts);
    expect(p.uids[0]).toBe(p.uids[1]);
    expect(p.uids[2]).not.toBe(p.uids[1]);
  });

  it("an appointment from a note", async () => {
    expect.hasAssertions();
    const p = flaky();
    const opts = { adapter: adapter(), createEvent: (_key: string, draft: PimEventDraft & { createAs: string }) => p.createEvent("primary", draft), calendarKey: "acc-1 primary", notePath: "N/Release.md", title: "Release", day: "2026-12-12", dateField: "due" };
    await expect(createEntryEvent(opts)).rejects.toThrow();
    await createEntryEvent(opts);
    await createEntryEvent(opts);
    expect(p.uids[0]).toBe(p.uids[1]);
    expect(p.uids[2]).not.toBe(p.uids[1]);
  });

  it("a blocker", async () => {
    expect.hasAssertions();
    const p = flaky();
    const draft = { title: "Busy", start: { ts: 1 }, end: { ts: 2 }, allDay: false, blockOf: "source-1" } as PimEventDraft;
    const run = () => runCalendarBlocks({ keys: ["acc-a cal-1"], labelFor: (k) => k, targetFor: async () => ({ target: p.target }), draft });
    expect((await run()).failed).toHaveLength(1);
    await run();
    await run();
    expect(p.uids[0]).toBe(p.uids[1]);
    expect(p.uids[2]).not.toBe(p.uids[1]);
  });

  it("a task sent to a list", async () => {
    expect.hasAssertions();
    const p = flaky("task-1");
    const opts = { adapter: adapter(), notePath: "T/milk.md", accountId: "g1", listId: "@default", draft: { title: "Buy milk" }, createTask: p.createTask };
    expect(await createProviderTask(opts)).toEqual({ ok: false, reason: "createFailed" });
    await createProviderTask(opts);
    await createProviderTask(opts);
    expect(p.uids[0]).toBe(p.uids[1]);
    expect(p.uids[2]).not.toBe(p.uids[1]);
  });

  it("the copy a move makes", async () => {
    expect.hasAssertions();
    const p = flaky();
    const deleteEvent = vi.fn(async () => undefined);
    const targets = { targetFor: async () => ({ ...p.target, deleteEvent }) as unknown as IPimTarget };
    const event = { accountId: "a1", calendarId: "old", uid: "ev-1", etag: '"s1"', title: "Planning", start: { ts: 1 }, end: { ts: 2 }, allDay: false } as PimEventRow;
    const draft = { title: "Planning", start: { ts: 1 }, end: { ts: 2 }, allDay: false } as PimEventDraft;
    await expect(updateCalendarEvent(targets, event, draft, { accountId: "a1", calendarId: "new" })).rejects.toThrow();
    await updateCalendarEvent(targets, event, draft, { accountId: "a1", calendarId: "new" });
    expect(p.uids[0]).toBe(p.uids[1]);
  });

  it("a later try names what the try before it sent (`createBefore`), so the provider can compare", () => {
    expect.hasAssertions();
    const first = createTryFor("probe-again", "acc cal", { title: "A" }, { title: "A", due: "2026-12-01" }, 0);
    const second = createTryFor("probe-again", "acc cal", { title: "A" }, { title: "A", due: "2026-12-09" }, 1_000);
    const third = createTryFor("probe-again", "acc cal", { title: "A" }, { title: "A", due: "2026-12-10" }, 2_000);
    expect([first.createBefore, second.createBefore, third.createBefore, second.createAs]).toEqual([undefined, { title: "A", due: "2026-12-01" }, { title: "A", due: "2026-12-09" }, first.createAs]);
  });

  it("a move that landed lets its uid go: the same move again is a new create", async () => {
    expect.hasAssertions();
    const uids: string[] = [];
    const createEvent = vi.fn(async (_cal: string, d: { createAs: string }) => (uids.push(d.createAs), { uid: d.createAs, etag: '"e"' }));
    const targets = { targetFor: async () => ({ createEvent, deleteEvent: async () => undefined }) as unknown as IPimTarget };
    const event = { accountId: "a1", calendarId: "old", uid: "ev-9", etag: '"s9"', title: "Planning", start: { ts: 1 }, end: { ts: 2 }, allDay: false } as PimEventRow;
    const draft = { title: "Planning", start: { ts: 1 }, end: { ts: 2 }, allDay: false } as PimEventDraft;
    await updateCalendarEvent(targets, event, draft, { accountId: "a1", calendarId: "new" });
    await updateCalendarEvent(targets, event, draft, { accountId: "a1", calendarId: "new" });
    expect(uids[0]).not.toBe(uids[1]);
  });
});
