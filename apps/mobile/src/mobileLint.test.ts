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
  "mobile.css": { fontSizeRaw: 42, zIndexRaw: 1, spacingRaw: 138, gapRaw: 68, sizeRaw: 73 },
  // A QR code is DATA, not an icon: `size` is the rendered pixel edge of a
  // square a camera has to resolve, and 232 fills the phone's sheet. The
  // iconLiteral rule cannot tell the two apart by shape (S7).
  "screens/SecurityAreaScreen.tsx": { iconLiteral: 1 },
  /**
   * Inline spacing in JSX (E5, entering the ratchet with N0.3). PinboardView is
   * the worst of them — it bypasses `.m-page` entirely and carries its own
   * chip metric next to the token one (§ 4); N3.6 is where it gets rebuilt.
   */
  "components/CloudFolderPickerSheet.tsx": { gapBare: 1 },
  "components/NoteContextSheet.tsx": { spacingBare: 1 },
  "screens/MailAccountsScreen.tsx": { spacingRaw: 2, spacingBare: 1 },
  "screens/PimAccountsScreen.tsx": { spacingRaw: 1, spacingBare: 3, sizeBare: 2 },
  "screens/PimCalendarScreen.tsx": { spacingRaw: 2, sizeBare: 4 },
  "screens/base/PinboardView.tsx": { spacingRaw: 10, spacingBare: 6, gapRaw: 2, gapBare: 6, sizeBare: 4 },
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
  // Spacing rules read the comment-free text: prose like "padding: the sticky
  // bar sits flush" is not a raw value, and counting it would put noise into a
  // budget that is supposed to be a measurement.
  const SPACING_RULES = new Set(["spacingRaw", "spacingBare", "gapRaw", "gapBare", "sizeRaw", "sizeBare"]);
  for (const [rule, re] of Object.entries(rules)) {
    const scanned =
      rule === "titleAttr" ? titleSource : rule === "nakedSelect" || SPACING_RULES.has(rule) ? markupSource : source;
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
    expect(screen).toMatch(/<EventEditSheet/);
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
    const screen = stripComments(readFileSync(join(SRC, "screens/PimCalendarScreen.tsx"), "utf8"));
    expect(screen).toMatch(/seriesMaster/);
    expect(screen).toMatch(/pimSeriesMaster\(/);
    expect(screen).toMatch(/pim\.seriesThis/);
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
    const screen = stripComments(readFileSync(join(SRC, "screens/PimCalendarScreen.tsx"), "utf8"));
    expect(screen).toMatch(/pim\.meetingNote/);
    expect(screen).toMatch(/openMeetingNoteFor\(/);
  });

  it("starts a new event in the configured calendar, not simply the first one", () => {
    const screen = stripComments(readFileSync(join(SRC, "screens/PimCalendarScreen.tsx"), "utf8"));
    expect(screen).toMatch(/resolveDefaultCalendarKey\(/);
    // The old "whatever is first" pre-selection must be gone.
    expect(screen).not.toMatch(/calendarKey: writableCals\[0\]/);
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
    expect(screen).toMatch(/m-dangerzone/);
    // Deleting the vault belongs to the danger group, not to the row that also
    // offers restoring files.
    const danger = screen.slice(screen.indexOf("m-dangerzone"));
    expect(danger).toMatch(/mobile\.vaultDelete/);
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
