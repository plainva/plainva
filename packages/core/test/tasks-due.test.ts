import { describe, expect, it } from "vitest";
import { setChecklistTaskDue } from "../src/vault/taskMutation.js";
import { scanTasks } from "../src/vault/taskScan.js";

/**
 * The due day of a checkbox, set from the task views (plan Befunde 2026-10-06,
 * W2/W3): a tap on a task's date opens the date picker, and "all overdue to
 * today" moves many at once. One line changes, one field in it; everything
 * else in the note stays byte for byte.
 */
describe("setChecklistTaskDue", () => {
  const note = "# Liste\r\n\r\n- [ ] Angebot ⏫ 📅 2026-09-21 🔁 every week #kunde\r\n  - [x] Bericht\r\n* [ ] Anruf ^block-1\r\n";

  it("replaces the day and leaves the rest of the line alone", () => {
    const next = setChecklistTaskDue(note, 0, "2026-10-06");
    expect(next.changed).toBe(true);
    expect(next.content).toBe(note.replace("📅 2026-09-21", "📅 2026-10-06"));
    expect(scanTasks(next.content)[0].due).toBe("2026-10-06");
  });

  it("adds the field to a task without one, in front of a block id", () => {
    const next = setChecklistTaskDue(note, 2, "2026-10-06");
    expect(next.content).toContain("* [ ] Anruf 📅 2026-10-06 ^block-1\r\n");
    expect(scanTasks(next.content)[2].due).toBe("2026-10-06");
  });

  it("clears the field with null", () => {
    const next = setChecklistTaskDue(note, 0, null);
    expect(next.content).toContain("- [ ] Angebot ⏫ 🔁 every week #kunde\r\n");
  });

  it("writes nothing when the day is already the one asked for, or the task is not there", () => {
    expect(setChecklistTaskDue(note, 0, "2026-09-21")).toEqual({ content: note, changed: false });
    expect(setChecklistTaskDue(note, 9, "2026-10-06")).toEqual({ content: note, changed: false });
  });

  it("leaves a line with two due dates alone — which one is meant is not Plainva's to guess", () => {
    const twice = "- [ ] Angebot 📅 2026-09-21 📅 2026-09-22";
    expect(setChecklistTaskDue(twice, 0, "2026-10-06")).toEqual({ content: twice, changed: false });
  });

  it("refuses a value that is not a calendar day", () => {
    expect(() => setChecklistTaskDue(note, 0, "2026-02-30")).toThrow("invalid_task_due_day");
    expect(() => setChecklistTaskDue(note, 0, "morgen")).toThrow("invalid_task_due_day");
  });
});
