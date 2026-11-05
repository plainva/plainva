import { describe, expect, it } from "vitest";
import { readTasksMetadata, readTasksPriority, scanTasks, taskNameText, type TaskRecord } from "@plainva/core";
import { appendJournalEntry, checkboxTextOfCapture, parseTaskCapture, plannerRowsFromTasks, tasksRecurrenceOf, taskTextToTitle, type CaptureVocabulary, type JournalFiles } from "@plainva/ui";

describe("a journal task's name", () => {
  const record = (text: string, journalTime?: string): TaskRecord => ({ ...scanTasks(`- [ ] ${text}\n`)[0], path: "2026-11-05.md", title: "2026-11-05", excluded: false, ...(journalTime ? { journalTime } : {}) });

  it("every task list shows it without the time it was noted; the line keeps the stamp for every write", () => {
    const [row] = plannerRowsFromTasks([record("10:15 Steuerunterlagen sortieren #steuer 📅 2026-11-06 14:30", "10:15")]);
    expect(row.title).toBe("Steuerunterlagen sortieren");
    expect(row.line?.text).toBe("10:15 Steuerunterlagen sortieren #steuer 📅 2026-11-06 14:30");
    expect(row.dueMinutes).toBe(14 * 60 + 30);
  });

  it("a task the index did not mark keeps its time as words: outside a daily note it is the task's own", () => {
    expect(plannerRowsFromTasks([record("10:15 call Anna")])[0].title).toBe("10:15 call Anna");
  });

  it("a promoted journal task is titled without the stamp", () => {
    expect(taskTextToTitle(taskNameText(record("10:15 Call Anna 📅 2026-11-06", "10:15")))).toBe("Call Anna");
  });
});

/**
 * A task captured without a task database (plan Rückmeldungen 2026-11-05, E1):
 * a checkbox line in today's journal — the Siri and Shortcuts rule — carrying
 * what the capture recognised as the Tasks plugin's marks.
 */

const VOCAB: CaptureVocabulary = {
  today: ["today"], tomorrow: ["tomorrow"], dayAfterTomorrow: [], nextWeek: ["next week"], inDays: ["in {n} days"], inWeeks: ["in {n} weeks"],
  weekdays: [["monday"], ["tuesday"], ["wednesday"], ["thursday"], ["friday"], ["saturday"], ["sunday"]],
  daily: ["daily"], weekly: ["weekly"], monthly: ["monthly"], yearly: ["yearly"], every: ["every"], everyNDays: ["every {n} days"], everyNWeeks: ["every {n} weeks"],
  oclock: [], at: ["at"], dateOrder: "ymd",
};
const TODAY = "2026-11-05";

describe("checkboxTextOfCapture", () => {
  it("is the title alone when nothing else was recognised", () => {
    expect(checkboxTextOfCapture(parseTaskCapture("Steuerunterlagen sortieren", VOCAB, TODAY))).toBe("Steuerunterlagen sortieren");
  });

  it("writes tags, priority, rhythm and the due date with its time in the Tasks plugin's order", () => {
    const text = checkboxTextOfCapture({ title: "Call the bank", tags: ["money"], priority: 1, repeat: { freq: "weekly", interval: 1, from: "due" }, due: "2026-11-06", minutes: 14 * 60 + 30 });
    expect(text).toBe("Call the bank #money ⏫ 🔁 every week 📅 2026-11-06 14:30");
    const meta = readTasksMetadata(text);
    expect(meta).toMatchObject({ due: "2026-11-06", dueTime: "14:30", repeatRule: { unit: "week", interval: 1, whenDone: false } });
    expect(readTasksPriority(text)).toBe(1);
  });

  it("writes a day without a time as a day", () => {
    expect(checkboxTextOfCapture(parseTaskCapture("Pay rent tomorrow", VOCAB, TODAY))).toBe("Pay rent 📅 2026-11-06");
  });

  it("is empty without a title", () => {
    expect(checkboxTextOfCapture({ title: "  ", tags: [], priority: 0, repeat: null, due: null, minutes: null })).toBe("");
  });

  it("says a rule in the words the Tasks plugin reads back", () => {
    expect(tasksRecurrenceOf({ freq: "daily", interval: 3, from: "completion" })).toBe("every 3 days when done");
    expect(readTasksMetadata(`x 🔁 ${tasksRecurrenceOf({ freq: "monthly", interval: 2, from: "due" })}`).repeatRule).toEqual({ unit: "month", interval: 2, whenDone: false });
  });
});

describe("a captured task in today's daily note", () => {
  it("lands as an open checkbox in the journal, through the journal's one writer", async () => {
    const PATH = "Daily/2026-11-05.md";
    const files = new Map<string, string>([[PATH, "# 2026-11-05\n\n## Journal\n- 09:00 Coffee\n"]]);
    const journal: JournalFiles = {
      ensureDailyNote: async () => ({ path: PATH, created: false }),
      readTextFile: async (path) => files.get(path) ?? "",
      writeTextFile: async (path, content) => { files.set(path, content); },
    };
    const text = checkboxTextOfCapture(parseTaskCapture("Steuerunterlagen sortieren today at 14:30", VOCAB, TODAY));
    const result = await appendJournalEntry(journal, { date: new Date(2026, 10, 5), text, heading: "Journal", task: true, now: new Date(2026, 10, 5, 10, 15) });
    expect(result.ok).toBe(true);
    const note = files.get(PATH)!;
    expect(note).toContain("- [ ] 10:15 Steuerunterlagen sortieren 📅 2026-11-05 14:30\n");
    expect(note.startsWith("# 2026-11-05\n\n## Journal\n- 09:00 Coffee\n")).toBe(true);
    const task = scanTasks(note).find((t) => t.text.includes("Steuerunterlagen"))!;
    expect(task).toMatchObject({ done: false, due: "2026-11-05", dueTime: "14:30" });
  });
});
