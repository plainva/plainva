import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBaseConfig } from "@plainva/ui";
import { readFrontmatterPath, setFrontmatterPath } from "@plainva/core";
import {
  taskDbFileStem,
  buildTaskDbFile,
  createTaskDatabase,
  resolveTaskStatusModel,
  classifyTaskStatus,
  resolveTaskCompletionModel,
  classifyTaskCompletion,
  applyTaskCompletion,
  splitTaskListKey,
  taskListPickerOptions,
  resolveTaskListName,
  resolveTaskListTarget,
  applyTaskStatusOption,
  type TaskDbLabels,
  type TaskDbAdapter,
} from "./taskDatabase";

const LABELS: TaskDbLabels = {
  viewTable: "Tabelle",
  viewBoard: "Board",
  viewTimeline: "Zeitleiste",
  doneKey: "erledigt",
  dueKey: "frist",
  statusOptions: ["Offen", "In Arbeit", "Erledigt"],
};

function memoryAdapter() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const adapter: TaskDbAdapter = {
    exists: async (p) => files.has(p) || dirs.has(p),
    createDir: async (p) => { dirs.add(p); },
    writeTextFile: async (p, c) => { files.set(p, c); },
  };
  return { adapter, files, dirs };
}

describe("taskDatabase (PIM plan 1a)", () => {
  it("sanitizes user-typed names into a usable file stem", () => {
    expect(taskDbFileStem("Aufgaben")).toBe("Aufgaben");
    expect(taskDbFileStem("  My   Tasks  ")).toBe("My Tasks");
    expect(taskDbFileStem('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j");
    // Trailing dots would collide with the .base extension on Windows.
    expect(taskDbFileStem("Tasks...")).toBe("Tasks");
    expect(taskDbFileStem("   ")).toBeNull();
    expect(taskDbFileStem("///")).toBeNull();
  });

  it("builds a template-shaped .base (root file + source folder, status/due, table + board)", () => {
    const { path, folder, content } = buildTaskDbFile("Aufgaben", LABELS);
    expect(path).toBe("Aufgaben.base");
    expect(folder).toBe("Aufgaben");

    // Round-trip through the real parser: the on-disk YAML must load back into
    // the exact structure the app (and Obsidian) expects.
    const cfg = parseBaseConfig(content);
    expect(cfg.filters).toEqual({ and: ['file.folder == "Aufgaben"'] });
    // The done CHECKBOX is the completion truth (binary like the providers).
    expect(cfg.columns.erledigt).toMatchObject({ input: "checkbox" });
    expect(cfg.columns.status).toMatchObject({ input: "status" });
    expect((cfg.columns.status.options ?? []).map((o: { value: string }) => o.value)).toEqual(["Offen", "In Arbeit", "Erledigt"]);
    // Date & time since tasks can carry a time of day (plan Aufgaben-Oberflaeche, E9).
    expect(cfg.columns.frist).toMatchObject({ input: "datetime" });
    expect(cfg.views).toHaveLength(3);
    expect(cfg.views[0]).toMatchObject({ type: "table", name: "Tabelle" });
    expect(cfg.views[0].order).toEqual(["file.name", "erledigt", "status", "frist"]);
    expect(cfg.views[1]).toMatchObject({ type: "board", name: "Board", groupBy: "status" });
    // Issue #84: the timeline is set up by default, due date as its axis.
    expect(cfg.views[2]).toMatchObject({ type: "timeline", name: "Zeitleiste", dateField: "frist" });
  });

  it("creates folder + .base and returns the path", async () => {
    const { adapter, files, dirs } = memoryAdapter();
    const path = await createTaskDatabase(adapter, "Aufgaben", LABELS);
    expect(path).toBe("Aufgaben.base");
    expect(dirs.has("Aufgaben")).toBe(true);
    expect(files.has("Aufgaben.base")).toBe(true);
  });

  it("adopts an existing database instead of overwriting it", async () => {
    const { adapter, files } = memoryAdapter();
    files.set("Aufgaben.base", "ORIGINAL");
    const path = await createTaskDatabase(adapter, "Aufgaben", LABELS);
    expect(path).toBe("Aufgaben.base");
    expect(files.get("Aufgaben.base")).toBe("ORIGINAL");
  });

  it("returns null for an unusable name without touching the vault", async () => {
    const { adapter, files, dirs } = memoryAdapter();
    expect(await createTaskDatabase(adapter, "  //  ", LABELS)).toBeNull();
    expect(files.size).toBe(0);
    expect(dirs.size).toBe(0);
  });
});

describe("resolveTaskStatusModel + classifyTaskStatus", () => {
  it("reads the status column from the one-click scaffold (first=open, last=done)", () => {
    const config = parseBaseConfig(buildTaskDbFile("Aufgaben", LABELS).content);
    const model = resolveTaskStatusModel(config);
    expect(model).toEqual({ key: "status", open: "Offen", done: "Erledigt", options: ["Offen", "In Arbeit", "Erledigt"] });
  });

  it("classifies done / open-or-intermediate / unknown", () => {
    const model = { key: "status", open: "Offen", done: "Erledigt", options: ["Offen", "In Arbeit", "Erledigt"] };
    expect(classifyTaskStatus("Erledigt", model)).toBe(true);
    expect(classifyTaskStatus("Offen", model)).toBe(false);
    expect(classifyTaskStatus("In Arbeit", model)).toBe(false); // recognized non-done
    expect(classifyTaskStatus("", model)).toBeNull(); // empty is ambiguous
    expect(classifyTaskStatus(null, model)).toBeNull();
    expect(classifyTaskStatus("Backlog", model)).toBeNull(); // foreign value is ambiguous
  });

  // Finding B2 (19.10.): "the last option is done" wrote "Abgebrochen" for
  // every task ticked off at the provider.
  it("takes a done word for done wherever it stands, never a cancelled option after it", () => {
    const config = parseBaseConfig(`properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Offen
        - value: Erledigt
        - value: Abgebrochen
views:
  - type: table
    name: T
`);
    const model = resolveTaskStatusModel(config)!;
    expect(model.done).toBe("Erledigt");
    expect(model.closed).toEqual(["Abgebrochen"]);
    // Cancelled counts as closed - read as open it would reopen the provider's task.
    expect(classifyTaskStatus("Abgebrochen", model)).toBe(true);
    expect(classifyTaskStatus("Offen", model)).toBe(false);
  });

  it("keeps an option after the done one closed: a task ticked under the old rule never reads as open", () => {
    const config = parseBaseConfig(`properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Open
        - value: Done
        - value: Archived
views:
  - type: table
    name: T
`);
    const model = resolveTaskStatusModel(config)!;
    expect(model.done).toBe("Done");
    // Under the old rule "Archived" was done; read as open, the next sync
    // would reopen every such task at the provider.
    expect(classifyTaskStatus("Archived", model)).toBe(true);
  });

  it("without a done word keeps the old rule: the last option is done", () => {
    const config = parseBaseConfig(`properties:
  note.phase:
    plainva:
      input: select
      options:
        - value: Idee
        - value: In progress
        - value: Cancelled
views:
  - type: table
    name: T
`);
    const model = resolveTaskStatusModel(config)!;
    expect(model).toMatchObject({ open: "Idee", done: "Cancelled" });
    // An option in between stays what it always was: open.
    expect(classifyTaskStatus("In progress", model)).toBe(false);
  });

  it("leaves options between the done one and the last open, and keeps the others closed", () => {
    const between = resolveTaskStatusModel(parseBaseConfig(`properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Open
        - value: Done
        - value: Waiting
        - value: Cancelled
views:
  - type: table
    name: T
`))!;
    expect(between.done).toBe("Done");
    expect(classifyTaskStatus("Waiting", between)).toBe(false);
    expect(classifyTaskStatus("Cancelled", between)).toBe(true);
    // Two done words: the last is written, the other still reads as done.
    const two = resolveTaskStatusModel(parseBaseConfig(`properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Open
        - value: Done
        - value: Completed
views:
  - type: table
    name: T
`))!;
    expect(two.done).toBe("Completed");
    expect(classifyTaskStatus("Done", two)).toBe(true);
    // A done word as the FIRST option is the open one; the old rule decides.
    const first = resolveTaskStatusModel(parseBaseConfig(`properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Done
        - value: Todo
        - value: In progress
views:
  - type: table
    name: T
`))!;
    expect(first).toMatchObject({ open: "Done", done: "In progress" });
    expect(classifyTaskStatus("Todo", first)).toBe(false);
  });

  it("returns null when the database has no status/select column", () => {
    const config = parseBaseConfig(`properties:\n  note.frist:\n    plainva:\n      input: date\nviews:\n  - type: table\n    name: T\n`);
    expect(resolveTaskStatusModel(config)).toBeNull();
  });
});

describe("completion model (checkbox property preferred)", () => {
  const read = (c: string, p: string[]) => readFrontmatterPath(c, p);
  const set = (c: string, p: string[], v: unknown) => setFrontmatterPath(c, p, v);

  it("the one-click scaffold resolves to a CHECKBOX completion with a coupled status", () => {
    const config = parseBaseConfig(buildTaskDbFile("Aufgaben", LABELS).content);
    const model = resolveTaskCompletionModel(config);
    expect(model).toEqual({
      kind: "checkbox",
      key: "erledigt",
      status: { key: "status", open: "Offen", done: "Erledigt", options: ["Offen", "In Arbeit", "Erledigt"] },
    });
  });

  it("a database without a checkbox column falls back to the status convention", () => {
    const config = parseBaseConfig(
      `properties:\n  note.status:\n    plainva:\n      input: status\n      options:\n        - value: Offen\n        - value: Erledigt\nviews:\n  - type: table\n    name: T\n`
    );
    const model = resolveTaskCompletionModel(config);
    expect(model?.kind).toBe("status");
  });

  it("classifies checkbox values string-tolerantly (index values travel as strings)", () => {
    const model = { kind: "checkbox" as const, key: "erledigt", status: null };
    expect(classifyTaskCompletion(model, { checkbox: true })).toBe(true);
    expect(classifyTaskCompletion(model, { checkbox: "true" })).toBe(true);
    expect(classifyTaskCompletion(model, { checkbox: false })).toBe(false);
    expect(classifyTaskCompletion(model, { checkbox: "false" })).toBe(false);
    expect(classifyTaskCompletion(model, { checkbox: undefined })).toBeNull(); // ambiguous
    expect(classifyTaskCompletion(model, { checkbox: "yes" })).toBeNull();
  });

  it("applyTaskCompletion writes the checkbox and keeps the status coupled", () => {
    const config = parseBaseConfig(buildTaskDbFile("Aufgaben", LABELS).content);
    const model = resolveTaskCompletionModel(config)!;
    const note = `---\nerledigt: false\nstatus: Offen\n---\n# T\n`;
    const done = applyTaskCompletion(note, model, true, read, set);
    expect(readFrontmatterPath(done, ["erledigt"])).toBe(true);
    expect(readFrontmatterPath(done, ["status"])).toBe("Erledigt");
    // Un-done: status only reverts when it currently shows the done option…
    const reopened = applyTaskCompletion(done, model, false, read, set);
    expect(readFrontmatterPath(reopened, ["erledigt"])).toBe(false);
    expect(readFrontmatterPath(reopened, ["status"])).toBe("Offen");
    // …an intermediate option is never clobbered.
    const inProgress = `---\nerledigt: true\nstatus: In Arbeit\n---\n# T\n`;
    const kept = applyTaskCompletion(inProgress, model, false, read, set);
    expect(readFrontmatterPath(kept, ["erledigt"])).toBe(false);
    expect(readFrontmatterPath(kept, ["status"])).toBe("In Arbeit");
  });

  it("applyTaskStatusOption keeps the checkbox consistent with the picked option", () => {
    const config = parseBaseConfig(buildTaskDbFile("Aufgaben", LABELS).content);
    const model = resolveTaskCompletionModel(config)!;
    const note = `---\nerledigt: false\nstatus: Offen\n---\n# T\n`;
    const done = applyTaskStatusOption(note, model, "Erledigt", set);
    expect(readFrontmatterPath(done, ["status"])).toBe("Erledigt");
    expect(readFrontmatterPath(done, ["erledigt"])).toBe(true);
    const back = applyTaskStatusOption(done, model, "In Arbeit", set);
    expect(readFrontmatterPath(back, ["status"])).toBe("In Arbeit");
    expect(readFrontmatterPath(back, ["erledigt"])).toBe(false);
  });
});

/**
 * C4/S15 — which provider list a task created in this database also goes to.
 * The point of these tests is the REFUSALS: absent is absent, and a key that
 * no longer resolves must not be guessed at, because a task created in a list
 * the user can no longer see lands somewhere they cannot check.
 */
describe("task list target", () => {
  const lists = [
    { id: "@default", accountId: "g1", name: "Meine Aufgaben" },
    { id: "https://dav.example/lists/Privat 2/", accountId: "c1", name: "Privat" },
  ];

  it("splits the key at the FIRST space, so an id may contain spaces", () => {
    expect(splitTaskListKey("g1 @default")).toEqual({ accountId: "g1", listId: "@default" });
    expect(splitTaskListKey("c1 https://dav.example/lists/Privat 2/")).toEqual({
      accountId: "c1",
      listId: "https://dav.example/lists/Privat 2/",
    });
  });

  it("refuses a key that is not one", () => {
    for (const bad of ["", "   ", "onlyaccount", " leading", "trailing "]) {
      expect(splitTaskListKey(bad), bad).toBeNull();
    }
  });

  it("names the account only when there is more than one", () => {
    const labels = new Map([["g1", "Google"], ["c1", "iCloud"]]);
    expect(taskListPickerOptions(lists, labels, false).map((o) => o.label)).toEqual(["Meine Aufgaben", "Privat"]);
    expect(taskListPickerOptions(lists, labels, true).map((o) => o.label)).toEqual([
      "Meine Aufgaben · Google",
      "Privat · iCloud",
    ]);
    expect(taskListPickerOptions(lists, labels, true)[1].value).toBe("c1 https://dav.example/lists/Privat 2/");
  });

  it("resolves a stored choice against the lists that actually exist", () => {
    expect(resolveTaskListTarget({ taskList: "g1 @default" }, lists)).toEqual({ accountId: "g1", listId: "@default" });
  });

  it("returns null when nothing was chosen — a new task stays a note", () => {
    for (const cfg of [{}, { taskList: "" }, { taskList: "   " }, { taskList: 7 }, null, undefined]) {
      expect(resolveTaskListTarget(cfg, lists), JSON.stringify(cfg)).toBeNull();
    }
  });

  it("returns null when the chosen list is gone instead of guessing another", () => {
    // Account removed, list deleted, mirror switched off — all the same answer.
    expect(resolveTaskListTarget({ taskList: "g1 @deleted" }, lists)).toBeNull();
    expect(resolveTaskListTarget({ taskList: "gone @default" }, lists)).toBeNull();
    expect(resolveTaskListTarget({ taskList: "g1 @default" }, [])).toBeNull();
  });
});

/**
 * The row is only worth anything if it reaches the same rule the creation path
 * will ask (S16). These read the source rather than mock it: a test with mocks
 * would check its own mocks, and the bug this class of guard exists for is a
 * second surface deciding the same question differently.
 */
describe("the chosen list's name", () => {
  // The phone's creation sheet has to SAY the list ("also create in X?"), so
  // the name is resolved through the same rule as the target — a list that is
  // gone gives null here too, and then the question is simply not asked.
  const lists = [
    { id: "@default", accountId: "g1", name: "Meine Aufgaben" },
    { id: "l2", accountId: "c1", name: "  " },
  ];

  it("names the chosen list", () => {
    expect(resolveTaskListName({ taskList: "g1 @default" }, lists)).toBe("Meine Aufgaben");
  });

  it("is null when nothing is chosen or the choice is gone", () => {
    expect(resolveTaskListName({}, lists)).toBeNull();
    expect(resolveTaskListName({ taskList: "gone @default" }, lists)).toBeNull();
  });

  it("falls back to the id rather than showing an empty label", () => {
    // A provider that returns no display name must not produce a switch that
    // reads "also create in ''".
    expect(resolveTaskListName({ taskList: "c1 l2" }, lists)).toBe("l2");
  });
});

describe("the task-list choice has one home", () => {
  const src = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

  it("is stored in the database, not in a per-shell setting", () => {
    // A settings-store key would make the choice invisible to the file, so a
    // synced vault would carry the database but not where its tasks go.
    const viewer = src("components/BaseViewer.tsx");
    expect(viewer).toMatch(/nc\.taskList = value/);
    expect(viewer).toMatch(/delete nc\.taskList/);
    expect(viewer, "the choice must be saved through the .base config").toMatch(/saveConfig\(nc\)/);
  });

  it("offers the row only on a database that has tasks in it", () => {
    // A books or contacts database never creates a task, so "also create new
    // tasks in" would be a control that does not apply. The gate reuses the
    // EXISTING definition of a task database (a done checkbox or a status
    // column) instead of inventing a second one.
    expect(src("components/BaseViewer.tsx")).toMatch(/resolveTaskCompletionModel\(dbConfig\) \?/);
  });

  it("offers the row only when a list actually exists", () => {
    // An empty picker is a promise nothing can keep: without a PIM account
    // there is no list to create anything in.
    expect(src("components/BaseViewer.tsx")).toMatch(/taskListTargets\.length > 0 &&/);
  });

  it("shows a vanished choice as \"stays a note\", not as a raw key", () => {
    // The calendar picker had exactly this bug in July: the trigger showed the
    // raw `<account> <id>` because the stored calendar was not among the
    // options. Here the row asks the same rule the creation path will ask, so
    // what it displays is what would actually happen.
    expect(src("components/BaseViewer.tsx")).toMatch(/value: resolveTaskListTarget\(dbConfig,/);
  });

  it("filters the offered lists by the account's enabled state", () => {
    // Visibility is not permission — but a DISABLED account is not reachable
    // at all, and offering its list would produce a target that always fails.
    expect(src("components/BaseViewer.tsx")).toMatch(/lists\.filter\(\(l\) => enabled\.has\(l\.accountId\)\)/);
  });
});
