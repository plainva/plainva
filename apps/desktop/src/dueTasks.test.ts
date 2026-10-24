import { describe, expect, it, vi } from "vitest";
import type { TaskRecord } from "@plainva/core";
import { buildWidgetSnapshot, checkboxJumpTerm, dueRowsByDay, dueTaskRows, dueTasksForDay, noteTaskTick, serializeWidgetSnapshot, tickCompletes, type PlannerRow, type TaskDbRow } from "@plainva/ui";

/**
 * What is due on a day (TestFlight, build 136, Sammelplan § 3.145 Nr. 1): a
 * checkbox with a Tasks-plugin `📅` due today was on the planner's Today list
 * and missing under the phone's Today → Due, because that surface — like both
 * calendars and the widget — read the task database alone. One rule now
 * answers for every surface, over the planner's row shape.
 */

function note(over: Partial<TaskRecord> & { text: string }): TaskRecord {
  return { path: "Haushalt.md", title: "Haushalt", excluded: false, line: 2, ordinal: 0, done: false, state: "open", tags: [], due: null, ...over };
}
function db(over: Partial<TaskDbRow> & { path: string }): TaskDbRow {
  return { title: over.path.replace(/\.md$/, ""), status: null, done: false, due: null, ...over };
}
const titles = (rows: readonly PlannerRow[]) => rows.map((r) => r.title);

describe("dueTaskRows: which tasks take part", () => {
  it("reads both sources, and a note that opts out of task aggregation stays out", () => {
    const rows = dueTaskRows({
      database: [db({ path: "Aufgaben/Angebot.md", due: "2026-09-20" })],
      notes: [
        note({ text: "Drucker einrichten 📅 2026-09-20", due: "2026-09-20" }),
        note({ path: "Vorlage.md", title: "Vorlage", excluded: true, text: "Vorlagenaufgabe 📅 2026-09-20", due: "2026-09-20" }),
      ],
    });
    expect(rows.map((r) => [r.source, r.title])).toEqual([["database", "Aufgaben/Angebot"], ["note", "Drucker einrichten"]]);
  });

  it("gives a checkbox row the line a write finds again — text and Tasks-plugin id", () => {
    const [row] = dueTaskRows({ notes: [note({ ordinal: 3, text: "Steuer 🆔 abc 📅 2026-09-18", taskId: "abc", due: "2026-09-18" })] });
    expect(row.line).toEqual({ ordinal: 3, text: "Steuer 🆔 abc 📅 2026-09-18", taskId: "abc" });
  });
});

describe("dueTasksForDay: what one day shows", () => {
  const rows = dueTaskRows({
    database: [
      db({ path: "Angebot.md", due: "2026-09-20", dueMinutes: 14 * 60 }),
      db({ path: "Steuer.md", due: "2026-09-18" }),
      db({ path: "Erledigt.md", due: "2026-09-17", done: true }),
    ],
    notes: [
      note({ ordinal: 0, text: "Drucker einrichten 📅 2026-09-20", due: "2026-09-20" }),
      note({ ordinal: 1, text: "Rechnung bezahlen 📅 2026-09-17", due: "2026-09-17" }),
      note({ ordinal: 2, text: "Brief eingeworfen 📅 2026-09-20", due: "2026-09-20", done: true, state: "done" }),
      note({ ordinal: 3, text: "Kuchen backen ⏫ 📅 2026-09-22", due: "2026-09-22", priority: 1 }),
      note({ ordinal: 4, text: "Keller", due: null, state: "progress" }),
    ],
  });

  it("on today: what is late leads, oldest first, then the day's own — from both sources", () => {
    const day = dueTasksForDay(rows, "2026-09-20", { today: "2026-09-20" });
    expect(titles(day.overdue)).toEqual(["Rechnung bezahlen", "Steuer"]);
    // The planner's order: a chosen time before none, then the name.
    expect(titles(day.due)).toEqual(["Angebot", "Drucker einrichten"]);
  });

  it("any other day shows what is due on it and nothing that is late", () => {
    const day = dueTasksForDay(rows, "2026-09-22", { today: "2026-09-20" });
    expect(day.overdue).toEqual([]);
    expect(titles(day.due)).toEqual(["Kuchen backen"]);
  });

  it("lists finished tasks of the day only when asked, and never as late", () => {
    expect(titles(dueTasksForDay(rows, "2026-09-20", { today: "2026-09-20", includeDone: true }).due)).toEqual(["Angebot", "Brief eingeworfen", "Drucker einrichten"]);
    expect(titles(dueTasksForDay(rows, "2026-09-20", { today: "2026-09-20", includeDone: true }).overdue)).not.toContain("Erledigt");
  });

  it("before the day boundary the diary's today is yesterday, and its late list never repeats its own tasks", () => {
    // 01:30 on the 21st with a 04:00 boundary: the Today screen still shows the 20th.
    const day = dueTasksForDay(rows, "2026-09-20", { today: "2026-09-21", diaryToday: "2026-09-20" });
    expect(titles(day.due)).toEqual(["Angebot", "Drucker einrichten"]);
    expect(titles(day.overdue)).toEqual(["Rechnung bezahlen", "Steuer"]);
    // The calendar's today, selected, is today as well: the 20th is late there.
    expect(titles(dueTasksForDay(rows, "2026-09-21", { today: "2026-09-21", diaryToday: "2026-09-20" }).overdue)).toEqual(["Rechnung bezahlen", "Steuer", "Angebot", "Drucker einrichten"]);
  });

  it("before the day boundary the diary's today also holds what is due on the calendar's today — the planner's Today at that hour", () => {
    const withToday = [...rows, ...dueTaskRows({ notes: [note({ ordinal: 9, text: "Müll rausbringen 📅 2026-09-21", due: "2026-09-21" })] })];
    const day = dueTasksForDay(withToday, "2026-09-20", { today: "2026-09-21", diaryToday: "2026-09-20" });
    expect(titles(day.due)).toEqual(["Angebot", "Drucker einrichten", "Müll rausbringen"]);
    expect(titles(day.overdue)).toEqual(["Rechnung bezahlen", "Steuer"]);
    // After the boundary the diary is on the 21st too: the 20th is late, the 21st due.
    const later = dueTasksForDay(withToday, "2026-09-21", { today: "2026-09-21", diaryToday: "2026-09-21" });
    expect(titles(later.due)).toEqual(["Müll rausbringen"]);
    // Another day reaches no further than itself.
    expect(titles(dueTasksForDay(withToday, "2026-09-19", { today: "2026-09-21", diaryToday: "2026-09-20" }).due)).toEqual([]);
  });

  it("a due value that is not a day is on no day", () => {
    const odd = dueTaskRows({ database: [db({ path: "Bald.md", due: "bald" })] });
    expect(dueTasksForDay(odd, "2026-09-20", { today: "2026-09-20" })).toEqual({ overdue: [], due: [] });
  });
});

