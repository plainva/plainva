import { describe, expect, it } from "vitest";
import { readTasksMetadata, nextTasksDates, readTasksInvalidDates, setTasksField, tasksDescription } from "../src/vault/taskMetadata.js";
import { scanTasks } from "../src/vault/taskScan.js";
import { resolveTaskOrdinal, setChecklistTaskDone } from "../src/vault/taskMutation.js";

const options = { today: "2026-09-14", newId: () => "test-origin" };
describe("Tasks emoji metadata and source edits", () => {
  it("matches complete backtick runs and ignores metadata inside code spans", () => {
    const raw = "`` ` 📅 2026-01-01 ` `` 📅 2026-09-17";
    expect(readTasksMetadata(raw).due).toBe("2026-09-17");
    expect(tasksDescription(raw)).toBe("`` ` 📅 2026-01-01 ` ``");
    expect(readTasksMetadata("`unclosed 📅 2026-09-17").due).toBe("2026-09-17");
  });
  it("reads dates and explicit identity while preserving unknown content", () => {
    const text = "Überprüfung 😀 ➕ 2026-08-01 📅 2026-09-15 ✅ 2026-09-14 🆔 review-1 🔁 every 2 weeks 🧭 custom";
    const task = scanTasks("- [x] " + text)[0];
    expect(task).toMatchObject({ created: "2026-08-01", completed: "2026-09-14", due: "2026-09-15", taskId: "review-1", recurrenceSupported: false });
    expect(task.text).toBe(text); expect(tasksDescription(text)).toContain("Überprüfung 😀");
  });
  it("keeps invalid dates, duplicated fields, escaped emoji and inline code literal", () => {
    const text = "`📅 2026-01-01` \\➕ 2026-01-02 📅 2026-02-30 🆔 one 🆔 two 🔁 every week";
    expect(readTasksMetadata(text)).toMatchObject({ due: null, created: null, taskId: null, repeatRule: null });
    expect(tasksDescription(text)).toContain("📅 2026-02-30"); expect(tasksDescription(text)).toContain("🆔 one 🆔 two");
  });
  it("writes and removes completion dates without changing an existing ID", () => {
    const raw = "- [ ] Send report ➕ 2026-08-03 📅 2026-09-15 🆔 fixed-id 🧭 unknown\r\n";
    const done = setChecklistTaskDone(raw, 0, true, options);
    expect(done.content).toContain("✅ 2026-09-14\r\n"); expect(done.content).toContain("🆔 fixed-id 🧭 unknown");
    expect(setChecklistTaskDone(done.content, 0, false, options).content).toBe(raw);
    expect(setChecklistTaskDone(done.content, 0, true, options)).toEqual({ content: done.content, changed: false });
  });
  it("does not add metadata to ordinary checkboxes and keeps empty CRLF lines", () => {
    expect(setChecklistTaskDone("- [ ]\r\n- [ ] plain\r\n", 0, true, options).content).toBe("- [x]\r\n- [ ] plain\r\n");
  });
  it("resolves moved tasks by ID, never by their dates or identical descriptions", () => {
    const before = scanTasks("- [ ] Same 📅 2026-09-14 🆔 one\n- [ ] Same 📅 2026-09-14 🆔 two");
    const after = "- [ ] Same 📅 2026-10-01 🆔 two\n- [ ] Changed 📅 2026-10-02 🆔 one";
    expect(resolveTaskOrdinal(after, before[0])).toBe(1); expect(resolveTaskOrdinal(after, before[1])).toBe(0);
    expect(resolveTaskOrdinal(after + "\n- [ ] Duplicate 🆔 one", before[0])).toBe(-1);
  });
  it("creates exactly one successor and keeps the completed original ID", () => {
    const raw = "- [ ] Review 🆔 review-1 ➕ 2026-08-01 🔁 every week 📅 2026-09-01\r\n";
    const first = setChecklistTaskDone(raw, 0, true, options), tasks = scanTasks(first.content);
    expect(tasks).toHaveLength(2); expect(tasks[0]).toMatchObject({ done: false, due: "2026-09-08", created: "2026-09-14" });
    expect(tasks[1]).toMatchObject({ taskId: "review-1", done: true, due: "2026-09-01", completed: "2026-09-14" });
    expect(tasks[0].taskId).not.toBe("review-1"); expect(first.content.match(/\r\n/g)).toHaveLength(2);
    const undone = setChecklistTaskDone(first.content, 1, false, options);
    expect(scanTasks(setChecklistTaskDone(undone.content, 1, true, options).content)).toHaveLength(2);
  });
  it("keeps relative date distances when repeating from the completion day", () => {
    const meta = readTasksMetadata("🔁 every 2 weeks when done 🛫 2026-08-28 ⏳ 2026-08-30 📅 2026-09-01");
    expect(nextTasksDates(meta, "2026-09-14")).toEqual({ due: "2026-09-28", scheduled: "2026-09-26", start: "2026-09-24" });
  });
  it("does not emit out-of-range relative dates", () => {
    expect(nextTasksDates(readTasksMetadata("📅 9999-01-01 ⏳ 9999-12-31 🔁 every day"), options.today)).toBeNull();
  });
  it("does not duplicate a parent with children after a blank line", () => {
    const raw = "- [ ] Parent 🔁 every week\n\n  - [ ] Child";
    expect(scanTasks(raw)[0].recurrenceSupported).toBe(false);
    expect(scanTasks(setChecklistTaskDone(raw, 0, true, options).content)).toHaveLength(2);
  });
  it.each([["2026-01-31", "every month", "2026-02-28"], ["2024-02-29", "every year", "2025-02-28"], ["2026-12-31", "every 2 days", "2027-01-02"]])("handles %s with %s", (day, rule, next) => {
    expect(nextTasksDates(readTasksMetadata(`📅 ${day} 🔁 ${rule}`), options.today)?.due).toBe(next);
  });
  it.each(["every Monday", "every month on the last", "jeden Montag", "every week 🏁 delete", "every week ⛔ another", "every week 📅 2026-02-30"])("preserves unsupported rule %s without a guessed successor", rule => {
    const raw = `- [ ] Review 🔁 ${rule}`;
    const next = setChecklistTaskDone(raw, 0, true, options);
    expect(scanTasks(next.content)).toHaveLength(1); expect(next.content).toContain(`🔁 ${rule}`);
  });
  it("leaves nested content and native/provider recurrence to their existing owner", () => {
    for (const raw of ["- [ ] Parent 🔁 every week\n  - [ ] child", "---\nplainva:\n  repeat:\n    freq: weekly\n---\n- [ ] Item 🔁 every week", "---\nplainva:\n  pim:\n    uid: provider-id\n---\n- [ ] Item 🔁 every week"]) {
      expect(scanTasks(raw)[0].recurrenceSupported).toBe(false);
      expect(scanTasks(setChecklistTaskDone(raw, 0, true, options).content)).toHaveLength(scanTasks(raw).length);
    }
  });
});

