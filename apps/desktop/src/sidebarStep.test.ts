import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  clampPeekSideWidth, columnWidth, PEEK_SIDE_DEFAULT, PEEK_SIDE_MIN, readPeekSideWidth, RIGHT_SIDEBAR_DEFAULT,
  RIGHT_SIDEBAR_LEGACY_DEFAULT, rightSidebarWidthFrom, sidebarStepFor, SIDEBAR_STEP_COMPACT, SIDEBAR_STEP_MINIMAL, writePeekSideWidth,
} from "./lib/sidebarStep";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), "utf8");
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * The step is the COLUMN's (finding 2026-10-06).
 *
 * The same note showed two layouts — name beside the value, name above it —
 * and the difference was the scrollbar: the step was read from the content
 * box, which a classic scrollbar narrows by its 11 px, so a section that
 * opened and made the panel scroll tipped a 285-px column from "comfortable"
 * into "compact". These tests pin the three halves of the fix: what is
 * measured, that nothing reads the content box, and that the room for the
 * scrollbar is always there.
 */
describe("the step follows the column, not its content", () => {
  it("reads the border box: a scrollbar inside the panel does not change the width that counts", () => {
    // A 285-px column. With a scrollbar its CONTENT is 274 px wide — below the
    // threshold. The column itself is not.
    const column = { getBoundingClientRect: () => ({ width: 285 }) as DOMRect };
    expect(sidebarStepFor(columnWidth(column))).toBe("comfortable");
    expect(sidebarStepFor(285 - 11), "what the old measurement saw").toBe("compact");
  });

  it("no measurement of the step reads a content box", () => {
    const source = stripComments(read("lib", "sidebarStep.ts"));
    expect(source).not.toMatch(/contentRect/);
    expect(source).not.toMatch(/contentBoxSize|clientWidth/);
  });

  it("the right panel and the peek column reserve their scrollbar's room at all times", () => {
    const css = stripComments(read("App.css"));
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      expect(at, `rule for ${selector}`).toBeGreaterThanOrEqual(0);
      return css.slice(at, css.indexOf("}", at));
    };
    expect(rule(".pv-side-right")).toMatch(/overflow-y:\s*scroll/);
    expect(rule(".pv-peek-side-scroll")).toMatch(/overflow-y:\s*scroll/);
    // ... and the component does not take it back with an inline `auto`.
    expect(stripComments(read("components", "RightSidebar.tsx"))).not.toMatch(/overflowY/);
  });

  it("one mechanism: no container query answers the question a second time", () => {
    // A rule at 220 px stacked the rows on its own terms beside the step.
    const css = stripComments(read("App.css"));
    expect(css).not.toMatch(/\.pv-props\s*\{[^}]*container-type/);
    expect(css).not.toMatch(/@container\s*\(max-width:\s*220px\)/);
  });

  it("no rule insets 'the last child of a section' — collapsed, that is the head", () => {
    const css = stripComments(read("App.css"));
    expect(css).not.toMatch(/\.pv-side-section\s*>\s*div:last-child/);
  });
});

/**
 * The default width (decision E2, 2026-10-06): 300 px instead of 250 — the
 * comfortable step. "A chosen width is kept" needs a way to tell a choice from
 * the old default, which the panel wrote back on every start.
 */
describe("the right panel's width for a window", () => {
  const MIN = 200;
  const MAX = 600;

  it("a window without a stored width opens at the new default, in the comfortable step", () => {
    expect(rightSidebarWidthFrom(null, false, MIN, MAX)).toBe(RIGHT_SIDEBAR_DEFAULT);
    expect(RIGHT_SIDEBAR_DEFAULT).toBe(300);
    expect(sidebarStepFor(RIGHT_SIDEBAR_DEFAULT)).toBe("comfortable");
  });

  it("a stored old default nobody chose follows to the new one", () => {
    expect(rightSidebarWidthFrom(String(RIGHT_SIDEBAR_LEGACY_DEFAULT), false, MIN, MAX)).toBe(RIGHT_SIDEBAR_DEFAULT);
  });

  it("a width somebody dragged is kept — the old default included, once it is marked as a choice", () => {
    expect(rightSidebarWidthFrom("250", true, MIN, MAX)).toBe(250);
    expect(rightSidebarWidthFrom("412", false, MIN, MAX)).toBe(412);
    expect(rightSidebarWidthFrom("210", false, MIN, MAX)).toBe(210);
  });

  it("garbage and widths outside the limits fall back to the default", () => {
    for (const stored of ["", "nope", "50", "9000", "NaN"]) {
      expect(rightSidebarWidthFrom(stored, true, MIN, MAX), stored).toBe(RIGHT_SIDEBAR_DEFAULT);
    }
  });
});

/**
 * The three named steps of the right sidebar (plan P3). Naming them is the
 * point: every surface degrades at the SAME two widths, so the result can be
 * described in one table instead of "it depends on the section".
 */
describe("sidebarStepFor", () => {
  it("keeps the comfortable layout at and above 280 px", () => {
    expect(sidebarStepFor(600)).toBe("comfortable");
    expect(sidebarStepFor(SIDEBAR_STEP_COMPACT)).toBe("comfortable");
  });

  it("switches to compact just below 280 px", () => {
    expect(sidebarStepFor(SIDEBAR_STEP_COMPACT - 1)).toBe("compact");
    expect(sidebarStepFor(SIDEBAR_STEP_MINIMAL)).toBe("compact");
  });

  it("switches to minimal below 232 px", () => {
    expect(sidebarStepFor(SIDEBAR_STEP_MINIMAL - 1)).toBe("minimal");
    // The panel cannot be dragged below 200 px, so this is the floor in practice.
    expect(sidebarStepFor(200)).toBe("minimal");
  });

  it("has no gap and no overlap between the steps", () => {
    const seen = new Set<string>();
    for (let w = 150; w <= 600; w++) seen.add(sidebarStepFor(w));
    expect([...seen].sort()).toEqual(["comfortable", "compact", "minimal"]);
  });
});

describe("peek window properties column (2026-09-04)", () => {
  it("never drops below the minimal step and never takes more than half the window body", () => {
    expect(clampPeekSideWidth(100, 1000)).toBe(PEEK_SIDE_MIN);
    expect(clampPeekSideWidth(300, 1000)).toBe(300);
    expect(clampPeekSideWidth(900, 1000)).toBe(500);
    // A tiny window still leaves the column its floor — the note pane yields.
    expect(clampPeekSideWidth(300, 400)).toBe(PEEK_SIDE_MIN);
  });

  it("remembers the width and falls back to the default for garbage", () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(readPeekSideWidth(storage)).toBe(PEEK_SIDE_DEFAULT);
    writePeekSideWidth(333.6, storage);
    expect(readPeekSideWidth(storage)).toBe(334);
    m.set("plainva-peek-side-width", "nope");
    expect(readPeekSideWidth(storage)).toBe(PEEK_SIDE_DEFAULT);
    m.set("plainva-peek-side-width", "50");
    expect(readPeekSideWidth(storage)).toBe(PEEK_SIDE_DEFAULT);
  });
});
