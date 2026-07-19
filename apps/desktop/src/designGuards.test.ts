import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(SRC, "../../..");

const STYLE_FILES = {
  ui: join(REPO, "packages/ui/src/styles/ui.css"),
  tokens: join(REPO, "packages/ui/src/styles/tokens.css"),
  baseColors: join(REPO, "packages/ui/src/styles/base-colors.css"),
  appCss: join(SRC, "App.css"),
  mailCss: join(SRC, "components/mail/mail.css"),
  mobileCss: join(REPO, "apps/mobile/src/mobile.css"),
};
const THEME_DIR = join(REPO, "packages/ui/src/themes");

const CODE_ROOTS = [
  join(SRC, "components"),
  join(SRC, "services"),
  join(REPO, "packages/ui/src/components"),
  join(REPO, "packages/ui/src/base"),
  join(REPO, "apps/mobile/src"),
];
const CODE_FILES = [join(SRC, "App.tsx"), join(SRC, "main.tsx")];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "android" || name === "ios" || name === "dist") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function allStylesheets(): string[] {
  const files = Object.values(STYLE_FILES).map((p) => readFileSync(p, "utf8"));
  for (const name of readdirSync(THEME_DIR)) {
    if (name.endsWith(".css")) files.push(readFileSync(join(THEME_DIR, name), "utf8"));
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
  const files = [...CODE_FILES];
  for (const root of CODE_ROOTS) walk(root, files);
  for (const f of files) sources.push(readFileSync(f, "utf8"));
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
  const files = [...CODE_FILES];
  for (const root of CODE_ROOTS) walk(root, files);
  for (const file of files) {
    const src = readFileSync(file, "utf8");
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
      ["ui.css", "both", readFileSync(STYLE_FILES.ui, "utf8")],
      ["App.css", "desktop", readFileSync(STYLE_FILES.appCss, "utf8")],
      ["mail.css", "desktop", readFileSync(STYLE_FILES.mailCss, "utf8")],
      ["mobile.css", "mobile", readFileSync(STYLE_FILES.mobileCss, "utf8")],
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

/** The docking matrix: top-level pv surfaces in ui.css. A surface must be
 * restyled by BOTH easter-egg themes or carry a visible exemption. */
const THEME_EXEMPT: Record<string, string> = {
  "pv-dot": "plain colored dot — inherits currentColor, nothing to theme",
  "pv-fixed-ghost": "positioning utility, no visual surface",
  "pv-click-catch": "invisible utility, no visual surface",
  "pv-overlay": "backdrop dim only — themes restyle the panels, not the dim",
  "pv-banner": "status colors come from the shared --error/--warning tokens the themes already override",
  "pv-searchfield": "field family — LCARS/Win95 restyle .pv-field and inputs generically",
  "pv-selecttrigger": "renders the .pv-field metric; panel is covered via .pv-popover overrides",
  "pv-selectpanel": "popover contract — themes restyle .pv-popover/.pv-menu generically",
  "pv-selectsearch": "internal row of the select panel",
  "pv-selectopt": "menu-row grammar — themes restyle menu rows generically",
  "pv-checkrow": "label row around native inputs; accent-color is themed via tokens",
  "pv-check": "native checkbox/radio — accent-color token themes it",
  "pv-switch": "themed via --switch-knob + accent tokens (see high-contrast)",
  "pv-badge": "count badge on token colors",
  "pv-toast": "toast layer is deliberately theme-neutral chrome",
  "pv-tooltip": "tooltip layer is deliberately theme-neutral chrome",
  "pv-palette": "command palette: themed transitively via field/menu families",
  "pv-navlink": "settings nav rows follow accent-container tokens",
  "pv-setpage": "settings page scaffold (head/cards carry the theming)",
  "pv-setpages": "settings page stack wrapper, layout only",
  "pv-setrow": "rows inside .pv-setcard — the card carries the theme look",
  "pv-vaultcard": "vault identity card follows the setcard tokens",
  "pv-linkbtn": "inline text link on accent tokens",
  "pv-titlebar-btn": "titlebar chrome follows the --titlebar-* tokens themes already set",
  "pv-winbtn--close": "titlebar chrome follows the --titlebar-* tokens",
  "pv-window-chrome-strip": "positioning strip, no visual surface",
  "pv-themecard": "theme preview cards paint their own swatches by design",
  "pv-tab-close": "tab affordance — tab strips are themed via .tabstrip rules",
  "pv-tab-dirty": "accent dot on token colors",
  "pv-splitbtn": "composed of .pv-btn halves — the button rules carry the theme",
  "pv-empty": "empty states are typography on token colors (LCARS adds uppercase)",
  "pv-toasts": "toast stack container, layout only",
  "pv-rowhover": "hover-state utility on --state-hover",
  "pv-cardhover": "hover-state utility on --state-hover",
  "pv-chips": "chip flow container, layout only",
  "pv-setgroup": "settings group wrapper, layout only",
};

describe("theme coverage (LCARS + Win95 dock onto every pv surface)", () => {
  it("each top-level pv surface is themed by both easter eggs or exempted", () => {
    const ui = readFileSync(STYLE_FILES.ui, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const lcars = readFileSync(join(THEME_DIR, "lcars.css"), "utf8");
    const win95 = readFileSync(join(THEME_DIR, "win95.css"), "utf8");
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
    const ui = readFileSync(STYLE_FILES.ui, "utf8");
    const stale = Object.keys(THEME_EXEMPT).filter((s) => !ui.includes(`.${s}`));
    expect(stale, `remove stale THEME_EXEMPT entries: ${stale.join(", ")}`).toEqual([]);
  });
});