describe("the cancelled date and invalid dates (plan Tasks-Abfragen, T1)", () => {
  it("reads ❌ as a field: kept in the source, left out of the description", () => {
    const text = "Dropped 📅 2026-10-20 ❌ 2026-10-24";
    expect(readTasksMetadata(text)).toMatchObject({ due: "2026-10-20", cancelled: "2026-10-24" });
    expect(tasksDescription(text)).toBe("Dropped");
    expect(setTasksField(text, "cancelled", null)).toBe("Dropped 📅 2026-10-20");
  });
  it("names the dated fields whose value is no day", () => {
    expect(readTasksInvalidDates("a 📅 2026-02-30 ⏳ 2026-02-28 ✅ 2026-13-01")).toEqual(["due", "done"]);
    expect(readTasksInvalidDates("a `📅 2026-02-30` 📅 2026-02-27")).toEqual([]);
    expect(readTasksInvalidDates("a 📅 tomorrow")).toEqual([]);
    expect(readTasksInvalidDates("a ❌ 2026-02-31 🛫 2026-04-31 ➕ 2025-02-29")).toEqual(["cancelled", "start", "created"]);
  });
  it("a recurring successor carries no cancelled date, and a cancelled task with fields gets its done date", () => {
    const done = setChecklistTaskDone("- [ ] Water 📅 2026-09-14 🔁 every week ❌ 2026-09-01\n", 0, true, options);
    expect(done.content).toBe("- [ ] Water 📅 2026-09-21 🔁 every week 🆔 pv-" + done.content.split("🆔 pv-")[1].split("\n")[0] + "\n- [x] Water 📅 2026-09-14 🔁 every week ❌ 2026-09-01 🆔 test-origin ✅ 2026-09-14\n");
  });
});
