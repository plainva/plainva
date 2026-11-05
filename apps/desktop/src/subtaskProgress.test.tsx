// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { scanTasks, type TaskRecord } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { buildPlanner, plannerRowsFromTasks, subtaskProgress, TaskPlannerList, TaskPlannerNav } from "@plainva/ui";

/**
 * The tasks tab from the tester's draft (plan Rückmeldungen 2026-11-05, P11):
 * "1 of 3 done" at a task with subtasks, counted over its direct subtasks,
 * and the number of tasks on the chosen list of the phone's segment. Shared
 * components, so both shells show the same.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-11-05";
const NOTE = [
  "- [ ] Umzug vorbereiten 📅 2026-11-05",
  "  - [x] Kartons bestellen",
  "  - [ ] Halteverbot beantragen",
  "    - [x] Formular holen",
  "  - [-] Möbelwagen",
  "  - [ ] Nachsendeauftrag",
  "- [ ] Steuerunterlagen sortieren 📅 2026-11-05",
  "",
].join("\n");

function rows() {
  const tasks: TaskRecord[] = scanTasks(NOTE).map((task) => ({ ...task, path: "Umzug.md", title: "Umzug", excluded: false }));
  return plannerRowsFromTasks(tasks);
}

const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); }
});
async function mount(node: React.ReactNode): Promise<HTMLDivElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(node); });
  return host;
}

describe("subtaskProgress", () => {
  it("counts the direct subtasks of a task, done among them; a cancelled one does not count", () => {
    const all = rows();
    const progress = subtaskProgress(all);
    const [parent, , halteverbot] = all;
    expect(progress.get(parent.id)).toEqual({ done: 1, total: 3 });
    // A subtask's own subtask counts at that subtask, not at the task above.
    expect(progress.get(halteverbot.id)).toEqual({ done: 1, total: 1 });
    // A task without subtasks is not listed.
    expect(progress.has(all[all.length - 1].id)).toBe(false);
    expect(progress.size).toBe(2);
  });
});

describe("in the planner", () => {
  it("a task with subtasks says how many are done, whether or not they stand under it", async () => {
    await i18n.changeLanguage("en");
    const all = rows();
    const planner = buildPlanner(all.filter((row) => !row.parentId), TODAY);
    const host = await mount(
      <TaskPlannerList sections={planner.sections("today")} emptyLabel="" databaseLabel="" onToggle={() => {}} onOpen={() => {}} progress={subtaskProgress(all)} />,
    );
    const chips = [...host.querySelectorAll('[data-testid="task-planner-progress"]')].map((chip) => chip.textContent);
    expect(chips).toEqual(["1 of 3 done"]);
    await i18n.changeLanguage("de");
    await act(async () => {});
    expect(host.querySelector('[data-testid="task-planner-progress"]')?.textContent).toBe("1 von 3 erledigt");
  });

  it("the phone's segment carries the number of the chosen list, and Today's always", async () => {
    await i18n.changeLanguage("en");
    const counts = { overdue: 1, today: 3, upcoming: 2, inbox: 5, done: 7 };
    const label = (host: HTMLElement, list: string) => host.querySelector(`[data-testid="tasks-list-${list}"]`)?.textContent;
    const inbox = await mount(<TaskPlannerNav variant="segment" value="inbox" onChange={() => {}} counts={counts} allCount={11} />);
    expect([label(inbox, "today"), label(inbox, "upcoming"), label(inbox, "inbox"), label(inbox, "all"), label(inbox, "done")]).toEqual(["Today 4", "Upcoming", "Inbox 5", "All", "Done"]);
    const done = await mount(<TaskPlannerNav variant="segment" value="done" onChange={() => {}} counts={counts} allCount={11} />);
    expect(label(done, "done")).toBe("Done 7");
    expect(label(done, "inbox")).toBe("Inbox");
  });
});
