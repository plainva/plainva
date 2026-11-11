import { describe, expect, it } from "vitest";
import type { PimEventRow } from "@plainva/core";
import { applyEventChanges, eventFormFromEvent, eventFormToDraft, localDayDistance } from "@plainva/ui";

/**
 * An event that ends at midnight is a normal event (found 2026-11-10 at a
 * test clock of 23:59): the edit form has no end date for a timed event, and
 * an event from 23:00 to 24:00 came back from any save - a changed title
 * alone - as 23:00 to 23:30, the rule for an end before its start. The form
 * now keeps the end's day as the event had it (`endDayOffset`).
 */
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const event = (start: number, end: number): PimEventRow => ({
  accountId: "a", calendarId: "c", uid: "e1", title: "Late", allDay: false, start: { ts: start }, end: { ts: end },
} as PimEventRow);

describe("a timed event that ends at or after midnight", () => {
  it("is saved as it was when only the title changes: 23:00 to 24:00", () => {
    const form = eventFormFromEvent(event(at(11, 23), at(12, 0)));
    expect(form.endDayOffset).toBe(1);
    const draft = eventFormToDraft({ ...form, title: "Later" });
    expect([draft.start.ts, draft.end.ts]).toEqual([at(11, 23), at(12, 0)]);
  });

  it("keeps a night across midnight, and a span of several days", () => {
    const night = eventFormToDraft(eventFormFromEvent(event(at(11, 22), at(12, 1, 30))));
    expect([night.start.ts, night.end.ts]).toEqual([at(11, 22), at(12, 1, 30)]);
    const long = eventFormToDraft(eventFormFromEvent(event(at(9, 10), at(11, 11))));
    expect([long.start.ts, long.end.ts]).toEqual([at(9, 10), at(11, 11)]);
  });

  it("moves with its start day, and ends on the start's day once its end time is edited", () => {
    const form = eventFormFromEvent(event(at(11, 23), at(12, 0)));
    const moved = eventFormToDraft({ ...form, dayKey: "2026-11-20" });
    expect([moved.start.ts, moved.end.ts]).toEqual([new Date(2026, 10, 20, 23).getTime(), new Date(2026, 10, 21, 0).getTime()]);
    const edited = eventFormToDraft({ ...form, endTime: "23:45", endDayOffset: undefined });
    expect(edited.end.ts).toBe(at(11, 23, 45));
  });

  it("is carried into a series with a time change, and left alone by one that changes something else", () => {
    const master = eventFormFromEvent(event(at(4, 9), at(4, 10)));
    const occurrence = eventFormFromEvent(event(at(11, 23), at(12, 0)));
    expect(applyEventChanges(master, occurrence, [{ field: "time", from: "09:00-10:00", to: "23:00-00:00" }] as never).endDayOffset).toBe(1);
    expect(applyEventChanges(master, { ...occurrence, title: "x" }, [{ field: "title", from: "Late", to: "x" }] as never).endDayOffset).toBe(0);
  });

  it("counts whole days, also over a change of summer time", () => {
    expect(localDayDistance(at(11, 23), at(12, 0))).toBe(1);
    expect(localDayDistance(new Date(2026, 2, 28, 23).getTime(), new Date(2026, 2, 29, 23).getTime())).toBe(1);
    expect(localDayDistance(at(11, 9), at(11, 17))).toBe(0);
  });
});
