import { describe, expect, it } from "vitest";
import {
  buildPlanner, nextPriorityWord, parseTaskCapture, plannerDbId, plannerRowsFromDb, plannerRowsFromTasks, plannerTaskId,
  priorityOfValue, priorityValue, resolveTaskPriorityModel, setCaptureWord, taskDisplayText, withPriorityColumn,
  type CaptureVocabulary,
} from "@plainva/ui";
import type { TaskRecord } from "@plainva/core";

/**
 * Plan Aufgaben-Oberfläche, B1–B3: the two task sources in the planner's one row
 * shape, the priority column, and the phone's quick buttons — which write into
 * the capture sentence instead of keeping a state beside it.
 */

const task = (over: Partial<TaskRecord>): TaskRecord => ({
  path: "Notes/Woche 38.md", title: "Woche 38", excluded: false, line: 3, ordinal: 0, done: false, state: "open", text: "Zahnarzt zurückrufen", tags: [], due: null, ...over,
});

describe("planner rows", () => {
  it("turns a database row into a planner row and takes what the namespace knows", () => {
    const rows = plannerRowsFromDb(
      [{ path: "Aufgaben/Angebot.md", title: "Angebot", status: "Offen", done: false, due: "2026-09-21", dueMinutes: 840 }],
      () => ({ priority: 1, mirrored: true, repeatsAtProvider: true, tags: ["kunde"] }),
    );
    expect(rows).toEqual([
      {
        id: plannerDbId("Aufgaben/Angebot.md"), source: "database", path: "Aufgaben/Angebot.md", title: "Angebot", state: "open",
        due: "2026-09-21", dueMinutes: 840, priority: 1, tags: ["kunde"], repeats: undefined, mirrored: true, repeatsAtProvider: true,
      },
    ]);
  });

  it("strips a checkbox's metadata from its title and keeps the note as its source", () => {
    const [row] = plannerRowsFromTasks([task({ text: "Zahnarzt zurückrufen #praxis 📅 2026-09-19", tags: ["praxis"], due: "2026-09-19", ordinal: 4 })]);
    expect(row).toMatchObject({ id: plannerTaskId("Notes/Woche 38.md", 4), source: "note", title: "Zahnarzt zurückrufen", noteTitle: "Woche 38", due: "2026-09-19", tags: ["praxis"], state: "open" });
    expect(taskDisplayText("x #a 📅 2026-01-01")).toBe("x");
  });

  it("both sources land in one Today, ordered by priority, then time, then title", () => {
    const rows = [
      ...plannerRowsFromDb(
        [
          { path: "A/Bericht.md", title: "Bericht", status: null, done: false, due: "2026-09-20" },
          { path: "A/Angebot.md", title: "Angebot", status: null, done: false, due: "2026-09-20", dueMinutes: 840 },
        ],
        (path) => (path === "A/Bericht.md" ? { priority: 2 } : { priority: 1 }),
      ),
      ...plannerRowsFromTasks([task({ due: "2026-09-20", text: "Drucker einrichten" }), task({ due: "2026-09-18", text: "Steuer", ordinal: 1 })]),
    ];
    const planner = buildPlanner(rows, "2026-09-20");
    expect(planner.counts).toMatchObject({ overdue: 1, today: 3 });
    const [overdue, today] = planner.sections("today");
    expect(overdue.rows.map((r) => r.title)).toEqual(["Steuer"]);
    expect(today.rows.map((r) => r.title)).toEqual(["Angebot", "Bericht", "Drucker einrichten"]);
  });
});

describe("priority column", () => {
  const config = {
    columns: { status: { input: "status", options: ["Offen", "Erledigt"] }, Priorität: { input: "select", options: [{ value: "hoch" }, { value: "mittel" }, { value: "niedrig" }] } },
    views: [{ type: "table", order: ["file.name", "status"] }],
  };

  it("is found by name in any of the ten languages, and ranks by option order", () => {
    const model = resolveTaskPriorityModel(config)!;
    expect(model).toEqual({ key: "Priorität", options: ["hoch", "mittel", "niedrig"] });
    expect(priorityOfValue("hoch", model)).toBe(1);
    expect(priorityOfValue("niedrig", model)).toBe(3);
    expect(priorityOfValue("dringend", model)).toBe(0);
    expect(priorityOfValue(null, model)).toBe(0);
    expect(priorityValue(2, model)).toBe("mittel");
    expect(priorityValue(0, model)).toBeNull();
    // The status column is a select with options too — and must never pass for it.
    expect(resolveTaskPriorityModel({ columns: { status: config.columns.status } })).toBeNull();
  });

  it("adds the column once, and into the table views that list their columns", () => {
    const bare = { columns: { status: config.columns.status }, views: [{ type: "table", order: ["file.name", "status"] }, { type: "board", groupBy: "status" }] };
    const added = withPriorityColumn(bare, "priority", ["high", "medium", "low"]);
    expect((added.columns as Record<string, unknown>).priority).toEqual({ input: "select", options: ["high", "medium", "low"] });
    expect(added.views[0]).toEqual({ type: "table", order: ["file.name", "status", "priority"] });
    expect(added.views[1]).toEqual(bare.views[1]);
    expect(withPriorityColumn(added, "priority", ["a", "b", "c"])).toBe(added);
  });
});

describe("quick buttons write into the sentence", () => {
  const vocab: CaptureVocabulary = {
    today: ["heute"], tomorrow: ["morgen"], dayAfterTomorrow: ["übermorgen"], nextWeek: ["nächste woche"], inDays: ["in {n} tagen"], inWeeks: ["in {n} wochen"],
    weekdays: [["montag"], ["dienstag"], ["mittwoch"], ["donnerstag"], ["freitag"], ["samstag"], ["sonntag"]],
    daily: ["täglich"], weekly: ["wöchentlich"], monthly: ["monatlich"], yearly: ["jährlich"], every: ["jeden"], everyNDays: ["alle {n} tage"], everyNWeeks: ["alle {n} wochen"],
    oclock: ["uhr"], at: ["um"], dateOrder: "dmy",
  };
  const parse = (text: string) => parseTaskCapture(text, vocab, "2026-09-20");

  it("appends a word, replaces the brick that is already there, and takes it out again", () => {
    let text = "Angebot abschicken";
    text = setCaptureWord(text, parse(text), "date", "morgen");
    expect(text).toBe("Angebot abschicken morgen");
    text = setCaptureWord(text, parse(text), "date", "heute");
    expect(text).toBe("Angebot abschicken heute");
    expect(parse(text)).toMatchObject({ title: "Angebot abschicken", due: "2026-09-20" });
    text = setCaptureWord(text, parse(text), "date", "");
    expect(parse(text)).toMatchObject({ title: "Angebot abschicken", due: null });
  });

  it("cycles the priority mark: none, high, medium, low, none", () => {
    let text = "Bericht";
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const result = parse(text);
      text = setCaptureWord(text, result, "priority", nextPriorityWord(result.priority));
      seen.push(parse(text).priority);
    }
    expect(seen).toEqual([1, 2, 3, 0]);
    expect(parse(text).title).toBe("Bericht");
  });
});
