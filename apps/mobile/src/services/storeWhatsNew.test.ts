import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- a plain ESM script without types; the build pipeline runs it as-is.
import { buildAll, buildNote, parseCatalog, PLAY_LIMIT, PLAY_LOCALES } from "../../scripts/store-whatsnew.mjs";

/**
 * The store notes (Play "What's new", TestFlight "What to Test") are derived
 * from the catalog and the locales, never written by hand. What is pinned
 * here: the parser reads the FIRST entry and its experimental flags, the note
 * is title lines only, and the real ten locales fit Play's limit right now —
 * so a release that adds a long title fails at commit time, not at upload.
 */

const repoRoot = join(__dirname, "../../../..");
const catalogSource = readFileSync(join(repoRoot, "packages/ui/src/lib/whatsNew.ts"), "utf8");
const readLocale = (lang: string) =>
  JSON.parse(readFileSync(join(repoRoot, `packages/ui/src/locales/${lang}.json`), "utf8")) as {
    whatsNew?: Record<string, string>;
  };

describe("parseCatalog", () => {
  it("reads version and experimental flags of the first entry only", () => {
    const src = `
      export const WHATS_NEW_CATALOG = [
        { version: "9.9.9", releaseDate: "2030-01-01", highlights: [
          { icon: "a" },
          // a comment between entries
          { icon: "b", experimental: true },
          { icon: "c" },
        ] },
        { version: "1.0.0", releaseDate: "2020-01-01", highlights: [ { icon: "x", experimental: true } ] },
      ];`;
    expect(parseCatalog(src)).toEqual({
      version: "9.9.9",
      highlights: [{ experimental: false }, { experimental: true }, { experimental: false }],
    });
  });
});

describe("buildNote", () => {
  const strings = {
    experimental: "Experimental",
    highlight1Title: "One",
    highlight2Title: "Two",
  };
  it("is the version, one title line per highlight with the pill, and the blog address", () => {
    const note = buildNote({
      lang: "en",
      version: "0.8.1",
      highlights: [{ experimental: false }, { experimental: true }],
      strings,
      blogUrl: "https://plainva.com/blog/plainva-0-8-1",
    });
    expect(note).toBe("Plainva 0.8.1\n• One\n• Two (Experimental)\nplainva.com/blog/plainva-0-8-1");
  });

  it("points German readers at the German post", () => {
    const note = buildNote({ lang: "de", version: "0.8.1", highlights: [{ experimental: false }], strings, blogUrl: "https://plainva.com/blog/plainva-0-8-1" });
    expect(note.endsWith("plainva.com/de/blog/plainva-0-8-1")).toBe(true);
  });

  it("refuses a highlight the locale has no title for", () => {
    expect(() =>
      buildNote({ lang: "fr", version: "0.8.1", highlights: [{ experimental: false }, { experimental: false }, { experimental: false }], strings }),
    ).toThrow(/highlight3Title/);
  });

  it("does not invent a blog URL for a release without a post", () => {
    expect(buildNote({ lang:"de", version:"0.6.4", highlights:[{}], strings })).toBe("Plainva 0.6.4\n• One");
  });
});

describe("the real catalog and locales", () => {
  it("produce a note under Play's limit for all ten languages", () => {
    const { notes } = buildAll({ catalogSource, readLocale });
    expect(Object.keys(notes).sort()).toEqual(Object.values(PLAY_LOCALES).sort());
    for (const [locale, note] of Object.entries(notes)) {
      expect([...(note as string)].length, locale).toBeLessThanOrEqual(PLAY_LIMIT);
    }
    expect(notes["fr-FR"]).toContain("plainva.com/fr/blog/");
    expect(notes["pt-BR"]).toContain("plainva.com/pt-BR/blog/");
  });
});
