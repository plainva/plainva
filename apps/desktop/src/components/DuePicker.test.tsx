// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

/**
 * "Change due date" with quick choices and a time (wishes 2026-10-24, E2):
 * the dates behind Today, Tomorrow, This weekend and Next week, and the
 * picker both shells render — a quick choice keeps a time already set, a time
 * changed alone is taken with Done, and a checkbox (which holds a day only)
 * is told so instead of offered a switch.
 */

import i18n from "@plainva/ui/i18n";
import { dueQuickChoices, nextWeekStartDay, thisWeekendDay, dueTimeOf } from "../../../../packages/ui/src/lib/dueQuickChoices";
import { DuePicker } from "../../../../packages/ui/src/components/ui/DuePicker";

// 2026-10-19 is a Monday; the week of the mockup (Saturday 24 October).
const MON = "2026-10-19";
const WED = "2026-10-21";
const SAT = "2026-10-24";
const SUN = "2026-10-25";

describe("quick-choice dates", () => {
  it("this weekend is the coming Saturday, and today on Saturday and Sunday", () => {
    expect(thisWeekendDay(MON)).toBe(SAT);
    expect(thisWeekendDay(WED)).toBe(SAT);
    expect(thisWeekendDay("2026-10-23")).toBe(SAT);
    expect(thisWeekendDay(SAT)).toBe(SAT);
    expect(thisWeekendDay(SUN)).toBe(SUN);
  });

  it("next week starts where the week-start setting says — Monday, Sunday or Saturday", () => {
    // Monday-first weeks.
    expect(nextWeekStartDay(WED, 1)).toBe("2026-10-26");
    expect(nextWeekStartDay(MON, 1)).toBe("2026-10-26");
    expect(nextWeekStartDay(SAT, 1)).toBe("2026-10-26");
    expect(nextWeekStartDay(SUN, 1)).toBe("2026-10-26");
    // Sunday-first: on a Saturday the next week begins tomorrow; on a Sunday a week ahead.
    expect(nextWeekStartDay(WED, 0)).toBe(SUN);
    expect(nextWeekStartDay(SAT, 0)).toBe(SUN);
    expect(nextWeekStartDay(SUN, 0)).toBe("2026-11-01");
    // Saturday-first: on a Saturday it is the next Saturday, never today.
    expect(nextWeekStartDay(SAT, 6)).toBe("2026-10-31");
    expect(nextWeekStartDay(SUN, 6)).toBe("2026-10-31");
    expect(nextWeekStartDay("2026-10-23", 6)).toBe(SAT);
  });

  it("counts across a month and a year end", () => {
    expect(nextWeekStartDay("2026-12-30", 1)).toBe("2027-01-04");
    expect(thisWeekendDay("2026-12-31")).toBe("2027-01-02");
    expect(dueQuickChoices("2026-12-31", 1).map((c) => [c.id, c.day])).toEqual([
      ["today", "2026-12-31"],
      ["tomorrow", "2027-01-01"],
      ["weekend", "2027-01-02"],
      ["nextWeek", "2027-01-04"],
      ["none", null],
    ]);
  });

  it("shows a stored time as HH:MM and none for an all-day task", () => {
    expect(dueTimeOf(600)).toBe("10:00");
    expect(dueTimeOf(9 * 60 + 15)).toBe("09:15");
    expect(dueTimeOf(null)).toBeNull();
    expect(dueTimeOf(undefined)).toBeNull();
  });
});

async function mount(ui: React.ReactElement): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(ui);
  });
  return { host, root };
}
async function unmount(m: { host: HTMLDivElement; root: Root }) {
  await act(async () => {
    m.root.unmount();
  });
  m.host.remove();
}
const click = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement).click();
  });
const by = (host: Element, id: string) => host.querySelector(`[data-testid="${id}"]`);
/** React's own value setter, so the change reaches the component as typing would. */
const typeTime = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("DuePicker", () => {
  it("lists the five quick choices with their weekdays and marks the task's day", async () => {
    await i18n.changeLanguage("en");
    const m = await mount(<DuePicker day="2026-10-26" time={null} timeAllowed todayKey={SAT} weekStart={1} onPick={() => {}} />);
    const rows = [...m.host.querySelectorAll(".pv-datejump-qitem")];
    expect(rows.map((r) => r.querySelector(".pv-datejump-qlabel")?.textContent)).toEqual(["Today", "Tomorrow", "This weekend", "Next week", "No date"]);
    expect(rows.map((r) => r.querySelector(".pv-datejump-qday")?.textContent ?? null)).toEqual(["Sat", "Sun", "Sat", "Mon", null]);
    expect(rows.map((r) => r.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "true", "false"]);
    // The grid's own Today button gave way to the quick choice.
    expect(by(m.host, "task-due-grid-today")).toBeNull();
    await unmount(m);
  });

  it("a quick choice keeps the time the task has; the switch off makes it all-day", async () => {
    await i18n.changeLanguage("en");
    const onPick = vi.fn();
    const m = await mount(<DuePicker day="2026-10-22" time="14:00" timeAllowed todayKey={SAT} weekStart={1} onPick={onPick} />);
    expect((by(m.host, "task-due-time") as HTMLInputElement).value).toBe("14:00");
    await click(by(m.host, "task-due-quick-nextWeek"));
    expect(onPick).toHaveBeenLastCalledWith({ day: "2026-10-26", time: "14:00" });
    await click(by(m.host, "task-due-time-switch"));
    expect(by(m.host, "task-due-time")).toBeNull();
    await click(by(m.host, "task-due-grid-day-2026-10-28"));
    expect(onPick).toHaveBeenLastCalledWith({ day: "2026-10-28", time: null });
    await click(by(m.host, "task-due-quick-none"));
    expect(onPick).toHaveBeenLastCalledWith({ day: null, time: null });
    await unmount(m);
  });

  it("sets a time and a day in one go, and Done takes a time changed alone", async () => {
    await i18n.changeLanguage("en");
    const onPick = vi.fn();
    const m = await mount(<DuePicker day="2026-10-22" time={null} timeAllowed todayKey={SAT} weekStart={1} onPick={onPick} />);
    expect(by(m.host, "task-due-time-done")).toBeNull();
    await click(by(m.host, "task-due-time-switch"));
    await typeTime(by(m.host, "task-due-time") as HTMLInputElement, "10:00");
    // Only the time changed: Done takes it on the task's own day.
    await click(by(m.host, "task-due-time-done"));
    expect(onPick).toHaveBeenLastCalledWith({ day: "2026-10-22", time: "10:00" });
    await click(by(m.host, "task-due-quick-nextWeek"));
    expect(onPick).toHaveBeenLastCalledWith({ day: "2026-10-26", time: "10:00" });
    await unmount(m);
  });

  it("a checkbox holds a day only: no switch, a sentence instead, and every pick is all-day", async () => {
    await i18n.changeLanguage("en");
    const onPick = vi.fn();
    const m = await mount(<DuePicker day={null} time={null} timeAllowed={false} todayKey={SAT} weekStart={0} onPick={onPick} />);
    expect(by(m.host, "task-due-time-switch")).toBeNull();
    expect(by(m.host, "task-due-timerow")?.textContent).toContain("A checkbox in a note carries a day only");
    expect(by(m.host, "task-due-quick-none")?.getAttribute("aria-pressed")).toBe("true");
    await click(by(m.host, "task-due-quick-tomorrow"));
    expect(onPick).toHaveBeenLastCalledWith({ day: SUN, time: null });
    await unmount(m);
  });
});
