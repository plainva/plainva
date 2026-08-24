import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Walks the whole source tree from disk: about half a second on its own, but past
// the 5 s unit-test default under the full suite's parallel load — six of these
// guards timed out at once and passed in isolation (2026-08-24). A default meant
// for unit tests is the wrong yardstick for a check whose runtime grows with the
// repo; 30 s still catches a hang.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Design-language ratchet 2.0 (design sweep 2026-07-19; v1: plan Designsprache
 * 2026-07-05, P1).
 *
 * Scans component sources for patterns the design language forbids: raw
 * border-radius pixel literals (use var(--radius-*); 50%-circles are exempt),
 * hardcoded hex/rgba colors, hand-rolled position:fixed overlays, raw px/rem
 * font sizes (use var(--text-*); content-relative em values are exempt), raw
 * z-index numbers (use var(--z-*)), literal box-shadow color recipes (use
 * var(--shadow-*)), literal transition/animation durations (use var(--dur-*)),
 * native title= tooltips (use data-tip), the retired legacy class families,
 * onMouseOver/onMouseOut style-mutation hover, and raw lucide size={N}
 * literals (use the shared ICON.* roles).
 *
 * BUDGET freezes the remaining debt per file — the suite fails when a file
 * EXCEEDS its budget (regression) and when a fully cleaned file still has an
 * entry (stale budget). The sweep packages (P2-P8) drive every entry to zero;
 * after that the map stays EMPTY — any raw value in ANY file (including new
 * ones) breaks pre-commit/pre-push/CI immediately. New entries require a
 * review-visible justification comment. Details:
 * docs/engineering/Design_Language.md.
 *
 * Deliberately NOT scanned: styles/tokens.css, base-colors.css and themes/*.css
 * (token definitions are made of literals), *.test.* files, and
 * src/components/ui/ (the primitives own the canonical implementations).
 * Note: the hex rule can match non-color uses (e.g. "#anchor" fragments);
 * such matches are budgeted like any other — only increases fail.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
// Desktop components + shell roots (App.tsx/main.tsx/services were a scan gap
// in v1) + the extracted shared editor layer (ADR 0011); budget keys keep
// their original "components/..." form across both roots. The shared .base
// layer scans under "base/...", shell roots under "src/...".
const COMPONENT_ROOTS: Array<{ dir: string; prefix: string }> = [
  { dir: join(SRC, "components"), prefix: "components/" },
  { dir: join(SRC, "services"), prefix: "services/" },
  { dir: join(SRC, "../../../packages/ui/src/components"), prefix: "components/" },
  { dir: join(SRC, "../../../packages/ui/src/base"), prefix: "base/" },
  // The mail core moved to the shared package (feinplan G0.1) — it must stay
  // under the same ratchet it had in the shell.
  { dir: join(SRC, "../../../packages/ui/src/mail"), prefix: "mail/" },
];
/** Shell root files scanned individually (walk would pull in tests/config). */
const ROOT_FILES = ["App.tsx", "main.tsx"];

