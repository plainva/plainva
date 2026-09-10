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
    const { DateJumpPicker } = await import("@plainva/ui");
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
    const { DateJumpPicker } = await import("@plainva/ui");
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
    const { DateJumpPicker } = await import("@plainva/ui");
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
    const { DateJumpPicker } = await import("@plainva/ui");
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
    const { DateJumpPicker } = await import("@plainva/ui");
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
});
