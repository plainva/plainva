import { describe, expect, it, vi } from "vitest";
import { PimRequestError, parsePimErrorBody, pimRequestError, type IPimTarget, type PimEventDraft } from "@plainva/core";
import { isAuthorizationFailure, runCalendarBlocks } from "./blockCalendars";

const DRAFT = { title: "Busy", start: "2026-09-03T09:00:00Z", end: "2026-09-03T10:00:00Z" } as unknown as PimEventDraft;

/**
 * Blocking in other calendars keeps every failure with its reason (K9). Before,
 * the view caught without binding the error and "could not block in X" was
 * all anyone ever saw - including the maintainer, whose work account answers
 * 403 for a scope the token never carried.
 */
describe("runCalendarBlocks", () => {
  it("counts the successes and names each failure with what the provider said", async () => {
    const created = vi.fn();
    const fine = { createEvent: vi.fn(async () => ({ uid: "u1", etag: "e1" })) } as unknown as IPimTarget;
    const refused = { createEvent: vi.fn(async () => { throw new PimRequestError("graph create event: 403 Forbidden — ErrorAccessDenied: Access is denied", 403, "ErrorAccessDenied"); }) } as unknown as IPimTarget;
    const outcome = await runCalendarBlocks({
      keys: ["acc-a cal-1", "acc-b cal-2", "acc-c cal-3", "broken"],
      labelFor: (key) => ({ "acc-a cal-1": "Private", "acc-b cal-2": "Work", "acc-c cal-3": "Old" })[key] ?? key,
      targetFor: async (accountId) => accountId === "acc-a" ? { target: fine } : accountId === "acc-b" ? { target: refused } : { target: null, reason: "not signed in" },
      draft: DRAFT,
      onCreated: created,
    });
    expect(outcome.ok).toBe(1);
    expect(created).toHaveBeenCalledWith("acc-a", "cal-1", { uid: "u1", etag: "e1" });
    expect(outcome.failed.map((f) => [f.label, f.status, f.reason])).toEqual([
      ["Work", 403, "graph create event: 403 Forbidden — ErrorAccessDenied: Access is denied"],
      ["Old", null, "not signed in"],
    ]);
    expect(outcome.failed.map(isAuthorizationFailure)).toEqual([true, false]);
  });
});

describe("pimRequestError", () => {
  it("reads Graph's and Google's error bodies and a CalDAV server's plain text", async () => {
    const graph = await pimRequestError("graph create event", { status: 403, statusText: "Forbidden", text: async () => JSON.stringify({ error: { code: "ErrorAccessDenied", message: "Access is denied. Check credentials and try again." } }) });
    expect(graph.message).toBe("graph create event: 403 Forbidden — ErrorAccessDenied: Access is denied. Check credentials and try again.");
    expect(graph.status).toBe(403);
    expect(graph.code).toBe("ErrorAccessDenied");
    const google = parsePimErrorBody(JSON.stringify({ error: { code: 403, message: "Insufficient Permission", errors: [{ reason: "insufficientPermissions", message: "Insufficient Permission" }] } }));
    expect(google).toEqual({ code: "insufficientPermissions", message: "Insufficient Permission" });
    const caldav = await pimRequestError("caldav create event", { status: 507, text: async () => "<html><body>Quota exceeded\nsecond line</body></html>" });
    expect(caldav.message).toBe("caldav create event: 507 — Quota exceeded");
    const bare = await pimRequestError("google create event", { status: 500, text: async () => { throw new Error("no body"); } });
    expect(bare.message).toBe("google create event: 500");
  });
});
