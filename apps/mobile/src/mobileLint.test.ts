import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mobile design-language ratchet (UI 2.0 plan phase 3 deliverable, delivered
 * with the Mobile M3E plan, package A2) — the mobile twin of the desktop
 * `designLint.test.ts`. Scans the mobile sources for raw values the shared
 * token system forbids in NEW code: border-radius pixel literals, hardcoded
 * hex/rgba colors, hand-rolled position:fixed overlays, and (CSS only) raw
 * millisecond durations on animation/transition — every duration must come
 * from the shared duration tokens (--dur-1..3, --m-spin-dur) so reduced-motion
 * and theme motion schemes can collapse them.
 *
 * BUDGET freezes today's counts per file; the suite fails when a file EXCEEDS
 * its budget (regression) and when a fully cleaned file still has an entry
 * (stale budget). The leading :root token block of mobile.css is NOT scanned —
 * token definitions are made of literals by nature (same rule as the desktop
 * ratchet's tokens.css exclusion).
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

const CODE_RULES: Record<string, RegExp> = {
  radiusPx: /border-?[rR]adius:\s*["'`]?\d/g,
  hex: /#[0-9a-fA-F]{3,8}\b/g,
  rgba: /rgba?\(/g,
  fixedOverlay: /position:\s*["']fixed["']/g,
  // Design sweep 2026-07-19: chrome font sizes come from the shared type
  // scale (em stays content-relative), z layers from --z-m-*.
  fontSizeRaw: /font-?[sS]ize:\s*["'`]?\d+(?:\.\d+)?(?:px|rem)/g,
  zIndexRaw: /z-?[iI]ndex:\s*["'`]?\d/g,
};

// CSS-only: literal durations on animation/transition shorthand or *-duration.
const CSS_MS_RULE = /(?:animation|transition)[^;{}]*?[\s,(]\d+(?:\.\d+)?m?s\b/g;

type Counts = Record<string, number>;

/** Frozen state as of 2026-07-12 (generated from the tree). Lower or remove
 * entries as files are migrated; never raise one. */
const BUDGET: Record<string, Counts> = {
  // Boot-error overlay: renders BEFORE themes/tokens load by design (the iOS
  // black-screen debug net) — hard colors AND the raw z are the point.
  "main.tsx": { hex: 2, zIndexRaw: 1 },
  // Remaining chrome font-size migration debt (design sweep 2026-07-19 moved
  // the metric/radius/z system; the type-scale pass over mobile.css is the
  // next ratchet target — lower, never raise). The one z literal is the
  // .m-header local stack (bars above scrolling content, documented inline).
  "mobile.css": { fontSizeRaw: 51, zIndexRaw: 1 },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

function countMatches(source: string, rules: Record<string, RegExp>): Counts {
  const counts: Counts = {};
  for (const [rule, re] of Object.entries(rules)) {
    const n = (source.match(re) || []).length;
    if (n > 0) counts[rule] = n;
  }
  return counts;
}

function scan(): Record<string, Counts> {
  const actual: Record<string, Counts> = {};
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).replace(/\\/g, "/");
    const counts = countMatches(readFileSync(file, "utf8"), CODE_RULES);
    if (Object.keys(counts).length) actual[rel] = counts;
  }
  const css = readFileSync(join(SRC, "mobile.css"), "utf8");
  // Skip the leading :root role/token block: definitions are literal by design.
  const rootStart = css.indexOf(":root");
  const rootEnd = css.indexOf("}", rootStart);
  const scannable = css.slice(0, Math.max(rootStart, 0)) + css.slice(rootEnd + 1);
  const cssCounts = countMatches(scannable, { ...CODE_RULES, hardMs: CSS_MS_RULE });
  delete cssCounts.fixedOverlay; // CSS position: fixed has no quotes; TSX-only rule.
  if (Object.keys(cssCounts).length) actual["mobile.css"] = cssCounts;
  return actual;
}

describe("mobile design language ratchet", () => {
  const actual = scan();

  it("no file exceeds its frozen budget (use the shared tokens instead)", () => {
    const regressions: string[] = [];
    for (const [file, counts] of Object.entries(actual)) {
      for (const [rule, n] of Object.entries(counts)) {
        const allowed = BUDGET[file]?.[rule] ?? 0;
        if (n > allowed) regressions.push(`${file}: ${rule} ${n} > budget ${allowed}`);
      }
    }
    expect(regressions, regressions.join("\n")).toEqual([]);
  });

  it("fully cleaned files are removed from the budget (keep the map honest)", () => {
    const stale = Object.keys(BUDGET).filter((file) => {
      const counts = actual[file];
      if (!counts) return true;
      return Object.keys(BUDGET[file]).some((rule) => !(rule in counts));
    });
    expect(stale, `remove stale budget entries: ${stale.join(", ")}`).toEqual([]);
  });
});
