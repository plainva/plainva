import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BusTransport, WindowBus } from "../windowBus";

/**
 * "Try again" on an event moved to another calendar from another window
 * (review 2026-11-18, O1): the real window bus — whose answer to a create goes
 * missing —, the real remote target and the shared `updateCalendarEvent`, as
 * the calendar's retry runs them. A move is "create there, delete here"; a
 * retry gets the create it already made and goes on with the delete.
 */

let aux: WindowBus;
vi.mock("../windowBus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../windowBus")>();
  return { ...actual, getWindowBus: async () => aux };
});

const { createWindowBus, OWNER_LABEL } = await import("../windowBus");
const { createRemotePimTarget, newWriteAction, withWriteAttempt } = await import("./remotePimTarget");
const { createCalendarEvent, updateCalendarEvent } = await import("@plainva/ui");
const { resetKeptForAWhileForTest } = await import("../keptForAWhile");

/** Windows on one wire; the central window's answer to the next `lose` creates goes missing. */
function wire() {
  const listeners = new Map<string, Set<{ label: string; fn: (payload: unknown) => void }>>();
  const lost = new Set<string>();
  let lose = 0;
  const make = (label: string): BusTransport => ({
    label,
    async emit(event, payload) {
      for (const entry of listeners.get(event) ?? []) entry.fn(payload);
    },
    async emitTo(target, event, payload) {
      const p = payload as { id?: string; args?: { op?: { kind?: string } } };
      if (event === "pv:rpc" && p.args?.op?.kind === "createEvent" && lose > 0) {
        lose -= 1;
        lost.add(p.id!);
      }
      if (event === "pv:rpc-reply" && lost.has(p.id!)) return;
      for (const entry of listeners.get(event) ?? []) if (entry.label === target) entry.fn(payload);
    },
    async listen(event, handler) {
      const entry = { label, fn: handler };
      const set = listeners.get(event) ?? new Set();
      set.add(entry);
      listeners.set(event, set);
      return () => set.delete(entry);
    },
  });
  return { make, loseCreates: (n: number) => { lose = n; } };
}

let calendars: Map<string, string[]>;
let owner: WindowBus;
let line: ReturnType<typeof wire>;
beforeEach(async () => {
  resetKeptForAWhileForTest();
  calendars = new Map([["home", ["u1"]], ["work", []]]);
  line = wire();
  owner = createWindowBus(line.make(OWNER_LABEL), 40);
  aux = createWindowBus(line.make("aux-1"), 40);
  let made = 0;
  await owner.handle("pim-write", (async ({ op }: { op: { kind: string; calendarId?: string; ref?: { calendarId: string; uid: string } } }) => {
    await new Promise((resolve) => setTimeout(resolve, 3));
    if (op.kind === "createEvent") {
      const uid = `new-${++made}`;
      calendars.get(op.calendarId!)!.push(uid);
      return { ok: true, uid };
    }
    if (op.kind === "deleteEvent") calendars.set(op.ref!.calendarId, calendars.get(op.ref!.calendarId)!.filter((uid) => uid !== op.ref!.uid));
    return { ok: true };
  }) as never);
});
afterEach(async () => {
  await owner.dispose();
  await aux.dispose();
});

const account = { id: "acc", provider: "google" } as never;
const event = { accountId: "acc", calendarId: "home", uid: "u1", etag: "e1" } as never;
const draft = { title: "Dentist", allDay: false, start: { ts: 1 }, end: { ts: 2 } } as never;
const work = { accountId: "acc", calendarId: "work" };
const targetsFor = (action: string) => ({ targetFor: async () => withWriteAttempt(createRemotePimTarget(account), action) });
const tryIt = (run: () => Promise<unknown>) => run().then(() => "ok", (error: Error) => (/may still land/.test(error.message) ? "may still land" : error.message));

describe("an event moved to another calendar, tried again from another window", () => {
  it("is created there once and deleted here: create lost, Try again", async () => {
    const action = newWriteAction("event-save");
    line.loseCreates(1);
    const out = [await tryIt(() => updateCalendarEvent(targetsFor(action), event, draft, work)), await tryIt(() => updateCalendarEvent(targetsFor(action), event, draft, work))];
    expect(out).toEqual(["may still land", "ok"]);
    expect(calendars.get("work")).toEqual(["new-1"]);
    expect(calendars.get("home")).toEqual([]);
  });

  it("is created there once: lost, lost, Try again", async () => {
    const action = newWriteAction("event-save");
    line.loseCreates(2);
    for (let i = 0; i < 3; i++) await tryIt(() => updateCalendarEvent(targetsFor(action), event, draft, work));
    expect(calendars.get("work")).toEqual(["new-1"]);
    expect(calendars.get("home")).toEqual([]);
  });

  it("is two events for two forms of the same content", async () => {
    await createCalendarEvent(targetsFor(newWriteAction("event-create")), "acc", "work", draft);
    await createCalendarEvent(targetsFor(newWriteAction("event-create")), "acc", "work", draft);
    expect(calendars.get("work")).toEqual(["new-1", "new-2"]);
  });
});
