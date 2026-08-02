import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Chips, segmented controls and search all come from the shared primitives.
 *
 * Mobile had five chip classes, two segmented controls and a class called
 * `m-searchfield` that was in truth THE mobile text input — it dressed a
 * password prompt and a date picker as a search box. They are Chip, Segmented,
 * SearchField and TextInput now.
 *
 * Read from source because the defect this prevents is a reappearance: a new
 * screen writing `className="m-chip"` would look right and fork the vocabulary
 * again — and nothing about the rendered output would say so.
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

describe("mobile builds on the shared choice controls", () => {
  const files = walk(SRC).map((p) => [p.slice(SRC.length + 1), readFileSync(p, "utf8")] as const);
  const css = readFileSync(join(SRC, "mobile.css"), "utf8");

  it("has no mobile-only chip, segment or search class in the markup", () => {
    // `m-chiprow` is a scroll row and stays.
    const bad = /\bm-(chip(?!row)|cellchip|minichip|chippill|seg|seg-item|viewpills?|searchfield|searchpill|mailsearch)\b/;
    const offenders = files.filter(([, s]) => bad.test(s)).map(([f]) => f);
    expect(offenders, `still hand-rolling: ${offenders.join(", ")}`).toEqual([]);
  });

  it("does not define them in CSS either", () => {
    for (const sel of [
      ".m-chip {", ".m-chippill", ".m-cellchip", ".m-minichip",
      ".m-seg {", ".m-seg-item", ".m-seg--", ".m-viewpill",
      ".m-searchfield", ".m-searchpill", ".m-mailsearch",
    ]) {
      expect(css.includes(sel), `${sel} is defined again in mobile.css`).toBe(false);
    }
  });

  it("uses no CSS variable that is never declared", () => {
    // `--m-radius-pill` was referenced three times and declared nowhere. An
    // unresolvable var() makes the property invalid at computed-value time, so
    // border-radius fell back to 0 — the security tabs, the loading "circle"
    // and the step counter all rendered as rectangles.
    const declared = new Set<string>();
    for (const file of [
      css,
      readFileSync(join(SRC, "../../../packages/ui/src/styles/tokens.css"), "utf8"),
      readFileSync(join(SRC, "../../../packages/ui/src/styles/ui.css"), "utf8"),
      readFileSync(join(SRC, "../../../packages/ui/src/styles/base-colors.css"), "utf8"),
    ]) {
      for (const m of file.matchAll(/(?:^|;)\s*(--[a-z0-9-]+)\s*:/gm)) declared.add(m[1]);
    }
    // Set on the element from data (a calendar's own colour), never in a sheet.
    declared.add("--evt-color");
    const missing = new Set<string>();
    for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
      if (!declared.has(m[1])) missing.add(m[1]);
    }
    expect([...missing], `mobile.css reads undeclared tokens: ${[...missing].join(", ")}`).toEqual([]);
  });

  it("declares each property at most once per block", () => {
    // `.m-row` and `.m-chippill` each set font-size twice; the raw value won,
    // so every list row rendered at 15.2px while the token said 16.
    const dupes: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim().split("\n").pop()!.trim();
      const seen = new Map<string, number>();
      for (const d of m[2].matchAll(/(^|;)\s*([a-z-]+)\s*:/g)) {
        seen.set(d[2], (seen.get(d[2]) ?? 0) + 1);
      }
      for (const [prop, n] of seen) if (n > 1) dupes.push(`${sel}: ${prop} ×${n}`);
    }
    expect(dupes, dupes.join("\n")).toEqual([]);
  });

  it("lets Windows 95 square off the sheets too", () => {
    // The theme zeroes every radius token — except the sheet's, which lives in
    // base-colors.css and therefore survived, leaving round bottom sheets in
    // the one theme whose whole point is square corners.
    const win95 = readFileSync(join(SRC, "../../../packages/ui/src/themes/win95.css"), "utf8");
    expect(win95).toMatch(/--radius-sheet:\s*0/);
  });
});
