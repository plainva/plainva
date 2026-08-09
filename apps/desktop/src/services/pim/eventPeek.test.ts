import { describe, expect, it } from "vitest";
import { acceptedCount, isSeries, nextOccurrenceOf, peekAttendees, sameSeries, seriesRecurrenceOf, type PeekRow } from "@plainva/ui";

/** `start` is a UTC instant in ms, as PimEventTime carries it. */
const row = (over: Omit<Partial<PeekRow>, "start" | "end"> & { uid: string; start: number }): PeekRow => ({
  accountId: "a1",
  calendarId: "cal",
  title: "Jour fixe",
  allDay: false,
  ...over,
  start: { ts: over.start },
  end: { ts: over.start + 1800000 },
});

const DAY = 86400000;
const MON = Date.UTC(2026, 7, 4, 9, 0);

const master = row({ uid: "m", start: MON, recurrence: "FREQ=WEEKLY;BYDAY=MO" });
const i1 = row({ uid: "m#1", start: MON + 7 * DAY, seriesMaster: "m" });
const i2 = row({ uid: "m#2", start: MON + 14 * DAY, seriesMaster: "m" });
const i3 = row({ uid: "m#3", start: MON + 21 * DAY, seriesMaster: "m" });
const single = row({ uid: "s1", start: MON + 10 * DAY });
const rows = [master, i3, i1, single, i2];

describe("series identity", () => {
  it("an instance and its master are the same series", () => {
    expect(sameSeries(i1, master)).toBe(true);
  });

  it("two instances of the same series match", () => {
    expect(sameSeries(i1, i2)).toBe(true);
  });

  it("a single event is its own series of one", () => {
    expect(sameSeries(single, i1)).toBe(false);
  });

  it("the same uid in another calendar is a different series", () => {
    expect(sameSeries(i1, { ...i2, calendarId: "other" })).toBe(false);
  });

  it("recognises both shapes of a repeating event", () => {
    expect(isSeries(master)).toBe(true);
    expect(isSeries(i1)).toBe(true);
    expect(isSeries(single)).toBe(false);
  });
});

describe("the repetition rule", () => {
  it("reads the rule off the master when the row IS the master", () => {
    expect(seriesRecurrenceOf(rows, master)).toMatchObject({ freq: "weekly", byWeekday: ["MO"] });
  });

  /** An expanded instance carries no RRULE — the preview has to look it up. */
  it("finds the rule for an expanded instance", () => {
    expect(seriesRecurrenceOf(rows, i1)).toMatchObject({ freq: "weekly", byWeekday: ["MO"] });
  });

  it("says nothing when the master lies outside the loaded window", () => {
    expect(seriesRecurrenceOf([i1, i2], i1)).toBeNull();
  });

  it("says nothing for a single event", () => {
    expect(seriesRecurrenceOf(rows, single)).toBeNull();
  });
});

describe("the next occurrence", () => {
  it("is the nearest instance after this one, not merely the next in the array", () => {
    expect(nextOccurrenceOf(rows, i1)?.uid).toBe("m#2");
  });

  it("skips the master row — a rule is not a date to attend", () => {
    expect(nextOccurrenceOf(rows, master)?.uid).toBe("m#1");
  });

  it("is null for the last loaded instance rather than guessing one", () => {
    expect(nextOccurrenceOf(rows, i3)).toBeNull();
  });

  it("is null for a single event", () => {
    expect(nextOccurrenceOf(rows, single)).toBeNull();
  });

  it("ignores an identically timed instance of a different series", () => {
    const foreign = row({ uid: "x#1", start: MON + 8 * DAY, seriesMaster: "x" });
    expect(nextOccurrenceOf([...rows, foreign], i1)?.uid).toBe("m#2");
  });
});

describe("attendees", () => {
  it("puts the organiser first", () => {
    const e = {
      ...single,
      rsvps: [
        { name: "Marco", status: "accepted" as const },
        { name: "Anke", status: "accepted" as const, organizer: true },
      ],
    };
    expect(peekAttendees(e).map((a) => a.name)).toEqual(["Anke", "Marco"]);
  });

  it("falls back to the plain names when the provider sent no statuses", () => {
    const e = { ...single, attendees: ["Jonas", "Tim"] };
    expect(peekAttendees(e)).toEqual([
      { name: "Jonas", status: "needsAction" },
      { name: "Tim", status: "needsAction" },
    ]);
  });

  it("counts only the acceptances", () => {
    expect(
      acceptedCount([
        { name: "a", status: "accepted" },
        { name: "b", status: "declined" },
        { name: "c", status: "accepted" },
        { name: "d", status: "needsAction" },
      ])
    ).toBe(2);
  });

  it("leaves the caller's list untouched", () => {
    const rsvps = [
      { name: "Marco", status: "accepted" as const },
      { name: "Anke", status: "accepted" as const, organizer: true },
    ];
    peekAttendees({ ...single, rsvps });
    expect(rsvps.map((a) => a.name)).toEqual(["Marco", "Anke"]);
  });
});
