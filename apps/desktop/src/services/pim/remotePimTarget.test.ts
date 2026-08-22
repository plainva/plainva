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

const { createRemotePimTarget, createClientPimRuntime } = await import("./remotePimTarget");

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

    expect(request).toHaveBeenCalledWith("pim-refresh", {});
    // start()/stop() are no-ops on purpose: a poller per window would multiply
    // provider traffic by the number of open windows.
    expect(request).toHaveBeenCalledTimes(1);
  });
});
