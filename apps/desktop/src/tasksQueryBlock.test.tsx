// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseTasksQuery, runTasksQuery, type TaskRecord } from "@plainva/core";
import { TASKS_QUERY_DRAW_LIMIT, TasksQueryBlock, tasksQueryExplainView, tasksQueryGroupLabel, tasksQueryView, type PlannerRow, type TasksQueryBlockProps } from "@plainva/ui";
import { SAMPLE_TODAY, sampleTasks, taskRecordsOf } from "../../../packages/core/test/fixtures/tasks-query/sampleVault";

/**
 * The Tasks query block (plan Tasks-Abfragen, T3): the result as the planner
 * draws it — groups, the tree of `show tree`, the hint of a line Plainva does
 * not read (case a), the error of a line Tasks rejects too (case c), the
 * explanation, and the cap of 100 rows. Shared by both shells, tested once.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", async () => {
  const data = (await import("../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): unknown => key.split(".").reduce<unknown>((obj, k) => (obj as Record<string, unknown>)?.[k], data);
  const t = (key: string, vars?: Record<string, unknown>) => {
    const plural = typeof vars?.count === "number" ? lookup(`${key}_${vars.count === 1 ? "one" : "other"}`) : undefined;
    const value = plural ?? lookup(key);
    return Object.entries(vars ?? {}).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), typeof value === "string" ? value : key);
  };
  return { initReactI18next: { type: "3rdParty", init() {} }, useTranslation: () => ({ i18n: { language: "en" }, t }) };
});

const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});

async function mount(props: Partial<TasksQueryBlockProps> & { source: string }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => {
    root.render(<TasksQueryBlock notePath="Daily/2026-10-29.md" tasks={sampleTasks()} today={SAMPLE_TODAY} onToggle={() => {}} onOpen={() => {}} {...props} />);
  });
  return host;
}

const all = (host: HTMLElement, id: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

describe("the tester's callout: open #rettediebahn tasks as a tree", () => {
  const source = "not done\ntags include #rettediebahn\nshow tree\nsort by filename reverse";

  it("draws the tasks in the query's order with their subtasks under them, and counts the matches", async () => {
    const host = await mount({ source });
    const rows = all(host, "task-planner-row");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Vorlage-Aufgabe"),
      expect.stringContaining("Petition einreichen"),
      expect.stringContaining("Unterschriften zählen"),
      expect.stringContaining("Text schreiben"),
      expect.stringContaining("Treffen mit Verband"),
      expect.stringContaining("Offene Todos sammeln"),
    ]);
    // A subtask that does not match itself still hangs under its task — done included.
    expect(rows.map((row) => row.dataset.state)).toEqual(["open", "open", "open", "done", "open", "open"]);
    expect(all(host, "tasks-query-count")[0].textContent).toBe("4 tasks");
    expect(all(host, "tasks-query-hint")).toHaveLength(0);
  });

  it("ticks optimistically and hands the row to the shell", async () => {
    const ticked: PlannerRow[] = [];
    const host = await mount({ source, onToggle: (row) => ticked.push(row) });
    const box = all(host, "task-planner-toggle")[1];
    await act(async () => box.click());
    expect(ticked.map((row) => row.title)).toEqual(["Petition einreichen"]);
    expect(all(host, "task-planner-row")[1].dataset.state).toBe("done");
  });

  it("in an embedded note the list is only to look at", async () => {
    const ticked: PlannerRow[] = [];
    const host = await mount({ source, readOnly: true, onToggle: (row) => ticked.push(row) });
    const box = all(host, "task-planner-toggle")[0] as HTMLButtonElement;
    expect(box.disabled).toBe(true);
    await act(async () => box.click());
    expect(ticked).toEqual([]);
  });
});

describe("groups, hints, errors, explanation", () => {
  it("groups by due date with headings in the app's language, the overdue one marked", async () => {
    const host = await mount({ source: "not done\ngroup by due\nshow group count" });
    const sections = all(host, "task-planner-section-group");
    const headings = sections.map((s) => s.querySelector(".pv-grouplabel")?.textContent ?? "");
    expect(headings[0]).toContain("Invalid date");
    expect(headings[1]).toContain("Tuesday, October 27");
    expect(headings[headings.length - 1]).toContain("No due date");
    expect(sections[1].querySelector(".pv-planner-late")).not.toBeNull();
    expect(sections[2].querySelector(".pv-planner-late")).toBeNull();
  });

  it("names a line it leaves out above the list, and still shows the list", async () => {
    const host = await mount({ source: "is recurring\nfilter by function task.urgency > 8" });
    const hints = all(host, "tasks-query-hint");
    expect(hints).toHaveLength(1);
    expect(hints[0].textContent).toContain("Line 2");
    expect(hints[0].textContent).toContain("Plainva never runs code from notes.");
    expect(hints[0].textContent).toContain("The list may show more tasks than in Obsidian.");
    expect(all(host, "task-planner-row")).toHaveLength(2);
  });

  it("shows an error with the line marked and no list — never zero tasks", async () => {
    const edits: Array<number | null> = [];
    const host = await mount({ source: "path includes Routinen\n(not done) AND \"is recurring\"\nsort by due", onEditQuery: (line) => edits.push(line) });
    expect(host.querySelector("[data-testid='tasks-query']")?.getAttribute("data-status")).toBe("error");
    expect(all(host, "tasks-query-error")[0].textContent).toContain("Line 2");
    expect(all(host, "tasks-query-error")[0].textContent).toContain("same kind of brackets");
    expect(all(host, "task-planner-row")).toHaveLength(0);
    expect(host.querySelector(".pv-tasksquery-bad")?.textContent).toContain('(not done) AND "is recurring"');
    expect(host.textContent).toContain("No result");
    await act(async () => all(host, "tasks-query-edit")[0].click());
    expect(edits).toEqual([2]);
  });

  it("explains each line on the switch, dates as days, without touching the query", async () => {
    const host = await mount({ source: "not done\ndue before next week\nhide edit button\nis blocked" });
    expect(all(host, "tasks-query-explain")).toHaveLength(0);
    await act(async () => all(host, "tasks-query-explain-switch")[0].click());
    const text = all(host, "tasks-query-explain")[0].textContent ?? "";
    expect(text).toContain("How Plainva reads this query");
    expect(text).toContain("until Sunday, November 1, 2026");
    expect(text).toContain("no effect");
    expect(text).toContain("not supported");
    expect(text).toContain("Then sorted by status, urgency, due date, priority and path");
  });

  it("the explain line shows the explanation without the switch", async () => {
    const host = await mount({ source: "explain\nnot done" });
    expect(all(host, "tasks-query-explain")).toHaveLength(1);
    expect(all(host, "tasks-query-explain-switch")).toHaveLength(0);
  });

  it("hides what the query hides: the source, the count", async () => {
    const host = await mount({ source: "path includes Haus\nhide backlink\nhide task count" });
    expect(host.querySelector(".pv-planner-source")).toBeNull();
    expect(all(host, "tasks-query-count")).toHaveLength(0);
  });
});

describe("large results", () => {
  const many: TaskRecord[] = taskRecordsOf([{ path: "Big.md", content: Array.from({ length: 250 }, (_, i) => `- [ ] Task ${i}`).join("\n") }]);

  it("draws the first 100, then offers all — and says 100 of 250", async () => {
    const host = await mount({ source: "", tasks: many });
    expect(all(host, "task-planner-row")).toHaveLength(TASKS_QUERY_DRAW_LIMIT);
    expect(all(host, "tasks-query-count")[0].textContent).toBe("100 of 250 tasks");
    await act(async () => all(host, "tasks-query-more")[0].click());
    expect(all(host, "task-planner-row")).toHaveLength(250);
    expect(all(host, "tasks-query-count")[0].textContent).toBe("250 tasks");
  });

  it("a limit is no cap: 20 of 250 and no button", async () => {
    const host = await mount({ source: "limit 20", tasks: many });
    expect(all(host, "task-planner-row")).toHaveLength(20);
    expect(all(host, "tasks-query-count")[0].textContent).toBe("20 of 250 tasks");
    expect(all(host, "tasks-query-more")).toHaveLength(0);
  });

  it("while the tasks load the block says so, not 'no tasks'", async () => {
    const host = await mount({ source: "not done", tasks: null });
    expect(host.textContent).toContain("Loading tasks");
    expect(host.textContent).not.toContain("No task matches");
  });
});

describe("the view model", () => {
  const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

  it("turns nested groups into headings with levels, and hangs the tree's children by parent", () => {
    const { result } = runTasksQuery("not done\ngroup by folder\ngroup by filename\nshow tree", sampleTasks(), { today: SAMPLE_TODAY });
    if (result.status !== "ok") throw new Error();
    const view = tasksQueryView(result, { t, locale: "en" });
    expect(view.sections.map((s) => [s.label, s.level, s.rows.length])).toEqual([
      ["/", 1, 0],
      ["Inbox", 2, 3],
      ["Daily/", 1, 0],
      ["2026-10-29", 2, 2],
      ["Projekte/", 1, 0],
      ["Bahn", 2, 3],
      ["Haus", 2, 4],
      ["Vorlagen/", 1, 0],
      ["Vorlage", 2, 1],
    ]);
    expect(view.subtasks?.map((row) => row.title)).toEqual(expect.arrayContaining(["Unterschriften zählen", "Text schreiben"]));
  });

  it("words every kind of heading", () => {
    expect(tasksQueryGroupLabel({ key: "priority", level: "highest" }, t, "en", SAMPLE_TODAY)).toBe('tasksQuery.groupPriority:{"level":"tasksQuery.priorityHighest"}');
    expect(tasksQueryGroupLabel({ key: "tags", tag: null }, t, "en", SAMPLE_TODAY)).toBe("tasksQuery.groupNoTags");
    expect(tasksQueryGroupLabel({ key: "due", day: "2027-01-04", invalid: false }, t, "en", SAMPLE_TODAY)).toBe("Monday, January 4, 2027");
    expect(tasksQueryGroupLabel({ key: "scheduled", day: null, invalid: false }, t, "en", SAMPLE_TODAY)).toBe("tasksQuery.groupNoScheduled");
    expect(tasksQueryGroupLabel({ key: "backlink", path: "A/Note.md", heading: "Plan" }, t, "en", SAMPLE_TODAY)).toBe("Note › Plan");
    expect(tasksQueryGroupLabel({ key: "statusType", type: "IN_PROGRESS" }, t, "en", SAMPLE_TODAY)).toBe("tasks.stateProgress");
  });

  it("explains a Boolean instruction as its parts, indented", () => {
    const view = tasksQueryExplainView(parseTasksQuery("(due before tomorrow) OR NOT (has tags)", { today: SAMPLE_TODAY }), t, "en");
    expect(view.rows.map((r) => [r.source, r.depth])).toEqual([
      ["(due before tomorrow) OR NOT (has tags)", 0],
      ["OR", 1],
      ["due before tomorrow", 2],
      ["NOT", 2],
      ["has tags", 3],
    ]);
  });
});

