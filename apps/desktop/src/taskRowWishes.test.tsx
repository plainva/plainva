// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TaskRecord } from "@plainva/core";
import { scanTasks } from "@plainva/core";
import {
  buildPlanner,
  doneTasksOnDay,
  nestPlannerRows,
  parseTaskViewState,
  plannerRowCaps,
  plannerRowsForTree,
  plannerRowsFromDb,
  plannerRowsFromTasks,
  readDoneFoldOpen,
  TaskCheckButton,
  TaskPlannerList,
  taskPlainTitle,
  taskRowActions,
  TaskTitle,
  buildWikiTargetSet,
  wikiLinkLabel,
  type PlannerRow,
  type PlannerTreeNode,
  type TaskDbRow,
} from "@plainva/ui";

/**
 * The task-row wishes of 2026-10-24 (TestFlight, builds 136 and 139): what a
 * task row can do, once (E1); links in a task's title (E3); what was finished
 * today (E5); subtasks under their task and the bullets under it (E6); one box
 * on the phone (E9). The rules are shared, so they are tested here once for
 * both shells.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", async () => {
  const data = (await import("../../../packages/ui/src/locales/en.json")).default;
  const lookup = (key: string): unknown => key.split(".").reduce<unknown>((obj, k) => (obj as Record<string, unknown>)?.[k], data);
  return { initReactI18next: { type: "3rdParty", init() {} }, useTranslation: () => ({ i18n: { language: "en" },
    t: (key: string, vars?: Record<string, unknown>) => {
      const value = lookup(key);
      return Object.entries(vars ?? {}).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), typeof value === "string" ? value : key);
    },
  }) };
});

const TODAY = "2026-10-24";
const t = (key: string) => key;

/** The checkbox tasks of one note, the way `listTasks` hands them over. */
function noteTasks(path: string, content: string): TaskRecord[] {
  return scanTasks(content).map((task) => ({ ...task, path, title: path.replace(/\.md$/, ""), excluded: false }));
}

const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); }
  localStorage.clear();
});
async function mount(node: React.ReactNode): Promise<HTMLDivElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(node); });
  return host;
}
const all = (host: HTMLElement, testId: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];

describe("what a task row can do, once (E1)", () => {
  const handlers = {
    open: vi.fn(), toggle: vi.fn(), promote: vi.fn(), repeat: vi.fn(), block: vi.fn(), due: vi.fn(), priority: vi.fn(), state: vi.fn(),
  };
  const db: PlannerRow = { id: "db:Tasks/Offer.md", source: "database", path: "Tasks/Offer.md", title: "Offer", state: "open", due: TODAY, dueMinutes: null, priority: 0, tags: [] };
  const [note] = plannerRowsFromTasks(noteTasks("Home.md", "- [ ] Ask [[Alexander Gaas|Alex]] 📅 2026-10-24\n"));

  it("a database entry: no promotion and no box states; the repeat rule unless it is mirrored", () => {
    const caps = plannerRowCaps(db, handlers, { databaseTickable: true, databaseDue: true });
    expect(taskRowActions(t, caps).map((a) => a.id)).toEqual(["toggle", "repeat", "block", "due", "priority"]);
    expect(caps.title).toBe("Offer");
    const mirrored = plannerRowCaps({ ...db, mirrored: true }, handlers, { databaseTickable: true, databaseDue: true });
    expect(mirrored.repeat).toBeUndefined();
  });

  it("a database that cannot say done offers no tick, one without a date column no day", () => {
    const caps = plannerRowCaps(db, handlers, { databaseTickable: false, databaseDue: false });
    expect(caps.toggle).toBeUndefined();
    expect(caps.due).toBeUndefined();
  });

  it("a checkbox: promotion and its four states, never a repeat rule; the sheet heading reads the link as its text", () => {
    const caps = plannerRowCaps(note, handlers, { databaseTickable: false, databaseDue: false });
    expect(taskRowActions(t, caps).map((a) => a.id)).toEqual(["toggle", "promote", "block", "due", "priority", "state"]);
    expect(caps.title).toBe("Ask Alex");
    caps.due!();
    expect(handlers.due).toHaveBeenCalledWith(note);
    caps.open();
    expect(handlers.open).toHaveBeenCalledWith(note);
  });

  it("offers only what the shell can do", () => {
    const caps = plannerRowCaps(note, { open: vi.fn(), toggle: vi.fn() }, { databaseTickable: true, databaseDue: true });
    expect(taskRowActions(t, caps).map((a) => a.id)).toEqual(["toggle"]);
    // The swipe takes the part of the same list marked for it.
    const full = plannerRowCaps(note, handlers, { databaseTickable: true, databaseDue: true });
    expect(taskRowActions(t, full).filter((a) => a.swipe).map((a) => a.id)).toEqual(["toggle", "promote", "block"]);
  });
});

