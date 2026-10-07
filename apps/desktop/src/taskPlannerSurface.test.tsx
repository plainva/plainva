// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildPlanner, TaskCheckButton, TaskPlannerList, type PlannerRow } from "@plainva/ui";

/**
 * The planner list as both shells mount it (plan Befunde 2026-10-06, W1-W3):
 * the box of a task is one control with one size rule, a task's date is the
 * way to change it, and the Overdue heading carries "All to today".
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

const TODAY = "2026-10-06";
const row = (over: Partial<PlannerRow> & Pick<PlannerRow, "id" | "title">): PlannerRow => ({
  source: "database", path: `${over.title}.md`, state: "open", due: null, dueMinutes: null, priority: 0, tags: [], ...over,
});
const ROWS: PlannerRow[] = [
  row({ id: "late", title: "Late", due: "2026-09-23" }),
  row({ id: "timed", title: "Timed", due: TODAY, dueMinutes: 14 * 60 }),
  row({ id: "plain", title: "Plain", due: TODAY }),
  row({ id: "locked", title: "Locked", due: "2026-09-30" }),
  row({ id: "done", title: "Done", due: "2026-09-01", state: "done" }),
];

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
const all = (host: HTMLElement, testId: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];

function list(props: Partial<React.ComponentProps<typeof TaskPlannerList>> = {}) {
  return (
    <TaskPlannerList
      sections={buildPlanner(ROWS, TODAY).sections("today")}
      emptyLabel="Nothing"
      databaseLabel="Tasks"
      onToggle={() => {}}
      onOpen={() => {}}
      {...props}
    />
  );
}

describe("the box of a task (W1)", () => {
  it("is the shared check button in every planner row, with its state", async () => {
    const onToggle = vi.fn();
    const host = await mount(list({ onToggle }));
    const boxes = all(host, "task-planner-toggle");
    expect(boxes.length).toBe(4);
    for (const box of boxes) {
      expect(box.tagName).toBe("BUTTON");
      expect(box.className).toContain("pv-iconbtn");
      expect(box.className).toContain("pv-iconbtn--taskbox");
      expect(box.dataset.state).toBe("open");
    }
    await act(async () => boxes[0].click());
    expect(onToggle.mock.calls[0][0].id).toBe("late");
  });

  it("says done by shape and by the accent, and can be unavailable", async () => {
    const onToggle = vi.fn();
    const host = await mount(<TaskCheckButton state="done" label="Open" onToggle={onToggle} disabled testId="box" />);
    const box = all(host, "box")[0] as HTMLButtonElement;
    expect(box.className).toContain("is-done");
    expect(box.querySelector('[data-task-state="done"]')).not.toBeNull();
    expect(box.getAttribute("aria-label")).toBe("Open");
    await act(async () => box.click());
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("draws the glyph at --taskbox-size: 18px with a pointer, 24px under a finger", () => {
    const tokens = readFileSync(resolve(__dirname, "../../../packages/ui/src/styles/tokens.css"), "utf8");
    const ui = readFileSync(resolve(__dirname, "../../../packages/ui/src/styles/ui.css"), "utf8");
    const touch = tokens.slice(tokens.indexOf('[data-density="touch"] {'));
    expect(tokens.slice(0, tokens.indexOf('[data-density="compact"]'))).toMatch(/--taskbox-size:\s*18px;/);
    expect(touch.slice(0, touch.indexOf("}"))).toMatch(/--taskbox-size:\s*24px;/);
    expect(ui).toMatch(/\.pv-iconbtn--taskbox svg\s*\{\s*width:\s*var\(--taskbox-size\);\s*height:\s*var\(--taskbox-size\);\s*\}/);
    // The target is the icon button's: at least 44px under a finger.
    expect(ui).toMatch(/\[data-density="touch"\] \.pv-iconbtn,[^{]*\{\s*min-width:\s*var\(--touch-sm\);\s*min-height:\s*var\(--touch-sm\);/);
  });

  it("no task list draws a box of its own any more", () => {
    const desktop = readFileSync(resolve(__dirname, "components/tasks/TasksView.tsx"), "utf8");
    const mobile = readFileSync(resolve(__dirname, "../../mobile/src/screens/TasksScreen.tsx"), "utf8");
    for (const source of [desktop, mobile]) {
      expect(source.match(/<TaskCheckButton/g)?.length).toBe(2);
      expect(source).not.toMatch(/data-testid="task(-db)?-toggle"/);
    }
  });
});

describe("a task's date is the way to change it (W2)", () => {
  it("is a button where the shell can move the day, and hands over the row and the chip", async () => {
    const onDue = vi.fn();
    const host = await mount(list({ onDue, canDue: (r) => r.id !== "locked" }));
    const chips = all(host, "task-planner-due");
    // Late and Locked show their date; Timed shows its time; Plain has nothing to show inside its day.
    expect(chips.map((chip) => chip.tagName)).toEqual(["BUTTON", "SPAN", "BUTTON"]);
    expect(chips.map((chip) => chip.textContent?.slice(0, 5))).toEqual(["09/23", "09/30", "02:00"]);
    await act(async () => chips[0].click());
    expect(onDue.mock.calls[0][0].id).toBe("late");
    expect(onDue.mock.calls[0][1]).toBe(chips[0]);
    await act(async () => chips[2].click());
    expect(onDue.mock.calls[1][0].id).toBe("timed");
  });

  it("a press on the date does not open the task", async () => {
    const onOpen = vi.fn();
    const host = await mount(list({ onDue: () => {}, onOpen }));
    await act(async () => all(host, "task-planner-due")[0].click());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("stays a label without a shell that can move it", async () => {
    const host = await mount(list());
    expect(all(host, "task-planner-due").every((chip) => chip.tagName === "SPAN")).toBe(true);
  });
});

describe("all overdue to today (W3)", () => {
  it("offers the action at the Overdue heading only, beside the count", async () => {
    const onOverdueToToday = vi.fn();
    const host = await mount(list({ onOverdueToToday }));
    const buttons = all(host, "task-planner-overdue-today");
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe("All to today");
    expect(buttons[0].closest('[data-testid="task-planner-section-overdue"]')).not.toBeNull();
    expect(buttons[0].parentElement?.textContent).toBe("All to today2");
    await act(async () => buttons[0].click());
    expect(onOverdueToToday).toHaveBeenCalledTimes(1);
  });

  it("is absent where nothing is overdue and where the shell does not offer it", async () => {
    const calm = await mount(list({ sections: buildPlanner(ROWS.slice(1, 3), TODAY).sections("today"), onOverdueToToday: () => {} }));
    expect(all(calm, "task-planner-overdue-today")).toEqual([]);
    const plain = await mount(list());
    expect(all(plain, "task-planner-overdue-today")).toEqual([]);
  });
});
