import { describe, it, expect } from "vitest";
import { reminderDiagnosis, type ReminderRunState } from "@plainva/ui";

/**
 * The line that answers "why do I get no task reminders" (plan Mobile-Feedback,
 * P1/5). Shared by both shells, so it is tested once here.
 */

const AT = Date.UTC(2026, 7, 22, 7, 30);
const time = () => "07:30";

function state(patch: Partial<ReminderRunState> = {}): ReminderRunState {
  return { events: 12, tasks: 3, lastRunTs: AT, reason: "ok", ...patch };
}

describe("reminderDiagnosis", () => {
  it("says nothing when nothing is switched on", () => {
    expect(reminderDiagnosis(state({ reason: "off" }), time)).toBeNull();
  });

  it("says nothing when permission was refused - a banner already does", () => {
    expect(reminderDiagnosis(state({ reason: "denied" }), time)).toBeNull();
  });

  it("says nothing before the first run rather than an empty time", () => {
    expect(reminderDiagnosis(state({ lastRunTs: null }), time)).toBeNull();
  });

  it("carries the counts and the run time", () => {
    expect(reminderDiagnosis(state(), time)).toEqual({
      planned: { events: 12, tasks: 3, time: "07:30" },
      reasonKey: null,
    });
  });

  it("adds no second sentence when tasks are simply switched off", () => {
    // The switch above the line is the explanation; repeating it under an off
    // switch is noise, and noise is what makes this line get skipped.
    expect(reminderDiagnosis(state({ tasks: 0, reason: "tasksOff" }), time)?.reasonKey).toBeNull();
  });

  it.each([
    ["noTaskDb", "reminders.diagNoTaskDb"],
    ["taskDbUnreadable", "reminders.diagTaskDbUnreadable"],
    ["taskDueNotDate", "reminders.diagTaskDueNotDate"],
  ] as const)("names %s so a zero is not read as 'there is nothing'", (reason, key) => {
    const out = reminderDiagnosis(state({ tasks: 0, reason }), time);
    expect(out).not.toBeNull();
    expect(out?.reasonKey).toBe(key);
    // The counts stay: "12 appointments, 0 tasks" is half the diagnosis.
    expect(out?.planned.events).toBe(12);
  });
});
