import { describe, expect, it } from "vitest";
import {
  evaluateTasksQuery,
  explainTasksQuery,
  parseTasksQuery,
  readTasksPluginSettings,
  runTasksQuery,
  type TasksGroupHeading,
  type TasksQueryGroup,
  type TasksQueryItem,
  type TasksQueryResult,
} from "../src/tasksQuery/index.js";
import { scanTasks } from "../src/vault/taskScan.js";
import { TASKS_QUERY_FIXTURES, type GroupShape, type ItemShape } from "./fixtures/tasks-query/cases.js";
import { generateTaskVault } from "./fixtures/tasks-query/generateVault.js";
import { SAMPLE_TODAY, sampleTasks, taskLabel, taskRecordsOf } from "./fixtures/tasks-query/sampleVault.js";

/** Tasks queries over the sample vault (plan Tasks-Abfragen, T0/T2). */

function headingId(h: TasksGroupHeading): string {
  switch (h.key) {
    case "status": return `status:${h.done ? "done" : "todo"}`;
    case "statusType": return `statusType:${h.type}`;
    case "priority": return `priority:${h.level}`;
    case "urgency": return `urgency:${h.urgency.toFixed(2)}`;
    case "recurring": return `recurring:${h.recurring ? "yes" : "no"}`;
    case "recurrence": return `recurrence:${h.rule ?? "none"}`;
    case "tags": return `tags:${h.tag ?? "none"}`;
    case "path": return `path:${h.path}`;
    case "root": return `root:${h.root}`;
    case "folder": return `folder:${h.folder}`;
    case "filename": return `filename:${h.filename}`;
    case "backlink": return `backlink:${h.path}>${h.heading ?? "none"}`;
    case "heading": return `heading:${h.heading ?? "none"}`;
    default: return `${h.key}:${h.invalid ? "invalid" : h.day ?? "none"}`;
  }
}
const itemShape = (item: TasksQueryItem): ItemShape => {
  const label = (item.matched ? "" : "~") + taskLabel(item.task);
  return item.children.length > 0 ? [label, item.children.map(itemShape)] : label;
};
const groupShape = (group: TasksQueryGroup): GroupShape => [headingId(group.heading!), group.groups.length > 0 ? group.groups.map(groupShape) : group.items.map(itemShape)];
function shape(result: Extract<TasksQueryResult, { status: "ok" }>): ItemShape[] | GroupShape[] {
  return result.root.groups.length > 0 ? result.root.groups.map(groupShape) : result.root.items.map(itemShape);
}

const tasks = sampleTasks();

describe("the sample vault", () => {
  it("holds the eighteen tasks the fixtures name, the query block in the callout none of them", () => {
    expect(tasks).toHaveLength(18);
    expect(new Set(tasks.map(taskLabel)).size).toBe(18);
    expect(tasks.find((t) => taskLabel(t) === "Vorlage-Aufgabe")!.excluded).toBe(true);
  });
});

describe("Tasks query fixtures", () => {
  for (const fixture of TASKS_QUERY_FIXTURES) {
    it(`${fixture.section}: ${fixture.name}`, () => {
      const { query, result } = runTasksQuery(fixture.query, tasks, { today: SAMPLE_TODAY, ...(fixture.filePath ? { filePath: fixture.filePath } : {}) });
      if ("error" in fixture.expect) {
        expect(result.status).toBe("error");
        if (result.status === "error") expect(result.errors.map((line) => line.error!.reason)).toEqual([fixture.expect.error]);
        return;
      }
      expect(query.errors).toEqual([]);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(shape(result)).toEqual(fixture.expect);
      expect(result.notices.map((line) => line.unsupported!.reason)).toEqual(fixture.notices ?? []);
      if (fixture.counts) expect({ total: result.total, shown: result.shown }).toEqual(fixture.counts);
    });
  }
});

