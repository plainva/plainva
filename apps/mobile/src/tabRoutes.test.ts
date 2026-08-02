import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NAV_KINDS, TAB_POOL, type TabScreenId } from "./navigation";
import { PUSHED_ROUTES, TAB_ROUTES, type RouteContext } from "./routes";

/**
 * Every area in the bar, and every kind the navigation can hold, must render a
 * screen of its own.
 *
 * The router was a 37-step conditional chain ending in a databases fallback. It
 * had branches for notes/today/tags/bookmarks/calendar/mail/graph — and none
 * for tasks, so pulling "Aufgaben" into the bar showed the DATABASE list under
 * the title "Aufgaben". Nothing failed; the fallback swallowed the absence.
 *
 * S8 turned the chain into two exhaustive tables, so the defect is now a type
 * error: `Record<TabScreenId, …>` does not compile with a member missing. These
 * tests are the runtime half — they catch the case the type cannot, namely a
 * member that exists but renders nothing, and they keep the guarantee legible
 * to a reader who is not running tsc.
 */
describe("mobile routes", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");

  for (const def of TAB_POOL) {
    it(`renders a screen of its own for the "${def.id}" area`, () => {
      expect(TAB_ROUTES[def.id], `no tab route for "${def.id}"`).toBeTypeOf("function");
    });
  }

  for (const kind of NAV_KINDS) {
    it(`renders a screen for a pushed "${kind}" entry`, () => {
      expect(PUSHED_ROUTES[kind], `no pushed route for "${kind}"`).toBeTypeOf("function");
    });
  }

  it("gives every tab area a DISTINCT screen (no silent sharing)", () => {
    // The tasks tab did not merely LACK a branch — it rendered the databases
    // screen. A table with every key present hides that just as well as the
    // chain did, so ask the element which component it names. Building an
    // element does not call the component, so a stub context is enough.
    const ctx = {} as RouteContext;
    const seen = new Map<unknown, TabScreenId>();
    const dupes: string[] = [];
    for (const def of TAB_POOL) {
      const el = TAB_ROUTES[def.id](ctx) as { type?: unknown } | null;
      const component = el?.type;
      expect(component, `the "${def.id}" area renders nothing`).toBeTruthy();
      const prev = seen.get(component);
      if (prev) dupes.push(`${def.id} renders the same screen as ${prev}`);
      else seen.set(component, def.id);
    }
    expect(dupes, dupes.join(", ")).toEqual([]);
  });

  it("keeps the shell out of the routing decision", () => {
    // The point of the table is that App.tsx no longer decides WHAT to render.
    // Two properties say that better than any grep over the JSX: the shell
    // tests no entry kind, and it imports no screen at all. (It still asks
    // which TAB is active — for the head's title and whether to offer the
    // search pill — and that is a head decision, not a route.)
    expect(source).not.toMatch(/top\?\.kind === "/);
    const screenImports = [...source.matchAll(/^import \{([^}]*)\} from "\.[^"]*";$/gm)]
      .flatMap((m) => m[1].split(",").map((n) => n.trim()))
      .filter((n) => /Screen$/.test(n));
    expect(screenImports, `App.tsx still imports screens: ${screenImports.join(", ")}`).toEqual([]);
    expect(source).toContain("renderRoute(");
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
