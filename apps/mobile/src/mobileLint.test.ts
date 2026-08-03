import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mobile design-language ratchet (UI 2.0 plan phase 3 deliverable, delivered
 * with the Mobile M3E plan, package A2) — the mobile twin of the desktop
 * `designLint.test.ts`. Scans the mobile sources for raw values the shared
 * token system forbids in NEW code.
 *
 * Since S7 it runs the DESKTOP rule set, not a subset of it: mobile used to be
 * watched by seven of the fifteen rules, so a mobile file could carry a native
 * `title=` tooltip, a literal shadow recipe, a JS hover mutation, a raw lucide
 * size or a naked <select> and nothing would say so. CSS additionally gets the
 * millisecond rule — every duration must come from the shared duration tokens
 * (--dur-1..3, --m-spin-dur) so reduced-motion and theme motion schemes can
 * collapse them.
 *
 * BUDGET freezes today's counts per file; the suite fails when a file EXCEEDS
 * its budget (regression) and when a fully cleaned file still has an entry
 * (stale budget). The leading :root token block of mobile.css is NOT scanned —
 * token definitions are made of literals by nature (same rule as the desktop
 * ratchet's tokens.css exclusion).
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

/* The desktop rule set, verbatim (S7). Mobile used to run seven of the fifteen
 * rules the desktop runs — so a mobile file could carry a `title=` tooltip, a
 * literal shadow recipe, a JS hover mutation or a raw lucide size and nothing
 * would say so. A ratchet that watches one shell is half a ratchet; the rules
 * describe the design language, and the design language is one.
 * Kept in sync with apps/desktop/src/designLint.test.ts RULES. */
const CODE_RULES: Record<string, RegExp> = {
  // 50%/percentage circles are legitimate geometry — exempted via lookahead.
  radiusPx: /border-?[rR]adius:\s*["'`]?\d+(?!\d*%)/g,
  hex: /#[0-9a-fA-F]{3,8}\b/g,
  rgba: /rgba?\(/g,
  fixedOverlay: /position:\s*["']fixed["']/g,
  // Design sweep 2026-07-19: chrome font sizes come from the shared type
  // scale (em stays content-relative), z layers from --z-m-*.
  fontSizeRaw: /font-?[sS]ize:\s*["'`]?\d+(?:\.\d+)?(?:px|rem)/g,
  fontSizeBare: /fontSize:\s*\d/g,
  zIndexRaw: /z-?[iI]ndex:\s*["'`]?\d/g,
  shadowRaw: /box-?[sS]hadow:[^;\n]*(?:rgba\(|#[0-9a-fA-F]{3})/g,
  durationRaw: /(?:transition|animation)[^;\n]*?\d+(?:\.\d+)?m?s\b/g,
  titleAttr: /\stitle=(?:\{|")/g,
  legacyClass: /pv-btn-primary|pv-btn-secondary|pv-icon-btn\b|pv-modal-card|pv-modal-overlay|pv-modal-head\b|pv-modal-title\b|pv-input\b|pv-date-display|pv-select-trigger\b|pv-add-btn/g,
  jsHover: /onMouseOver=\{|onMouseOut=\{/g,
  iconLiteral: /\bsize=\{\d+\}/g,
  nakedSelect: /<select(?!(?:=>|[^>])*pv-field--select)/g,
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
  "mobile.css": { fontSizeRaw: 50, zIndexRaw: 1 },
  // A QR code is DATA, not an icon: `size` is the rendered pixel edge of a
  // square a camera has to resolve, and 232 fills the phone's sheet. The
  // iconLiteral rule cannot tell the two apart by shape (S7).
  "screens/SecurityAreaScreen.tsx": { iconLiteral: 1 },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** JSX component OPENING tags (<Capitalized …>) carry legitimate `title`
 * PROPS (EmptyState, AreaHeader, TabHead) — strip them (and iframes, whose
 * title is an a11y requirement) before counting the titleAttr rule, so only
 * native-DOM tooltip titles are flagged. All other rules run on the raw
 * source (lucide icons ARE capitalized components, so size={N} must be
 * counted un-stripped). Same treatment as the desktop ratchet. */
function stripComponentTags(source: string): string {
  return source
    .replace(/<[A-Z][A-Za-z0-9]*(?:=>|[^>])*>/g, "<STRIPPED>")
    .replace(/<iframe(?:=>|[^>])*>/g, "<STRIPPED>");
}

/** Prose is not markup: a comment that NAMES a native <select> (the mobile
 * dialog module opens by explaining that it replaces the OS dropdowns) is not
 * one. Only the markup rule strips comments — the value rules deliberately
 * count literals wherever they stand. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function countMatches(source: string, rules: Record<string, RegExp>): Counts {
  const titleSource = stripComponentTags(source);
  const markupSource = stripComments(source);
  const counts: Counts = {};
  for (const [rule, re] of Object.entries(rules)) {
    const scanned = rule === "titleAttr" ? titleSource : rule === "nakedSelect" ? markupSource : source;
    const n = (scanned.match(re) || []).length;
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

/**
 * One app bar (S11). The phone had two header families with different metrics
 * — 26 screens rendered one, a single screen the other — so every step inward
 * changed title size, weight, edge and elevation at once. These two rules keep
 * it at one: a surface asks the component, and the component is the only place
 * that knows what a header looks like.
 */
describe("the app bar is the only header", () => {
  const screens = [...walk(SRC)].filter((f) => /\.tsx$/.test(f));

  it("no surface builds its own header", () => {
    const offenders: string[] = [];
    for (const file of screens) {
      const src = stripComments(readFileSync(file, "utf8"));
      const rel = relative(SRC, file).replace(/\\/g, "/");
      // The component itself is the one place a <header> may be written.
      if (rel === "components/AppBar.tsx") continue;
      if (/<header\b/.test(src)) offenders.push(`${rel}: writes its own <header>`);
      if (/className="m-(header|topbar)/.test(src)) offenders.push(`${rel}: uses a retired header class`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no three-dot menu opens the app settings", () => {
    // Redesign rule 4: "a ⋮ always means the same thing — actions on the object
    // that is open. App settings do not live behind it." Two surfaces broke it,
    // and both were tab roots, where the ⋮ is most visible.
    const offenders: string[] = [];
    for (const file of screens) {
      const src = stripComments(readFileSync(file, "utf8"));
      const rel = relative(SRC, file).replace(/\\/g, "/");
      for (const m of src.matchAll(/<IconButton[^>]*>[\s\S]{0,120}?<MoreVertical/g)) {
        const open = src.slice(m.index ?? 0, (m.index ?? 0) + 260);
        if (/kind: "settings"|onOpenSettings|t\("settings\.title"\)|sectionSettings/.test(open)) {
          offenders.push(`${rel}: a ⋮ carries the app settings`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
