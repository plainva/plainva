import { describe, it, expect } from "vitest";
import { buildDayAgenda, buildDayStrip, dayWindow, type AgendaEvent, type AgendaTask } from "@plainva/ui";

const ev = (uid: string, title: string, allDay: boolean, hh: number): AgendaEvent => ({
  uid, title, allDay,
  startMs: new Date(2026, 7, 4, hh, 0).getTime(),
  timeLabel: allDay ? "" : `${String(hh).padStart(2, "0")}:00`,
});
const task = (title: string, due: string | null, done = false): AgendaTask => ({ path: `${title}.md`, title, due, done });

describe("buildDayAgenda", () => {
  it("puts all-day entries first, then the clock, then what is due", () => {
    const items = buildDayAgenda(
      "2026-08-04",
      [ev("b", "Standup", false, 9), ev("a", "Urlaub", true, 0), ev("c", "Review", false, 14)],
      [task("Rechnung", "2026-08-04")],
    );
    expect(items.map((i) => (i.kind === "event" ? i.event.title : i.task.title))).toEqual([
      "Urlaub", "Standup", "Review", "Rechnung",
    ]);
  });

  it("keeps only tasks due on that very day", () => {
    const items = buildDayAgenda("2026-08-04", [], [
      task("heute", "2026-08-04"), task("morgen", "2026-08-05"), task("ohne", null),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].kind === "task" && items[0].task.title).toBe("heute");
  });

  it("leaves finished tasks out unless asked for them", () => {
    const done = [task("erledigt", "2026-08-04", true)];
    expect(buildDayAgenda("2026-08-04", [], done)).toHaveLength(0);
    expect(buildDayAgenda("2026-08-04", [], done, { includeDone: true })).toHaveLength(1);
  });

  it("orders equal starts by title so the list does not reshuffle", () => {
    const a = buildDayAgenda("2026-08-04", [ev("x", "Zebra", false, 9), ev("y", "Alpha", false, 9)], []);
    const b = buildDayAgenda("2026-08-04", [ev("y", "Alpha", false, 9), ev("x", "Zebra", false, 9)], []);
    expect(a.map((i) => i.kind === "event" && i.event.title)).toEqual(b.map((i) => i.kind === "event" && i.event.title));
  });
});

describe("dayWindow", () => {
  it("spans exactly the local day", () => {
    const { start, end } = dayWindow("2026-08-04");
    expect(new Date(start).getHours()).toBe(0);
    expect(end - start).toBe(24 * 60 * 60 * 1000);
  });
});

describe("buildDayStrip", () => {
  it("reaches into the future, not only the past", () => {
    const days = buildDayStrip(new Date(2026, 7, 4), 14, 14);
    expect(days).toHaveLength(29);
    // The point of the change: a day view whose future is one day long cannot
    // answer "what does next week look like".
    expect(days[days.length - 1].getDate()).toBe(18);
    expect(days[0].getDate()).toBe(21); // 21 July
  });

  it("puts today in the middle", () => {
    const days = buildDayStrip(new Date(2026, 7, 4), 14, 14);
    expect(days[14].getDate()).toBe(4);
  });
});