describe("evaluation details", () => {
  const run = (source: string, filePath?: string) => {
    const result = runTasksQuery(source, tasks, { today: SAMPLE_TODAY, ...(filePath ? { filePath } : {}) }).result;
    if (result.status !== "ok") throw new Error("query failed: " + source);
    return result;
  };

  it("counts every match before the limit and what is shown after it", () => {
    const result = run("not done\nlimit 5");
    expect(result.total).toBe(14);
    expect(result.shown).toBe(5);
    expect(result.root.taskCount).toBe(5);
  });

  it("an error gives no result, never zero tasks", () => {
    const result = runTasksQuery("not done\nsort by size\ndue before 2026-13-01", tasks, { today: SAMPLE_TODAY }).result;
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.errors.map((line) => [line.line, line.error!.reason])).toEqual([[2, "unknownSortKey"], [3, "invalidDate"]]);
  });

  it("groups by urgency from the most urgent, rounded to two places", () => {
    const result = run("path includes Haus\ngroup by urgency");
    expect(result.root.groups.map((g) => headingId(g.heading!))).toEqual(["urgency:18.71", "urgency:3.90", "urgency:2.40", "urgency:1.95", "urgency:-4.80"]);
  });

  it("groups by root, path, backlink, happens and status type", () => {
    expect(run("not done\ngroup by root").root.groups.map((g) => headingId(g.heading!))).toEqual(["root:/", "root:Daily/", "root:Projekte/", "root:Vorlagen/"]);
    expect(run("path includes Bahn\ngroup by path").root.groups.map((g) => headingId(g.heading!))).toEqual(["path:Projekte/Bahn"]);
    expect(run("path includes Bahn\nnot done\ngroup by backlink").root.groups.map((g) => [headingId(g.heading!), g.items.map((i) => taskLabel(i.task))])).toEqual([
      ["backlink:Projekte/Bahn.md>Bahn-Projekt", ["Petition einreichen", "Pressemitteilung", "Unterschriften zählen"]],
      ["backlink:Projekte/Bahn.md>Termine", ["Treffen mit Verband"]],
    ]);
    expect(run("path includes Haus\ngroup by happens").root.groups.map((g) => headingId(g.heading!))).toEqual(["happens:2026-10-26", "happens:2026-10-27", "happens:2026-11-10", "happens:2027-04-01", "happens:none"]);
    expect(run("path includes Haus\ngroup by status.type").root.groups.map((g) => headingId(g.heading!))).toEqual(["statusType:IN_PROGRESS", "statusType:TODO", "statusType:CANCELLED"]);
    expect(run("is recurring\ngroup by recurrence").root.groups.map((g) => headingId(g.heading!))).toEqual(["recurrence:every week", "recurrence:every year"]);
    expect(run("path includes Haus\ngroup by cancelled").root.groups.map((g) => headingId(g.heading!))).toEqual(["cancelled:2026-10-24", "cancelled:none"]);
  });

  it("a group heading counts its tasks, a task with two tags counts in both groups", () => {
    const content = "- [ ] Both #a #b\n- [ ] Only #a\n";
    const records = taskRecordsOf([{ path: "x.md", content }]);
    const result = runTasksQuery("group by tags", records, { today: SAMPLE_TODAY }).result;
    if (result.status !== "ok") throw new Error();
    expect(result.root.groups.map((g) => [headingId(g.heading!), g.taskCount])).toEqual([["tags:#a", 2], ["tags:#b", 1]]);
    expect(result.shown).toBe(2);
  });

  it("show tree keeps the children of the file, nested, in file order — and every level", () => {
    const content = ["- [ ] Root #x", "  - [ ] Child", "    - [x] Grandchild #x", "  - Note", "  - [ ] Second child #x", "- [ ] Other"].join("\n");
    const records = taskRecordsOf([{ path: "t.md", content }]);
    const result = runTasksQuery("tags include #x\nshow tree", records, { today: SAMPLE_TODAY }).result;
    if (result.status !== "ok") throw new Error();
    expect(result.root.items.map(itemShape)).toEqual([["Root", [["~Child", ["Grandchild"]], "Second child"]]]);
    expect(result.layout.tree).toBe(true);
  });

  it("without show tree a matching subtask stands on its own", () => {
    expect(shape(run("not done\npath includes Bahn"))).toEqual(["Petition einreichen", "Pressemitteilung", "Treffen mit Verband", "Unterschriften zählen"]);
  });

  it("carries the layout of show and hide lines", () => {
    const result = run("hide backlink\nhide due date\nshow group count\nhide task count\nshort mode");
    expect(result.layout).toMatchObject({ backlink: false, dueDate: false, groupCount: true, taskCount: false, tree: false, tags: true });
  });

  it("a description in Tasks' sense leaves out the fields but keeps tags and text", () => {
    const records = taskRecordsOf([{ path: "d.md", content: "- [ ] Call [[Anna]] #x ⛔ abc123 🏁 delete ⏫ 📅 2026-10-30 ^block-1\n" }]);
    expect(shape((runTasksQuery("description includes anna", records, { today: SAMPLE_TODAY }).result as Extract<TasksQueryResult, { status: "ok" }>))).toEqual(["Call [[Anna]]"]);
    expect((runTasksQuery("description includes abc123", records, { today: SAMPLE_TODAY }).result as Extract<TasksQueryResult, { status: "ok" }>).total).toBe(0);
    expect((runTasksQuery("description includes block-1", records, { today: SAMPLE_TODAY }).result as Extract<TasksQueryResult, { status: "ok" }>).total).toBe(0);
  });

  it("evaluates against the day handed in, not a clock", () => {
    const tomorrow = runTasksQuery("due today", tasks, { today: "2026-10-30" }).result;
    if (tomorrow.status !== "ok") throw new Error();
    expect(shape(tomorrow)).toEqual(["Petition einreichen"]);
  });

  it("the task items carry the record of listTasks unchanged and its urgency", () => {
    const result = run("priority is highest");
    const item = result.root.items[0];
    expect(item.task).toBe(tasks.find((t) => taskLabel(t) === "Maler anrufen"));
    expect(item.urgency).toBeCloseTo(18.71429, 4);
  });
});

