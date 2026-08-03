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
