import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// User-guide parity guard (plan Nutzerhandbuch 2026-07-04): docs/user/ holds one
// folder per language (de/, en/, ...) and every language folder must carry the
// exact same file names — only the contents are translated. Without this, a page
// added in one language silently goes missing in the others and the language
// switch on a future docs site would 404. Content drift is NOT covered here;
// keeping translations in sync is a workflow duty (see CONTRIBUTING.md).

const DOCS_USER = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "user");

function languageDirs(): string[] {
  return readdirSync(DOCS_USER).filter((entry) => statSync(join(DOCS_USER, entry)).isDirectory()).sort();
}

function pagesOf(lang: string): string[] {
  return readdirSync(join(DOCS_USER, lang)).filter((f) => f.endsWith(".md")).sort();
}

describe("user guide language parity", () => {
  const langs = languageDirs();

  it("has at least the de and en guides", () => {
    expect(langs).toContain("de");
    expect(langs).toContain("en");
  });

  it("every language folder contains the same pages", () => {
    const reference = pagesOf(langs[0]);
    expect(reference.length).toBeGreaterThan(5); // sanity: the guide actually has pages
    for (const lang of langs.slice(1)) {
      expect({ lang, pages: pagesOf(lang) }).toEqual({ lang, pages: reference });
    }
  });
});
