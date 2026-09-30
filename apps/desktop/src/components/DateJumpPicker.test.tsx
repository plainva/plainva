// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

/**
 * The date jump picker (plan Kalender, Anker-Links, Dependabot 2026-09-10,
 * P1): one grid for every place a date is picked to go to.
 *
 * What is pinned here is what the three hand-built grids got wrong or never
 * had: names from the app language (the date field said "Mo Di Mi" in every
 * language), the week starting where the setting says (it was Monday, hard
 * wired), a keyboard that moves INSIDE the grid (nothing in the calendar
 * tab's header was reachable by Tab at all), and the band that shows what
 * the caller currently displays.
 */

// The real i18n (test-setup loads every bundle and pins English); the German
// case switches the language itself, so the Intl names are asserted through
// the same path the app takes.
import i18n from "@plainva/ui/i18n";
// The picker from its own module, loaded while the file is collected: through
// the package barrel, the first test paid for all of @plainva/ui inside its
// time limit (Befunde 2026-09-24, Z2).
import { DateJumpPicker } from "../../../../packages/ui/src/components/ui/DateJumpPicker";

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
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });
const texts = (host: Element, sel: string) => [...host.querySelectorAll(sel)].map((e) => e.textContent?.trim());
const focused = (host: Element) => host.querySelector('.pv-datejump-day[tabindex="0"]')?.getAttribute("data-day");

