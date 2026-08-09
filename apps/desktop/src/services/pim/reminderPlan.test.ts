import { describe, expect, it } from "vitest";
import { IOS_NOTIFICATION_LIMIT, planReminders, type ReminderRule, type ReminderSubject } from "@plainva/ui";

/**
 * The planner is where every reminder decision lives, so it is where they get
 * proven — without a device. The ceiling case matters most: iOS discards past
 * 64 pending notifications silently, so a plan that cannot say where it stops
 * is a plan that loses appointments without anyone noticing.
 */

const RULE: ReminderRule = { defaultLeadMinutes: 15, allDayLeadDays: 1, allDayAtMinutes: 19 * 60 };
const NOW = Date.parse("2026-08-09T08:00:00Z");
const WINDOW_END = NOW + 14 * 86_400_000;

function ev(over: Partial<ReminderSubject> & { key: string; startTs: number }): ReminderSubject {
  return { title: over.key, allDay: false, accountId: "a1", calendarId: "c1", ...over };
}

const plan = (subjects: ReminderSubject[], limit?: number) =>
  planReminders(subjects, RULE, { now: NOW, windowEndTs: WINDOW_END, limit });

describe("planReminders", () => {
  it("lets the appointment's own reminder win over the rule", () => {
    const start = NOW + 3 * 3_600_000;
    const { reminders } = plan([ev({ key: "own", startTs: start, reminders: [60] })]);
    // 60 minutes, not the rule's 15 — somebody set that in their calendar.
    expect(reminders).toHaveLength(1);
    expect(reminders[0].at).toBe(start - 60 * 60_000);
    expect(reminders[0].leadMinutes).toBe(60);
  });

  it("schedules one reminder per offset the appointment names", () => {
    const start = NOW + 5 * 3_600_000;
    const { reminders } = plan([ev({ key: "two", startTs: start, reminders: [15, 60] })]);
    expect(reminders.map((r) => r.at)).toEqual([start - 60 * 60_000, start - 15 * 60_000]);
  });

  it("respects an appointment that asks for no reminder at all", () => {
    // `[]` is an answer, not a gap. Filling it with the rule would announce
    // something the person switched off in their calendar.
    expect(plan([ev({ key: "muted", startTs: NOW + 3_600_000, reminders: [] })]).reminders).toEqual([]);
  });

  it("falls back to the rule only where the appointment is silent", () => {
    const start = NOW + 3_600_000;
    const { reminders } = plan([ev({ key: "silent", startTs: start })]);
    expect(reminders[0].at).toBe(start - 15 * 60_000);
  });

  it("gives an all-day appointment a time of day instead of minutes before", () => {
    // Midnight is not when anyone wants to hear about tomorrow.
    const { reminders } = plan([
      ev({ key: "trip", startTs: Date.parse("2026-08-12T00:00:00Z"), allDay: true, startDate: "2026-08-12" }),
    ]);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].at).toBe(new Date(2026, 7, 11, 19, 0).getTime()); // evening before, local
    expect(reminders[0].leadMinutes).toBeUndefined();
  });

  it("honours an all-day appointment's own reminder rather than the all-day rule", () => {
    const start = Date.parse("2026-08-12T00:00:00Z");
    const { reminders } = plan([
      ev({ key: "trip", startTs: start, allDay: true, startDate: "2026-08-12", reminders: [24 * 60] }),
    ]);
    expect(reminders[0].at).toBe(start - 24 * 60 * 60_000);
  });

  it("drops what already passed and what lies beyond the window", () => {
    const out = plan([
      ev({ key: "past", startTs: NOW - 3_600_000 }),
      ev({ key: "far", startTs: WINDOW_END + 86_400_000 }),
      ev({ key: "soon", startTs: NOW + 7_200_000 }),
    ]);
    expect(out.reminders.map((r) => r.subject.key)).toEqual(["soon"]);
  });

  it("sorts by the moment it fires, so the ceiling cuts the far end", () => {
    const out = plan([
      ev({ key: "late", startTs: NOW + 10 * 3_600_000 }),
      ev({ key: "early", startTs: NOW + 2 * 3_600_000 }),
    ]);
    expect(out.reminders.map((r) => r.subject.key)).toEqual(["early", "late"]);
  });

  it("says from when on it no longer reaches instead of swallowing the rest", () => {
    // 70 appointments, one an hour: past the ceiling by six.
    const many = Array.from({ length: 70 }, (_, i) => ev({ key: `e${i}`, startTs: NOW + (i + 1) * 3_600_000 }));
    const out = plan(many);
    expect(out.reminders).toHaveLength(IOS_NOTIFICATION_LIMIT);
    expect(out.dropped).toBe(6);
    // The moment named is the first one NOT covered — what a person needs to
    // know is where the announcements stop, not how many were lost.
    expect(out.truncatedFrom).toBe(NOW + 65 * 3_600_000 - 15 * 60_000);
  });

  it("says nothing about a ceiling it did not hit", () => {
    const out = plan([ev({ key: "one", startTs: NOW + 3_600_000 })]);
    expect(out.truncatedFrom).toBeUndefined();
    expect(out.dropped).toBe(0);
  });

  it("breaks a tie the same way twice, so two devices cut at the same place", () => {
    const at = NOW + 4 * 3_600_000;
    const a = plan([ev({ key: "z", title: "Zebra", startTs: at }), ev({ key: "a", title: "Anna", startTs: at })]);
    const b = plan([ev({ key: "a", title: "Anna", startTs: at }), ev({ key: "z", title: "Zebra", startTs: at })]);
    expect(a.reminders.map((r) => r.subject.key)).toEqual(["a", "z"]);
    expect(b.reminders.map((r) => r.subject.key)).toEqual(a.reminders.map((r) => r.subject.key));
  });
});
