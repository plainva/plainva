import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Buttons come from the shared primitives, not from a second mobile set.
 *
 * Mobile used to carry its own `.m-btn` family, its own `.m-iconbtn` and its
 * own zoom control, and with them THREE ways to say "this toggle is on"
 * (`.is-active` coloured the icon, `.is-tonal` filled it, `.is-on` used the
 * accent-container pair) — none of which told a screen reader anything. All of
 * it now goes through Button / IconButton / Fab, whose active state is one look
 * and an aria-pressed.
 *
 * This reads the sources because the defect it prevents is a REAPPEARANCE: a
 * new screen writing `<button className="m-btn">` would look right and quietly
 * fork the vocabulary again.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

describe("mobile builds on the shared controls", () => {
  const files = walk(SRC).map((p) => [p.slice(SRC.length + 1), readFileSync(p, "utf8")] as const);
  const css = readFileSync(join(SRC, "mobile.css"), "utf8");

  it("has no mobile-only button classes left in the markup", () => {
    // `m-btnrow` and `m-zoomers` are layout rows and stay; what must be gone is
    // a mobile class that IS the control.
    const offenders = files
      .filter(([, s]) => /\bm-(btn(?!row)|iconbtn|zoomer(?!s))\b/.test(s))
      .map(([f]) => f);
    expect(offenders, `still hand-rolling buttons: ${offenders.join(", ")}`).toEqual([]);
  });

  it("does not define them in CSS either", () => {
    // .m-btnrow (a layout row) and .m-zoomer (surface only) stay; what must be
    // gone is a mobile definition of the CONTROL itself.
    for (const sel of [".m-btn {", ".m-btn--", ".m-iconbtn {", ".m-iconbtn."]) {
      expect(css.includes(sel), `${sel} is defined again in mobile.css`).toBe(false);
    }
    // The map controls floated over the graph canvas and therefore carried
    // their own surface — as an `m-` class that escaped the theme-coverage
    // guard, which is why they knew neither LCARS nor Win95. They are a shared
    // modifier now; only their PLACEMENT stays mobile.
    expect(css.includes(".m-zoomer {"), ".m-zoomer is a control again").toBe(false);
    expect(css.includes(".m-zoomers {"), "the map keeps its own placement row").toBe(true);
  });

  it("keeps exactly one way to say a toggle is on", () => {
    // The primitive's `active` prop. `.is-on` survives on chips and rows until
    // their own steps; what may not come back is a second rule for the same
    // control.
    expect(css.includes(".m-iconbtn.is-active")).toBe(false);
    expect(css.includes(".m-iconbtn.is-tonal")).toBe(false);
    expect(css.includes(".m-iconbtn.is-on")).toBe(false);
  });
});
