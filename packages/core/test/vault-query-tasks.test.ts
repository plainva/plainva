import { describe, it, expect } from "vitest";
import { VaultQueryService } from "../src/vault/VaultQueryService.ts";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import { splitJournalStamp, taskNameText, withTaskName } from "../src/journal.ts";
import { setChecklistTaskDue } from "../src/vault/taskMutation.ts";
import { scanTasks } from "../src/vault/taskScan.ts";

describe("VaultQueryService.listTasks", () => {
  it("flattens tasks across notes with path and title", async () => {
    const db = new MockDatabaseAdapter();
    db.mockedResults = [
      [
        { path: "a.md", title: "A", content: "- [ ] one\n- [x] two" },
        { path: "sub/b.md", title: null, content: "no tasks here" },
        { path: "c.md", title: "C", content: "- [ ] three #tag 📅 2026-08-01" },
      ],
    ];
    const tasks = await new VaultQueryService(db).listTasks();
    expect(tasks.map((t) => [t.path, t.title, t.ordinal, t.done, t.text])).toEqual([
      ["a.md", "A", 0, false, "one"],
      ["a.md", "A", 1, true, "two"],
      ["c.md", "C", 0, false, "three #tag 📅 2026-08-01"],
    ]);
    expect(tasks[2].tags).toEqual(["tag"]);
    expect(tasks[2].due).toBe("2026-08-01");
  });

  it("derives a title from the filename when the index has none", async () => {
    const db = new MockDatabaseAdapter();
    db.mockedResults = [[{ path: "notes/Todo.md", title: null, content: "- [ ] x" }]];
    const tasks = await new VaultQueryService(db).listTasks();
    expect(tasks[0].title).toBe("Todo");
  });

  it("marks a note excluded when its frontmatter carries plainva.tasks: false", async () => {
    const db = new MockDatabaseAdapter();
    db.mockedResults = [
      [
        { path: "Templates/Weekly.md", title: "Weekly", content: "---\nplainva:\n  tasks: false\n---\n- [ ] placeholder" },
        { path: "Real.md", title: "Real", content: "---\nplainva:\n  tasks: true\n---\n- [ ] do it" },
        { path: "Plain.md", title: "Plain", content: "- [ ] no frontmatter" },
      ],
    ];
    const tasks = await new VaultQueryService(db).listTasks();
    const excludedByPath = Object.fromEntries(tasks.map((t) => [t.path, t.excluded]));
    expect(excludedByPath["Templates/Weekly.md"]).toBe(true);
    expect(excludedByPath["Real.md"]).toBe(false);
    expect(excludedByPath["Plain.md"]).toBe(false);
  });
});

/**
 * A task the journal wrote (`- [ ] 10:15 Call Anna`, by Siri, Shortcuts or the
 * capture without a task database) is named without its time: the stamp is
 * the entry's (plan Rückmeldungen 2026-11-05). Only in a daily note — where
 * the journal writes; a hand-written `- [ ] 10:15 call Anna` elsewhere keeps
 * its text — and the file is never rewritten for it.
 */
describe("the journal stamp in front of a task", () => {
  const DAILY = ["# 2026-11-05", "", "## Journal", "", "- [ ] 10:15 Call Anna 📅 2026-11-06 14:30", "- 11:00 Coffee", "- [ ] Plain task", "- [x] 09:05:30 Done early", ""].join("\n");
  const OTHER = ["- [ ] 10:15 call Anna", ""].join("\n");
  const service = () => {
    const db = new MockDatabaseAdapter();
    db.mockedResults = [[
      { path: "Daily/2026-11-05.md", title: "2026-11-05", content: DAILY },
      { path: "Projects/Calls.md", title: "Calls", content: OTHER },
    ]];
    const query = new VaultQueryService(db);
    query.setDayOfPath((path) => (/^Daily\/\d{4}-\d{2}-\d{2}\.md$/.test(path) ? path.slice(6, 16) : null));
    return query;
  };

  it("reads the stamp in a daily note only, and keeps the text as it stands", async () => {
    const tasks = await service().listTasks();
    expect(tasks.map((t) => [t.path, t.text, t.journalTime ?? null, taskNameText(t)])).toEqual([
      ["Daily/2026-11-05.md", "10:15 Call Anna 📅 2026-11-06 14:30", "10:15", "Call Anna 📅 2026-11-06 14:30"],
      ["Daily/2026-11-05.md", "Plain task", null, "Plain task"],
      ["Daily/2026-11-05.md", "09:05:30 Done early", "09:05:30", "Done early"],
      ["Projects/Calls.md", "10:15 call Anna", null, "10:15 call Anna"],
    ]);
    // Its due date and time are still read from the line.
    expect(tasks[0]).toMatchObject({ due: "2026-11-06", dueTime: "14:30" });
  });

  it("reads nothing without the daily-note naming", async () => {
    const db = new MockDatabaseAdapter();
    db.mockedResults = [[{ path: "Daily/2026-11-05.md", title: "2026-11-05", content: DAILY }]];
    const tasks = await new VaultQueryService(db).listTasks();
    expect(tasks.every((t) => t.journalTime === undefined)).toBe(true);
  });

  it("is the journal's own rule: a time of day, then the text", () => {
    expect(splitJournalStamp("10:15 Call Anna")).toEqual({ time: "10:15", name: "Call Anna" });
    expect(splitJournalStamp("7:05 early")).toEqual({ time: "7:05", name: "early" });
    expect(splitJournalStamp("25:00 not a time")).toBeNull();
    expect(splitJournalStamp("10:15h meeting")).toBeNull();
    expect(splitJournalStamp("Call Anna at 10:15")).toBeNull();
  });

  it("a renamed task keeps its stamp in front; a task without one gets none", () => {
    expect(withTaskName({ text: "10:15 Call Anna", journalTime: "10:15" }, "Call Anna back")).toBe("10:15 Call Anna back");
    expect(withTaskName({ text: "10:15 call Anna" }, "call Anna back")).toBe("call Anna back");
    expect(withTaskName({ text: "Plain task" }, "Renamed")).toBe("Renamed");
  });

  it("a write finds the line by its text, stamp included", () => {
    const [task] = scanTasks(DAILY);
    expect(task.text).toBe("10:15 Call Anna 📅 2026-11-06 14:30");
    const moved = setChecklistTaskDue(DAILY, 0, "2026-11-07", null);
    expect(moved.content.split("\n")).toContain("- [ ] 10:15 Call Anna 📅 2026-11-07");
  });
});
