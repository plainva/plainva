import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TAB_POOL } from "./navigation";

/**
 * Every area in the bar must render its own screen.
 *
 * The tab router was a 37-step conditional chain that ended in a databases
 * fallback. It had branches for notes/today/tags/bookmarks/calendar/mail/graph
 * — and none for tasks, so pulling "Aufgaben" into the bar showed the DATABASE
 * list under the title "Aufgaben". Nothing failed; the fallback simply
 * swallowed the missing branch.
 *
 * This is a source check on purpose: the chain is JSX, and the defect was the
 * ABSENCE of a branch. Reading the file is what catches an absence — and it
 * catches it again when a tenth area joins TAB_POOL without a branch, which is
 * exactly how the ninth slipped through.
 *
 * S8 replaces the chain with a route table; this test then guards the table.
 */
describe("mobile tab routes", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");

  for (const def of TAB_POOL) {
    it(`renders a screen of its own for the "${def.id}" area`, () => {
      expect(
        source.includes(`nav.activeTab === "${def.id}"`),
        `App.tsx has no branch for the "${def.id}" tab, so it falls through to whatever the chain ends with.`,
      ).toBe(true);
    });
  }

  it("does not end the tab chain in a screen that swallows missing branches", () => {
    // The chain must end in nothing rather than in a screen: a fallback screen
    // makes an unrouted area look like a working one.
    const tail = source.slice(source.lastIndexOf('nav.activeTab === "'));
    expect(tail).toMatch(/\)\s*:\s*null\}/);
  });

  /**
   * The second half of the same story: the bar is what makes a missing route or
   * an unfinished input dangerous, because a tap on it clears the overlay
   * stack. These pin that the shell asks the shared helpers rather than
   * re-deciding locally — the previous local decision was `top?.kind === "note"`,
   * which knew about exactly one of the four input surfaces.
   */
  it("hides the bar through the shared rule instead of a local note check", () => {
    expect(source).toContain("hidesTabBar(top)");
    // The local gate this replaced. Leaving it behind would mean two rules
    // about the same bar, and the local one knew about a single surface.
    expect(source).not.toMatch(/const noteOpen\s*=/);
    const bar = source.slice(source.indexOf('className="m-tabbar"') - 400, source.indexOf('className="m-tabbar"'));
    expect(bar).toContain("!barHidden");
  });

  it("routes every leave through the guard question", () => {
    // Bar tap, back button and the in-app back arrow: all three used to discard
    // unsaved work without asking.
    const barTap = source.slice(source.indexOf("<TabButton"), source.indexOf("<TabButton") + 400);
    expect(barTap, "bar tap").toContain("askBeforeLeaving");
    const back = source.slice(source.indexOf('addListener("backButton"'), source.indexOf('addListener("backButton"') + 500);
    expect(back, "Android back").toContain("askBeforeLeaving");
    const pop = source.slice(source.indexOf("const pop = ()"), source.indexOf("const pop = ()") + 300);
    expect(pop, "in-app back arrow").toContain("askBeforeLeaving");
  });
});
