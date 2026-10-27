import { describe, expect, it } from "vitest";
import {
  addSnooze,
  dueSnoozes,
  filterSnoozed,
  isSnoozed,
  parseSnoozeState,
  pruneSnoozes,
  removeSnooze,
  snoozeUntil,
  type SnoozeEntry,
} from "@plainva/ui/mail";
import { dueQuickDay, type WeekStartDay } from "@plainva/ui";

const at = (iso: string) => new Date(iso);
const entry = (over: Partial<SnoozeEntry> = {}): SnoozeEntry => ({
  account: "a1",
  id: "42",
  folder: "INBOX",
  until: at("2026-08-11T08:00:00").getTime(),
  ...over,
});

describe("snoozeUntil", () => {
  it("adds hours for 'later today'", () => {
    const now = at("2026-08-10T09:00:00");
    expect(new Date(snoozeUntil("laterToday", now, 1)).getHours()).toBe(12);
  });

  it("caps 'later today' at the next morning — three hours after 23:00 is not today", () => {
    const now = at("2026-08-10T23:00:00");
    const due = new Date(snoozeUntil("laterToday", now, 1));
    expect(due.getDate()).toBe(11);
    expect(due.getHours()).toBe(8);
  });

  it("wakes 'tomorrow' at the morning hour", () => {
    const due = new Date(snoozeUntil("tomorrow", at("2026-08-10T15:00:00"), 1));
    expect(due.getDate()).toBe(11);
    expect(due.getHours()).toBe(8);
  });

  it("takes 'next week' to the coming Monday", () => {
    // 2026-08-12 is a Wednesday.
    const due = new Date(snoozeUntil("nextWeek", at("2026-08-12T10:00:00"), 1));
    expect(due.getDay()).toBe(1);
    expect(due.getDate()).toBe(17);
  });

  it("takes 'next week' on a Monday to the FOLLOWING Monday, never to today", () => {
    const monday = at("2026-08-10T10:00:00");
    expect(monday.getDay()).toBe(1);
    const due = new Date(snoozeUntil("nextWeek", monday, 1));
    expect(due.getDate()).toBe(17);
    expect(due.getTime()).toBeGreaterThan(monday.getTime());
  });

  it("takes 'this weekend' on a Saturday to the NEXT one — this morning has happened", () => {
    const saturday = at("2026-08-15T10:00:00");
    expect(saturday.getDay()).toBe(6);
    const due = new Date(snoozeUntil("thisWeekend", saturday, 1));
    expect(due.getDate()).toBe(22);
    expect(due.getTime()).toBeGreaterThan(saturday.getTime());
  });

  // "Next week" is the due picker's question (dueQuickDay): the first day of
  // the week after this one, where the week-start setting says a week starts.
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  it.each([
    // [week start, now (2026-08-12 is a Wednesday), expected day]
    [1, "2026-08-12T10:00:00", "2026-08-17"],
    [0, "2026-08-12T10:00:00", "2026-08-16"],
    [6, "2026-08-12T10:00:00", "2026-08-15"],
    // On the first day of a week: the next one, never today.
    [1, "2026-08-10T07:00:00", "2026-08-17"],
    [0, "2026-08-09T07:00:00", "2026-08-16"],
    [6, "2026-08-15T07:00:00", "2026-08-22"],
    // The day before a week starts: tomorrow.
    [0, "2026-08-15T10:00:00", "2026-08-16"],
    [6, "2026-08-14T10:00:00", "2026-08-15"],
  ] as [WeekStartDay, string, string][])("takes 'next week' with the week starting on day %i, at %s, to %s — the due picker's day", (weekStart, nowIso, expected) => {
    const now = at(nowIso);
    const due = new Date(snoozeUntil("nextWeek", now, weekStart));
    expect(dayKey(due)).toBe(expected);
    expect(dayKey(due)).toBe(dueQuickDay("nextWeek", dayKey(now), weekStart));
    expect(due.getHours()).toBe(8);
    expect(due.getMinutes()).toBe(0);
  });

  it("takes 'tomorrow' to the due picker's tomorrow, across a month's end, whatever the week start", () => {
    for (const weekStart of [0, 1, 6] as const) {
      const now = at("2026-08-31T22:00:00");
      const due = new Date(snoozeUntil("tomorrow", now, weekStart));
      expect(dayKey(due)).toBe("2026-09-01");
      expect(dayKey(due)).toBe(dueQuickDay("tomorrow", dayKey(now), weekStart));
      expect(due.getHours()).toBe(8);
    }
  });

  it("keeps its own 'this weekend': on a weekend day the NEXT Saturday, whatever the week start", () => {
    for (const weekStart of [0, 1, 6] as const) {
      expect(dayKey(new Date(snoozeUntil("thisWeekend", at("2026-08-12T10:00:00"), weekStart)))).toBe("2026-08-15");
      expect(dayKey(new Date(snoozeUntil("thisWeekend", at("2026-08-16T07:00:00"), weekStart)))).toBe("2026-08-22");
    }
  });

  it("never returns a time in the past, for any preset or weekday", () => {
    for (let day = 10; day <= 16; day++) {
      for (const hour of [0, 9, 23]) {
        const now = at(`2026-08-${day}T${String(hour).padStart(2, "0")}:30:00`);
        for (const p of ["laterToday", "tomorrow", "thisWeekend", "nextWeek"] as const) {
          for (const weekStart of [0, 1, 6] as const) {
            expect(snoozeUntil(p, now, weekStart), `${p} on ${now.toISOString()}, week from ${weekStart}`).toBeGreaterThan(now.getTime());
          }
        }
      }
    }
  });
});