describe("a link in a task's title reads as its text (E3)", () => {
  it("shows the alias, else the note's name — not its folder, not its heading", () => {
    expect(taskPlainTitle("[[Alexander Gaas|Alex]] fragen ob Willkommenspaket angekommen")).toBe("Alex fragen ob Willkommenspaket angekommen");
    expect(taskPlainTitle("Mit Chefin von [[People/Anna Dóczi]] sprechen")).toBe("Mit Chefin von Anna Dóczi sprechen");
    expect(taskPlainTitle("See [[Plan#Budget]] and **[the log](Logs/Log.md)**")).toBe("See Plan and the log");
    expect(wikiLinkLabel({ kind: "wikiLink", target: "", display: "#Budget", anchor: "#Budget" })).toBe("Budget");
    expect(taskPlainTitle("[[#^block1]] and [[Note|Note]]")).toBe("block1 and Note");
  });

  it("a press on the link opens its note, read from the task's note; a press beside it opens the task", async () => {
    const onOpenNote = vi.fn();
    const onOpen = vi.fn();
    const rows = plannerRowsFromTasks(noteTasks("Work/Home.md", "- [ ] [[Alexander Gaas|Alex]] fragen 📅 2026-10-24\n"));
    const host = await mount(
      <TaskPlannerList sections={buildPlanner(rows, TODAY).sections("today")} emptyLabel="-" databaseLabel="Tasks" onToggle={() => {}} onOpen={onOpen} links={{ onOpenNote }} />,
    );
    const title = host.querySelector(".pv-grouprow-title")!;
    expect(title.textContent).toBe("Alex fragen");
    const link = all(host, "task-title-link")[0];
    expect(link.className).toBe("pv-wiki-link");
    await act(async () => link.click());
    expect(onOpenNote).toHaveBeenCalledWith("Alexander Gaas", false, "wiki", "Work/Home.md");
    expect(onOpen).not.toHaveBeenCalled();
    await act(async () => (all(host, "task-planner-row")[0]).click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("sorts a row by what it shows: a link under the letter of its text", () => {
    const rows = plannerRowsFromTasks(noteTasks("Home.md", [
      "- [ ] Zahnarzt anrufen 📅 2026-10-24",
      "- [ ] [[Alexander Gaas|Alex]] fragen 📅 2026-10-24",
      "- [ ] Aaron anrufen 📅 2026-10-24",
      "- [ ] [[People/Bert]] treffen 📅 2026-10-24",
    ].join("\n")));
    const today = buildPlanner(rows, TODAY).sections("today").find((s) => s.kind === "today")!;
    // The written brackets sorted both links before everything else.
    expect(today.rows.map((r) => taskPlainTitle(r.title))).toEqual(["Aaron anrufen", "Alex fragen", "Bert treffen", "Zahnarzt anrufen"]);
  });

  it("without handlers a link is drawn and does nothing", async () => {
    const host = await mount(<TaskTitle text="Call [[Bob]]" notePath="a.md" />);
    expect(host.textContent).toBe("Call Bob");
    expect(all(host, "task-title-link")).toHaveLength(0);
    expect(host.querySelector(".pv-wiki-link")?.textContent).toBe("Bob");
  });

  // A link to a note that does not exist reads as it does in the editor
  // (remaining point of the wishes plan): the editor's question
  // (`isWikiTargetResolved`, ADR 0027) asked of the lookup the shell feeds it.
  const lookup = buildWikiTargetSet([
    { path: "People/Alexander Gaas.md", title: "Alexander Gaas" },
    { path: "Plan.md", title: "Plan" },
    { path: "Work/Sibling.md", title: "Sibling" },
    { path: "Notes/2026-10-01 Kickoff.md", title: "Kickoff" },
  ]);
  const linkClasses = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".pv-wiki-link")].map((el) => [el.textContent, el.className, el.getAttribute("data-tip")]);

  it("draws a link to a missing note as unresolved — by name, path, heading, relative path and title, as the editor does", async () => {
    const host = await mount(
      <TaskTitle
        text="[[Alexander Gaas|Alex]] [[Plan#Budget]] [[./Sibling]] [[Kickoff]] [[Nobody]] [[Plan/Missing]] [[Ghost#Part|G]]"
        notePath="Work/Home.md"
        links={{ onOpenNote: () => {} }}
        linkLookup={lookup}
      />,
    );
    const tip = "Note doesn't exist yet — click to create";
    expect(linkClasses(host)).toEqual([
      ["Alex", "pv-wiki-link", null],
      ["Plan", "pv-wiki-link", null],
      ["Sibling", "pv-wiki-link", null],
      ["Kickoff", "pv-wiki-link", null],
      ["Nobody", "pv-wiki-link pv-wiki-link--unresolved", tip],
      ["Missing", "pv-wiki-link pv-wiki-link--unresolved", tip],
      ["G", "pv-wiki-link pv-wiki-link--unresolved", tip],
    ]);
  });

  it("counts every link as resolved while there is no lookup — the index loading, as in the editor", async () => {
    for (const linkLookup of [undefined, null]) {
      const host = await mount(<TaskTitle text="[[Nobody]]" notePath="a.md" links={{ onOpenNote: () => {} }} linkLookup={linkLookup} />);
      expect(linkClasses(host)).toEqual([["Nobody", "pv-wiki-link", null]]);
    }
  });

  it("a drawn-only link is unresolved too, without the press hint; the planner hands its lookup on", async () => {
    const drawn = await mount(<TaskTitle text="[[Nobody]]" notePath="a.md" linkLookup={lookup} />);
    expect(linkClasses(drawn)).toEqual([["Nobody", "pv-wiki-link pv-wiki-link--unresolved", null]]);
    const rows = plannerRowsFromTasks(noteTasks("Work/Home.md", "- [ ] [[Nobody]] and [[Plan]] 📅 2026-10-24\n"));
    const host = await mount(
      <TaskPlannerList sections={buildPlanner(rows, TODAY).sections("today")} emptyLabel="-" databaseLabel="Tasks" onToggle={() => {}} onOpen={() => {}} links={{ onOpenNote: () => {} }} linkLookup={lookup} />,
    );
    expect(all(host, "task-title-link").map((el) => el.className)).toEqual(["pv-wiki-link pv-wiki-link--unresolved", "pv-wiki-link"]);
  });
});

describe("what was finished today (E5)", () => {
  const tasks = noteTasks("Home.md", [
    "- [x] Probe ✅ 2026-10-24",
    "- [x] Yesterday ✅ 2026-10-23",
    "- [x] No date",
    "- [-] Dropped ❌ 2026-10-24",
    "- [ ] Open",
  ].join("\n"));
  const at = (day: string, hour: number) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hour).getTime();
  const dbRows: TaskDbRow[] = [
    { path: "Tasks/Paper.md", title: "Druckerpapier", status: "Done", done: true, due: null, modified: at(TODAY, 9) },
    { path: "Tasks/Old.md", title: "Old", status: "Done", done: true, due: null, modified: at("2026-10-20", 9) },
    { path: "Tasks/Busy.md", title: "Busy", status: "Open", done: false, due: null, modified: at(TODAY, 9) },
  ];

  it("a checkbox by its ✅ date, a database entry by the day its note last changed", () => {
    const rows = [...plannerRowsFromDb(dbRows, () => undefined), ...plannerRowsFromTasks(tasks)];
    expect(doneTasksOnDay(rows, TODAY).map((r) => r.title)).toEqual(["Druckerpapier", "Probe"]);
    // Before the vault's day boundary the diary's today reaches up to the calendar's.
    expect(doneTasksOnDay(rows, "2026-10-23", TODAY).map((r) => r.title)).toEqual(["Druckerpapier", "Probe", "Yesterday"]);
  });

  it("folds under Today, closed until opened; the device remembers the choice", async () => {
    const rows = plannerRowsFromTasks(noteTasks("Home.md", "- [ ] Angebot 📅 2026-10-24\n- [x] Probe ✅ 2026-10-24\n"));
    const done = doneTasksOnDay(rows, TODAY);
    const props = { sections: buildPlanner(rows, TODAY).sections("today"), emptyLabel: "-", databaseLabel: "Tasks", onToggle: () => {}, onOpen: () => {}, doneToday: done };
    const host = await mount(<TaskPlannerList {...props} />);
    const fold = all(host, "task-done-fold")[0];
    expect(fold.textContent).toBe("Done (1)");
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(all(host, "task-planner-row").map((r) => r.textContent)).toEqual([expect.stringContaining("Angebot")]);
    await act(async () => fold.click());
    expect(readDoneFoldOpen()).toBe(true);
    expect(all(host, "task-planner-row").map((r) => r.dataset.state)).toEqual(["open", "done"]);
    const again = await mount(<TaskPlannerList {...props} />);
    expect(all(again, "task-done-fold")[0].getAttribute("aria-expanded")).toBe("true");
  });
});

