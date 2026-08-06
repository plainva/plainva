import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
 * BUDGET freezes today's counts per file. The suite fails when a file EXCEEDS
 * its budget (a regression) and — since N0.3 — whenever a budget sits ABOVE
 * the real count. That second rule is the important one: headroom is exactly
 * how the drift got legitimised. The font-size count grew from 27 to 51 UNDER
 * this ratchet, the budget was then written to 51, and it has fallen once
 * since, by one; 42 real values sat under a budget of 50. The old check only
 * fired when a rule reached zero and could not see any of that.
 *
 * The leading :root token block of mobile.css is NOT scanned — token
 * definitions are made of literals by nature (same rule as the desktop
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

  /**
   * Spacing and size (rework N0.3, decision E5). Until now the ratchet watched
   * radii, colors, font sizes, z-index, shadows, durations, tooltips and icons
   * — and NOT a single rule for padding, margin, gap, width or height, the very
   * values that had drifted furthest: 279 raw ones in mobile.css, 21 different
   * paddings, 13 different gaps, more than half of them off the 4-px grid the
   * file declares for itself. Without a container to belong to, every element
   * negotiated its own inset, which is how one screen came to have ten
   * different left edges.
   *
   * `0` is deliberately not a finding — zero needs no token. `%`, `auto`,
   * `dvh` and `calc()` over tokens pass too; only literal px/rem lengths (and,
   * in TSX, bare numbers) count.
   *
   * The `*Bare` variants are TSX-ONLY and are dropped from the CSS scan: in
   * CSS they would double-count the same declaration their `*Raw` sibling
   * already caught.
   */
  spacingRaw: /(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block))?:\s*[^;{}\n]*?\d+(?:\.\d+)?(?:px|rem)/g,
  spacingBare: /(?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block)?:\s*[1-9]/g,
  gapRaw: /(?:^|[;{\s])(?:row-|column-)?gap:\s*[^;{}\n]*?\d+(?:\.\d+)?(?:px|rem)/g,
  gapBare: /\bgap:\s*[1-9]/g,
  sizeRaw: /(?:^|[;{\s])(?:min-|max-)?(?:width|height):\s*[^;{}\n]*?\d+(?:\.\d+)?(?:px|rem)/g,
  sizeBare: /\b(?:min|max)?(?:Width|Height|width|height):\s*[1-9]/g,
};

// CSS-only: literal durations on animation/transition shorthand or *-duration.
const CSS_MS_RULE = /(?:animation|transition)[^;{}]*?[\s,(]\d+(?:\.\d+)?m?s\b/g;

type Counts = Record<string, number>;

/** Measured from the tree (2026-07-12; spacing and size added 2026-08-06).
 * Lower or remove entries as files are migrated; never raise one — and never
 * leave one above the real count, which now fails too. */
const BUDGET: Record<string, Counts> = {
  // Boot-error overlay: renders BEFORE themes/tokens load by design (the iOS
  // black-screen debug net) — hard colors AND the raw z are the point.
  "main.tsx": { hex: 2, zIndexRaw: 1, spacingRaw: 1, spacingBare: 1 },
  /**
   * mobile.css. The font-size count is the REAL one (42) since N0.3 — it stood
   * at 50 with 42 in the tree, i.e. eight free slots for new raw values; N5.1
   * takes it to zero. The spacing and size counts enter the ratchet here for
   * the first time (E5); they are the drift § 3.2 measured and N5.2 works off.
   * The one z literal is the .m-header local stack (bars above scrolling
   * content, documented inline).
   */
  "mobile.css": { fontSizeRaw: 41, zIndexRaw: 1, spacingRaw: 128, gapRaw: 67, sizeRaw: 72 },
  // A QR code is DATA, not an icon: `size` is the rendered pixel edge of a
  // square a camera has to resolve, and 232 fills the phone's sheet. The
  // iconLiteral rule cannot tell the two apart by shape (S7).
  "screens/SecurityAreaScreen.tsx": { iconLiteral: 1 },
  /**
   * Inline spacing in JSX (E5, entering the ratchet with N0.3). PinboardView
   * was the worst of them and has no entry any more: N3.6 took its 29 inline
   * styles into `mobile.css`, and the values it genuinely owns (masonry gap,
   * card clamp) are named custom properties there rather than repeated.
   */
  "components/CloudFolderPickerSheet.tsx": { gapBare: 1 },
  "components/NoteContextSheet.tsx": { spacingBare: 1 },
  "screens/MailAccountsScreen.tsx": { spacingRaw: 0, spacingBare: 1 },
  "screens/PimAccountsScreen.tsx": { spacingBare: 1 },
  "screens/PimCalendarScreen.tsx": { spacingRaw: 2, sizeBare: 4 },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** The native tooltip attribute lives on a LOWERCASE DOM tag; `title` on a
 * capitalised tag is a component PROP (EmptyState, AreaHeader, TabHead, Row)
 * and shows no tooltip. All other rules run on the raw source (lucide icons
 * ARE capitalised components, so size={N} must be counted un-stripped). */
function countNativeTitleAttrs(source: string): number {
  // Walk the tag HEADERS. An attribute belongs to the header it stands in, and
  // a header can hold a whole element inside a prop — `<Row icon={<span />}
  // title={…}>` has three tags before the attribute and only one owner. The
  // stack restores the outer header when a nested one ends, which is the case
  // a "nearest tag opening" rule and a strip-the-tags regex both get wrong.
  const stack: { name: string; brace: number }[] = [];
  let head: { name: string; brace: number } | null = null;
  let count = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (head === null) {
      if (ch === "<" && /[A-Za-z]/.test(source[i + 1] ?? "")) {
        const name = /^[A-Za-z][A-Za-z0-9.]*/.exec(source.slice(i + 1))![0];
        head = { name, brace: 0 };
        i += name.length;
      }
      continue;
    }
    if (ch === "{") head.brace += 1;
    else if (ch === "}") head.brace -= 1;
    else if (ch === "<" && head.brace > 0 && /[A-Za-z]/.test(source[i + 1] ?? "")) {
      const name = /^[A-Za-z][A-Za-z0-9.]*/.exec(source.slice(i + 1))![0];
      stack.push(head);
      head = { name, brace: 0 };
      i += name.length;
    } else if (ch === ">" && head.brace === 0) {
      head = stack.pop() ?? null;
    } else if (
      head.brace === 0 &&
      ch === "t" &&
      /^\stitle=(?:\{|")/.test(source.slice(i - 1, i + 8)) &&
      // An iframe title is an accessibility requirement, not a tooltip.
      head.name !== "iframe" &&
      head.name[0] === head.name[0].toLowerCase()
    ) {
      count += 1;
    }
  }
  return count;
}

/** Prose is not markup: a comment that NAMES a native <select> (the mobile
 * dialog module opens by explaining that it replaces the OS dropdowns) is not
 * one. Only the markup rule strips comments — the value rules deliberately
 * count literals wherever they stand. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function countMatches(source: string, rules: Record<string, RegExp>): Counts {
  const markupSource = stripComments(source);
  const counts: Counts = {};
  // Spacing rules read the comment-free text: prose like "padding: the sticky
  // bar sits flush" is not a raw value, and counting it would put noise into a
  // budget that is supposed to be a measurement.
  const SPACING_RULES = new Set(["spacingRaw", "spacingBare", "gapRaw", "gapBare", "sizeRaw", "sizeBare"]);
  for (const [rule, re] of Object.entries(rules)) {
    const n =
      rule === "titleAttr"
        ? countNativeTitleAttrs(source)
        : ((rule === "nakedSelect" || SPACING_RULES.has(rule) ? markupSource : source).match(re) || []).length;
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
  // The bare-number spacing rules describe JSX style objects. In CSS they
  // would count the same declaration their *Raw sibling already caught.
  for (const rule of ["spacingBare", "gapBare", "sizeBare"]) delete cssCounts[rule];
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

  /**
   * A budget ABOVE the actual count is headroom for new raw values, and
   * headroom is how the drift got legitimised in the first place: the font-size
   * count grew from 27 to 51 UNDER this ratchet, the budget was then written
   * to 51, and it has fallen exactly once since — by one. Today's 42 real
   * values sat under a budget of 50, i.e. eight free slots. The old check only
   * fired when a rule reached zero, so it could not see any of that.
   *
   * Now every gap between budget and reality is a failure with the number to
   * write instead (decision E5). Budgets only ever fall.
   */
  it("no budget sits above the real count (headroom is how drift gets legitimised)", () => {
    const stale: string[] = [];
    for (const [file, counts] of Object.entries(BUDGET)) {
      const found = actual[file];
      if (!found) {
        stale.push(`${file}: fully clean — remove the entry`);
        continue;
      }
      for (const [rule, allowed] of Object.entries(counts)) {
        const n = found[rule] ?? 0;
        if (n < allowed) stale.push(`${file}: ${rule} budget ${allowed} > actual ${n} — lower it to ${n}`);
      }
    }
    expect(stale, stale.join("\n")).toEqual([]);
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

/**
 * One gesture, one meaning (S12, redesign rule 1). Holding used to answer after
 * 350 ms on a board card, 450 ms on the navigation bar and 500 ms on a list row
 * — one movement, three durations, and a different result under each finger.
 * The number now has exactly one home; these rules keep it there.
 */
describe("gestures mean one thing", () => {
  const files = [...walk(SRC)].filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("no surface invents its own hold duration", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, "utf8"));
      const rel = relative(SRC, file).replace(/\\/g, "/");
      if (rel === "lib/useLongPress.ts") continue;
      // Only timers a finger starts: a poll interval or a settle animation is
      // not a hold, and flagging those would make the rule noise.
      if (!/onPointerDown|pointerdown/.test(src)) continue;
      for (const m of src.matchAll(/setTimeout\([\s\S]{0,200}?,\s*(\d{3,4})\s*\)/g)) {
        const ms = Number(m[1]);
        if (ms >= 300 && ms <= 800) offenders.push(`${rel}: hold timer of ${ms}ms — use LONG_PRESS_MS`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the hold duration is the one the rules name", () => {
    const src = readFileSync(join(SRC, "lib/useLongPress.ts"), "utf8");
    expect(src).toMatch(/export const LONG_PRESS_MS = 500;/);
  });
});

/**
 * A sheet is navigation state (S12, redesign rule 2): the system back button
 * closes the topmost open sheet instead of walking past it and popping the
 * screen underneath. `SheetGrip` registers it, so no sheet has to remember to.
 */
describe("sheets are navigation state", () => {
  it("the back handler asks the sheet stack first", () => {
    const src = stripComments(readFileSync(join(SRC, "App.tsx"), "utf8"));
    const back = src.slice(src.indexOf('addListener("backButton"'));
    const closeAt = back.indexOf("closeTopSheet()");
    const stepAt = back.indexOf("backStep(");
    expect(closeAt, "the back handler must consult the sheet stack").toBeGreaterThan(-1);
    expect(closeAt, "the sheet stack must be asked before a screen is popped").toBeLessThan(stepAt);
  });

  it("every dismissable sheet registers through the grip", () => {
    const src = stripComments(readFileSync(join(SRC, "components/SheetGrip.tsx"), "utf8"));
    expect(src).toMatch(/registerSheet\(/);
  });
});

/**
 * The adaptive shell (S13). A tablet used to render a blown-up phone; the
 * window class is the layer that ends that. These rules keep it a layer rather
 * than a set of ad-hoc media queries scattered through the stylesheet.
 */
describe("the shell adapts by window class", () => {
  it("no surface invents its own breakpoint", () => {
    const css = readFileSync(join(SRC, "mobile.css"), "utf8");
    const offenders: string[] = [];
    for (const m of css.matchAll(/@media[^{]*\((?:min|max)-width:\s*(\d+)px\)/g)) {
      const px = Number(m[1]);
      // Anything in the region the window classes govern belongs to them.
      if (px >= 400 && px <= 1200) offenders.push(`media query at ${px}px — use [data-window]`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the rail and the split are keyed on the published class", () => {
    const css = readFileSync(join(SRC, "mobile.css"), "utf8");
    expect(css).toMatch(/\[data-window="medium"\]/);
    expect(css).toMatch(/\[data-window="expanded"\]/);
    expect(css).toMatch(/\.m-tabbar--rail/);
  });
});

/**
 * The retreating bar cannot move the page (rework N1.1).
 *
 * The shake at the bottom of long pages was a closed loop, not a rendering
 * quirk: the bar was a flex sibling of the scrolling surface inside a 100dvh
 * shell, `is-away` took ~21px off its height, that grew the scroll container,
 * the browser corrected `scrollTop` by the same ~21px at the very bottom, and
 * the resulting scroll event — larger than the 6px dead zone — flipped the
 * state straight back.
 *
 * The invariant these rules hold is the one that ends it: an `is-away` change
 * must not be able to alter the scroll height. It is checked structurally
 * rather than by measuring one viewport — as long as EVERY `is-away` effect
 * lands inside an out-of-flow bar, no viewport can reproduce the loop.
 */
describe("the retreating bar cannot move the page", () => {
  // Comment-free: a rule's selector starts after the previous block, and the
  // prose in between would otherwise be read as part of it.
  const css = stripComments(readFileSync(join(SRC, "mobile.css"), "utf8"));
  /** Rule blocks whose selector mentions the retreat state. */
  const awayRules = [...css.matchAll(/([^{}]*\.is-away[^{}]*)\{([^}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, " "),
    body: m[2],
  }));

  it("the phone bar is out of the flow", () => {
    const bar = /\.m-tabbar:not\(\.m-tabbar--rail\)\s*\{([^}]*)\}/.exec(css);
    expect(bar, "the phone bar rule not found").not.toBeNull();
    expect(bar![1], "the bar must float, or its height reaches the scroll container").toMatch(
      /position:\s*fixed/,
    );
  });

  it("every retreat effect stays inside that bar", () => {
    expect(awayRules.length, "no .is-away rules found — did the state get renamed?").toBeGreaterThan(0);
    const escapes = awayRules
      .filter((r) => !r.selector.split(",").every((s) => s.trim().startsWith(".m-tabbar")))
      .map((r) => r.selector);
    expect(
      escapes,
      `these retreat rules reach outside the floating bar and can move the page:\n${escapes.join("\n")}`,
    ).toEqual([]);
  });

  it("the scrolling surface reserves a constant strip", () => {
    const page = /\.m-page\s*\{([^}]*)\}/.exec(css);
    expect(page, ".m-page rule not found").not.toBeNull();
    // The reservation is a token, not a value derived from the bar's current
    // height: a reservation that followed the shrinking would BE the shake.
    expect(page![1]).toMatch(/padding:[^;]*var\(--m-bar-space\)/);
    const touchesPage = awayRules.some((r) => r.selector.includes("m-page"));
    expect(touchesPage, "no retreat rule may resize the scrolling surface").toBe(false);
  });

  it("the dead zone is wider than the shift the retreat used to cause", () => {
    const src = readFileSync(join(SRC, "components/AppBar.tsx"), "utf8");
    const m = /CHROME_SCROLL_DEAD_ZONE\s*=\s*(\d+)/.exec(src);
    expect(m, "dead zone constant not found").not.toBeNull();
    // ~21px was the measured collapse (6px padding + the label's 1.4em). The
    // structural fix already removes the loop; this is the second lock, so a
    // later change that puts a resizing element back into the flow cannot
    // restart the oscillation from a single correction.
    expect(Number(m![1])).toBeGreaterThanOrEqual(21);
  });

  it("the retreat animates monotonically", () => {
    // An overshoot carries a shrinking bar past its target and back, which
    // reads as a wobble rather than as momentum (§ 3.8).
    const bar = /\.m-tabbar\s*\{([^}]*)\}/.exec(css)![1];
    const label = /\.m-tab-label\s*\{([^}]*)\}/.exec(css)![1];
    // Both carry the retreat: the bar's padding and the label's height.
    for (const [name, body] of [["m-tabbar", bar], ["m-tab-label", label]] as const) {
      expect(body, `${name}: the retreat must not use the overshooting spring`).not.toMatch(
        /transition:[^;]*--ease-spatial/s,
      );
    }
  });
});

/**
 * The context surface is ONE implementation (S14). It arrives over the work on
 * a phone and stands beside it on a wide window — the same six sections either
 * way. A second component for the docked case would drift within a release.
 */
describe("the context surface has one implementation", () => {
  it("docks rather than being rebuilt", () => {
    const src = stripComments(readFileSync(join(SRC, "components/NoteContextSheet.tsx"), "utf8"));
    expect(src).toMatch(/docked\s*=\s*false/);
    // Docked means: no backdrop, no grip, no dismiss.
    expect(src).toMatch(/docked \? "m-col m-col--context" : "m-sheet-backdrop"/);
    expect(src).toMatch(/\{!docked && <SheetGrip/);
  });

  it("the third column reuses that component", () => {
    const src = stripComments(readFileSync(join(SRC, "screens/NoteScreen.tsx"), "utf8"));
    expect(src).toMatch(/<NoteContextSheet\s+docked/);
    expect(src).toMatch(/m-worksplit/);
  });
});

/**
 * Every row-shaped view marks its rows (S20). The entry menu hangs on ONE
 * delegated hold listener that finds its target through `data-row-path`; a view
 * whose rows carry no marker simply has no menu, and nothing else would notice.
 * That is exactly how a database ends up offering its actions in four views out
 * of six.
 */
describe("every view of a database offers its entry actions", () => {
  const src = () => stripComments(readFileSync(join(SRC, "screens/base/BaseScreen.tsx"), "utf8"));

  it("marks the rows of every row-shaped view", () => {
    const marks = src().match(/data-row-path=/g) ?? [];
    // table, list, cards, board card, timeline (dated + undated), the calendar
    // day sheet — the board also reads the marker for its drag.
    expect(marks.length).toBeGreaterThanOrEqual(7);
  });

  it("finds the target through the marker, not through a per-view handler", () => {
    expect(src()).toMatch(/closest<HTMLElement>\("\[data-row-path\]"\)/);
    expect(src()).toMatch(/setRowMenu\(/);
  });

  it("the peek reads the position from the loaded rows", () => {
    // A second query would be a second truth: the sheet must show the position
    // in the view the user is looking at.
    expect(src()).toMatch(/buildEntryPeek\(rows, orderedColumns, peekPath\)/);
  });
});

/**
 * A relation touches TWO files (S21): the owning base gets the target and the
 * cardinality, the target base gets the computed column pointing back. Which
 * file is written, in which order, and the self-relation case where both are
 * the same file — that decision is shared. A second implementation here would
 * produce a `.base` the desktop reads differently, and Obsidian a third way.
 */
describe("relations are written once, for both shells", () => {
  it("goes through the shared orchestration", () => {
    const src = stripComments(readFileSync(join(SRC, "services/baseOps.ts"), "utf8"));
    expect(src).toMatch(/applyRelationWrite\(/);
    // The two config mutations belong to that orchestration, not to us.
    expect(src).not.toMatch(/addReverseColumnToConfig|removeReverseColumnFromConfig/);
  });

  it("derives the reverse intent rather than deciding it locally", () => {
    const src = stripComments(readFileSync(join(SRC, "screens/base/PropertyEditSheet.tsx"), "utf8"));
    expect(src).toMatch(/reverseIntentFor\(/);
    expect(src).toMatch(/reverseColumnState\(/);
  });
});

/**
 * The view types are the shared catalog (S22). The phone carried its own list
 * of seven, which is exactly how `graph` ended up being a type it could RENDER
 * but never CHOOSE — the renderer knew it, the picker did not. A hand-kept
 * second list drifts the moment a type is added.
 */
describe("a database offers the view types it can render", () => {
  const src = () => stripComments(readFileSync(join(SRC, "screens/base/BaseConfigSheet.tsx"), "utf8"));

  it("takes the types and their labels from the catalog", () => {
    expect(src()).toMatch(/BASE_VIEW_TYPES\.map/);
    expect(src()).toMatch(/baseViewTypeMeta\(type\)\.labelKey/);
  });

  it("nests through the shared tree rather than its own", () => {
    // The cycle guard and the "parent outside the result set" rule are the kind
    // of detail two implementations get subtly different.
    expect(stripComments(readFileSync(join(SRC, "screens/base/BaseScreen.tsx"), "utf8"))).toMatch(/buildSubItemsTree\(/);
    expect(src()).toMatch(/enableSubItemsConfig\(/);
  });
});

/**
 * An embedded database shows ITS rows for THIS note (S23) — the project note
 * listing its tasks. Which rows those are is the shared embedScope: automatic
 * when the two bases are related, plus any explicit "this note" filter. It
 * decides what a reader sees, so it is one reading for both shells.
 */
describe("an embedded database scopes to its host note", () => {
  it("uses the shared scope rather than a local guess", () => {
    const src = stripComments(readFileSync(join(SRC, "services/baseOps.ts"), "utf8"));
    expect(src).toMatch(/detectEmbedScopeRelations\(/);
    expect(src).toMatch(/computeContextScope\(/);
    expect(src).toMatch(/getContextFilters\(/);
  });

  it("offers the note-side answer where the sidebar is", () => {
    // "Which database does this note belong to?" is a context section, not a
    // new surface — the sheet IS the desktop's right sidebar.
    const sheet = stripComments(readFileSync(join(SRC, "components/NoteContextSheet.tsx"), "utf8"));
    expect(sheet).toMatch(/value: "databases"/);
    const section = stripComments(readFileSync(join(SRC, "components/NoteDatabasesSection.tsx"), "utf8"));
    expect(section).toMatch(/buildNoteDatabaseContext\(/);
    // Same deps as the cascade deletion: both must agree on "belongs to".
    expect(section).toMatch(/buildMobilePlanDeps\(/);
  });
});

/**
 * What opening an appointment means lives in one place since N1.3, so the
 * guarantees below read it there rather than in the calendar screen.
 */
const editor = () => stripComments(readFileSync(join(SRC, "components/useEventEditor.tsx"), "utf8"));

/**
 * Writing a calendar event goes through the shared rules (S24). The provider
 * calls are the easy part; the three rules around them are not — a move is a
 * create plus a delete, a remote that moved first means re-pull rather than an
 * error, and a written event has to show before the next pull. Guessing at
 * those a second time produces duplicates and lost edits on a real calendar.
 */
describe("the calendar can be written into", () => {
  const src = () => stripComments(readFileSync(join(SRC, "services/pim/pimService.ts"), "utf8"));

  it("uses the shared write rules", () => {
    expect(src()).toMatch(/createCalendarEvent\(/);
    expect(src()).toMatch(/updateCalendarEvent\(/);
    expect(src()).toMatch(/deleteCalendarEvent\(/);
  });

  it("does not call the provider targets directly for events", () => {
    // A direct target.createEvent here would bypass every rule above.
    expect(src()).not.toMatch(/target\.(createEvent|updateEvent|deleteEvent)\(/);
  });

  it("offers creating from the grid and from the bar", () => {
    // The agenda has no grid to tap; without the action it stayed read-only.
    const screen = stripComments(readFileSync(join(SRC, "screens/PimCalendarScreen.tsx"), "utf8"));
    expect(screen).toMatch(/openCreate\(/);
    // The form itself moved into the shared editor with N1.3, so that both the
    // calendar and Today open an appointment through the same one.
    expect(editor()).toMatch(/<EventEditSheet/);
  });
});

/**
 * The event form is the shared one (S25). Its touched guards are the reason an
 * edit of the time does not reset who answered an invitation, and does not
 * overwrite a recurrence Plainva could only read half of. A phone form written
 * from scratch would clear somebody's RSVPs eventually.
 */
describe("editing an event keeps what it did not touch", () => {
  const sheet = () => stripComments(readFileSync(join(SRC, "components/EventEditSheet.tsx"), "utf8"));

  it("builds on the shared form values", () => {
    expect(sheet()).toMatch(/eventFormFromEvent\(/);
    expect(sheet()).toMatch(/eventFormToDraft\(/);
    expect(sheet()).toMatch(/emptyEventForm\(/);
  });

  it("marks the repeat rule and the attendees as touched when they are used", () => {
    expect(sheet()).toMatch(/repeatTouched: true/);
    expect(sheet()).toMatch(/attendeesTouched: true/);
  });

  it("asks which occurrences before touching a series", () => {
    expect(editor()).toMatch(/seriesMaster/);
    expect(editor()).toMatch(/pimSeriesMaster\(/);
    expect(editor()).toMatch(/pim\.seriesThis/);
  });
});

/**
 * The first day of the week is ONE setting (S26). A second key would mean a
 * vault whose week starts on Sunday on the desktop and on Monday on the phone
 * — for the same person, in the same calendar.
 */
describe("the week starts on the same day everywhere", () => {
  it("reads the shared setting rather than assuming Monday", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/PimCalendarScreen.tsx"), "utf8"));
    expect(screen).toMatch(/getWeekStartSetting\(/);
    expect(screen).toMatch(/WEEK_START_CHANGED_EVENT/);
    // The template engine had the same gap: `{{weekday:…}}` fell back to Monday.
    const tpl = stripComments(readFileSync(join(SRC, "services/templateInteractive.ts"), "utf8"));
    expect(tpl).toMatch(/weekStart = weekStartDayOf\(/);
  });

  it("offers the week and the month the desktop has", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/PimCalendarScreen.tsx"), "utf8"));
    expect(screen).toMatch(/buildWeekCells\(/);
    expect(screen).toMatch(/buildMonthCells\(/);
    // A month steps by months; stepping by 30 days skips February.
    expect(screen).toMatch(/d\.getMonth\(\) \+ dir/);
  });
});

/**
 * A meeting note is a normal note whose `plainva.pim` anchor points at an
 * event; stage 3 reconciles against exactly that anchor (S27). A phone-local
 * builder writing a slightly different one would silently break the link
 * between an event and its note on the very devices meant to share a vault.
 */
describe("a meeting note is created the same way everywhere", () => {
  it("resolves through the shared builder rather than writing its own note", () => {
    const svc = stripComments(readFileSync(join(SRC, "services/pim/pimService.ts"), "utf8"));
    expect(svc).toMatch(/resolveOrCreateMeetingNote\(/);
    // Not a hand-rolled name/anchor next to it.
    expect(svc).not.toMatch(/plainva:\s*\{\s*pim/);
  });

  it("offers the meeting note from the event menu", () => {
    expect(editor()).toMatch(/pim\.meetingNote/);
    expect(editor()).toMatch(/openMeetingNoteFor\(/);
  });

  it("starts a new event in the configured calendar, not simply the first one", () => {
    expect(editor()).toMatch(/resolveDefaultCalendarKey\(/);
    // The old "whatever is first" pre-selection must be gone.
    expect(editor()).not.toMatch(/calendarKey: calendars\[0\]/);
  });
});

/**
 * Answering a thread and passing a message on (S28). All three rules were
 * already shared and already tested — the phone simply never called them, so a
 * thread answered from the phone dropped everyone but the sender, a message
 * could not be passed on at all, and a message that needed a file with it
 * could not be written here. The gap was the surface, never the capability.
 */
describe("mail can answer everyone, pass on, and carry a file", () => {
  it("uses the shared recipient and quoting rules", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/MailMessageScreen.tsx"), "utf8"));
    expect(screen).toMatch(/replyAllRecipients\(/);
    expect(screen).toMatch(/buildForwardBody\(/);
    // One draft builder for reply and reply-all: the quoting must not diverge.
    expect(screen).toMatch(/const replyDraft = /);
  });

  it("actually sends the attachments instead of an empty array", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/MailComposeScreen.tsx"), "utf8"));
    expect(screen).toMatch(/sendMail\(.*\bbody,\s*attach\s*,/);
    // The hard-coded empty array is what made the whole pipeline unreachable.
    expect(screen).not.toMatch(/sendMail\(.*\bbody,\s*\[\]\s*,/);
  });

  it("asks the shared guess for an attachment's type", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/MailComposeScreen.tsx"), "utf8"));
    expect(screen).toMatch(/guessAttachmentMime\(/);
    // Not a second extension table next to the shared one.
    expect(screen).not.toMatch(/application\/pdf/);
  });
});

/**
 * Drafts and the two filters (S29). Same shape as S28: the shared core could
 * do all of it, the phone had no way in. A message begun on a phone and
 * finished at a desk needs a way out of the composer other than "send now" or
 * "lose it", and a mailbox with three hundred messages needs a way to see only
 * what is unread or starred.
 */
describe("mail can file a draft and narrow the list", () => {
  it("files the draft through the shared mailbox decision", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/MailComposeScreen.tsx"), "utf8"));
    expect(screen).toMatch(/appendDraft\(/);
    expect(screen).toMatch(/resolveDraftsMailbox\(/);
    // Never a literal folder name: Graph localizes its drafts folder.
    expect(screen).not.toMatch(/"Drafts"/);
  });

  it("asks the server for flagged, and only filters unread locally", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/MailListScreen.tsx"), "utf8"));
    expect(screen).toMatch(/listFlaggedEnvelopes\(/);
    expect(screen).toMatch(/unreadOnly/);
    // The flagged query names one mailbox — it has no cross-account answer.
    expect(screen).toMatch(/\{!unified && \(/);
  });

  it("lets the empty state tell 'nothing unread' from 'nothing here'", () => {
    const view = stripComments(readFileSync(join(SRC, "screens/mail/mailListView.ts"), "utf8"));
    expect(view).toMatch(/isEmptyByFilter/);
    const screen = stripComments(readFileSync(join(SRC, "screens/MailListScreen.tsx"), "utf8"));
    expect(screen).toMatch(/view\.isEmptyByFilter \? t\("mail\.noUnread"\)/);
  });
});

/**
 * Capturing, one status line, and a delete you can take back (S30).
 */
describe("mail files, says and deletes carefully", () => {
  it("captures a task the same way every other task is created", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/MailMessageScreen.tsx"), "utf8"));
    expect(screen).toMatch(/createTaskInDatabase\(/);
    expect(screen).toMatch(/saveEmlFile\(/);
    // The raw copy costs a second fetch of the whole message — only on demand.
    expect(screen).toMatch(/mode === "eml" && res\.created/);
  });

  it("says one thing at a time instead of stacking banners", () => {
    const list = stripComments(readFileSync(join(SRC, "screens/MailListScreen.tsx"), "utf8"));
    expect(list).toMatch(/mailStatus\(/);
    // The per-account banner loop is what filled the first screenful.
    expect(list).not.toMatch(/unifiedErrors\.map\(/);
  });

  it("offers undo for the reversible delete and a question for the other", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/MailMessageScreen.tsx"), "utf8"));
    expect(screen).toMatch(/undoMoveToTrash\(/);
    // Deleting FROM Trash cannot be taken back, so it still asks.
    expect(screen).toMatch(/deleteForeverConfirm/);
    // Delete left the header: a destructive action beside the back arrow is a
    // mis-tap waiting to happen.
    expect(screen).toMatch(/data-testid="mail-message-menu"/);
  });

  it("offers the note itself as mail", () => {
    const note = stripComments(readFileSync(join(SRC, "screens/NoteScreen.tsx"), "utf8"));
    expect(note).toMatch(/buildMailtoUrl\(/);
    expect(note).toMatch(/onComposeMail\?\.\(/);
  });
});

/**
 * The task filters (S31). `filterTasks` has taken folder, tag, dueOnly and
 * includeHidden since it was written; the phone passed two of the six. On a
 * phone they matter MORE than on a desktop, not less: the list is the same
 * length and the screen is a fifth of the size.
 */
describe("tasks can be narrowed the same way on both shells", () => {
  it("passes every filter the shared helper accepts", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/TasksScreen.tsx"), "utf8"));
    expect(screen).toMatch(/filterTasks\(visibleTasks, \{ status, text, folder, tag, dueOnly, includeHidden: true \}\)/);
    // The database section takes only what means anything there.
    expect(screen).toMatch(/filterTaskDbRows\(dbRows \?\? \[\], \{ status, text, dueOnly \}\)/);
  });

  it("writes the hidden marker through the one shared rule", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/TasksScreen.tsx"), "utf8"));
    expect(screen).toMatch(/setNoteTaskExclusion\(/);
    // Not a second hand-written frontmatter path: unhiding must DELETE the key.
    expect(screen).not.toMatch(/\["plainva", "tasks"\]/);
  });

  it("can hide and unhide a single note, not only the template folder", () => {
    // Otherwise "show hidden" is a dead end: you see them and cannot act.
    const screen = stripComments(readFileSync(join(SRC, "screens/TasksScreen.tsx"), "utf8"));
    expect(screen).toMatch(/data-testid="task-note-hide"/);
  });

  it("lets a promotion choose its database", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/TasksScreen.tsx"), "utf8"));
    expect(screen).toMatch(/promoteInto\(/);
    expect(screen).toMatch(/listBases\(\)/);
  });
});

/**
 * Today as a day, and tags that can be corrected (S32).
 *
 * "Today" showed the daily note and the notes edited that day — half the
 * question. Where you have to be and what you owe are the other half, and both
 * were already in the caches the phone reads for other surfaces.
 */
describe("today answers the whole day", () => {
  it("merges events and due tasks through the shared rule", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/TodayScreen.tsx"), "utf8"));
    expect(screen).toMatch(/buildDayAgenda\(/);
    expect(screen).toMatch(/listPimEvents\(/);
    // Not a second ordering: the sort lives in @plainva/ui, not here.
    expect(screen).not.toMatch(/\.sort\(/);
  });

  it("runs the strip in both directions", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/TodayScreen.tsx"), "utf8"));
    expect(screen).toMatch(/buildDayStrip\(new Date\(\), \d+, \d+\)/);
    // A day view whose future is one day long cannot answer "what does next
    // week look like" — the old strip ran -27..+1.
    const m = /buildDayStrip\(new Date\(\), \d+, (\d+)\)/.exec(screen);
    expect(Number(m?.[1] ?? 0)).toBeGreaterThan(1);
  });
});

describe("a tag can be corrected everywhere at once", () => {
  it("renames vault-wide through the shared rule", () => {
    const screen = stripComments(readFileSync(join(SRC, "TagsScreen.tsx"), "utf8"));
    expect(screen).toMatch(/renameTagAcrossVault\(/);
    expect(screen).toMatch(/normalizeRenameTarget\(/);
    // No hand-rolled loop over the notes: that is exactly what drifted.
    expect(screen).not.toMatch(/for \(const path of/);
  });
});

/**
 * The map's three tools (S33).
 *
 * `buildVaultMapScene` has always taken `pins`, `focus` and `overlay`. The
 * phone passed `{}`, `null` and `"normal"` — a map you could not pin, narrow
 * or read by age, on the device where a thousand-node hairball is least
 * readable.
 */
describe("the vault map can be pinned, narrowed and read by age", () => {
  it("passes the three scene arguments instead of empty ones", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/GraphScreen.tsx"), "utf8"));
    expect(screen).toMatch(/pins,/);
    expect(screen).toMatch(/focus,/);
    expect(screen).toMatch(/overlay,/);
    expect(screen).not.toMatch(/pins: \{\}/);
    expect(screen).not.toMatch(/overlay: \{ mode: "normal" \}/);
  });

  it("remembers a dragged node through the shared store", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/GraphScreen.tsx"), "utf8"));
    expect(screen).toMatch(/onNodeDragEnd/);
    expect(screen).toMatch(/getGraphState\(/);
    // And flushes before leaving, or a pin set a moment earlier is lost.
    expect(screen).toMatch(/\.flush\(\)/);
  });

  it("pins the heatmap's idea of 'now' instead of reading it per render", () => {
    // Otherwise the tint drifts while the map is open.
    const screen = stripComments(readFileSync(join(SRC, "screens/GraphScreen.tsx"), "utf8"));
    expect(screen).toMatch(/now: heatmapNow/);
  });
});

/**
 * Acting ON the map, not just reading it (S34).
 *
 * Every hook used here already existed on the engine — node and edge context,
 * drop-on-node, lasso, toSVG. The phone registered none of them, so the map
 * was a picture: you could look at it and change nothing.
 */
describe("the vault map can be acted on", () => {
  it("registers the menu, connect and lasso hooks", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/GraphScreen.tsx"), "utf8"));
    expect(screen).toMatch(/onNodeContext\s*=/);
    expect(screen).toMatch(/onEdgeContext\s*=/);
    expect(screen).toMatch(/onNodeDropOnNode\s*=/);
    expect(screen).toMatch(/onLassoSelect\s*=/);
  });

  it("offers the shared relation options rather than its own", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/GraphScreen.tsx"), "utf8"));
    expect(screen).toMatch(/loadRelationCatalog\(/);
    expect(screen).toMatch(/findRelationOptions\(/);
    expect(screen).toMatch(/writeRelationLink\(/);
    // And warns before replacing a single-value relation, as the desktop does.
    expect(screen).toMatch(/connectLimitTitle/);
  });

  it("makes selection a mode, because a phone has no modifier key", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/GraphScreen.tsx"), "utf8"));
    // A constant true would turn the pan gesture into a lasso permanently.
    expect(screen).toMatch(/lassoOnEmptyDrag: \(\) =>/);
  });

  it("sends a bulk delete through the same cascade dialog as one note", () => {
    // Ten selected must not be easier to destroy than one.
    const screen = stripComments(readFileSync(join(SRC, "screens/GraphScreen.tsx"), "utf8"));
    expect(screen).toMatch(/confirmDeleteFile\(/);
  });
});

/**
 * Cleaning up, and the `.base` graph brought level (S35).
 *
 * The three cleanup questions — what is unreachable, what points nowhere,
 * where a note is mentioned without being linked — were answered by
 * `GraphService` long before the phone had a screen for them. The map could
 * show the problem and offer nothing to do about it.
 *
 * The `.base` graph, meanwhile, had the shared engine but none of the map's
 * grammar: no persisted pins, no zoom, no legend, and a `zoomToFit` on every
 * rebuild that moved the camera each time a node was placed.
 */
describe("the cleanup worklist", () => {
  it("asks the shared service all three questions", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/CleanupScreen.tsx"), "utf8"));
    expect(screen).toMatch(/getOrphans\(/);
    expect(screen).toMatch(/getBrokenLinks\(/);
    expect(screen).toMatch(/findUnlinkedMentions\(/);
  });

  it("keeps the mention scan on demand and abortable", () => {
    // It reads every note in the vault; starting that because someone opened
    // a screen would be a poor trade on a phone.
    const screen = stripComments(readFileSync(join(SRC, "screens/CleanupScreen.tsx"), "utf8"));
    expect(screen).toMatch(/AbortController/);
    expect(screen).toMatch(/signal: controller\.signal/);
    expect(screen).toMatch(/onProgress:/);
  });

  it("deletes an orphan through the same cascade dialog as any other note", () => {
    // An orphan is not a lesser file because a graph called it unreachable.
    const screen = stripComments(readFileSync(join(SRC, "screens/CleanupScreen.tsx"), "utf8"));
    expect(screen).toMatch(/confirmDeleteFile\(/);
  });

  it("places a mention link at the passage and remembers a rejection", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/CleanupScreen.tsx"), "utf8"));
    expect(screen).toMatch(/applyMentionLink\(/);
    expect(screen).toMatch(/dismissSuggestion\(suggestionKey\(/);
    // A rejected mention must not return with the next scan.
    expect(screen).toMatch(/isDismissed\(suggestionKey\(/);
    // The write is debounced: leaving without a flush loses the rejection.
    expect(screen).toMatch(/\.flush\(\)/);
  });
});

describe("the context graph writes where the text is", () => {
  it("links the passage rather than appending to the end", () => {
    const cg = stripComments(readFileSync(join(SRC, "components/ContextGraph.tsx"), "utf8"));
    expect(cg).toMatch(/applyInlineLink\(/);
    // The append stays as the fallback for a suggestion with no passage.
    expect(cg).toMatch(/appendWikiLink\(/);
  });

  it("persists a dismissal instead of forgetting it on remount", () => {
    const cg = stripComments(readFileSync(join(SRC, "components/ContextGraph.tsx"), "utf8"));
    expect(cg).toMatch(/dismissSuggestion\(/);
    expect(cg).toMatch(/isDismissed\(/);
    expect(cg).toMatch(/\.flush\(\)/);
  });
});

describe("the .base graph is level with the vault map", () => {
  it("persists pins under the desktop's context key", () => {
    const g = stripComments(readFileSync(join(SRC, "screens/base/MobileBaseGraph.tsx"), "utf8"));
    expect(g).toMatch(/getGraphState\(/);
    expect(g).toMatch(/onNodeDragEnd/);
    expect(g).not.toMatch(/pins: \{\}/);
    const base = stripComments(readFileSync(join(SRC, "screens/base/BaseScreen.tsx"), "utf8"));
    expect(base).toMatch(/seed=\{`base:\$\{path\}#\$\{view\?\.name \?\? ""\}`\}/);
  });

  it("fits the viewport only on a context change", () => {
    // A pin write rebuilds the scene; re-fitting there moves the map out from
    // under the finger that just placed a node.
    const g = stripComments(readFileSync(join(SRC, "screens/base/MobileBaseGraph.tsx"), "utf8"));
    expect(g).toMatch(/fitKeyRef\.current !== seed/);
  });

  it("has the map's zoom controls and legend", () => {
    const g = stripComments(readFileSync(join(SRC, "screens/base/MobileBaseGraph.tsx"), "utf8"));
    expect(g).toMatch(/m-zoomers/);
    expect(g).toMatch(/m-glegend/);
    expect(g).toMatch(/graph\.zoomFit/);
  });
});

/**
 * Vault detail: state first, groups, danger last (S36).
 *
 * The screen used to end in up to nine identical full-width buttons, with
 * "restore deleted files" in the same row as "delete vault" — the two most
 * different actions on the surface, rendered alike. And the one question
 * someone opens it with, "is it running?", took three separate readings.
 */
describe("the vault detail screen", () => {
  it("answers the state question in one card", () => {
    const screen = stripComments(readFileSync(join(SRC, "VaultDetailScreen.tsx"), "utf8"));
    expect(screen).toMatch(/m-statcard/);
    // Last run, waiting operations and cadence in ONE line, not three places.
    expect(screen).toMatch(/const stateLine =/);
    expect(screen).toMatch(/mobile\.pendingCount/);
  });

  it("groups the actions and keeps the destructive ones apart", () => {
    const screen = stripComments(readFileSync(join(SRC, "VaultDetailScreen.tsx"), "utf8"));
    expect(screen).toMatch(/mobile\.vaultGroupConnection/);
    expect(screen).toMatch(/mobile\.vaultGroupContents/);
    // Deleting the vault belongs to the danger group, not to the row that also
    // offers restoring files.
    const danger = screen.slice(screen.indexOf('tone="danger"'));
    expect(danger).toMatch(/mobile\.vaultDelete/);
  });

  it("carries its actions as rows, not as a stack of full-width buttons", () => {
    const screen = stripComments(readFileSync(join(SRC, "VaultDetailScreen.tsx"), "utf8"));
    // Nine identical buttons ended this screen, seven of them visible at once
    // for a cloud vault. What is left is the call to action a state asks for:
    // "use this vault" and "resume sync", and never both. The chain and the
    // diagnostics block above still carry their own buttons — N4 answers those,
    // so the count is taken from the action region this step owns.
    const actions = screen.slice(screen.indexOf("mobile.vaultUse"));
    const buttons = actions.match(/<Button\b/g) ?? [];
    expect(
      buttons.length,
      "an action that leads somewhere is a row; a button remains only where something is triggered",
    ).toBeLessThanOrEqual(2);
    expect(screen).toMatch(/<GroupCard tone="danger">/);
    expect(screen).toMatch(/<SectionLabel className="m-danger">/);
    // The destructive rows have to READ destructive, which was the finding:
    // "Sync trennen" was tonal and optically identical to "Umbenennen".
    const danger = screen.slice(screen.indexOf('tone="danger"'));
    expect(danger).toMatch(/m-danger">\{t\("mobile\.syncDisconnect"\)/);
    expect(danger).toMatch(/m-danger">\{t\("mobile\.vaultDelete"\)/);
  });

  it("no longer claims the buttons were replaced while they stood there", () => {
    const raw = readFileSync(join(SRC, "VaultDetailScreen.tsx"), "utf8");
    // The old comment described a grouping that had never happened, directly
    // above the nine buttons it claimed to have replaced.
    expect(raw).not.toMatch(/Grouped by what they are FOR/);
    expect(raw).toMatch(/a chevron means the row LEADS/);
  });
});

describe("the tag list and the folder list", () => {
  it("gives a nested row the same height as its parent, only indented", () => {
    const screen = stripComments(readFileSync(join(SRC, "TagsScreen.tsx"), "utf8"));
    const css = readFileSync(join(SRC, "mobile.css"), "utf8");
    // A root tag stood 56px tall and its child 44 in the SAME list. The class
    // that made the difference existed for nothing else.
    expect(css).not.toMatch(/^\.m-row--nested/m);
    expect(screen).not.toMatch(/m-row--nested/);
    expect(screen).toMatch(/indent=\{1\}/);
  });

  it("carries both lists in groups", () => {
    for (const file of ["TagsScreen.tsx", "screens/BrowseScreen.tsx"]) {
      const screen = stripComments(readFileSync(join(SRC, file), "utf8"));
      // Only the LIST: the action sheets below it are a different container,
      // and the browse screen ends its listing at the selection bar.
      const list = screen.slice(0, screen.indexOf("m-selectbar") >= 0 ? screen.indexOf("m-selectbar") : screen.length);
      expect(list, `${file} still builds its own row`).not.toMatch(/className="m-row["\s]/);
      expect(screen, `${file} has rows outside a group`).toMatch(/<GroupCard/);
    }
  });

  it("draws the hairline between the list's children, so a wrapped row keeps it", () => {
    const css = readFileSync(join(SRC, "..", "..", "..", "packages", "ui", "src", "styles", "ui.css"), "utf8");
    // The one swipeable row in the folder list lives inside its gesture
    // container. A rule on the row itself would draw after the last row and
    // miss the one before it.
    expect(css).toMatch(/\.pv-grouprows > \* \+ \* \{\n\s*border-top:/);
    const row = css.slice(css.indexOf(".pv-grouprow {"), css.indexOf("}", css.indexOf(".pv-grouprow {")));
    expect(row).not.toMatch(/border-bottom/);
  });
});

describe("the cloud accounts screen", () => {
  const read = () => stripComments(readFileSync(join(SRC, "screens", "CloudAccountsScreen.tsx"), "utf8"));

  it("groups by account, not by service", () => {
    const screen = read();
    const fold = readFileSync(join(SRC, "services", "cloudAccountCards.ts"), "utf8");
    // Three stores, one row each, titled with the service — a Google account
    // with files, calendar and mail stood there three times and never said
    // "Google". The fold is the shared identity rule, and the service names
    // move to their own line. It lives in ONE place because the overview and
    // the destination behind its chevron must agree on what an account is.
    expect(fold).toMatch(/identityKey/);
    expect(screen).toMatch(/loadAccountCards/);
    expect(screen).toMatch(/subtitle=\{familyLabel\(card\.family\)\}/);
    expect(screen).toMatch(/<Row indent=\{1\} title=\{<span className="m-acctsub">\{serviceNames/);
    expect(screen, "still builds its own row").not.toMatch(/className="m-row["\s]/);
    expect(screen).toMatch(/<GroupCard/);
  });

  it("names the provider from the shared table, not from a second copy", () => {
    const screen = read();
    const shared = readFileSync(
      join(SRC, "..", "..", "..", "packages", "ui", "src", "lib", "cloudAccountsLabels.ts"),
      "utf8",
    );
    expect(shared).toMatch(/export function familyLabel/);
    expect(screen).toMatch(/familyLabel/);
    // The desktop owned the family names, so the phone had none at all.
    const desktopShared = readFileSync(
      join(SRC, "..", "..", "desktop", "src", "components", "settings", "cloudAccountsShared.tsx"),
      "utf8",
    );
    expect(desktopShared).not.toMatch(/case "microsoft":/);
  });

  it("offers the repair where the expired sign-in is stated", () => {
    const screen = read();
    // The one action that fixes an expired token sits on the row that reports
    // it — behind the chevron the user would have to guess which screen holds
    // the button.
    expect(screen).toMatch(/DeviceSignInBadge/);
    expect(screen).toMatch(/cloudacct-signin-again/);
    expect(screen).toMatch(/beginAccountLogin/);
  });

  it("leads into the account, not into the list of a service", () => {
    const screen = read();
    const detail = stripComments(readFileSync(join(SRC, "screens", "CloudAccountDetailScreen.tsx"), "utf8"));
    const routes = stripComments(readFileSync(join(SRC, "routes.tsx"), "utf8"));
    // The chevron promised THIS account and opened every calendar account
    // there is (E4). The detail names the services and hands each one on to
    // the screen that owns it.
    expect(screen).toMatch(/onOpenAccount\(card\.key\)/);
    expect(screen).not.toMatch(/onOpenCalendarAccounts|onOpenMailAccounts/);
    expect(routes).toMatch(/kind: "cloudaccount", path: key/);
    expect(detail).toMatch(/loadAccountCards/);
    expect(detail).toMatch(/cloudacct-service-\$\{service\}/);
  });

  it("lets the wizard step out of the way once it has handed over", () => {
    const routes = stripComments(readFileSync(join(SRC, "routes.tsx"), "utf8"));
    const wizard = routes.slice(routes.indexOf("cloudconnect:"), routes.indexOf("sync:"));
    // Back from the connect form returned to a provider list the user was
    // done with, two screens away from the account they had just made.
    expect(wizard).toMatch(/c\.pop\(\);/);
  });

  it("puts adding an account in the app bar", () => {
    const screen = read();
    const bar = screen.slice(screen.indexOf("<AppBar"), screen.indexOf("</AppBar>") >= 0 ? screen.indexOf("</AppBar>") : screen.indexOf("m-hint"));
    expect(bar).toMatch(/cloudacct-connect/);
  });
});

describe("the settings surfaces", () => {
  const FILES = [
    "SettingsScreen.tsx",
    "screens/SettingsAreaScreens.tsx",
    "screens/AppearanceScreen.tsx",
    "screens/BehaviorAreaScreen.tsx",
    "screens/MaintenanceAreaScreen.tsx",
  ];

  it("carry their rows in groups, with one heading dialect", () => {
    for (const file of FILES) {
      const screen = stripComments(readFileSync(join(SRC, file), "utf8"));
      // The class itself, not a prefix — `m-row-note` is a label inside a row.
      expect(screen, `${file} still builds its own row`).not.toMatch(/className="m-row["\s]/);
      expect(screen, `${file} still has the old heading`).not.toMatch(/className="m-sectionlabel"/);
      expect(screen, `${file} has rows outside a group`).toMatch(/<GroupCard/);
    }
  });

  it("says what maintenance DOES rather than restating it underneath", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/MaintenanceAreaScreen.tsx"), "utf8"));
    // Three cards each carried a bold line, a sentence and a full-width button.
    // The sentences restated their own titles and truncated mid-word in a row —
    // a row's second line is a short STATE, not prose.
    expect(screen).not.toMatch(/rebuildIndexDesc|deletedFilesDesc|step3Hint/);
    expect(screen).toMatch(/title=\{t\("settings\.rebuildIndexAction"\)\}/);
    // The one thing the second line is good for here: that it is running.
    expect(screen).toMatch(/subtitle=\{busy \? t\("settings\.rebuildIndexRunning"\)/);
  });
});

describe("the security area", () => {
  it("carries its runs as grouped rows, not as loose lines under a heading", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/SecurityAreaScreen.tsx"), "utf8"));
    // Eleven static lines and seven buttons stood directly on the page: a
    // heading, then rows with nothing around them, so nothing said where one
    // group ended and the next began.
    expect(screen).not.toMatch(/className="m-row/);
    expect(screen).not.toMatch(/className="m-sectionlabel"/);
    const groups = screen.match(/<GroupCard/g) ?? [];
    expect(groups.length).toBeGreaterThanOrEqual(8);
    // Quarantined artefacts are the one run that argues rather than informs.
    expect(screen).toMatch(/<GroupCard tone="warn">/);
    // Unlocking is part of the STATUS, so it sits with it and above the area
    // switch rather than below it.
    const status = screen.slice(screen.indexOf("workspaceSecurity.currentStatus"));
    expect(status.indexOf("workspaceSecurity.unlock")).toBeLessThan(status.indexOf("m-security-tabs"));
  });
});

describe("the scheduled vault archive", () => {
  it("prunes and names by the shared rules, not its own", () => {
    const svc = stripComments(readFileSync(join(SRC, "services/vaultBackup.ts"), "utf8"));
    expect(svc).toMatch(/from "@plainva\/ui"/);
    expect(svc).toMatch(/selectZipsToDelete\(/);
    expect(svc).toMatch(/buildZipFileName\(/);
    expect(svc).toMatch(/shouldRunZip\(/);
  });

  it("writes where the OS will not delete it", () => {
    // Directory.Cache is emptied by the system; an archive the system may
    // remove is not an archive.
    const svc = stripComments(readFileSync(join(SRC, "services/vaultBackup.ts"), "utf8"));
    expect(svc).toMatch(/Directory\.Documents/);
    expect(svc).not.toMatch(/Directory\.Cache/);
  });

  it("prunes only after the new archive exists", () => {
    // Deleting first leaves a window where a failed write means one backup
    // fewer than promised.
    const svc = readFileSync(join(SRC, "services/vaultBackup.ts"), "utf8");
    // Measured inside the function, not from the file start — the import line
    // names the pruner long before it is used.
    const body = svc.slice(svc.indexOf("export async function runVaultBackup"));
    expect(body.indexOf("writeFile")).toBeLessThan(body.indexOf("selectZipsToDelete"));
  });

  it("packs the same contents as the manual export", () => {
    const svc = stripComments(readFileSync(join(SRC, "services/vaultBackup.ts"), "utf8"));
    expect(svc).toMatch(/buildVaultZip\(/);
    const exp = stripComments(readFileSync(join(SRC, "services/vaultExport.ts"), "utf8"));
    expect(exp).toMatch(/export async function buildVaultZipBytes\(/);
  });

  it("is a catch-up, not a clock", () => {
    // A phone gets no background timer; the check runs when the app is in
    // front, and the shell must not carry that feature block itself.
    const hook = stripComments(readFileSync(join(SRC, "services/useBackupSchedule.ts"), "utf8"));
    expect(hook).toMatch(/m-backup-due/);
    const app = stripComments(readFileSync(join(SRC, "App.tsx"), "utf8"));
    expect(app).toMatch(/useBackupSchedule\(/);
    expect(app).not.toMatch(/backupIfDue\(/);
  });
});

/**
 * The two security wizards (S37).
 *
 * Both hold key material that exists only in memory until the last step, and
 * both destroy it when they are left. Until now they answered that differently:
 * the workspace wizard asked before leaving, the settings-sync wizard did not —
 * and it lived in a bottom sheet, which the plan reserves for a single decision,
 * never for a multi-step flow with the highest stakes in the app.
 */
describe("the security wizards", () => {
  it("run as their own destination, so the bar cannot swallow a draft", () => {
    const nav = stripComments(readFileSync(join(SRC, "navigation.ts"), "utf8"));
    const kinds = nav.slice(nav.indexOf("const INPUT_KINDS"), nav.indexOf("const INPUT_KINDS") + 200);
    expect(kinds).toMatch(/securitywizard/);
  });

  it("both ask before they throw the key away", () => {
    for (const file of ["screens/SecurityWizardScreen.tsx"]) {
      const src = stripComments(readFileSync(join(SRC, file), "utf8"));
      expect(src, file).toMatch(/useLeaveGuard\(/);
      // The draft must be zeroed on the way out, not merely forgotten.
      expect(src, file).toMatch(/discardPrepared/);
    }
  });

  it("is one wizard shell, not two shapes for the same job", () => {
    const shell = stripComments(readFileSync(join(SRC, "screens/SecurityWizardScreen.tsx"), "utf8"));
    // Identity/recovery/activate for the workspace, passphrase/recovery/activate
    // for the settings key: same three beats, one component.
    expect(shell).toMatch(/m-setupsteps/);
    expect(shell).toMatch(/workspace/);
    expect(shell).toMatch(/encryption/);
    // The sheet it replaces is gone; a wizard in a sheet is the pattern the
    // plan forbids.
    expect(existsSync(join(SRC, "components/EncryptionSetupSheet.tsx"))).toBe(false);
  });

  it("shows the sweep it can measure and admits the one it cannot", () => {
    const shell = stripComments(readFileSync(join(SRC, "screens/SecurityWizardScreen.tsx"), "utf8"));
    // The workspace activation re-encrypts every file and reports counts; the
    // settings key is two writes and has nothing to count. A fake percentage
    // for the second would be a lie told by a progress bar.
    expect(shell).toMatch(/onProgress/);
    expect(shell).toMatch(/m-progress/);
  });
});

/**
 * Managing shares from the phone (S38, decision E8).
 *
 * The security area could LIST members, groups, slices and publications and
 * then said, in as many words, "manage on the desktop app". Every operation it
 * was missing already existed in the shared core — the phone simply never
 * called it. What it must NOT gain is the three the plan holds back (rekey,
 * ownership transfer, decommission): they are tracked as C14, and a phone that
 * quietly grew them would be the opposite of a deliberate boundary.
 */
describe("managing shares from the phone", () => {
  it("uses the shared governance calls rather than a second implementation", () => {
    const svc = stripComments(readFileSync(join(SRC, "services/mobileWorkspaceSecurity.ts"), "utf8"));
    for (const call of ["inviteWorkspaceMember", "createWorkspaceGroup", "createWorkspaceSlice", "assignWorkspaceRole"]) {
      expect(svc, call).toMatch(new RegExp(call));
    }
  });

  it("publishes, applies and persists — in that order, through ONE committer", () => {
    // A policy change that is applied locally but never published leaves this
    // device believing something the workspace does not know; one that is
    // published but never persisted is lost on the next start. Four copies of
    // that sequence would be four chances to get it wrong, so there is one —
    // and every operation has to go through it.
    const svc = readFileSync(join(SRC, "services/mobileWorkspaceSecurity.ts"), "utf8");
    const commit = svc.slice(svc.indexOf("async function commitGovernance"), svc.indexOf("export async function inviteMobileWorkspaceMember"));
    expect(commit.indexOf("publishWorkspaceGovernanceUpdate")).toBeGreaterThan(-1);
    expect(commit.indexOf("applyWorkspaceGovernanceUpdate")).toBeGreaterThan(commit.indexOf("publishWorkspaceGovernanceUpdate"));
    expect(commit.indexOf("persistMobileWorkspaceRuntime")).toBeGreaterThan(commit.indexOf("applyWorkspaceGovernanceUpdate"));

    for (const fn of ["inviteMobileWorkspaceMember", "createMobileWorkspaceGroup", "createMobileWorkspaceSlice", "assignMobileWorkspaceRole"]) {
      const start = svc.indexOf(`export async function ${fn}`);
      expect(start, fn).toBeGreaterThan(-1);
      const body = svc.slice(start, svc.indexOf("\nexport ", start + 10));
      expect(body, fn).toMatch(/commitGovernance\(/);
      // …and none of them may publish on their own path around it.
      expect(body, fn).not.toMatch(/publishWorkspaceGovernanceUpdate\(/);
    }
  });

  it("keeps the three deliberate exceptions off the phone", () => {
    // Rekey, ownership transfer and decommission stay desktop-only (E8 / C14).
    const svc = stripComments(readFileSync(join(SRC, "services/mobileWorkspaceSecurity.ts"), "utf8"));
    for (const call of ["startWorkspaceRekey", "transferWorkspaceOwnership", "decommission"]) {
      expect(svc, call).not.toMatch(new RegExp(call));
    }
  });

  it("no longer sends people to the desktop for what it can do here", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/SecurityAreaScreen.tsx"), "utf8"));
    expect(screen).not.toMatch(/mobileManageOnDesktop/);
    // The rows became actionable: a list you can only read is what this step
    // exists to end.
    expect(screen).toMatch(/onInviteMember|inviteMember/);
  });
});

/**
 * "Today" answers a day, and a day has two kinds of thing on it (N1.3).
 *
 * The appointment row was a plain `<div className="m-row">` — no `onClick`, no
 * `role`, no keyboard handling — so an appointment could be READ there and
 * never opened, and there was no way from Today to an appointment at all.
 * Next to it the task row was already a `<button>`, which is what made the
 * difference invisible: the surface looked interactive.
 *
 * The other two: both kinds sat in ONE list under one heading, so "two
 * appointments and three things due" read as "five somethings"; and the whole
 * block was gated on `agenda.length > 0`, so an empty day showed nothing at
 * all rather than saying it was empty.
 */
describe("a day surface answers the day", () => {
  const today = () => stripComments(readFileSync(join(SRC, "screens/TodayScreen.tsx"), "utf8"));

  it("makes the appointment row a control that opens the appointment", () => {
    const src = today();
    // The row that carries an agenda event must be a button, not a div.
    expect(src, "the appointment row is not a control").toMatch(
      /<button[^>]*\n?[^>]*key=\{item\.event\.uid\}/,
    );
    expect(src, "tapping an appointment does not open it").toMatch(/editor\.openEvent\(/);
  });

  it("opens it through the shared editor rather than its own copy", () => {
    // The series question, the delete confirmation, the meeting note and the
    // RSVPs are decided once; a second copy here would drift from the calendar.
    expect(today()).toMatch(/useEventEditor\(/);
    expect(today()).not.toMatch(/updatePimEvent\(|deletePimEvent\(|pimSeriesMaster\(/);
  });

  it("shows two named sections with counters instead of one mixed list", () => {
    const src = today();
    expect(src).toMatch(/mobile\.todayEvents/);
    expect(src).toMatch(/mobile\.todayDue/);
    expect(src).toMatch(/dayEvents\.length/);
    expect(src).toMatch(/dayTasks\.length/);
    // The single mixed heading must be gone, here and from every locale.
    expect(src).not.toMatch(/mobile\.todayAgenda/);
  });

  it("keeps the section standing when the day is empty", () => {
    const src = today();
    // Not gated on there being anything: an empty day is an answer.
    expect(src).not.toMatch(/\{agenda\.length > 0 && \(/);
    expect(src).toMatch(/mobile\.todayNoEvents/);
    expect(src).toMatch(/mobile\.todayNoDue/);
  });

  it("offers creating an appointment from an empty day, when one can be created", () => {
    const src = today();
    expect(src).toMatch(/editor\.writableCount > 0/);
    expect(src).toMatch(/editor\.openCreate\(/);
  });
});

/**
 * Home leads home (N1.4, Gesamtplan § 3.7).
 *
 * Two causes, both of which looked deliberate. The bar tap kept the target
 * tab's stack, so Home was wherever Home was left; and the navigator remembers
 * per vault which of its three sections was last open, so with Tags remembered
 * "Home" showed neither the file tree nor anything the tap had asked for.
 *
 * The remembering itself is right — coming back from a note should land where
 * you were. Only the explicit tap on the bar clears it, which is why the reset
 * sits in the bar handler and nowhere else.
 */
describe("a tap on Home leads home", () => {
  // What a bar tap does lives in one module since N1.4, rather than as four
  // unrelated lines in an inline handler.
  const tap = () => stripComments(readFileSync(join(SRC, "services/tabTap.ts"), "utf8"));

  it("clears the remembered navigator section on an explicit Home tap", () => {
    expect(tap()).toMatch(/if \(id === "notes"\) forgetNavigatorSection\(\)/);
  });

  it("asks about unsaved work BEFORE anything a tap changes", () => {
    const src = tap();
    const ask = src.indexOf("askBeforeLeaving(");
    const reset = src.indexOf("forgetNavigatorSection()");
    const nav = src.indexOf("tapTab(");
    expect(ask, "the leave question is gone").toBeGreaterThan(-1);
    expect(ask, "the tap changes something before asking").toBeLessThan(reset);
    expect(reset).toBeLessThan(nav);
  });

  it("clears it ONLY there — not on back, and not on a note's return path", () => {
    const src = stripComments(readFileSync(join(SRC, "App.tsx"), "utf8"));
    expect(
      src.includes("forgetNavigatorSection"),
      "the shell resets the section outside the bar tap: coming back from a note would forget it too",
    ).toBe(false);
  });

  it("lets the navigator follow a reset it did not make itself", () => {
    // It reads the stored section once, on mount. In the two-column layout it
    // never unmounts, so without following the setting the reset is invisible.
    const nav = stripComments(readFileSync(join(SRC, "screens/NavigatorScreen.tsx"), "utf8"));
    expect(nav).toMatch(/m-settings-changed/);
    expect(nav).toMatch(/setTab\(getNavigatorTab\(\)\)/);
  });
});

/**
 * Settings are one tap from every root (N1.5, E7).
 *
 * They used to be a row at the FOOT of the navigator: reachable only from
 * Home, and only after scrolling to the end of it. They now sit in the leading
 * slot of the app bar as a hamburger — the slot M3 reserves for navigation,
 * which a pushed surface still uses for its back arrow.
 *
 * The list below is the point of this test. Threading a prop through six
 * screens is six chances to forget it, and a root that quietly shipped without
 * the entry would be the old problem again on one surface.
 */
describe("settings are reachable from every root", () => {
  const routes = () => stripComments(readFileSync(join(SRC, "routes.tsx"), "utf8"));

  it("gives the app bar a hamburger when there is nothing to go back to", () => {
    const bar = stripComments(readFileSync(join(SRC, "components/AppBar.tsx"), "utf8"));
    expect(bar).toMatch(/onMenu/);
    expect(bar).toMatch(/data-testid="nav-settings"/);
    // The back arrow keeps the slot when both are given — M3's definition of it.
    expect(bar).toMatch(/\{onBack \? \(/);
  });

  it("passes it from EVERY tab root", () => {
    const src = routes();
    const start = src.indexOf("export const TAB_ROUTES");
    const table = src.slice(start, src.indexOf("\n};", start));
    const roots = [...table.matchAll(/\n {2}([a-z][a-zA-Z]*): \(c\) =>/g)].map((m) => m[1]);
    expect(roots.length, "the tab route table changed shape").toBeGreaterThanOrEqual(6);
    const missing = roots.filter((name) => {
      const at = table.indexOf(`\n  ${name}: (c) =>`);
      const rest = table.slice(at + 1);
      const next = rest.search(/\n {2}[a-z][a-zA-Z]*: \(c\) =>/);
      const body = next === -1 ? rest : rest.slice(0, next);
      return !body.includes("onMenu=");
    });
    expect(missing, "these roots cannot reach the settings from their app bar").toEqual([]);
  });

  it("no longer keeps a settings row at the foot of the navigator", () => {
    const nav = stripComments(readFileSync(join(SRC, "screens/NavigatorScreen.tsx"), "utf8"));
    expect(nav).not.toMatch(/m-row--foot/);
    // And the class it used went with it, rather than lingering as dead CSS.
    expect(stripComments(readFileSync(join(SRC, "mobile.css"), "utf8"))).not.toMatch(/\.m-row--foot/);
  });
});

/**
 * One edge, one heading (N2.2).
 *
 * Ten different left edges were possible on a single surface — 8 for the
 * app-bar title, 16 for the page, 18 for a section heading, 32 for a card, 48
 * for a row inside one, 56 for a nested row — and two screens mixed two of
 * them. The target design has exactly one. Six uppercase micro-label dialects
 * described the same heading six ways, one of them (`.m-section-label`) dead
 * next to the live `.m-sectionlabel` it duplicated.
 *
 * NOTE on the plan's third "dead" rule: `.m-danger` is NOT dead. It carries
 * the destructive colour on eight surfaces (row action sheets, table menu,
 * colour picker). It stays, and this test says so, so that a later reading of
 * the plan does not remove it on the strength of the list.
 */
describe("one page edge and one heading dialect", () => {
  const css = () => stripComments(readFileSync(join(SRC, "mobile.css"), "utf8"));

  it("routes every page-level edge through the one token", () => {
    const src = css();
    for (const rule of [".m-page {", ".m-appbar {", ".m-card {", ".m-hint--inset {", ".m-sectionlabel--inset {"]) {
      const at = src.indexOf(rule);
      expect(at, `${rule} is gone`).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf("}", at));
      expect(body, `${rule} still states its own edge`).toContain("--m-edge");
    }
  });

  it("declares that edge exactly once", () => {
    expect([...css().matchAll(/--m-edge:\s/g)]).toHaveLength(1);
  });

  it("leaves the heading to the shared rule rather than restating it", () => {
    const src = css();
    // The three that are genuinely headings above a group now ride on the
    // shared .pv-grouplabel; a local declaration would be a seventh dialect.
    for (const cls of [".m-sectionlabel {", ".m-suggest-eyebrow {", ".m-codefield-label {"]) {
      expect(src, `${cls} declares the heading a second time`).not.toContain(cls);
    }
    const shared = stripComments(
      readFileSync(join(SRC, "..", "..", "..", "packages", "ui", "src", "styles", "ui.css"), "utf8"),
    );
    expect(shared).toContain(".m-sectionlabel");
    expect(shared).toContain(".m-suggest-eyebrow");
  });

  it("has removed the rules that nothing rendered", () => {
    const src = css();
    expect(src).not.toContain(".m-page--home");
    expect(src).not.toContain(".m-section-label");
  });

  it("has KEPT .m-danger, which the plan lists as dead but eight surfaces use", () => {
    expect(css()).toContain(".m-danger");
  });
});
