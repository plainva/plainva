import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO, sourceFile, sourceTexts, type SourceText } from "./test-sourceTree";

/**
 * Design-language guards (design sweep 2026-07-19, part D "enforcement").
 * Three structural checks that complement the value ratchet in
 * designLint.test.ts:
 *
 * 1. classExistence — every pv-/m-/base-cfg- class referenced from a string
 *    literal in TSX/TS must be DEFINED in some stylesheet. Would have caught
 *    3 of the 8 audit bugs (colorless mobile chips, the never-spinning
 *    .m-spin, the ghost .m-btn--primary).
 * 2. cssDuplicate — no class selector is defined twice across the app-layer
 *    stylesheets (ui.css / App.css / mail.css / mobile.css). Would have
 *    caught the .pv-chip collision (App.css silently overriding ui.css on
 *    desktop only) and the mobile duplicate blocks. Theme files are exempt:
 *    overriding IS their job.
 * 3. themeCoverage — every top-level pv surface defined in ui.css must either
 *    carry LCARS + Win95 selectors or appear in the visible exemption list
 *    below. New surfaces therefore REQUIRE a conscious theming decision
 *    (docs/engineering/Design_Language.md, "new visual pattern" rule).
 *
 * Three more, added with the mobile redesign (S7) and applying to BOTH shells,
 * because the desktop can make all three mistakes just as easily:
 *
 * 4. duplicateDeclaration — no property is set twice in one block.
 * 5. declaredVariables — no stylesheet reads a var() nothing declares.
 * 6. touchTargets — nothing interactive in the mobile shell falls under the
 *    44px the app documents as its own minimum.
 *
 * Plus themeReach: a mobile surface must paint through shared tokens. A hard
 * colour is what actually put mobile out of twelve themes' reach — not a
 * missing selector.
 */

// Repository-relative; every file is read once for all checks below, the code
// trees from the scan guards' shared snapshot (test-sourceTree.ts). Each check
// used to walk and read the trees itself — three times ~770 files per run,
// which is what took these guards past the unit-test limit under load
// (2026-08-24; Befunde 2026-09-24, Z2).
const STYLE_FILES = {
  ui: "packages/ui/src/styles/ui.css",
  tokens: "packages/ui/src/styles/tokens.css",
  baseColors: "packages/ui/src/styles/base-colors.css",
  appCss: "apps/desktop/src/App.css",
  mailCss: "apps/desktop/src/components/mail/mail.css",
  baseCss: "apps/desktop/src/components/base/base.css",
  mobileCss: "apps/mobile/src/mobile.css",
};
const THEME_DIR = "packages/ui/src/themes";
/** Every file of the theme folder, as the folder lists it. */
const themeFiles = () => readdirSync(join(REPO, THEME_DIR)).map((name) => `${THEME_DIR}/${name}`);

const CODE_ROOTS = [
  "apps/desktop/src/components",
  "apps/desktop/src/services",
  "packages/ui/src/components",
  "packages/ui/src/base",
  "packages/ui/src/ai",
  "apps/mobile/src",
];
const CODE_FILES = ["apps/desktop/src/App.tsx", "apps/desktop/src/main.tsx"];

let code: readonly SourceText[] | undefined;
/** The shipped TypeScript under CODE_ROOTS, plus CODE_FILES. */
function codeSources(): readonly SourceText[] {
  code ??= sourceTexts(["apps/desktop/src", "packages/ui/src", "apps/mobile/src"], "shipped").filter(
    (f) => CODE_FILES.includes(f.rel) || CODE_ROOTS.some((root) => f.rel.startsWith(`${root}/`)),
  );
  return code;
}

function allStylesheets(): string[] {
  const files = Object.values(STYLE_FILES).map((rel) => sourceFile(rel));
  for (const rel of themeFiles()) {
    if (rel.endsWith(".css")) files.push(sourceFile(rel));
  }
  return files;
}

/** Class names DEFINED anywhere (selector occurrences count as definitions —
 * a theme override without a base definition still means the class exists). */