const RULES: Record<string, RegExp> = {
  // 50%/percentage circles are legitimate geometry — exempted via lookahead.
  radiusPx: /border-?[rR]adius:\s*["'`]?\d+(?!\d*%)/g,
  hex: /#[0-9a-fA-F]{3,8}\b/g,
  rgba: /rgba?\(/g,
  fixedOverlay: /position:\s*["']fixed["']/g,
  // Chrome font sizes come from the type scale; em values (content-relative
  // typography in the reader/editor) are exempt.
  fontSizeRaw: /font-?[sS]ize:\s*["'`]?\d+(?:\.\d+)?(?:px|rem)/g,
  fontSizeBare: /fontSize:\s*\d/g,
  zIndexRaw: /z-?[iI]ndex:\s*["'`]?\d/g,
  // Literal shadow recipes carrying their own color — token shadows adapt to
  // dark mode / black themes, literals do not.
  shadowRaw: /box-?[sS]hadow:[^;\n]*(?:rgba\(|#[0-9a-fA-F]{3})/g,
  durationRaw: /(?:transition|animation)[^;\n]*?\d+(?:\.\d+)?m?s\b/g,
  titleAttr: /\stitle=(?:\{|")/g,
  legacyClass: /pv-btn-primary|pv-btn-secondary|pv-icon-btn\b|pv-modal-card|pv-modal-overlay|pv-modal-head\b|pv-modal-title\b|pv-input\b|pv-date-display|pv-select-trigger\b|pv-add-btn/g,
  jsHover: /onMouseOver=\{|onMouseOut=\{/g,
  iconLiteral: /\bsize=\{\d+\}/g,
  // A raw <select> must at least wear the field skin (`pv-field pv-field--select`,
  // the documented dense-toolbar idiom); forms/dialogs use the Select primitive.
  nakedSelect: /<select(?!(?:=>|[^>])*pv-field--select)/g,
};

type Counts = Partial<Record<keyof typeof RULES, number>>;

/** Frozen remaining debt (initialized 2026-07-19 from the tree; the sweep
 * packages P2-P8 drive this to EMPTY). Lower or remove entries as files are
 * migrated; never raise one; new entries need a justification comment. */
const BUDGET: Record<string, Counts> = {
  // The sweep (P2-P8, 2026-07-19) drove this map from 1253 findings in 107
  // files down to the entries below — every remaining one is a JUSTIFIED
  // exception documented at the finding site, not debt:
  // - propertyModel/callouts: option-swatch DATA + var() fallback literals.
  // - EmojiPicker/HeaderColorPicker: native <input type=color> needs a
  //   resolved hex string.
  // - ImageViewer: pen default + JPEG flatten fill are baked PIXEL data.
  // - mail.css: avatar fg over the theme-independent --palette-N swatches.
  // - DayTimeGrid: local stacking order inside one day column (no overlay).
  // - ThemePickerCards: neutral outline over each card's OWN swatch colors.
  // - mailSanitize: sandboxed srcdoc iframe cannot inherit app tokens.
  "base/propertyModel.ts": {hex:8},
  "components/callouts.ts": {hex:8},
  "components/EmojiPicker.tsx": {hex:1},
  "components/HeaderColorPicker.tsx": {hex:1},
  "components/ImageViewer.tsx": {hex:2},
  "components/mail/mail.css": {hex:1},
  "components/pimcal/DayTimeGrid.tsx": {zIndexRaw:3},
  "components/ThemePickerCards.tsx": {rgba:2},
  "mail/mailSanitize.ts": {hex:2,fontSizeRaw:1},
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      // ui/ primitives own the canonical overlay/shadow implementations — not ratcheted.
      if (name === "ui") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\./.test(name) && name !== "palette.ts") {
      // palette.ts is a token SOURCE (accent hex values written into user
      // frontmatter — data, not styling), excluded like styles/tokens.css.
      out.push(p);
    }
  }
  return out;
}

/** The native tooltip attribute lives on a LOWERCASE DOM tag; `title` on a
 * capitalised tag is a component PROP (Modal, EmptyState, SettingRow, Row) and
 * shows no tooltip. All other rules run on the raw source (lucide icons ARE
 * capitalised components, so size={N} must be counted un-stripped). */
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

function countFile(source: string): Counts {
  const markupSource = stripComments(source);
  const counts: Counts = {};
  for (const [rule, re] of Object.entries(RULES)) {
    const n =
      rule === "titleAttr"
        ? countNativeTitleAttrs(source)
        : ((rule === "nakedSelect" ? markupSource : source).match(re) || []).length;
    if (n > 0) counts[rule as keyof typeof RULES] = n;
  }
  return counts;
}

function scan(): Record<string, Counts> {
  const actual: Record<string, Counts> = {};
  const record = (rel: string, counts: Counts) => {
    if (Object.keys(counts).length) actual[rel] = counts;
  };
  for (const root of COMPONENT_ROOTS) {
    for (const file of walk(root.dir)) {
      const rel = root.prefix + relative(root.dir, file).replace(/\\/g, "/");
      record(rel, countFile(readFileSync(file, "utf8")));
    }
  }
  for (const name of ROOT_FILES) {
    record(`src/${name}`, countFile(readFileSync(join(SRC, name), "utf8")));
  }
  // App.css: full rule set (v1 only counted raw radii there).
  record("App.css", countFile(readFileSync(join(SRC, "App.css"), "utf8")));
  // mail.css: the one component stylesheet outside styles/ — same contract.
  record(
    "components/mail/mail.css",
    countFile(readFileSync(join(SRC, "components/mail/mail.css"), "utf8"))
  );
  return actual;
}

describe("design language ratchet", () => {
  const actual = scan();

  it("no file exceeds its frozen budget (use tokens/primitives instead)", () => {
    const regressions: string[] = [];
    for (const [file, counts] of Object.entries(actual)) {
      for (const [rule, n] of Object.entries(counts)) {
        const allowed = BUDGET[file]?.[rule as keyof typeof RULES] ?? 0;
        if ((n ?? 0) > allowed) {
          regressions.push(`${file}: ${rule} ${n} > budget ${allowed}`);
        }
      }
    }
    expect(regressions, regressions.join("\n")).toEqual([]);
  });

  it("fully cleaned files are removed from the budget (keep the map honest)", () => {
    const stale: string[] = [];
    for (const [file, counts] of Object.entries(BUDGET)) {
      const act = actual[file];
      if (!act) {
        stale.push(file);
        continue;
      }
      for (const rule of Object.keys(counts)) {
        if (!(rule in act)) stale.push(`${file}#${rule}`);
      }
    }
    expect(stale, `remove stale budget entries: ${stale.join(", ")}`).toEqual([]);
  });
});
