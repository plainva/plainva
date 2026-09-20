import { describe, expect, it } from "vitest";
import { parseTaskRemind, planReminders, readTaskSnoozes, snoozeMoment, snoozeTask, taskReminderSubjects, taskSnoozeKey, type ReminderRule } from "@plainva/ui";

/**
 * Plan Aufgaben-Oberfläche, B4: a task with a time reminds at ITS time (its own
 * lead, default 0 — not the appointment's "15 minutes before"), `remind` in the
 * note is the exception per task, and "Later" parks one moment that replaces
 * the regular reminder until it has passed. One rule for both shells.
 */

const RULE: ReminderRule = { defaultLeadMinutes: 15, allDayLeadDays: 1, allDayAtMinutes: 19 * 60, taskLeadDays: 0, taskAtMinutes: 9 * 60, taskTimedLeadMinutes: 0 };
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 9, 20, 8, 0);
const WINDOW = { now: NOW, windowEndTs: NOW + 14 * 86_400_000 };
const plan = (tasks: Parameters<typeof taskReminderSubjects>[0], rule = RULE, snoozes?: Record<string, number>) =>
  planReminders(taskReminderSubjects(tasks, { ...WINDOW, snoozes }), rule, WINDOW).reminders.map((r) => [r.subject.key, r.at]);

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

describe("task reminders", () => {
  it("a task with a time reminds at its time; one without follows the day rule", () => {
    expect(
      plan([
        { path: "A/Angebot.md", title: "Angebot", due: "2026-09-21", dueMinutes: 14 * 60, done: false },
        { path: "A/Bericht.md", title: "Bericht", due: "2026-09-22", done: false },
      ]),
    ).toEqual([
      ["A/Angebot.md", at(2026, 9, 21, 14, 0)],
      ["A/Bericht.md", at(2026, 9, 22, 9, 0)],
    ]);
  });

  it("the task lead is its own setting — the appointment lead no longer leaks in", () => {
    const timed = [{ path: "A/Angebot.md", title: "Angebot", due: "2026-09-21", dueMinutes: 14 * 60, done: false }];
    expect(plan(timed, { ...RULE, taskTimedLeadMinutes: 30 })).toEqual([["A/Angebot.md", at(2026, 9, 21, 13, 30)]]);
    // A caller that predates the setting keeps the behaviour it had.
    const { taskTimedLeadMinutes: _dropped, ...legacy } = RULE;
    expect(plan(timed, legacy)).toEqual([["A/Angebot.md", at(2026, 9, 21, 13, 45)]]);
  });

  it("`remind` in the note is the exception per task", () => {
    expect(parseTaskRemind("off")).toEqual([]);
    expect(parseTaskRemind(false)).toEqual([]);
    expect(parseTaskRemind("45")).toEqual([45]);
    expect(parseTaskRemind(10)).toEqual([10]);
    expect(parseTaskRemind("bald")).toBeUndefined();
    expect(parseTaskRemind(-5)).toBeUndefined();
    expect(parseTaskRemind(undefined)).toBeUndefined();

    expect(
      plan([
        { path: "A/Still.md", title: "Still", due: "2026-09-21", dueMinutes: 600, done: false, remind: "off" },
        { path: "A/Frueh.md", title: "Früh", due: "2026-09-21", dueMinutes: 600, done: false, remind: 60 },
        // A lead needs a moment to count back from: without a time the day rule stays.
        { path: "A/Tag.md", title: "Tag", due: "2026-09-21", done: false, remind: 60 },
      ]),
    ).toEqual([
      ["A/Frueh.md", at(2026, 9, 21, 9, 0)],
      ["A/Tag.md", at(2026, 9, 21, 9, 0)],
    ]);
  });

  it("done tasks and tasks without a date are never announced", () => {
    expect(plan([{ path: "a.md", title: "a", due: "2026-09-21", done: true }, { path: "b.md", title: "b", due: null, done: false }])).toEqual([]);
  });

  it("'Later' parks one moment that replaces the regular reminder — also for a task that is already overdue", () => {
    const tasks = [
      { path: "A/Heute.md", title: "Heute", due: "2026-09-20", dueMinutes: 9 * 60, done: false },
      { path: "A/Alt.md", title: "Alt", due: "2026-09-10", done: false },
    ];
    const hour = snoozeMoment("hour", NOW, 9 * 60);
    const tomorrow = snoozeMoment("tomorrow", NOW, 9 * 60);
    expect(hour).toBe(NOW + 3_600_000);
    expect(tomorrow).toBe(at(2026, 9, 21, 9, 0));
    expect(plan(tasks, RULE, { "A/Heute.md": hour, "A/Alt.md": tomorrow })).toEqual([
      ["A/Heute.md", hour],
      ["A/Alt.md", tomorrow],
    ]);
    // Without a parked moment the overdue task is out of the window, as before.
    expect(plan(tasks).map(([key]) => key)).toEqual(["A/Heute.md"]);
  });

  it("parked moments live per vault on this device, and what has passed is dropped on read", () => {
    const storage = memoryStorage();
    snoozeTask("vault-a", "A/Heute.md", NOW + 1000, NOW, storage);
    snoozeTask("vault-a", "A/Alt.md", NOW + 5000, NOW, storage);
    expect(readTaskSnoozes("vault-a", NOW, storage)).toEqual({ "A/Heute.md": NOW + 1000, "A/Alt.md": NOW + 5000 });
    expect(readTaskSnoozes("vault-a", NOW + 2000, storage)).toEqual({ "A/Alt.md": NOW + 5000 });
    expect(readTaskSnoozes("vault-b", NOW, storage)).toEqual({});
    storage.data.set(taskSnoozeKey("vault-a"), "not json");
    expect(readTaskSnoozes("vault-a", NOW, storage)).toEqual({});
  });
});
