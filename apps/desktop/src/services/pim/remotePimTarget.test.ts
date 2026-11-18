import { describe, it, expect, vi, beforeEach } from "vitest";
import { PimConflictError, type PimAccountRow } from "@plainva/core";

/**
 * The calendar of an auxiliary window (multi-window P2).
 *
 * Two things are load-bearing here and nothing else is:
 *
 * 1. A provider round trip NEVER happens in this window. Since cloud accounts
 *    stage B one refresh token serves files, calendar and mail of an account —
 *    two windows renewing it at the same moment do not break one service, they
 *    invalidate the account.
 * 2. A moved remote still arrives as `PimConflictError`. It cannot survive
 *    JSON, so it travels as a value and is re-thrown here; the caller's
 *    `instanceof` check is what decides between "re-pull and reopen the dialog"
 *    and "show an error".
 */

const request = vi.fn();
vi.mock("../windowBus", () => ({
  getWindowBus: async () => ({ request }),
}));

const { createRemotePimTarget, createClientPimRuntime, newWriteAction, withWriteAttempt } = await import("./remotePimTarget");
const { updateCalendarEvent } = await import("@plainva/ui");

const account = { id: "acc-1", provider: "google" } as unknown as PimAccountRow;
const ref = { calendarId: "cal", uid: "u1", etag: "e1" } as never;
const draft = { title: "Standup", start: "2026-09-01T09:00:00Z" } as never;

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ ok: true });
});

describe("remote PIM target", () => {
  it("hands a new event to the owner instead of calling the provider", async () => {
    request.mockResolvedValue({ ok: true, uid: "created", etag: "e2", href: "/h" });
    const target = createRemotePimTarget(account);

    const res = await target.createEvent!("cal", draft);

    expect(request).toHaveBeenCalledWith("pim-write", {
      accountId: "acc-1",
      op: { kind: "createEvent", calendarId: "cal", draft },
    });
    expect(res).toEqual({ uid: "created", etag: "e2", href: "/h" });
  });

  it("forwards update, delete and the RSVP", async () => {
    const target = createRemotePimTarget(account);

    await target.updateEvent!(ref, draft);
    await target.deleteEvent!(ref);
    await target.respondToEvent!(ref, "accepted");

    expect(request.mock.calls.map((c) => (c[1] as { op: { kind: string } }).op.kind)).toEqual([
      "updateEvent",
      "deleteEvent",
      "respondToEvent",
    ]);
    expect((request.mock.calls[2]![1] as { op: { response: string } }).op.response).toBe("accepted");
  });

  it("turns the owner's conflict value back into PimConflictError", async () => {
    request.mockResolvedValue({ conflict: true });
    const target = createRemotePimTarget(account);

    await expect(target.updateEvent!(ref, draft)).rejects.toBeInstanceOf(PimConflictError);
  });

  it("refuses to pull: a second reader would poll the provider twice", async () => {
    const target = createRemotePimTarget(account);

    expect(() => target.listCalendars()).toThrow(/central window/);
    expect(() => target.pullEvents("cal", 0, 0)).toThrow(/central window/);
    expect(request).not.toHaveBeenCalled();
  });

  it("asks the owner's worker for a cycle and starts none of its own", async () => {
    const runtime = createClientPimRuntime({} as never);

    runtime.worker.start();
    runtime.worker.stop();
    await runtime.worker.triggerImmediate();

    expect(request).toHaveBeenCalledWith("pim-refresh", { afterWrite: false });
    // start()/stop() are no-ops on purpose: a poller per window would multiply
    // provider traffic by the number of open windows.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("tells the owner when the refresh follows a write of this window (issue 119)", async () => {
    const runtime = createClientPimRuntime({} as never);
    await runtime.worker.triggerImmediate({ afterWrite: true });
    expect(request).toHaveBeenCalledWith("pim-refresh", { afterWrite: true });
  });
});

describe("the target of one form's event (A15)", () => {
  it("names the form's action in the create it sends, and only there", async () => {
    request.mockResolvedValue({ ok: true, uid: "created" });
    const target = withWriteAttempt(createRemotePimTarget(account), "event-form-1")!;
    await target.createEvent!("cal", draft);
    await target.updateEvent!(ref, draft);
    expect(request.mock.calls[0]).toEqual(["pim-write", { accountId: "acc-1", op: { kind: "createEvent", calendarId: "cal", draft } }, { attempt: expect.stringMatching(/^event-form-1:/) }]);
    expect(request.mock.calls[1]).toEqual(["pim-write", { accountId: "acc-1", op: { kind: "updateEvent", ref, draft } }]);
  });

  it("leaves a target of the central window itself, and no target, as they are", () => {
    const own = { provider: "google" } as never;
    expect(withWriteAttempt(own, "event-form-1")).toBe(own);
    expect(withWriteAttempt(null, "event-form-1")).toBeNull();
  });
});

describe("an event moved to another calendar, tried again (review 2026-11-17, O1)", () => {
  /** The central window: runs an attempt once and gives its outcome to every further try; the first answer goes missing. */
  function centralWindow() {
    const calendars = new Map<string, string[]>([["home", ["u1"]], ["work", []]]);
    const kept = new Map<string, unknown>();
    let lose = true;
    request.mockImplementation(async (_kind: string, { op }: { op: { kind: string; calendarId?: string; ref?: { calendarId: string; uid: string } } }, options?: { attempt?: string }) => {
      if (options?.attempt && kept.has(options.attempt)) return kept.get(options.attempt);
      let answer: unknown = { ok: true };
      if (op.kind === "createEvent") {
        const uid = `new-${calendars.get(op.calendarId!)!.length + 1}`;
        calendars.get(op.calendarId!)!.push(uid);
        answer = { ok: true, uid };
      }
      if (op.kind === "deleteEvent") calendars.set(op.ref!.calendarId, calendars.get(op.ref!.calendarId)!.filter((uid) => uid !== op.ref!.uid));
      if (options?.attempt) kept.set(options.attempt, answer);
      if (lose) {
        lose = false;
        throw new Error('window RPC "pim-write" got no answer after the owner took it; it may still land');
      }
      return answer;
    });
    return calendars;
  }

  it("creates it there once and then deletes it here, however often it is tried", async () => {
    const calendars = centralWindow();
    const action = newWriteAction("event-move");
    const targets = { targetFor: async () => withWriteAttempt(createRemotePimTarget(account), action) };
    const event = { accountId: "acc-1", calendarId: "home", uid: "u1", etag: "e1" } as never;
    const move = () => updateCalendarEvent(targets, event, draft, { accountId: "acc-1", calendarId: "work" });
    await expect(move()).rejects.toThrow(/may still land/);
    await move();
    await move();
    expect(calendars.get("work")).toEqual(["new-1"]);
    expect(calendars.get("home")).toEqual([]);
  });

  it("gives two creates of one action a name each", async () => {
    request.mockResolvedValue({ ok: true, uid: "x" });
    const target = withWriteAttempt(createRemotePimTarget(account), "event-move-1")!;
    await target.createEvent!("work", draft);
    await target.createEvent!("other", draft);
    await target.createEvent!("work", draft);
    const names = request.mock.calls.map((call) => (call[2] as { attempt: string }).attempt);
    expect(names[0]).not.toBe(names[1]);
    expect(names[2]).toBe(names[0]);
  });
});
