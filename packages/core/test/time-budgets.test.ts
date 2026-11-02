import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { coreSlowdown, MAX_SLOWDOWN, within, withinAsync } from "./helpers/timeBudget.js";

/**
 * A test that holds code to a time does so through `helpers/timeBudget.ts`
 * (Sammelplan § 3.129 Nr. 4, § 3.142 Nr. 1, § 3.151 Nr. 5, § 3.162 Nr. 2).
 *
 * Twenty-odd tests measured the wall clock against a fixed number of
 * milliseconds, each with its own copy of the measuring. On a loaded runner,
 * on an efficiency core, under a commit hook with twenty sessions side by
 * side, they failed — a different one each time, with nothing wrong in the
 * code, and every such failure cost a CI run or a commit. The helper scales a
 * budget to the core the test runs on; a loop that needs a clock gets one
 * handed in (`createYielder`'s third parameter).
 *
 * So no test file reads the wall clock to time something but where this list
 * says why. Reading `Date.now()` to stamp a value ("an hour ago") is no timing
 * and stays free.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const ROOTS = ["packages/core/src", "packages/core/test", "packages/ui/src", "apps/desktop/src", "apps/mobile/src"];
/** The helper itself, and this guard, which times nothing but its own probe. */
const EXEMPT = ["packages/core/test/helpers/timeBudget.ts", "packages/core/test/time-budgets.test.ts"];

/** Reads the wall clock as a timer: `performance.now()`, or an upper bound on `Date.now() - …`. */
const TIMES = /performance\.now\(\)|expect\(\s*Date\.now\(\)\s*-[^)]*\)\.toBeLessThan/;

const ALLOWED = new Map<string, string>([
  [
    "packages/core/test/tasks-query-evaluate.test.ts",
    "times the cold and the warm evaluation as the least of three and prints both (plan E6); its bound is scaled with coreSlowdown()",
  ],
  ["apps/desktop/src/components/graph/graphEngine.test.ts", "hands a frame callback the time it expects; nothing is measured"],
]);

function testFiles(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  for (const root of ROOTS) {
    (function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(test|spec)\.tsx?$/.test(name)) out.push({ rel: relative(REPO, full).replace(/\\/g, "/"), text: readFileSync(full, "utf8") });
      }
    })(join(REPO, root));
  }
  return out;
}

describe("time budgets in tests", () => {
  it("no test reads the wall clock to time something but through helpers/timeBudget.ts, or where this list says why", () => {
    const files = testFiles();
    const found = files.filter(({ rel, text }) => !EXEMPT.includes(rel) && TIMES.test(text)).map(({ rel }) => rel);
    expect(
      found.sort(),
      "A test measures the wall clock against a fixed budget. Use within()/withinAsync() from packages/core/test/helpers/timeBudget.ts " +
        "(the budget is scaled to the core the test runs on), hand a loop its clock as a parameter, or enter the file here with why.",
    ).toEqual([...ALLOWED.keys()].sort());
    for (const [rel, why] of ALLOWED) expect(why.length, rel).toBeGreaterThan(20);
  }, 60_000);

  it("recognises a timer, and leaves a stamp alone", () => {
    expect(TIMES.test("const start = performance.now();")).toBe(true);
    expect(TIMES.test("expect(Date.now() - started).toBeLessThan(15_000);")).toBe(true);
    expect(TIMES.test("const at = new Date(Date.now() - 3_600_000).toISOString();")).toBe(false);
    expect(TIMES.test("expect(Date.now() - began).toBeGreaterThanOrEqual(120);")).toBe(false);
  });

  it("passes work within its budget at once, and returns what it made", async () => {
    expect(within(1_000, () => 41 + 1)).toBe(42);
    expect(await withinAsync(1_000, async () => "made")).toBe("made");
  });

  it("scales a budget only as far as the core is slower, and catches work far beyond it", () => {
    const slowdown = coreSlowdown();
    expect(slowdown).toBeGreaterThanOrEqual(1);
    expect(slowdown).toBeLessThanOrEqual(MAX_SLOWDOWN);
    // Work that takes 40 ms against a budget of 1 ms: more than any core is slower.
    const busy = () => {
      const until = performance.now() + 40;
      while (performance.now() < until) { /* hold the thread */ }
    };
    expect(() => within(1, busy)).toThrow(/budget is 1 ms on the reference core/);
  });
});
