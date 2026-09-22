// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseJournal } from "@plainva/core";
import { JournalCardWall, readJournalShape, writeJournalShape, type JournalDay } from "@plainva/ui";

/**
 * The journal as a wall of cards (plan Journal-Erweiterungen, X5/E4).
 *
 * The same entries in a second shape, so what is pinned here is that nothing
 * underneath changed: the same days, the same order, the same actions — and
 * that a day break is a rule ACROSS the columns rather than a card inside one,
 * which is the whole reason each day gets its own little wall.
 */

const NOTE = [
  "# Monday",
  "",
  "## Journal",
  "",
  "- 08:00 Fog over the canal",
  "- [ ] 10:30 Order the spare part",
  "- 14:05 Called the workshop #client",
  "",
].join("\n");

function dayOf(key: string, raw: string): JournalDay {
  const [year, month, day] = key.split("-").map(Number);
  return {
    key,
    date: new Date(year, month - 1, day),
    path: `${key}.md`,
    entries: parseJournal(raw, { heading: "Journal" }).entries,
  };
}

const mounted: { root: Root; host: HTMLElement }[] = [];
const render = async (element: React.ReactElement) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(element); });
  return host;
};

afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => { root.unmount(); });
    host.remove();
  }
  try { localStorage.clear(); } catch { /* a blocked store is not a failure */ }
});

const noop = () => undefined;

describe("the wall", () => {
  it("draws one card per entry, newest first, as the stream does", async () => {
    const host = await render(
      <JournalCardWall
        days={[dayOf("2026-09-21", NOTE)]}
        onMenu={noop}
        onOpenEntry={noop}
        onToggleTask={noop}
        todayKey="2026-09-22"
      />,
    );
    const cards = [...host.querySelectorAll('[data-testid="journal-card"]')];
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain("Called the workshop");
    expect(cards[2].textContent).toContain("Fog over the canal");
  });

  it("gives every day its own wall, so a day break is a rule across the columns", async () => {
    const host = await render(
      <JournalCardWall
        days={[dayOf("2026-09-22", NOTE), dayOf("2026-09-21", NOTE)]}
        onMenu={noop}
        onOpenEntry={noop}
        onToggleTask={noop}
        todayKey="2026-09-22"
      />,
    );
    const sections = [...host.querySelectorAll('[data-testid="journal-day"]')];
    expect(sections.map((s) => s.getAttribute("data-day"))).toEqual(["2026-09-22", "2026-09-21"]);
    // Today says so; the other day is just its date.
    expect(sections[0].querySelector(".pv-journal-wall-head")?.textContent).toMatch(/·/);
  });

  it("marks a task card and offers the box, so the same entry can be ticked here", async () => {
    let ticked = 0;
    const host = await render(
      <JournalCardWall
        days={[dayOf("2026-09-21", NOTE)]}
        onMenu={noop}
        onOpenEntry={noop}
        onToggleTask={() => { ticked += 1; }}
        todayKey="2026-09-22"
      />,
    );
    const task = host.querySelector('[data-testid="journal-card"][data-task="open"]');
    expect(task).not.toBeNull();
    const box = task?.querySelector<HTMLButtonElement>('[data-testid="journal-entry-toggle"]');
    expect(box).not.toBeNull();
    await act(async () => { box?.click(); });
    expect(ticked).toBe(1);
  });

  it("opens an entry when the card itself is pressed, not when the box is", async () => {
    const opened: string[] = [];
    const host = await render(
      <JournalCardWall
        days={[dayOf("2026-09-21", NOTE)]}
        onMenu={noop}
        onOpenEntry={(_day, entry) => opened.push(entry.text)}
        onToggleTask={noop}
        todayKey="2026-09-22"
      />,
    );
    const cards = [...host.querySelectorAll<HTMLElement>('[data-testid="journal-card"]')];
    await act(async () => { cards[0].click(); });
    expect(opened).toEqual(["Called the workshop #client"]);
    // The box stops the press: ticking a task is not opening it.
    const task = host.querySelector('[data-task="open"]');
    await act(async () => { task?.querySelector<HTMLButtonElement>('[data-testid="journal-entry-toggle"]')?.click(); });
    expect(opened).toHaveLength(1);
  });
});

describe("which shape the journal is read in", () => {
  it("is the stream until a device says otherwise, and is remembered", () => {
    expect(readJournalShape()).toBe("stream");
    writeJournalShape("cards");
    expect(readJournalShape()).toBe("cards");
    writeJournalShape("stream");
    expect(readJournalShape()).toBe("stream");
  });

  it("is the stream when the store is blocked, instead of throwing", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readJournalShape()).toBe("stream");
    expect(() => writeJournalShape("cards")).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