describe("DateJumpPicker", () => {
  it("names weekdays and months in the app language and starts the week where the setting says", async () => {
    await i18n.changeLanguage("en");
    const m = await mount(<DateJumpPicker value="2026-09-10" weekStart={0} onPick={() => {}} />);
    expect(texts(m.host, ".pv-datejump-wd")[0]).toBe("Sun");
    expect(texts(m.host, ".pv-datejump-month")[0]).toBe("Jan");
    // A Sunday-first grid of September 2026 starts on Sunday, 30 August.
    expect(m.host.querySelector(".pv-datejump-day")?.getAttribute("data-day")).toBe("2026-08-30");
    await unmount(m);

    await i18n.changeLanguage("de");
    const de = await mount(<DateJumpPicker value="2026-09-10" weekStart={1} onPick={() => {}} />);
    expect(texts(de.host, ".pv-datejump-wd")[0]).toMatch(/^Mo/);
    expect(texts(de.host, ".pv-datejump-month")[2]).toMatch(/^Mär/);
    expect(de.host.querySelector(".pv-datejump-day")?.getAttribute("data-day")).toBe("2026-08-31");
    await unmount(de);
    await i18n.changeLanguage("en");
  });

  it("marks the selection, today, the band and the marked days", async () => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const m = await mount(
      <DateJumpPicker value={todayKey} weekStart={1} onPick={() => {}} band={{ from: todayKey, to: todayKey }} markedDays={new Set([todayKey])} />
    );
    const cell = m.host.querySelector(`[data-day="${todayKey}"]`)!;
    expect(cell.getAttribute("aria-pressed")).toBe("true");
    expect(cell.getAttribute("aria-current")).toBe("date");
    expect(cell.className).toContain("is-today");
    expect(cell.className).toContain("in-band");
    expect(cell.className).toContain("has-mark");
    // Exactly one Tab stop in the whole grid.
    expect(m.host.querySelectorAll('.pv-datejump-day[tabindex="0"]')).toHaveLength(1);
    await unmount(m);
  });

  it("moves with the arrow keys across the month edge, pages months and years, and picks with Enter", async () => {
    const picked: string[] = [];
    const closed = vi.fn();
    const m = await mount(<DateJumpPicker value="2026-09-30" weekStart={1} onPick={(k) => picked.push(k)} onClose={closed} />);
    const grid = m.host.querySelector('[data-testid="datejump-days"]')!;
    await key(grid, "ArrowRight");
    // The focus crossed into October, and the grid followed.
    expect(focused(m.host)).toBe("2026-10-01");
    expect(m.host.querySelector('.pv-datejump-month[aria-pressed="true"]')?.textContent).toBe("Oct");
    await key(grid, "ArrowDown");
    expect(focused(m.host)).toBe("2026-10-08");
    await key(grid, "PageDown");
    expect(focused(m.host)).toBe("2026-11-08");
    await key(grid, "PageUp", { shiftKey: true });
    expect(focused(m.host)).toBe("2025-11-08");
    expect(m.host.querySelector('[data-testid="datejump-year"]')?.textContent).toBe("2025");
    await key(grid, "Home");
    expect(focused(m.host)).toBe("2025-11-03");
    await key(grid, "Enter");
    expect(picked).toEqual(["2025-11-03"]);
    await key(grid, "Escape");
    expect(closed).toHaveBeenCalledTimes(1);
    await unmount(m);
  });

  it("without the day grid a month tile is the pick (the sidebar's variant)", async () => {
    const months: Array<[number, number]> = [];
    const m = await mount(
      <DateJumpPicker value="2026-09-10" weekStart={1} showDays={false} onPick={() => {}} onPickMonth={(y, mo) => months.push([y, mo])} testId="calendar-picker" />
    );
    expect(m.host.querySelector('[data-testid="calendar-picker-days"]')).toBeNull();
    await act(async () => {
      (m.host.querySelector('[data-testid="calendar-picker-prev-year"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (m.host.querySelector('[data-testid="calendar-picker-month-0"]') as HTMLButtonElement).click();
    });
    expect(months).toEqual([[2025, 0]]);
    await unmount(m);
  });

  it("offers week numbers only on a Monday-first grid, and a Today button only when asked", async () => {
    const today = vi.fn();
    const m = await mount(<DateJumpPicker value="2026-09-10" weekStart={1} showWeekNumbers onPick={() => {}} onToday={today} />);
    // Six rows of week numbers plus the header cell.
    expect(m.host.querySelectorAll(".pv-datejump-wk")).toHaveLength(7);
    await act(async () => {
      (m.host.querySelector('[data-testid="datejump-today"]') as HTMLButtonElement).click();
    });
    expect(today).toHaveBeenCalledTimes(1);
    await unmount(m);

    const s = await mount(<DateJumpPicker value="2026-09-10" weekStart={0} showWeekNumbers onPick={() => {}} />);
    expect(s.host.querySelectorAll(".pv-datejump-wk")).toHaveLength(0);
    expect(s.host.querySelector('[data-testid="datejump-today"]')).toBeNull();
    await unmount(s);
  });

  it("reloads visible-month marks, ignores late results, and refreshes after rename", async () => {
    const requests: Array<{ dates: Date[]; resolve: (days: Set<string>) => void }> = [];
    const load = (dates: Date[]) => new Promise<Set<string>>((resolve) => requests.push({ dates, resolve }));
    const picked = vi.fn();
    const opened = vi.fn();
    const props = { value: "2026-09-10", weekStart: 1 as const, loadMarkedDays: load, onPick: picked, onOpenDailyNote: opened };
    const m = await mount(<DateJumpPicker {...props} marksRevision={0} />);
    expect(requests[requests.length - 1].dates).toHaveLength(42);
    const old = requests.slice();
    await act(async () => { (m.host.querySelector('[data-testid="datejump-month-9"]') as HTMLButtonElement).click(); });
    const october = requests[requests.length - 1];
    expect(october.dates.some((date) => date.getMonth() === 9 && date.getDate() === 20)).toBe(true);
    await act(async () => { october.resolve(new Set(["2026-10-20"])); });
    await act(async () => { for (const request of old) request.resolve(new Set(["2026-09-10"])); });
    const cell = m.host.querySelector('[data-day="2026-10-20"]') as HTMLButtonElement;
    expect(cell.className).toContain("has-mark");
    expect(cell.getAttribute("aria-label")).toContain("Daily note exists");
    await act(async () => { cell.click(); });
    expect(picked).not.toHaveBeenCalled();
    const daily = m.host.querySelector('[data-testid="datejump-daily-note"]') as HTMLButtonElement;
    expect(daily.textContent).toBe("Open daily note");
    await act(async () => { daily.click(); });
    expect(opened).toHaveBeenCalledWith("2026-10-20");
    await act(async () => { m.root.render(<DateJumpPicker {...props} marksRevision={1} />); });
    expect(m.host.querySelector(".has-mark")).toBeNull();
    await act(async () => { requests[requests.length - 1].resolve(new Set()); });
    expect(daily.textContent).toBe("Create daily note");
    await act(async () => { (m.host.querySelector('[data-testid="datejump-go"]') as HTMLButtonElement).click(); });
    expect(picked).toHaveBeenCalledWith("2026-10-20");
    await unmount(m);
  });

  it("does not offer creation as if a failed existence scan proved absence", async () => {
    const m = await mount(<DateJumpPicker value="2026-09-10" weekStart={1} onPick={() => {}} onOpenDailyNote={() => {}}
      loadMarkedDays={async () => { throw new Error("permission denied"); }} />);
    expect(m.host.querySelector('[role="status"]')?.textContent).toContain("could not be loaded");
    expect(m.host.querySelector('[data-testid="datejump-daily-note"]')?.textContent).toBe("Open daily note");
    expect(m.host.querySelector(".has-mark")).toBeNull();
    await unmount(m);
  });
});
