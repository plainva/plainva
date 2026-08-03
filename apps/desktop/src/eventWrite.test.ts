import { describe, expect, it, vi } from "vitest";
import { PimConflictError } from "@plainva/core";
import { createCalendarEvent, deleteCalendarEvent, draftToRow, sameEventRef, updateCalendarEvent } from "@plainva/ui";

const draft = { title: "Review", start: { ts: 1 }, end: { ts: 2 }, allDay: false } as any;
const event = { accountId: "a1", calendarId: "c1", uid: "u1", etag: "e1", href: "h1" } as any;

function targets(map: Record<string, any>) {
  return { targetFor: vi.fn(async (id: string) => map[id] ?? null) };
}

describe("calendar event writes", () => {
  it("shows a new event without waiting for the next pull", async () => {
    const t = targets({ a1: { createEvent: vi.fn(async () => ({ uid: "u9", etag: "e9", href: "h9" })) } });
    const out = await createCalendarEvent(t, "a1", "c1", draft);
    expect(out.kind).toBe("written");
    expect(out.kind === "written" && out.rows[0]).toMatchObject({ uid: "u9", title: "Review", accountId: "a1" });
  });

  it("treats a moved remote as a signal to re-pull, not as an error", async () => {
    const t = targets({
      a1: {
        updateEvent: vi.fn(async () => {
          throw new PimConflictError("moved");
        }),
      },
    });
    await expect(updateCalendarEvent(t, event, draft)).resolves.toEqual({ kind: "conflict" });
  });

  it("moves across calendars as create-then-delete", async () => {
    const create = vi.fn(async () => ({ uid: "u2", etag: "e2", href: "h2" }));
    const del = vi.fn(async () => {});
    const t = targets({ a1: { deleteEvent: del, createEvent: create }, a2: { createEvent: create, deleteEvent: del } });
    const out = await updateCalendarEvent(t, event, draft, { accountId: "a2", calendarId: "c2" });
    expect(create).toHaveBeenCalledOnce();
    expect(del).toHaveBeenCalledOnce();
    expect(out.kind === "written" && out.removed).toEqual({ accountId: "a1", calendarId: "c1", uid: "u1" });
  });

  it("keeps the copy when the source delete fails", async () => {
    // A duplicate is visible and fixable; a lost event is not.
    const t = targets({
      a1: {
        deleteEvent: vi.fn(async () => {
          throw new Error("locked");
        }),
      },
      a2: { createEvent: vi.fn(async () => ({ uid: "u2" })) },
    });
    const out = await updateCalendarEvent(t, event, draft, { accountId: "a2", calendarId: "c2" });
    expect(out.kind).toBe("duplicate");
    expect(out.kind === "duplicate" && out.rows[0].uid).toBe("u2");
  });

  it("refuses to write without a target instead of failing silently", async () => {
    const t = targets({});
    await expect(createCalendarEvent(t, "a1", "c1", draft)).rejects.toThrow();
    await expect(deleteCalendarEvent(t, event)).rejects.toThrow();
  });

  it("matches rows by account, calendar and uid", () => {
    expect(sameEventRef(draftToRow("a1", "c1", "u1", draft), event)).toBe(true);
    expect(sameEventRef(draftToRow("a1", "c2", "u1", draft), event)).toBe(false);
  });
});