describe("subtasks under their task, bullets as a preview (E6)", () => {
  const content = [
    "- [ ] Einführung PD Level 7 und 8 📅 2026-10-24",
    "  - Vorschlag: PD Level 8 einmal in 2 Wochen",
    "  - Wo binden wir den Materialbesteller ein?",
    "  - [ ] Termine mit Javid 📅 2026-10-28",
    "  - [x] Checkliste prüfen ✅ 2026-10-23",
    "  - [ ] Ohne Datum",
    "- [ ] Alex fragen",
  ].join("\n");
  const rows = plannerRowsFromTasks(noteTasks("Work.md", content));
  const titles = (nodes: PlannerTreeNode[]): unknown[] => nodes.map((n) => (n.children.length ? [n.row.title, titles(n.children)] : n.row.title));

  it("carries the task above a subtask and the bullets under a task", () => {
    expect(rows.map((r) => r.parentId ?? null)).toEqual([null, "note:Work.md#0", "note:Work.md#0", "note:Work.md#0", null]);
    expect(rows[0].details).toEqual(["Vorschlag: PD Level 8 einmal in 2 Wochen", "Wo binden wir den Materialbesteller ein?"]);
  });

  it("an undated subtask of an open task leaves the Inbox and the Done list; one with a day keeps it", () => {
    // Open or finished, it stands under its task — finished ones struck through.
    const listed = plannerRowsForTree(rows);
    expect(listed.map((r) => r.title)).toEqual(["Einführung PD Level 7 und 8", "Termine mit Javid", "Alex fragen"]);
    const planner = buildPlanner(listed, TODAY);
    expect(planner.sections("inbox")[0].rows.map((r) => r.title)).toEqual(["Alex fragen"]);
    expect(planner.sections("upcoming")[0].rows.map((r) => r.title)).toEqual(["Termine mit Javid"]);
  });

  it("nests every subtask under its task, whatever its day or state, and lists it again only on a day of its own", () => {
    const planner = buildPlanner(plannerRowsForTree(rows), TODAY);
    const today = planner.sections("today").find((s) => s.kind === "today")!;
    expect(titles(nestPlannerRows(today.rows, rows))).toEqual([["Einführung PD Level 7 und 8", ["Termine mit Javid", "Checkliste prüfen", "Ohne Datum"]]]);
    // On its own day the subtask stands on its own.
    const day = planner.sections("upcoming")[0];
    expect(titles(nestPlannerRows(day.rows, rows))).toEqual(["Termine mit Javid"]);
    // A subtask in the same section as its task is not listed twice.
    expect(titles(nestPlannerRows(rows.slice(0, 2), rows))).toEqual([["Einführung PD Level 7 und 8", ["Termine mit Javid", "Checkliste prüfen", "Ohne Datum"]]]);
  });

  it("draws the subtasks indented under their task, folds them away, and shows the bullets", async () => {
    const sections = buildPlanner(plannerRowsForTree(rows), TODAY).sections("today");
    const props = { sections, emptyLabel: "-", databaseLabel: "Tasks", onToggle: () => {}, onOpen: () => {} };
    const host = await mount(<TaskPlannerList {...props} subtasks={rows} details />);
    const shown = all(host, "task-planner-row");
    expect(shown.map((r) => r.querySelector(".pv-task-title")?.textContent)).toEqual(["Einführung PD Level 7 und 8", "Termine mit Javid", "Checkliste prüfen", "Ohne Datum"]);
    expect(shown.map((r) => r.className.includes("pv-grouprow--indent"))).toEqual([false, true, true, true]);
    expect(all(host, "task-planner-details")[0].textContent).toBe("Vorschlag: PD Level 8 einmal in 2 WochenWo binden wir den Materialbesteller ein?");
    const fold = all(host, "task-planner-fold")[0];
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    await act(async () => fold.click());
    expect(all(host, "task-planner-row")).toHaveLength(1);
    // Switched off: every row on its own, no preview.
    const flat = await mount(<TaskPlannerList {...props} />);
    expect(all(flat, "task-planner-details")).toHaveLength(0);
    expect(all(flat, "task-planner-fold")).toHaveLength(0);
  });

  it("both switches are filters of the view, on until switched off, and remembered", () => {
    expect(parseTaskViewState(null)).toMatchObject({ subtasks: true, details: true });
    expect(parseTaskViewState(JSON.stringify({ version: 1, subtasks: false, details: false }))).toMatchObject({ subtasks: false, details: false });
  });
});

describe("one task box on the phone (E9)", () => {
  it("draws the glyph for a pointer and the drawn box for a finger, both saying the state", async () => {
    for (const state of ["open", "progress", "done", "cancelled"] as const) {
      const host = await mount(<TaskCheckButton state={state} label="x" onToggle={() => {}} testId="box" />);
      const box = all(host, "box")[0];
      expect(box.querySelector(`svg[data-task-state="${state}"]`)).not.toBeNull();
      expect(box.querySelector(`.pv-taskbox-face[data-state="${state}"]`)).not.toBeNull();
    }
  });
});