describe("explanation as data", () => {
  it("names each line's state, resolves dates to days, and lists the default sort", () => {
    const query = parseTasksQuery("explain\nnot done\ndue before next week\nstarts after today\n(has due date) OR NOT (is recurring)\nis blocked\nhide edit button", { today: SAMPLE_TODAY });
    const explanation = explainTasksQuery(query);
    expect(explanation.today).toBe(SAMPLE_TODAY);
    expect(explanation.weeks).toBe("iso");
    expect(explanation.includesNotesOutsideTasksTab).toBe(true);
    expect(explanation.lines.map((l) => [l.line, l.status])).toEqual([[1, "understood"], [2, "understood"], [3, "understood"], [4, "understood"], [5, "understood"], [6, "unsupported"], [7, "noEffect"]]);
    expect(explanation.lines[2].filter).toMatchObject({ kind: "date", field: "due", operator: "before", days: { to: "2026-11-01" }, tasksWithoutDate: false });
    expect(explanation.lines[3].filter).toMatchObject({ kind: "date", field: "start", days: { from: "2026-10-30" }, tasksWithoutDate: true });
    expect(explanation.lines[4].filter).toMatchObject({ kind: "boolean", expression: { op: "or", left: { op: "filter", source: "has due date" }, right: { op: "not" } } });
    expect(explanation.defaultSorters.map((s) => s.key)).toEqual(["statusType", "urgency", "due", "priority", "path"]);
    expect("plugin" in explanation).toBe(false);
  });

  it("names the Tasks plugin's global filter and query, which Plainva does not apply", () => {
    const settings = readTasksPluginSettings(JSON.stringify({ globalFilter: "#task", globalQuery: "not done\n", other: 1 }));
    expect(settings).toEqual({ globalFilter: "#task", globalQuery: "not done" });
    expect(explainTasksQuery(parseTasksQuery("", { today: SAMPLE_TODAY }), settings).plugin).toEqual(settings);
    expect(explainTasksQuery(parseTasksQuery("", { today: SAMPLE_TODAY }), { globalFilter: null, globalQuery: null }).plugin).toBeUndefined();
    expect(readTasksPluginSettings("{ not json")).toBeNull();
    expect(readTasksPluginSettings("[1]")).toBeNull();
    expect(readTasksPluginSettings("{\"globalFilter\": \"  \"}")).toEqual({ globalFilter: null, globalQuery: null });
  });
});

describe("timing over 20 000 tasks (plan E6)", () => {
  // The bound is generous so that a loaded CI machine never fails the run;
  // PLAINVA_TASKS_QUERY_TIMING=1 holds evaluation to the plan's 50 ms.
  const strict = process.env.PLAINVA_TASKS_QUERY_TIMING === "1";
  const notes = generateTaskVault(20_000, SAMPLE_TODAY);
  const scanStart = performance.now();
  const records = taskRecordsOf(notes);
  const scanMs = performance.now() - scanStart;
  const queries: Array<[string, string]> = [
    ["empty (default sort)", ""],
    ["tester's case", "not done\ntags include #rettediebahn\nshow tree\nsort by filename reverse"],
    ["dates, boolean, groups", "(due before next week) OR (scheduled on or before today)\nnot done\ngroup by folder\ngroup by due\nsort by priority"],
    ["description and tags", "description includes report\ntags do not include #privat\nsort by description"],
  ];

  it("generates the vault", () => {
    expect(records).toHaveLength(20_000);
  });

  for (const [name, source] of queries) {
    it(`evaluates: ${name}`, () => {
      // Cold: records the evaluation has never seen (a new index state), after
      // one run on other copies so the JIT is warm. Warm: the same records
      // again — every further block until the index moves on.
      const copy = () => records.map((record) => ({ ...record }));
      evaluateTasksQuery(parseTasksQuery(source, { today: SAMPLE_TODAY }), copy());
      let cold = Infinity;
      let warm = Infinity;
      let total = 0;
      for (let round = 0; round < 3; round++) {
        const fresh = copy();
        let start = performance.now();
        const result = evaluateTasksQuery(parseTasksQuery(source, { today: SAMPLE_TODAY }), fresh);
        cold = Math.min(cold, performance.now() - start);
        start = performance.now();
        evaluateTasksQuery(parseTasksQuery(source, { today: SAMPLE_TODAY }), fresh);
        warm = Math.min(warm, performance.now() - start);
        if (result.status === "ok") total = result.total;
      }
      console.log(`[tasks-query timing] ${name}: cold ${cold.toFixed(1)} ms, warm ${warm.toFixed(1)} ms for 20 000 tasks (${total} match); scanning the notes took ${scanMs.toFixed(0)} ms`);
      expect(cold).toBeLessThan(strict ? 50 : 2000);
    });
  }

  it("the generated notes scan the way the index reads them", () => {
    expect(scanTasks(notes[0].content).length).toBe(20);
  });
});