describe("the list", () => {
  it("re-times an already snoozed message instead of adding a second entry", () => {
    const first = addSnooze([], entry());
    const again = addSnooze(first, entry({ until: 9_999 }));
    expect(again).toHaveLength(1);
    expect(again[0]!.until).toBe(9_999);
  });

  it("keeps entries of other accounts with the same id apart", () => {
    const state = addSnooze(addSnooze([], entry()), entry({ account: "a2" }));
    expect(state).toHaveLength(2);
    expect(removeSnooze(state, "a1", "42")).toHaveLength(1);
  });

  it("reports due entries without removing them — a read must not write", () => {
    const state = [entry({ until: 100 }), entry({ id: "43", until: 900 })];
    expect(dueSnoozes(state, 500).map((e) => e.id)).toEqual(["42"]);
    expect(state).toHaveLength(2);
  });

  it("says a message is snoozed only while its time is ahead", () => {
    const state = [entry({ until: 500 })];
    expect(isSnoozed(state, "a1", "42", 400)).toBe(true);
    expect(isSnoozed(state, "a1", "42", 600)).toBe(false);
  });
});

describe("filterSnoozed", () => {
  const rows = [
    { acc: "a1", id: "1" },
    { acc: "a1", id: "2" },
    { acc: "a2", id: "1" },
  ];
  const opts = { accountOf: (r: (typeof rows)[number]) => r.acc, idOf: (r: (typeof rows)[number]) => r.id };

  it("hides a snoozed row of that folder", () => {
    const state = [entry({ id: "2", until: 900 })];
    const out = filterSnoozed(rows, { state, now: 100, folder: "INBOX", ...opts });
    expect(out.map((r) => r.id)).toEqual(["1", "1"]);
  });

  it("hides nothing in a DIFFERENT folder — a snooze is 'not in my way', not 'gone'", () => {
    const state = [entry({ id: "2", until: 900 })];
    const out = filterSnoozed(rows, { state, now: 100, folder: "Archive", ...opts });
    expect(out).toHaveLength(3);
  });

  it("hides nothing once the time has passed", () => {
    const state = [entry({ id: "2", until: 50 })];
    expect(filterSnoozed(rows, { state, now: 100, folder: "INBOX", ...opts })).toHaveLength(3);
  });

  it("does not confuse the same id in two accounts", () => {
    const state = [entry({ account: "a2", id: "1", until: 900 })];
    const out = filterSnoozed(rows, { state, now: 100, folder: "INBOX", ...opts });
    expect(out).toEqual([rows[0], rows[1]]);
  });
});

describe("pruneSnoozes", () => {
  it("keeps an entry that came back within the grace period", () => {
    const now = 10 * 24 * 3600_000;
    const back = now - 3 * 24 * 3600_000;
    expect(pruneSnoozes([entry({ until: back })], now)).toHaveLength(1);
  });

  it("drops one that came back long ago", () => {
    const now = 30 * 24 * 3600_000;
    const back = now - 20 * 24 * 3600_000;
    expect(pruneSnoozes([entry({ until: back })], now)).toHaveLength(0);
  });
});

describe("parseSnoozeState", () => {
  it("returns nothing for a non-list", () => {
    expect(parseSnoozeState(null)).toEqual([]);
    expect(parseSnoozeState({ a: 1 })).toEqual([]);
  });

  it("skips entries without an id or without a time, rather than repairing them", () => {
    const raw = [
      { account: "a1", id: "1", folder: "INBOX", until: 5 },
      { account: "a1", folder: "INBOX", until: 5 },
      { account: "a1", id: "2", folder: "INBOX" },
      { account: "a1", id: "3", folder: "INBOX", until: Number.NaN },
    ];
    expect(parseSnoozeState(raw).map((e) => e.id)).toEqual(["1"]);
  });

  it("tolerates a missing folder — the entry still says 'not now'", () => {
    const out = parseSnoozeState([{ account: "a1", id: "1", until: 5 }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.folder).toBe("");
  });
});
