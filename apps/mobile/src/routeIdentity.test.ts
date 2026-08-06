// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";


/**
 * The two halves of the showing-through defect (N1.2, Gesamtplan § 3.4).
 *
 * The maintainer saw one view rendering through another during a change. It
 * had two independent causes, and each is pinned here:
 *
 *  1. `folder` was the only path-carrying route without a `key`, so React
 *     reused the same BrowseScreen across a folder change and the previous
 *     folder's rows stayed on screen under the new folder's title.
 *  2. The screen-enter animation was addressed at `.m-screen > *`, which
 *     stopped being the page when the adaptive layout put an `.m-col` wrapper
 *     in between. A CSS animation does not restart because its children
 *     changed, so it ran once at boot and never again — the new surface simply
 *     appeared on top of the old one with nothing to separate them.
 *
 * Both are structural, so both are checked structurally: the first against the
 * route table's source, the second against the real DOM shape.
 */

/**
 * jsdom leaves `import.meta.url` as a document URL rather than a file one, so
 * the sources are located from the working directory — which is the package
 * root under turbo and `src/` when vitest is run directly.
 */
function readSource(name: string): string {
  for (const dir of [process.cwd(), join(process.cwd(), "src")]) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  throw new Error(`cannot locate ${name} from ${process.cwd()}`);
}

const routes = readSource("routes.tsx");
const css = readSource("mobile.css");

/**
 * Routes whose screen shows the CONTENT AT `e.path`.
 *
 * These must remount when the path changes, because the instance carries that
 * content: reusing it means the previous path is still on screen. Routes that
 * merely parse an argument out of the path are deliberately absent — keying
 * `mailcompose` would remount the composer and drop a half-written draft.
 */
const CONTENT_ROUTES = ["folder", "note", "base", "tags", "imageviewer"];

describe("a path change replaces the view", () => {
  for (const name of CONTENT_ROUTES) {
    it(`\`${name}\` keys on the path, so a change cannot reuse the instance`, () => {
      // The route body runs from its own name up to the start of the next
      // top-level entry, which is the only place a sibling key could hide.
      const start = routes.indexOf(`\n  ${name}: (e, c) =>`);
      expect(start, `route \`${name}\` is gone — update CONTENT_ROUTES`).toBeGreaterThan(-1);
      const rest = routes.slice(start + 1);
      const next = rest.search(/\n {2}[a-z][a-zA-Z]*: \(e, c\) =>/);
      const body = next === -1 ? rest : rest.slice(0, next);
      expect(
        body,
        `\`${name}\` renders the content at e.path but does not key on it: React ` +
          `will reuse the instance across a change and the previous path stays visible`,
      ).toContain("key={e.path}");
    });
  }
});

describe("the enter animation addresses the node that is replaced", () => {
  /** Selectors of every rule that runs a screen-enter animation. */
  const enterSelectors = [...css.matchAll(/([^{}]+)\{[^{}]*animation:\s*m-(?:screen-in|fade-in)[^{}]*\}/g)]
    .map((m) => m[1].trim())
    .filter((s) => s.includes("m-screen") || s.includes("m-col"));

  /**
   * The real shape since the adaptive layout: the column is permanent, the
   * page inside it is what a route change replaces.
   */
  function page(pageClass: string): Element {
    const screen = document.createElement("div");
    screen.className = "m-screen";
    const col = document.createElement("div");
    col.className = "m-col";
    const el = document.createElement("div");
    el.className = pageClass;
    col.appendChild(el);
    screen.appendChild(col);
    document.body.appendChild(screen);
    return el;
  }

  it("finds the enter rules at all", () => {
    expect(enterSelectors.length, "the screen-enter rules are gone or renamed").toBeGreaterThan(0);
  });

  it("matches the page, not the column that outlives it", () => {
    const el = page("m-page");
    const matching = enterSelectors.filter((s) => el.matches(s));
    expect(
      matching.length,
      `no enter rule matches the page. Selectors found: ${enterSelectors.join(" | ")}`,
    ).toBeGreaterThan(0);
  });

  it("no enter rule is addressed at `.m-screen > *` any more", () => {
    // The regression itself: that selector matches the permanent `.m-col`, and
    // an animation on a node that never unmounts plays exactly once.
    const col = document.createElement("div");
    col.className = "m-col";
    const screen = document.createElement("div");
    screen.className = "m-screen";
    screen.appendChild(col);
    document.body.appendChild(screen);
    const onWrapper = enterSelectors.filter((s) => col.matches(s));
    expect(
      onWrapper,
      "an enter animation sits on the column wrapper, which outlives every route change",
    ).toEqual([]);
  });

  it("still exempts the note page, which brings its own transition", () => {
    const el = page("m-page m-page--note");
    expect(enterSelectors.filter((s) => el.matches(s))).toEqual([]);
  });

  it("gives the page an opaque background, so nothing behind it can show through", () => {
    const block = css.match(/\n\.m-page \{([^}]*)\}/);
    expect(block, ".m-page is gone or reshaped").not.toBeNull();
    expect(
      block?.[1],
      "a transparent page lets whatever survives a change be seen through the one that replaced it",
    ).toMatch(/background:\s*var\(--surface\)/);
  });
});
