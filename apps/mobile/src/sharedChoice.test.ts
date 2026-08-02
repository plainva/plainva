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

  it("gives a notice exactly one shape", () => {
    // A standalone notice is a Banner. `m-hint--warn` was a second warning
    // strip and `m-sync-error` a third way to say "this failed"; two of the
    // warn notices even spelled out role="alert" by hand, which Banner derives
    // from the kind.
    for (const sel of [".m-hint--warn", ".m-sync-error"]) {
      expect(css.includes(sel), `${sel} is a notice again`).toBe(false);
    }
    const offenders = files.filter(([, s]) => /\bm-(hint--warn|sync-error)\b/.test(s)).map(([f]) => f);
    expect(offenders, `still hand-rolling notices: ${offenders.join(", ")}`).toEqual([]);
  });

  it("styles fields by their role, not by their ancestor", () => {
    // The field look hung on `.m-field input` — an input was styled because a
    // label happened to wrap it. An input outside a label got nothing; one
    // carrying the shared role inside a label got both.
    for (const sel of [".m-field input", ".m-field select", ".m-field textarea"]) {
      expect(css.includes(sel), `${sel} styles inputs by ancestry again`).toBe(false);
    }
    // Native widgets keep their own chrome; everything text-ish is a field.
    // The window is scanned by length, not up to the closing ">": an arrow
    // function in an attribute contains one, which would end the scan early.
    const NATIVE = /type="(checkbox|radio|range|color|file)"/;
    const raw: string[] = [];
    for (const [file, withComments] of files) {
      // Prose describing markup is not markup — a file-header comment naming
      // `<input type=file>` would otherwise read as a raw field.
      const src = withComments.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const m of src.matchAll(/<input\b/g)) {
        if (!NATIVE.test(src.slice(m.index, m.index + 400))) raw.push(`${file}:${m.index}`);
      }
      if (/<textarea\b/.test(src)) raw.push(`${file} (textarea)`);
    }
    expect(raw, `raw text inputs left: ${raw.join(", ")}`).toEqual([]);
  });

  it("takes card and sheet surfaces from the shared layer", () => {
    // Seven mobile cards differed only in which alias they reached for: three
    // names for the same background, three radii, five paddings. The look is
    // shared now; what stays mobile is placement.
    for (const sel of [".m-card", ".m-bigcard", ".m-basecard", ".m-caro-card", ".m-themecard", ".m-embed-card", ".m-onboarding-card", ".m-sheet"]) {
      const i = css.indexOf(`${sel} {`);
      if (i < 0) continue;
      const body = css.slice(i, css.indexOf("}", i));
      for (const prop of ["background", "border-radius", "border"]) {
        // Match a DECLARATION, not the word — `transition: background …` names
        // the property without setting it.
        const declared = new RegExp(`(^|[{;])\\s*${prop}\\s*:`).test(body);
        expect(declared, `${sel} redefines ${prop} instead of taking the shared surface`).toBe(false);
      }
    }
  });

  it("lets Windows 95 square off the sheets too", () => {
    // The theme zeroes every radius token — except the sheet's, which lives in
    // base-colors.css and therefore survived, leaving round bottom sheets in
    // the one theme whose whole point is square corners.
    const win95 = readFileSync(join(SRC, "../../../packages/ui/src/themes/win95.css"), "utf8");
    expect(win95).toMatch(/--radius-sheet:\s*0/);
  });
});