describe("dueRowsByDay: the rows on a calendar", () => {
  it("puts open and finished tasks of both sources on their day, nothing undated", () => {
    const byDay = dueRowsByDay(
      dueTaskRows({
        database: [db({ path: "Angebot.md", due: "2026-09-20" })],
        notes: [note({ text: "Brief 📅 2026-09-20", due: "2026-09-20", done: true, state: "done" }), note({ ordinal: 1, text: "Keller", due: null })],
      }),
    );
    expect([...byDay.keys()]).toEqual(["2026-09-20"]);
    expect(titles(byDay.get("2026-09-20")!)).toEqual(["Angebot", "Brief"]);
  });
});

describe("noteTaskTick: what a tick on a checkbox row writes", () => {
  const text = "# Haushalt\n\n- [ ] Drucker einrichten 📅 2026-09-20\n- [ ] Rechnung bezahlen 📅 2026-09-17\n";

  it("ticks the line it was read from and nothing else, with the completion date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 10, 0));
    try {
      const next = noteTaskTick({ ordinal: 1, text: "Rechnung bezahlen 📅 2026-09-17" }, true)(text);
      expect(next).toBe("# Haushalt\n\n- [ ] Drucker einrichten 📅 2026-09-20\n- [x] Rechnung bezahlen 📅 2026-09-17 ✅ 2026-09-20\n");
      // And back: reopening takes the completion date away again.
      expect(noteTaskTick({ ordinal: 1, text: "Rechnung bezahlen 📅 2026-09-17 ✅ 2026-09-20" }, false)(next!)).toBe(text);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes nothing when the note changed under the row: never the neighbour", () => {
    const moved = "# Haushalt\n\n- [ ] Neu oben\n- [ ] Drucker einrichten 📅 2026-09-20\n- [ ] Rechnung bezahlen 📅 2026-09-17\n";
    expect(noteTaskTick({ ordinal: 1, text: "Rechnung bezahlen 📅 2026-09-17" }, true)(moved)).toBeNull();
  });

  it("follows a line that moved when it carries a Tasks-plugin id", () => {
    const moved = "- [ ] Neu oben\n- [ ] Steuer 🆔 abc 📅 2026-09-18\n";
    const next = noteTaskTick({ ordinal: 0, text: "Steuer 🆔 abc 📅 2026-09-18", taskId: "abc" }, true)(moved);
    expect(next).toMatch(/^- \[ \] Neu oben\n- \[x\] Steuer 🆔 abc 📅 2026-09-18 ✅ \d{4}-\d{2}-\d{2}\n$/);
  });

  it("writes nothing for a box that already stands so", () => {
    expect(noteTaskTick({ ordinal: 0, text: "Erledigt" }, true)("- [x] Erledigt\n")).toBeNull();
  });

  it("a tap completes what is open or in progress and reopens what is done or cancelled", () => {
    expect([tickCompletes({ state: "open" }), tickCompletes({ state: "progress" }), tickCompletes({ state: "done" }), tickCompletes({ state: "cancelled" })]).toEqual([true, true, false, false]);
  });
});

describe("checkboxJumpTerm: where a checkbox opens", () => {
  it("is the line's own text, cut at whole characters — never half an emoji", () => {
    const text = "Call #work Bob 📅 2026-09-20";
    expect(checkboxJumpTerm(text)).toBe(text);
    // 📅 is two UTF-16 units: a cut by units after "Bob " would leave a lone surrogate.
    const cut = checkboxJumpTerm(text, 16);
    expect(cut).toBe("Call #work Bob 📅");
    expect(text.startsWith(cut)).toBe(true);
  });
});

describe("the widget: a checkbox row's line stays in the app", () => {
  it("travels in the refs, never in the file the widget reads", () => {
    const rows = dueTaskRows({ notes: [note({ ordinal: 2, text: "Drucker einrichten 🆔 p1 📅 2026-09-20", taskId: "p1", due: "2026-09-20" })] });
    const { snapshot, refs } = buildWidgetSnapshot({
      vaultName: "Notizen",
      tasks: rows,
      labels: { today: "Heute", overdue: "Überfällig", empty: "", locked: "", pending: "", newTask: "", newJournal: "" },
      now: new Date(2026, 8, 20, 10, 0),
    });
    expect(refs).toEqual([{ path: "Haushalt.md", ordinal: 2, text: "Drucker einrichten 🆔 p1 📅 2026-09-20", taskId: "p1" }]);
    const file = serializeWidgetSnapshot(snapshot);
    expect(file).not.toContain("Haushalt.md");
    expect(file).not.toContain("📅");
  });
});
