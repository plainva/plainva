// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fillAllDayRoom,
  forgetFreshNote,
  getShowWeekNumbers,
  isFreshNote,
  isoWeekLabel,
  markFreshNote,
  parkTemplateCaret,
  consumePendingTemplateCaret,
  planAllDayRows,
  resetFreshNotesForTests,
  setShowWeekNumbers,
  SHOW_WEEK_NUMBERS_KEY,
  weekNumbersShown,
  WIKI_LINK_HOVER_STYLE,
  WIKI_LINK_STYLE,
  WIKI_LINK_UNRESOLVED_STYLE,
} from "@plainva/ui";

/**
 * The wishes package (plan Wiederaufnahme, step 10b, 2026-10-19): the shared
 * building blocks both shells draw from. Each rule lives once in the ui
 * package; these tests hold what it answers.
 */

const REPO = join(__dirname, "../../..");
const source = (rel: string) => readFileSync(join(REPO, rel), "utf8");

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
/** The declarations of the first block whose selector list is exactly `selector`. */
function cssBlock(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  expect(at, `no block for ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  const out: Record<string, string> = {};
  for (const decl of body.split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}
const asCss = (style: Record<string, string>) => Object.fromEntries(Object.entries(style).map(([k, v]) => [kebab(k), v]));

describe("links: one look per device choice (wish 1, then the maintainer's setting of 2026-10-23)", () => {
  const ui = source("packages/ui/src/styles/ui.css");

  it("draws the reading views' link with the editor's values", () => {
    // The maintainer asked that the live-preview link look the same as in
    // reading mode: ui.css carries the same declarations as the editor theme.
    expect(cssBlock(ui, ".pv-wiki-link")).toEqual(asCss(WIKI_LINK_STYLE));
    expect(cssBlock(ui, ".pv-wiki-link:hover")).toEqual(asCss(WIKI_LINK_HOVER_STYLE));
    expect(cssBlock(ui, ".pv-wiki-link--unresolved,\n.pv-wiki-link--unresolved:hover")).toEqual(asCss(WIKI_LINK_UNRESOLVED_STYLE));
  });

  it("is underlined by default, as up to 0.8.5, and the tint is one choice of four", () => {
    expect(WIKI_LINK_STYLE.textDecoration).toBe("var(--wiki-link-decoration)");
    expect(WIKI_LINK_HOVER_STYLE.textDecoration).toBe("underline");
    expect(WIKI_LINK_UNRESOLVED_STYLE.textDecoration).toBe("underline dashed");
    const colors = source("packages/ui/src/styles/base-colors.css");
    for (const token of ["--wiki-link-bg: transparent;", "--wiki-link-weight: inherit;", "--wiki-link-decoration: underline;", "--web-link-decoration: underline;"]) {
      expect(colors).toContain(token);
    }
    // Each choice only moves tokens, and never in high contrast.
    for (const choice of ['[data-link-note="tint"]', '[data-link-note="color"]', '[data-link-note="subtle"]', '[data-link-web="color"]']) {
      expect(ui).toContain(`html:not([data-theme-name="high-contrast"])${choice} {`);
    }
    expect(cssBlock(ui, 'html:not([data-theme-name="high-contrast"])[data-link-note="tint"]')["--wiki-link-decoration"]).toBe("none");
    const hc = source("packages/ui/src/themes/high-contrast.css");
    expect(hc).toContain("--wiki-link-bg: transparent;");
    expect(hc).toContain("--wiki-link-decoration: underline;");
  });

  it("gives every surface that draws a wiki link the one look", () => {
    expect(source("apps/desktop/src/components/MarkdownReader.tsx")).toMatch(/className=\{unresolved \? 'pv-wiki-link pv-wiki-link--unresolved' : 'pv-wiki-link'\}/);
    expect(source("packages/ui/src/components/NoteCardBody.tsx")).toMatch(/case "wikiLink": return <span key=\{key\} className="pv-wiki-link">/);
    expect(source("packages/ui/src/components/MarkdownTheme.ts")).toContain('".cm-md-cell-link.pv-wiki-link": WIKI_LINK_STYLE');
    expect(source("packages/ui/src/components/WikiLinkPlugin.ts")).toContain('".cm-wiki-link.cm-wiki-link--note": WIKI_LINK_STYLE');
  });
});

describe("wish 2: week numbers, one switch for every calendar", () => {
  afterEach(() => localStorage.clear());

  it("names the ISO week of a run of days", () => {
    // Monday 19 October 2026 is in week 43.
    const days = (from: number, n: number) => Array.from({ length: n }, (_, i) => new Date(2026, 9, from + i));
    expect(isoWeekLabel(days(19, 7), "Wk")).toBe("Wk 43");
    expect(isoWeekLabel(days(21, 1), "KW")).toBe("KW 43");
    // Three days across a Monday name both weeks.
    expect(isoWeekLabel(days(24, 3), "KW")).toBe("KW 43–44");
    // The year's edge: 31 December 2026 is a Thursday, still week 53.
    expect(isoWeekLabel([new Date(2026, 11, 31)], "Wk")).toBe("Wk 53");
    expect(isoWeekLabel([], "Wk")).toBe("");
  });

  it("is the sidebar calendar's old choice, kept under its old key", () => {
    expect(SHOW_WEEK_NUMBERS_KEY).toBe("plainva-calendar-show-weeks");
    localStorage.setItem(SHOW_WEEK_NUMBERS_KEY, "true");
    expect(getShowWeekNumbers()).toBe(true);
    let heard = 0;
    const listener = () => { heard += 1; };
    window.addEventListener("plainva-show-week-numbers-changed", listener);
    setShowWeekNumbers(false);
    window.removeEventListener("plainva-show-week-numbers-changed", listener);
    expect(getShowWeekNumbers()).toBe(false);
    expect(localStorage.getItem(SHOW_WEEK_NUMBERS_KEY)).toBe("false");
    expect(heard).toBe(1);
  });

  it("shows ISO weeks only where the week starts on Monday", () => {
    expect(weekNumbersShown(true, 1)).toBe(true);
    expect(weekNumbersShown(true, 0)).toBe(false);
    expect(weekNumbersShown(true, 6)).toBe(false);
    expect(weekNumbersShown(false, 1)).toBe(false);
  });

  it("is read by the sidebar calendar, the calendar tab and the phone's calendar", () => {
    for (const file of [
      "apps/desktop/src/components/CalendarWidget.tsx",
      "apps/desktop/src/components/pimcal/CalendarView.tsx",
      "apps/mobile/src/screens/PimCalendarScreen.tsx",
    ]) {
      const code = source(file);
      expect(code, file).toContain("useShowWeekNumbers()");
      expect(code, file).toMatch(/WeekNumbersToggle weekStart=/);
    }
    expect(source("apps/desktop/src/components/CalendarWidget.tsx")).not.toContain("localStorage");
  });
});

describe("wish 3: the all-day row, the same rule on both shells", () => {
  it("fills a day's room group by group, in the order the row draws them", () => {
    const status = ["away"];
    const appointments = ["fair", "lunch", "call"];
    const tasks = ["stamps"];
    expect(fillAllDayRoom([status, appointments, tasks], 3)).toEqual([["away"], ["fair", "lunch"], []]);
    expect(fillAllDayRoom([status, appointments, tasks], 9)).toEqual([status, appointments, tasks]);
    expect(fillAllDayRoom([status, appointments, tasks], 0)).toEqual([[], [], []]);
  });

  it("gives a phone day of seven entries four rows and a count", () => {
    // The phone draws no bars: its days only have their own entries.
    const plan = planAllDayRows({ laneCount: 0, bars: [], itemCounts: [7, 2, 1], expanded: false });
    expect(plan.days[0]).toEqual({ visibleItems: 4, hidden: 3 });
    const [status, appointments, tasks, overlay] = fillAllDayRoom([["home"], ["fair", "lunch"], ["a"], ["entry", "b", "c"]], plan.days[0].visibleItems);
    expect([status, appointments, tasks, overlay]).toEqual([["home"], ["fair", "lunch"], ["a"], []]);
  });

  it("is pinned on the phone and closed in the parity catalog", () => {
    const screen = source("apps/mobile/src/screens/PimCalendarScreen.tsx");
    expect(screen).toMatch(/position: "sticky", top: 0, zIndex: "var\(--z-m-bar\)", background: "var\(--bg-primary\)" \}\} data-testid="pim-timegrid-head"/);
    expect(screen).toContain('data-testid="pim-allday-more"');
    expect(source("packages/ui/src/lib/featureParity.ts")).not.toContain('"calendar-all-day-row-limit"');
  });
});

describe("wish 4: a note just created opens to be written in", () => {
  afterEach(() => resetFreshNotesForTests());

  it("is marked by every note that parks its caret, with or without a cursor marker", () => {
    parkTemplateCaret("Inbox/Note 1.md", "# Note 1\n", null);
    expect(isFreshNote("Inbox/Note 1.md")).toBe(true);
    expect(consumePendingTemplateCaret("Inbox/Note 1.md")).toBeNull();
    parkTemplateCaret("Inbox/Note 2.md", "# Note 2\n\n", 10);
    expect(isFreshNote("Inbox/Note 2.md")).toBe(true);
    expect(consumePendingTemplateCaret("Inbox/Note 2.md")).toEqual({ path: "Inbox/Note 2.md", offset: 10 });
  });

  it("lasts until it is forgotten, and only for that note", () => {
    markFreshNote("A.md");
    expect(isFreshNote("A.md")).toBe(true);
    expect(isFreshNote("B.md")).toBe(false);
    expect(isFreshNote(null)).toBe(false);
    forgetFreshNote("A.md");
    expect(isFreshNote("A.md")).toBe(false);
  });

  it("is asked by both shells, and marked where a note is built without a template", () => {
    expect(source("apps/desktop/src/services/viewModeDefault.ts")).toContain('cachedDefault === "read" && isFreshNote(path)');
    expect(source("apps/mobile/src/screens/NoteScreen.tsx")).toContain('isFreshNote(path) || getMobileSettings().defaultView === "edit"');
    expect(source("apps/desktop/src/services/createNoteFromLink.ts")).toContain("markFreshNote(path);");
    expect(source("apps/desktop/src/AppShell.tsx").match(/markFreshNote\(path\);/g)).toHaveLength(2);
    expect(source("apps/mobile/src/services/vaultService.ts")).toContain("markFreshNote(path);");
  });
});

describe("wish 5: task boxes for a finger, and dates from the calendar", () => {
  it("grows the boxes only in the touch density", () => {
    const tokens = source("packages/ui/src/styles/tokens.css");
    const base = tokens.slice(0, tokens.indexOf('[data-density="touch"]'));
    const touch = tokens.slice(tokens.indexOf('[data-density="touch"] {'));
    expect(base).toContain("--md-task-size: auto;");
    expect(base).toContain("--md-task-hit: 0px;");
    expect(base).toContain("--journal-taskbox-size: 15px;");
    expect(touch).toContain("--md-task-size: 22px;");
    expect(touch).toContain("--md-task-hit: calc((var(--touch-sm) - var(--md-task-size)) / 2);");
    expect(touch).toContain("--journal-taskbox-size: 22px;");
  });

  it("picks the day of a new task and of a date cell from the shared calendar on the phone", () => {
    const capture = source("apps/mobile/src/components/TaskCaptureSheet.tsx");
    expect(capture).toContain('testId="task-capture-date"');
    expect(capture).not.toContain('type="date"');
    const cell = source("apps/mobile/src/screens/base/CellEditSheet.tsx");
    expect(cell).toContain('testId="cell-date"');
    expect(cell).not.toMatch(/type=\{input === "datetime" \? "datetime-local" : "date"\}/);
  });
});
