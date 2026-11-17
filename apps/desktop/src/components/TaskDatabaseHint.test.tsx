// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import type { PimSyncProblem } from "@plainva/core";
import { CalendarSyncNotice, TaskDatabaseHint, TASK_NOTE_PROBLEM_PREFIX, resetTaskDbHint, withoutTaskDatabaseLines } from "@plainva/ui";

/**
 * The quiet hint for task lists without a standard task database (issue 172,
 * maintainer 2026-11-16): one neutral line, however many lists wait; hidden
 * for this vault on this device until a database was set again; the yellow
 * notice keeps only real faults. Rendered for real, both shells use it.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const line = (listId: string, code: string): PimSyncProblem => ({
  accountId: "a1", accountLabel: "Nextcloud", provider: "caldav", taskListId: listId, taskListName: listId, since: null, error: `${TASK_NOTE_PROBLEM_PREFIX}${code}`, signIn: false,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function View({ problems, onCreate, taskDatabase }: { problems: PimSyncProblem[]; onCreate: () => void; taskDatabase: string | null }) {
  return (
    <>
      <CalendarSyncNotice problems={withoutTaskDatabaseLines(problems)} onRetry={() => {}} />
      <TaskDatabaseHint vault="/vault" problems={problems} taskDatabase={taskDatabase} onCreate={onCreate} />
    </>
  );
}
const render = async (problems: PimSyncProblem[], onCreate: () => void = () => {}, taskDatabase: string | null = null) => {
  await act(async () => root.render(<View problems={problems} onCreate={onCreate} taskDatabase={taskDatabase} />));
};
const hints = () => container.querySelectorAll("[data-testid=task-db-hint]");
const warning = () => container.querySelector("[data-testid=calendar-sync-notice]");

describe("the hint for a missing task database (issue 172)", () => {
  it("says nothing without a list that waits for one", async () => {
    await render([]);
    expect(hints()).toHaveLength(0);
    expect(warning()).toBeNull();
  });

  it("is one neutral line for two lists, not a warning per list, and offers to create the database", async () => {
    let created = 0;
    await render([line("l1", "no-task-db"), line("l2", "no-task-db")], () => { created++; });
    expect(hints()).toHaveLength(1);
    expect(hints()[0]!.className).toContain("pv-banner--info");
    expect(hints()[0]!.textContent).toContain("need a standard task database");
    expect(warning()).toBeNull();
    await act(async () => container.querySelector<HTMLElement>("[data-testid=task-db-hint-create]")!.click());
    expect(created).toBe(1);
  });

  it("hidden stays hidden for this vault, also after a new start, until a database was set again", async () => {
    await render([line("l1", "no-task-db")]);
    await act(async () => container.querySelector<HTMLElement>("[data-testid=task-db-hint-hide]")!.click());
    expect(hints()).toHaveLength(0);
    act(() => root.unmount());
    root = createRoot(container);
    await render([line("l1", "no-task-db")]);
    expect(hints()).toHaveLength(0);
    // A run with a task database resets it; the database going missing later is a new state.
    resetTaskDbHint("/vault");
    act(() => root.unmount());
    root = createRoot(container);
    await render([line("l1", "no-task-db")]);
    expect(hints()).toHaveLength(1);
  });

  it("is gone once a task database is set, whatever line an earlier run left: no second database", async () => {
    await render([line("l1", "no-task-db")], () => {}, "Tasks.base");
    expect(hints()).toHaveLength(0);
    expect(container.querySelector("[data-testid=task-db-hint-create]")).toBeNull();
  });

  it("keeps real faults yellow, beside the quiet line", async () => {
    await render([line("l1", "no-task-db"), line("l2", "task-db-unreadable"), line("l3", "not-created"), line("l4", "no-index")]);
    expect(hints()).toHaveLength(1);
    expect(warning()!.querySelectorAll("[data-testid=calendar-sync-line]")).toHaveLength(3);
    expect(warning()!.querySelector(".pv-banner--warning")).not.toBeNull();
  });
});