function definedClasses(): Set<string> {
  const defined = new Set<string>();
  const sources = allStylesheets();
  // CSS-in-TS style sources (embedded <style> blocks, CM themes) also define
  // classes; the selector DOT distinguishes a definition from a className
  // reference, so scanning all code files is safe.
  for (const f of codeSources()) sources.push(f.text);
  for (const css of sources) {
    for (const m of css.matchAll(/\.([A-Za-z][\w-]*)/g)) defined.add(m[1]);
  }
  return defined;
}

/** Guarded prefixes: our own class families. Everything else (cm-*, katex,
 * third-party) is out of scope. */
const GUARDED = /^(pv-|m-|base-cfg-|tabstrip)/;

/** Dynamically-generated class families the literal scan cannot see the
 * definition site for, plus state modifiers toggled at runtime. */
const CLASS_EXEMPT = new Set([
  "m-screen-in", // composed via template literal in screen transitions
  "pv-ribbon", // bare theme hook on the ribbon rail (no base rules by design)
  "pv-math-widget", // CM widget marker for click routing (styled inline)
  "pv-mermaid-live", // CM widget marker for click routing (styled inline)
]);

function referencedClasses(): Map<string, string> {
  const refs = new Map<string, string>(); // class -> first referencing file
  for (const { rel: file, text: src } of codeSources()) {
    // className="..." / className={"..."} / classList.add("...") / cx("...")
    for (const m of src.matchAll(/(?:className|overlayClassName|bodyClassName)\s*[=:]\s*[{]?\s*["'`]([^"'`]+)["'`]/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls.includes("$") || cls.includes("{")) continue; // template fragment
        if (GUARDED.test(cls) && !refs.has(cls)) refs.set(cls, file);
      }
    }
    for (const m of src.matchAll(/classList\.(?:add|toggle|remove)\(\s*["']([\w-]+)["']/g)) {
      const cls = m[1];
      if (GUARDED.test(cls) && !refs.has(cls)) refs.set(cls, file);
    }
    for (const m of src.matchAll(/\bcx\(\s*["']([^"'`]+)["']/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls.includes("$") || cls.includes("{")) continue; // template fragment
        if (GUARDED.test(cls) && !refs.has(cls)) refs.set(cls, file);
      }
    }
  }
  return refs;
}

describe("class existence (referenced pv-/m-/base-cfg- classes are defined)", () => {
  it("finds a stylesheet definition for every referenced class", () => {
    const defined = definedClasses();
    const missing: string[] = [];
    for (const [cls, file] of referencedClasses()) {
      if (CLASS_EXEMPT.has(cls)) continue;
      if (!defined.has(cls)) missing.push(`${cls} (first ref: ${file})`);
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });
});

describe("the dialog's header note stays in the header", () => {
  it("leaves pv-modal-note to the Modal primitive", () => {
    // `pv-modal-note` is the one line beside a dialog's title: at most 40% of
    // the header, never wrapped, cut off with an ellipsis. Four dialogs used
    // it for a paragraph in their body (finding 2026-10-06), and their
    // explanations ended in "…" after the first third of a sentence. A hint
    // in a dialog's body is `pv-modal-hint`.
    const users = codeSources()
      .filter((f) => /\bpv-modal-note\b/.test(f.text))
      .map((f) => f.rel);
    expect(users).toEqual(["packages/ui/src/components/ui/Modal.tsx"]);
  });
});

/** Deliberate double definitions in the app layer (each needs a reason). */
const DUPLICATE_ALLOW = new Set<string>([
  // ui.css keeps all entrance animations in ONE motion section at the end of
  // the file (single reduced-motion override point) — these selectors appear
  // a second time there with animation properties only.
  ".pv-menu",
  ".pv-toast",
  ".pv-tooltip",
]);

describe("css duplicates (app-layer stylesheets define each selector once)", () => {
  it("has no repeated class-selector blocks across ui.css/App.css/mail.css/mobile.css", () => {
    // App.css and mobile.css never load together (desktop vs. mobile shell),
    // so a repeated selector is only a conflict WITHIN one bundle. ui.css is
    // part of both bundles.
    const appLayer: Array<[string, string, string]> = [
      ["ui.css", "both", sourceFile(STYLE_FILES.ui)],
      ["App.css", "desktop", sourceFile(STYLE_FILES.appCss)],
      ["mail.css", "desktop", sourceFile(STYLE_FILES.mailCss)],
      ["mobile.css", "mobile", sourceFile(STYLE_FILES.mobileCss)],
    ];
    const seen = new Map<string, { file: string; bundle: string }>();
    const dupes: string[] = [];
    for (const [name, bundle, css] of appLayer) {
      // Strip comments, then walk top-level blocks; nested contexts (@media,
      // @keyframes) are tracked so their inner selectors get a scoped key.
      const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
      const stack: string[] = [];
      let buf = "";
      for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (ch === "{") {
          const sel = buf.trim().replace(/\s+/g, " ");
          stack.push(sel);
          if (sel.startsWith(".") && stack.length === 1) {
            const key = sel;
            if (DUPLICATE_ALLOW.has(key)) {
              buf = "";
              continue;
            }
            const prev = seen.get(key);
            const clash =
              prev && (prev.bundle === "both" || bundle === "both" || prev.bundle === bundle);
            if (prev && clash) dupes.push(`"${key}" in ${name} (already in ${prev.file})`);
            else if (!prev) seen.set(key, { file: name, bundle });
          }
          buf = "";
        } else if (ch === "}") {
          stack.pop();
          buf = "";
        } else {
          buf += ch;
        }
      }
    }
    expect(dupes, dupes.join("\n")).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ *
 * The three rules below were written for the mobile shell and apply to both
 * (S7). Each grew out of a defect that had shipped: a property declared twice
 * in one block, a var() nothing declares, and a tap target under the app's own
 * minimum. None of them is a mobile concern — the desktop can make all three
 * mistakes, and two of them are invisible until someone measures.
 * ------------------------------------------------------------------------ */

/** Every app-layer stylesheet, with the shell that loads it. */
function appLayerCss(): Array<[string, string]> {
  return [
    ["ui.css", sourceFile(STYLE_FILES.ui)],
    ["App.css", sourceFile(STYLE_FILES.appCss)],
    ["mail.css", sourceFile(STYLE_FILES.mailCss)],
    ["base.css", sourceFile(STYLE_FILES.baseCss)],
    ["mobile.css", sourceFile(STYLE_FILES.mobileCss)],
  ];
}

/** Blocks of one stylesheet as [selector, body], comments stripped. */
function blocks(css: string): Array<[string, string]> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Array<[string, string]> = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push([m[1].trim().split("\n").pop()!.trim(), m[2]]);
  }
  return out;
}

describe("duplicate declarations (a property is set at most once per block)", () => {
  it("never declares the same property twice in one rule", () => {
    // `.m-row` and `.m-chippill` each set font-size twice — the raw value won,
    // so every list row rendered at 15.2px while the token said 16. Nothing
    // about the output says which of the two you are looking at.
    const dupes: string[] = [];
    for (const [file, css] of appLayerCss()) {
      for (const [sel, body] of blocks(css)) {
        const seen = new Map<string, number>();
        for (const d of body.matchAll(/(^|;)\s*([a-z-]+)\s*:/g)) {
          seen.set(d[2], (seen.get(d[2]) ?? 0) + 1);
        }
        for (const [prop, n] of seen) if (n > 1) dupes.push(`${file} — ${sel}: ${prop} ×${n}`);
      }
    }
    expect(dupes, dupes.join("\n")).toEqual([]);
  });
});

describe("declared variables (no stylesheet reads a token nothing defines)", () => {
  it("resolves every var() against the token layer, a theme or code", () => {
    // `--m-radius-pill` was read three times and declared nowhere. An
    // unresolvable var() makes the whole declaration invalid at computed-value
    // time, so border-radius silently fell back to 0: the security tabs, the
    // loading "circle" and the step counter all rendered as rectangles. Same
    // family: --font-mono (the recovery code, a string a human copies group by
    // group, stood in the proportional UI face) and two invented callout names.
    const declared = new Set<string>();
    for (const f of [
      STYLE_FILES.ui, STYLE_FILES.tokens, STYLE_FILES.baseColors,
      STYLE_FILES.appCss, STYLE_FILES.mailCss, STYLE_FILES.baseCss, STYLE_FILES.mobileCss,
      ...themeFiles(),
    ]) {
      for (const m of sourceFile(f).matchAll(/(?:^|[;{])\s*(--[a-z0-9-]+)\s*:/gm)) {
        declared.add(m[1]);
      }
    }
    // Custom properties set from code as inline style (peek geometry, a
    // calendar's own colour) are declarations too — just not in a stylesheet.
    for (const { text } of codeSources()) {
      // `["--evt-color" as string]: …` is the same declaration with a cast.
      for (const m of text.matchAll(/["'](--[a-z0-9-]+)["'](?:\s+as\s+\w+)?\s*\]?\s*:/g)) {
        declared.add(m[1]);
      }
    }
    const missing: string[] = [];
    for (const [file, css] of appLayerCss()) {
      const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of clean.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
        // A var() WITH a fallback degrades on purpose; only a bare read breaks.
        // Slice from the SAME string the match came from — comment stripping
        // shifts every index.
        const next = clean.slice(m.index! + m[0].length).trimStart()[0];
        if (!declared.has(m[1]) && next !== ",") missing.push(`${file}: ${m[1]}`);
      }
    }
    expect([...new Set(missing)], [...new Set(missing)].join("\n")).toEqual([]);
  });
});

describe("touch targets (nothing tappable falls under the app's own minimum)", () => {
  it("keeps every interactive mobile rule at --touch-sm or larger", () => {
    // The plan counted eight targets under the 44px the app itself documents,
    // with no test. A hit area is not a matter of taste: below it the control
    // is a coin toss for anyone whose hands are not steady.
    const MIN = 44;
    const INTERACTIVE = /(^|[\s>+~])(button|a|\[role="(button|tab|switch|checkbox|radio|option|menuitem)"\])(?![\w-])/;
    const bad: string[] = [];
    for (const [sel, body] of blocks(sourceFile(STYLE_FILES.mobileCss))) {
      if (!INTERACTIVE.test(sel)) continue;
      for (const d of body.matchAll(/(^|[;{])\s*(min-height|height)\s*:\s*([0-9.]+)px/g)) {
        if (Number(d[3]) < MIN) bad.push(`${sel}: ${d[2]} ${d[3]}px (minimum ${MIN})`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});

describe("theme reach (every mobile surface can be re-themed)", () => {
  it("paints mobile surfaces from shared tokens, never from literals", () => {
    // The plan's finding was "2 of 14 themes know mobile". The cause is not a
    // missing theme selector — it is a literal: a hard colour or shadow takes a
    // surface out of EVERY theme's reach at once, and no theme file can win it
    // back. Painting through the shared tokens is what makes the other twelve
    // themes carry mobile for free; LCARS and Win95 dock on top only where
    // their shape language genuinely differs (bevels, Okuda bars) — that stays
    // a design decision, not something this guard can demand of 61 surfaces.
    const PAINT = /(^|[;{])\s*(background|background-color|color|border|border-[a-z]+|box-shadow)\s*:([^;]*)/g;
    const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;
    const offenders: string[] = [];
    for (const [sel, body] of blocks(sourceFile(STYLE_FILES.mobileCss))) {
      if (!/^\.m-/.test(sel)) continue;
      for (const d of body.matchAll(PAINT)) {
        if (LITERAL.test(d[3])) offenders.push(`${sel}: ${d[2]}:${d[3].trim()}`);
      }
    }
    expect(offenders, `paint through tokens so every theme reaches it:\n${offenders.join("\n")}`).toEqual([]);
  });
});

/** The docking matrix: top-level pv surfaces in ui.css. A surface must be
 * restyled by BOTH easter-egg themes or carry a visible exemption. */
const THEME_EXEMPT: Record<string, string> = {
  "pv-semantic-mode": "layout only — a placement class on a Segmented the themes already restyle",
  "pv-semantic-coverage": "layout only — --text-muted text, ghost Buttons and the .pv-security-progress track the themes restyle",
  "pv-semantic-coverage-actions": "layout only — see pv-semantic-coverage",
  "pv-semantic-note": "a text run in --text-muted; the themes override that token",
  "pv-semantic-choices": "layout only — Radio rows (.pv-checkrow) the themes already restyle",
  "pv-related": "layout only — a list of rows; its controls are IconButtons and ghost Buttons the themes restyle",
  "pv-ai-lens-trail": "layout only — a ghost Button the themes restyle",
  "pv-ai-lens-sensitive": "a text line in --warning-text beside ghost Buttons; the themes override that token",
  "pv-ai-overview-sensitive": "a text line in --warning-text beside a ghost Button; the themes override that token",
  "pv-ai-overview-hint": "a text line in --text-muted; the themes override that token",
  "pv-linecompare": "a pre block in tokens; its added and removed lines use --success-bg and --error-bg, which the themes override",
  "pv-skills": "layout only — SettingCards and Buttons the themes already restyle",
  "pv-skills-actions": "layout only — see pv-skills",
  "pv-skill-facts": "a definition list in --text-muted and --text-main; the themes override those tokens",
  "pv-skill-test-line": "a text line whose mark is toned in --success-text, --error-text or --text-muted; the themes override those tokens",
  "pv-related-row": "layout only — see pv-related",
  "pv-related-head": "layout only — see pv-related",
  "pv-related-main": "a placement class on a ghost Button the themes already restyle",
  "pv-related-title": "a text run in --text-main; the themes override that token",
  "pv-related-ctx": "a text run in --text-muted; the themes override that token",
  "pv-related-why": "a text block behind a --border-color rule; the themes override both tokens",
  "pv-related-quote": "a placement class on a ghost Button the themes already restyle (its label wraps)",
  "pv-related-facts": "a text run in --text-muted; the themes override that token",
  "pv-related-actions": "layout only — ghost Buttons the themes restyle",
  "pv-related-state": "a text line in --text-muted beside a ghost Button; the themes override that token",
  "pv-related-pause": "layout only — ghost Buttons the themes restyle",
  "pv-rulelist": "layout only — every visible part is a .pv-field/Select/IconButton the themes already restyle",
  "pv-rule": "layout only — see pv-rulelist",
  "pv-rule-from": "layout only — see pv-rulelist",
  "pv-rule-to": "layout only — see pv-rulelist",
  "pv-rule-arrow": "a → glyph in --text-faint; the themes override that token",
  "pv-palette-heading": "text row inside the palette, which is itself themed transitively",
  "pv-dot": "plain colored dot — inherits currentColor, nothing to theme",
  "pv-notepath": "text run — inherits the colour of whatever row it sits in",
  "pv-notepath-dir": "text run — see pv-notepath",
  "pv-notepath-file": "text run — see pv-notepath",
  "pv-setcontent": "scroll host of the settings pages — layout only, the pages carry every visible surface",
  "pv-qr-scanner": "camera surface — the --qr-* tokens are theme-invariant on purpose: a scan frame needs contrast against the room, not the theme",
  "pv-qr-video": "the camera stream itself — see pv-qr-scanner",
  "pv-qr-frame": "aiming frame in --qr-light — see pv-qr-scanner",
  "pv-qr-bar": "caption row over the stream — see pv-qr-scanner",
  "pv-qr-fallback": "camera-unavailable message over the same dark ground — see pv-qr-scanner",
  "pv-security-code-hidden": "hint row + a ghost Button; the text is --text-muted, which every theme overrides",
  "pv-placestamp": "layout only — one IconButton and a warning line, both of which every theme already restyles; the button carries no surface of its own",
  "pv-fixed-ghost": "positioning utility, no visual surface",
  "pv-click-catch": "invisible utility, no visual surface",
  "pv-overlay": "backdrop dim only — themes restyle the panels, not the dim",
  "pv-banner": "status colors come from the shared --error/--warning tokens the themes already override",
  "pv-searchfield": "field family — LCARS/Win95 restyle .pv-field and inputs generically",
  "pv-selecttrigger": "renders the .pv-field metric; panel is covered via .pv-popover overrides",
  "pv-fontpick": "layout only — a scroll host around .pv-grouprow rows, which the themes restyle; the hint is --text-muted",
  "pv-selectpanel": "popover contract — themes restyle .pv-popover/.pv-menu generically",
  "pv-selectsearch": "internal row of the select panel",
  "pv-selectopt": "menu-row grammar — themes restyle menu rows generically",
  "pv-checkrow": "label row around native inputs; accent-color is themed via tokens",
  "pv-check": "native checkbox/radio — accent-color token themes it",
  "pv-switch": "themed via --switch-knob + accent tokens (see high-contrast)",
  "pv-toast": "toast layer is deliberately theme-neutral chrome",
  "pv-tooltip": "tooltip layer is deliberately theme-neutral chrome",
  "pv-palette": "command palette: themed transitively via field/menu families",
  "pv-navlink": "settings nav rows follow accent-container tokens",
  "pv-setpage": "settings page scaffold (head/cards carry the theming)",
  "pv-setpages": "settings page stack wrapper, layout only",
  "pv-setrow": "rows inside .pv-setcard — the card carries the theme look",
  "pv-rowfield": "field family inside .pv-card — the card carries the theme look and LCARS/Win95 restyle .pv-field and inputs generically",
  "pv-rowfield-label": "text run inside .pv-rowfield — inherits the row's colour",
  "pv-rowfield-hint": "muted text run inside .pv-rowfield — same token as every other hint",
  "pv-rowfield-control": "layout only — the control inside is a themed .pv-field",
  "pv-taskacts": "layout-only rail of a task row (fixed slots + right-aligned trail); the controls inside are themed IconButtons and token-coloured chips",
  "pv-barlabel": "group heading inside .pv-setcard — typography on token colors, like the card's other rows",
  "pv-barrow": "rows inside .pv-setcard — the card carries the theme look; grip/eye are themed IconButtons",
  "pv-barfoot": "footer row inside .pv-setcard — the card carries the theme look, the actions are themed Buttons",
  "pv-vaultcard": "vault identity card follows the setcard tokens",
  "pv-linkbtn": "inline text link on accent tokens",
  "pv-titlebar-btn": "titlebar chrome follows the --titlebar-* tokens themes already set",
  "pv-winbtn--close": "titlebar chrome follows the --titlebar-* tokens",
  "pv-window-chrome-strip": "positioning strip, no visual surface",
  "pv-themecard": "theme preview cards paint their own swatches by design",
  "pv-swatches": "eight-slot colour grid of the custom theme, layout only",
  "pv-swatch": "colour discs are DATA (the hex each one offers); the pick ring and the hairline are --text-main/--border-color, which both themes already set",
  "pv-tab-close": "tab affordance — tab strips are themed via .tabstrip rules",
  "pv-tab-dirty": "accent dot on token colors",
  "pv-splitbtn": "composed of .pv-btn halves — the button rules carry the theme",
  "pv-empty": "empty states are typography on token colors (LCARS adds uppercase)",
  "pv-toasts": "toast stack container, layout only",
  "pv-selcol": "table cell that only sizes and reveals the Checkbox primitive inside it — that checkbox is what the themes restyle",
  "pv-bulkset": "layout on top of .pv-popover, which both themes already restyle — this class only sets flex, gap and a min-width",
  "pv-rowhover": "hover-state utility on --state-hover",
  "pv-cardhover": "hover-state utility on --state-hover",
  "pv-chips": "chip flow container, layout only",
  "pv-setgroup": "settings group wrapper, layout only",
  "pv-acct": "account rows inside .pv-setcard — the card carries the theme look",
  "pv-svcchip": "service chip on the themed accent-container pair",
  "pv-wizsteps": "wizard step header, layout only",
  "pv-taskmeta": "wrapping task metadata text, no surface; shared muted/warning tokens already follow every theme",
  "pv-wizstep": "step chips on token colors; active/done discs use the accent pair",
  "pv-svcline": "service rows inside .pv-setcard — setrow grammar, card carries the theme",
  "pv-svcstat": "status rows inside .pv-setcard on shared status tokens",
  "pv-cascade": "cascade-delete dialog scaffold — rows/badges live inside .pv-setcard on shared status/accent tokens the themes already override",
  "pv-dupes": "layout only — spaces the GroupCard/Row/Chip primitives of 'tasks that exist more than once' inside .pv-modal (desktop) and the phone sheet; every visible surface is one of those primitives, which both themes already restyle",
  "pv-security": "security page/hero scaffold — layout only (flex + gap), all colour comes from the cards and banners inside, which both themes already override",
  "pv-chain": "account-sync chain — steps live inside .pv-setcard and draw only from shared accent/status/border tokens both themes already override",
  "pv-sidecal": "layout only — the sidebar calendar's flex growth of the DateJumpTrigger and its week-number checkbox row; the trigger, the picker and the checkbox carry the theme",
  "pv-evt": "calendar event states: the fill/hatch/outline is derived from --evt-color (the calendar's own colour, i.e. DATA) plus --bg-primary/--text-main/--accent-on, which both themes already override — there is no theme-specific surface to restyle",
  "pv-filterrow": "layout only — a wrapping row of .pv-chip, which the themes restyle",
  "pv-resulthead": "text row above the hits — the label is --text-muted and the ✕ is a themed .pv-iconbtn",
  "pv-basesearch": "layout only — a .pv-searchfield plus the hit counter beside it; both are themed. The row under the head paints --bg-secondary and --border-color, which both themes override",
  "pv-evtdesc": "event description text (plan Befunde 24.09., E25): running text on --text-muted and link chips on --border-color/--bg-primary/--accent-color, all tokens both themes already override",
  "pv-evtjoin": "layout only — aligns the Join button; the button is a .pv-btn, which both themes restyle",
  "pv-pinentry": "layout only — the pinboard entry window's title field, editor host and line of inherited chips inside .pv-modal; the modal, the field tokens, the Chip primitive and the editor carry every theme",
};

describe("theme coverage (LCARS + Win95 dock onto every pv surface)", () => {
  it("each top-level pv surface is themed by both easter eggs or exempted", () => {
    const ui = sourceFile(STYLE_FILES.ui).replace(/\/\*[\s\S]*?\*\//g, "");
    const lcars = sourceFile(`${THEME_DIR}/lcars.css`);
    const win95 = sourceFile(`${THEME_DIR}/win95.css`);
    // Top-level surface = a class selector starting a block at nesting depth
    // 0 whose FIRST class is a simple `pv-name` (modifiers/sub-elements like
    // pv-btn--sm or pv-modal-header belong to their parent surface).
    const surfaces = new Set<string>();
    for (const m of ui.matchAll(/(^|\n)\s*\.(pv-[a-z]+)(?=[\s{,:.[])/g)) {
      surfaces.add(m[2]);
    }
    const uncovered: string[] = [];
    for (const s of surfaces) {
      if (THEME_EXEMPT[s]) continue;
      const inLcars = lcars.includes(`.${s}`);
      const inWin95 = win95.includes(`.${s}`);
      if (!inLcars || !inWin95) {
        uncovered.push(`${s} (lcars: ${inLcars ? "yes" : "NO"}, win95: ${inWin95 ? "yes" : "NO"})`);
      }
    }
    expect(uncovered, `add theme selectors or a justified THEME_EXEMPT entry:\n${uncovered.join("\n")}`).toEqual([]);
  });

  it("keeps the exemption list honest (no stale entries)", () => {
    const ui = sourceFile(STYLE_FILES.ui);
    const stale = Object.keys(THEME_EXEMPT).filter((s) => !ui.includes(`.${s}`));
    expect(stale, `remove stale THEME_EXEMPT entries: ${stale.join(", ")}`).toEqual([]);
  });
});
