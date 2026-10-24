import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue 119: "I added an event and it appeared. Then it disappeared. Now it's
 * back." The desktop calendar put every written row into its own copy of the
 * cache rows as well as into the shared overlay. The overlay saw the row there
 * and stepped aside; the next reload from a cycle that had started before the
 * write replaced the copy - and the event was gone until the cycle after.
 *
 * What the calendar holds is what the cache holds; what was just written lives
 * in the overlay alone, until the cache lists it. The phone was built that way
 * from the start. This keeps the desktop there.
 */
describe("the desktop calendar keeps written rows out of its cache copy", () => {
  const source = readFileSync(join(__dirname, "components/pimcal/CalendarView.tsx"), "utf8");

  it("sets its rows only from the cache", () => {
    const calls = [...source.matchAll(/\bsetEvents\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls).toEqual(["evs"]);
  });

  it("asks for a cycle of its own after a write", () => {
    expect(source).toMatch(/triggerImmediate\(\{ afterWrite: true \}\)/);
  });
});
