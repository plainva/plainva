import { describe, expect, it } from "vitest";
import { scanTasks } from "@plainva/core";
import {
  applyTaskDueChanges, buildPlanner, formatPickedDay, overdueToDayChanges, plannerRowsFromDb, plannerRowsFromTasks, withDueDay,
  type PlannerRow, type TaskDueChange, type TaskDueDeps,
} from "@plainva/ui";

/**
 * Moving a task's due day (plan Befunde 2026-10-06, W2/W3): a tap on a task's
 * date opens the date picker, "All to today" moves the Overdue section, and
 * every move can be undone. Both shells call this one function; what is pinned
 * here is what the desktop popover and the phone's sheet write.
 */

const DB_NOTE = "---\ntype: task\nstatus: Open\ndue: 2026-10-01T14:00\n---\n# Offer\n";
const DAY_NOTE = "---\ntype: task\ndue: 2026-09-28\n---\n# Report\n";
const LIST = "# Shopping\n\n- [ ] Milk 📅 2026-10-02 #home\n- [ ] Bread\n- [x] Eggs 📅 2026-09-30\n- [ ] Tea ⏫ 📅 2026-10-03 🔁 every week\n";

function vault(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const writes: string[] = [];
  const deps: TaskDueDeps = {
    readTextFile: async (path) => {
      const text = store.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    writeNoteText: async (path, content) => { writes.push(path); store.set(path, content); },
    writeDbNote: async (path, mutate) => {
      const raw = store.get(path);
      if (raw === undefined) throw new Error(`missing ${path}`);
      const next = mutate(raw);
      if (next !== raw) { writes.push(path); store.set(path, next); }
    },
    dueKey: "due",
  };
  return { deps, store, writes };
}

const line = (path: string, content: string, ordinal: number): TaskDueChange & { source: "note" } => {
  const task = scanTasks(content)[ordinal];
  return { source: "note", path, task: { ordinal, text: task.text }, day: "2026-10-06" };
};

describe("withDueDay", () => {
  it("changes the day and keeps the time of day as written", () => {
    expect(withDueDay("2026-10-01T14:00", "2026-10-06")).toBe("2026-10-06T14:00");
    expect(withDueDay("2026-10-01 09:30:00", "2026-10-06")).toBe("2026-10-06 09:30:00");
    expect(withDueDay("2026-10-01", "2026-10-06")).toBe("2026-10-06");
  });

  it("writes a plain day where there was no date to keep anything of", () => {
    expect(withDueDay(undefined, "2026-10-06")).toBe("2026-10-06");
    expect(withDueDay("soon", "2026-10-06")).toBe("2026-10-06");
  });
});

describe("applyTaskDueChanges", () => {
  it("moves a database entry in its date column and leaves the clock alone", async () => {
    const { deps, store } = vault({ "Tasks/Offer.md": DB_NOTE });
    const outcome = await applyTaskDueChanges(deps, [{ source: "database", path: "Tasks/Offer.md", day: "2026-10-06" }]);
    expect(outcome).toMatchObject({ moved: 1, skipped: 0 });
    expect(store.get("Tasks/Offer.md")).toBe(DB_NOTE.replace("2026-10-01T14:00", "2026-10-06T14:00"));
    expect(outcome.undo).toEqual([{ source: "database", path: "Tasks/Offer.md", day: "2026-10-01" }]);
  });

  it("moves a checkbox by its 📅 field and nothing else on the line", async () => {
    const { deps, store } = vault({ "Shopping.md": LIST });
    const outcome = await applyTaskDueChanges(deps, [line("Shopping.md", LIST, 3)]);
    expect(outcome.moved).toBe(1);
    expect(store.get("Shopping.md")).toBe(LIST.replace("📅 2026-10-03", "📅 2026-10-06"));
    expect(outcome.lines).toEqual([{ path: "Shopping.md", ordinal: 3, text: "Tea ⏫ 📅 2026-10-06 🔁 every week", day: "2026-10-06" }]);
  });

  it("gives a task without a date one — and undo takes it away again, byte for byte", async () => {
    const bare = "---\ntype: task\nstatus: Open\n---\n# Idea\n";
    const { deps, store } = vault({ "Shopping.md": LIST, "Tasks/Idea.md": bare });
    const outcome = await applyTaskDueChanges(deps, [line("Shopping.md", LIST, 1), { source: "database", path: "Tasks/Idea.md", day: "2026-10-06" }]);
    expect(outcome.moved).toBe(2);
    expect(store.get("Shopping.md")).toContain("- [ ] Bread 📅 2026-10-06\n");
    expect(store.get("Tasks/Idea.md")).toContain("due: 2026-10-06");
    // There was no day to go back to: undo is "no date".
    expect(outcome.undo.map((change) => change.day)).toEqual([null, null]);
    const back = await applyTaskDueChanges(deps, outcome.undo);
    expect(back).toMatchObject({ moved: 2, skipped: 0 });
    expect(store.get("Shopping.md")).toBe(LIST);
    expect(store.get("Tasks/Idea.md")).toBe(bare);
  });

  it("offers no undo where the column held something that was not a date", async () => {
    const odd = "---\ndue: soon\n---\n# Odd\n";
    const { deps, store } = vault({ "Tasks/Odd.md": odd });
    const outcome = await applyTaskDueChanges(deps, [{ source: "database", path: "Tasks/Odd.md", day: "2026-10-06" }]);
    expect(outcome).toMatchObject({ moved: 1, undo: [] });
    expect(store.get("Tasks/Odd.md")).toContain("due: 2026-10-06");
  });

  it("writes a note once however many of its tasks move", async () => {
    const { deps, store, writes } = vault({ "Shopping.md": LIST });
    const outcome = await applyTaskDueChanges(deps, [line("Shopping.md", LIST, 0), line("Shopping.md", LIST, 3)]);
    expect(outcome.moved).toBe(2);
    expect(writes).toEqual(["Shopping.md"]);
    expect(outcome.notePaths).toEqual(["Shopping.md"]);
    expect(scanTasks(store.get("Shopping.md")!).map((task) => task.due)).toEqual(["2026-10-06", null, "2026-09-30", "2026-10-06"]);
  });

  it("undo puts every task back on the day it had", async () => {
    const { deps, store } = vault({ "Tasks/Offer.md": DB_NOTE, "Tasks/Report.md": DAY_NOTE, "Shopping.md": LIST });
    const outcome = await applyTaskDueChanges(deps, [
      { source: "database", path: "Tasks/Offer.md", day: "2026-10-06" },
      { source: "database", path: "Tasks/Report.md", day: "2026-10-06" },
      line("Shopping.md", LIST, 0),
      line("Shopping.md", LIST, 3),
    ]);
    expect(outcome.moved).toBe(4);
    const back = await applyTaskDueChanges(deps, outcome.undo);
    expect(back).toMatchObject({ moved: 4, skipped: 0 });
    expect(store.get("Tasks/Offer.md")).toBe(DB_NOTE);
    expect(store.get("Tasks/Report.md")).toBe(DAY_NOTE);
    expect(store.get("Shopping.md")).toBe(LIST);
  });

  it("leaves a task alone that changed since it was listed, and says so", async () => {
    const { deps, store } = vault({ "Shopping.md": LIST.replace("Milk", "Oat milk") });
    const outcome = await applyTaskDueChanges(deps, [line("Shopping.md", LIST, 0), line("Shopping.md", LIST, 3)]);
    expect(outcome).toMatchObject({ moved: 1, skipped: 1 });
    expect(store.get("Shopping.md")).toContain("Oat milk 📅 2026-10-02");
  });

  it("counts an unreadable note and a database without a date column as skipped, and goes on", async () => {
    const { deps, store } = vault({ "Shopping.md": LIST, "Tasks/Offer.md": DB_NOTE });
    const outcome = await applyTaskDueChanges({ ...deps, dueKey: null }, [
      { source: "database", path: "Tasks/Offer.md", day: "2026-10-06" },
      { source: "note", path: "Gone.md", task: { ordinal: 0, text: "x" }, day: "2026-10-06" },
      line("Shopping.md", LIST, 0),
    ]);
    expect(outcome).toMatchObject({ moved: 1, skipped: 2 });
    expect(store.get("Tasks/Offer.md")).toBe(DB_NOTE);
  });

  it("writes nothing for a day that is not one, and nothing when the day is already there", async () => {
    const { deps, writes } = vault({ "Tasks/Report.md": DAY_NOTE });
    const outcome = await applyTaskDueChanges(deps, [
      { source: "database", path: "Tasks/Report.md", day: "tomorrow" },
      { source: "database", path: "Tasks/Report.md", day: "2026-09-28" },
    ]);
    expect(outcome).toMatchObject({ moved: 0, skipped: 1, undo: [] });
    expect(writes).toEqual([]);
  });
});

describe("all overdue to today", () => {
  const tasks = scanTasks(LIST).map((task) => ({ ...task, path: "Shopping.md", title: "Shopping", excluded: false }));
  const rows: PlannerRow[] = [
    ...plannerRowsFromDb([
      { path: "Tasks/Offer.md", title: "Offer", status: "Open", done: false, due: "2026-10-01", dueMinutes: 840 },
      { path: "Tasks/Done.md", title: "Done", status: "Done", done: true, due: "2026-09-20" },
      { path: "Tasks/Later.md", title: "Later", status: "Open", done: false, due: "2026-10-09" },
    ], () => undefined),
    ...plannerRowsFromTasks(tasks as never),
  ];

  it("takes exactly the open rows the planner lists as overdue", () => {
    const overdue = buildPlanner(rows, "2026-10-06").sections("today").find((section) => section.kind === "overdue")!.rows;
    const changes = overdueToDayChanges(overdue, "2026-10-06", (row) => tasks.find((task) => task.ordinal === row.ordinal));
    expect(changes.map((change) => [change.source, change.path, change.source === "note" ? change.task.ordinal : null, change.day])).toEqual([
      ["database", "Tasks/Offer.md", null, "2026-10-06"],
      ["note", "Shopping.md", 0, "2026-10-06"],
      ["note", "Shopping.md", 3, "2026-10-06"],
    ]);
  });

  it("drops a checkbox row whose line is not known any more instead of guessing", () => {
    const overdue = buildPlanner(rows, "2026-10-06").sections("today").find((section) => section.kind === "overdue")!.rows;
    expect(overdueToDayChanges(overdue, "2026-10-06", () => undefined).map((change) => change.source)).toEqual(["database"]);
  });
});

describe("the day a confirmation names", () => {
  it("carries the weekday, and the year only when it is another one", () => {
    const today = new Date(2026, 9, 6);
    expect(formatPickedDay("2026-10-09", "en", today)).toBe("Fri, 10/09");
    expect(formatPickedDay("2026-10-09", "de", today)).toBe("Fr., 09.10.");
    expect(formatPickedDay("2027-01-04", "en", today)).toBe("Mon, 01/04/2027");
    expect(formatPickedDay("soon", "en", today)).toBe("soon");
  });
});
