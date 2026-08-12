import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One app bar grammar, and a palette that shows what it already knows (S19).
 *
 * The header over a working surface existed three times as an inline recipe:
 * the editor at 8/16 with `--border-color`, the base at 12/16 with the same,
 * the calendar at 8/12 with `--border-color-light`. Moving between an editor
 * and a database shifted the content line and changed the weight of the rule
 * above it — and no theme could reach any of it, because an inline style beats
 * a theme selector.
 *
 * The palette is the other half: the shared registry has carried `group` and
 * `icon` since the phone started using it (the phone renders both), while the
 * desktop listed 39 commands as one undifferentiated run.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
const UI_CSS = join(SRC, "..", "..", "..", "packages", "ui", "src", "styles", "ui.css");
const THEMES = join(SRC, "..", "..", "..", "packages", "ui", "src", "themes");
const LOCALES = join(SRC, "..", "..", "..", "packages", "ui", "src", "locales");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("one app bar grammar", () => {
  it("defines the bar once, from tokens", () => {
    const css = readFileSync(UI_CSS, "utf8");
    const block = css.slice(css.indexOf(".pv-appbar {"), css.indexOf("}", css.indexOf(".pv-appbar {")));
    expect(block).toMatch(/padding:\s*var\(--space-2\) var\(--space-3\)/);
    expect(block).toMatch(/border-bottom:\s*1px solid var\(--border-color-light\)/);
  });

  /**
   * How many elements in a file still spell a header for themselves: an inline
   * `padding` TOGETHER WITH an inline `borderBottom`. The three remaining ones
   * are banners in the editor (a read-only notice, two conflict warnings) —
   * they are notices over the document, not the bar above it. The numbers only
   * ever go down; a fourth header idiom fails this.
   */
  const INLINE_HEADERS: Array<[name: string, parts: string[], budget: number]> = [
    ["Editor", ["components", "Editor.tsx"], 3],
    ["BaseViewer", ["components", "BaseViewer.tsx"], 0],
    ["CalendarView", ["components", "pimcal", "CalendarView.tsx"], 0],
  ];

  for (const [file, parts, budget] of INLINE_HEADERS) {
    it(`${file} wears the bar instead of its own recipe`, () => {
      const text = strip(read(...parts));
      expect(text, `${file} does not use the shared bar`).toMatch(/className="[^"]*pv-appbar/);
      const spelled = [...text.matchAll(/<div\b[^>]*>/gs)].filter(
        (m) => m[0].includes("borderBottom") && m[0].includes("padding"),
      ).length;
      expect(spelled, `${file}: ${spelled} element(s) spell a header inline, budget ${budget}`).toBeLessThanOrEqual(budget);
    });
  }

  it("is reachable by both easter-egg themes", () => {
    // The reason the grammar is worth having: LCARS paints a colour block where
    // a surface begins and Win95 draws a bevel — neither can touch an inline
    // style. `designGuards` enforces the rule; this names the intent.
    expect(readFileSync(join(THEMES, "lcars.css"), "utf8")).toMatch(/\.pv-appbar\b/);
    expect(readFileSync(join(THEMES, "win95.css"), "utf8")).toMatch(/\.pv-appbar\b/);
  });

  it("leaves the mail toolbar its own tint, on purpose", () => {
    // `.pv-mail-toolbar` is an action bar OVER A LIST, not a header over a
    // document: it carries its own container surface and wraps. Named here so
    // the exception stays a decision.
    expect(read("components", "mail", "mail.css")).toMatch(/\.pv-mail-toolbar \{[^}]*surface-container-low/s);
  });
});

describe("the command palette shows the vocabulary it has", () => {
  it("renders the registry's groups and icons", () => {
    const text = strip(read("components", "CommandPalette.tsx"));
    expect(text).toMatch(/COMMAND_GROUPS/);
    expect(text).toMatch(/pv-menu-label/);
    expect(text).toMatch(/const Icon = c\.icon/);
  });

  it("indexes what the eye sees, not what the filter returned", () => {
    // Measured in a browser before it was believed: indexing the FILTERED
    // array while rendering in group order put the initial highlight on row 19
    // and made the first arrow-down jump to the top. The selection runs over
    // the flattened rendered sequence, and both the arrows and the click use
    // that same array.
    const text = strip(read("components", "CommandPalette.tsx"));
    expect(text).toMatch(/const ordered = useMemo\(\(\) => groups\.flatMap/);
    expect(text).toMatch(/ordered\.length - 1/);
    expect(text).toMatch(/const c = ordered\[selected\]/);
    expect(text, "the rendered row must take its index from the rendered order").toMatch(
      /const i = ordered\.indexOf\(c\)/,
    );
  });

  it("names every group in every language", () => {
    for (const lang of ["en", "de", "fr", "es", "it", "nl", "pl", "pt-BR", "ja", "zh-CN"]) {
      const dict = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8")) as {
        palette: { group?: Record<string, string> };
      };
      for (const g of ["create", "open", "note", "view", "vault", "app"]) {
        expect(dict.palette.group?.[g], `${lang} lacks palette.group.${g}`).toBeTruthy();
      }
    }
  });
});
