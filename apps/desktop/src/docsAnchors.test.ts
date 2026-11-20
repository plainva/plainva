import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A link from one handbook page to a heading — `File_Format_Reference.md#databases-base`, or
 * `#some-heading` inside a page — names the heading by its SLUG, and a slug is made from the
 * heading's own words. The handbook is translated, so the same heading has a different slug in every
 * language: `databases-base` in English, `datenbanken-base` in German, `数据库base` in Chinese.
 *
 * What went wrong: `Automation_and_Scripts.md` linked to `File_Format_Reference.md#databases-base`,
 * and eight of the ten translations kept the ENGLISH slug. The link went to the right page and
 * silently to no heading at all, on plainva.com and on GitHub alike. `docsParity` (file lists),
 * `docsStructure` (headings, items, rows, paragraphs) and `docsLinks` (the app's own help links) cannot
 * see it: none of them reads a link.
 *
 * WHAT IT CHECKS: every link of the form `Page.md#slug` or `#slug` in every language folder. The
 * target page must exist in the same folder and carry a heading whose slug is the link's anchor.
 * WHAT IT DOES NOT: links without an anchor, links to anything but a handbook page, and the text of a
 * link — nothing here compares translations.
 *
 * The slug rule is the one the website builds with (GitHub's: lower case, punctuation and symbols
 * removed, blanks to hyphens, a repeated heading numbered `-1`, `-2` — and one hyphen at the end cut
 * off, which is why "Qu'est-ce qui part ?" is `quest-ce-qui-part`). It was compared with the ids of
 * all 310 built handbook pages when this test was written: not one heading differed. A page's own
 * title (the `#` line) is no anchor on the website, so only headings of level two and below count.
 */

const userDocs = resolve(__dirname, "../../../docs/user");

/** The text of a heading as it reads once rendered: no markup, only the words. */
function headingText(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/** GitHub's slug of a heading's words. */
export function slugOf(words: string): string {
  return words
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-")
    .replace(/-$/, "");
}

/** Lines outside fenced code, with their text. */
function proseLines(md: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const marker = raw.match(/^\s*(```+|~~~+)/)?.[1]?.[0];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence === null) out.push(raw);
  }
  return out;
}

/** The slugs of a page's headings, a repeated one numbered the way the website numbers it. */
export function headingSlugs(md: string): Set<string> {
  const seen = new Map<string, number>();
  const slugs = new Set<string>();
  for (const line of proseLines(md)) {
    const heading = line.match(/^#{2,6}\s+(.+?)\s*$/);
    if (!heading) continue;
    const base = slugOf(headingText(heading[1]));
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

type Anchor = { page: string | null; slug: string; link: string };

/** Every `Page.md#slug` and `#slug` link of a page (links in code spans and fences are samples, not links). */
export function anchorLinks(md: string): Anchor[] {
  const out: Anchor[] = [];
  for (const line of proseLines(md)) {
    const text = line.replace(/`[^`]*`/g, "");
    for (const match of text.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      const hash = target.match(/^(?:([A-Za-z0-9_-]+\.md))?#(.+)$/);
      if (!hash) continue;
      let slug = hash[2];
      try {
        slug = decodeURIComponent(slug);
      } catch {
        // an anchor that is not percent-encoded text stays as written
      }
      out.push({ page: hash[1] ?? null, slug, link: target });
    }
  }
  return out;
}

/** What is wrong with the anchors of a set of pages (file name → text), one line each. */
export function anchorFailures(pages: Record<string, string>): string[] {
  const slugs = new Map<string, Set<string>>();
  const slugsOf = (file: string) => {
    let known = slugs.get(file);
    if (!known) slugs.set(file, (known = headingSlugs(pages[file])));
    return known;
  };
  const failures: string[] = [];
  for (const [file, md] of Object.entries(pages)) {
    for (const { page, slug, link } of anchorLinks(md)) {
      const target = page ?? file;
      if (!(target in pages)) {
        failures.push(`${file}: ${link} — ${target} is not a page of this language`);
      } else if (!slugsOf(target).has(slug)) {
        failures.push(`${file}: ${link} — ${target} has no heading with the slug "${slug}"`);
      }
    }
  }
  return failures;
}

describe("docsAnchors", () => {
  it("every anchor link of every language names a heading of its own language", () => {
    const failures: string[] = [];
    const langs = readdirSync(userDocs, { withFileTypes: true }).filter((e) => e.isDirectory());
    expect(langs.length).toBeGreaterThan(1);
    for (const lang of langs) {
      const dir = resolve(userDocs, lang.name);
      const pages: Record<string, string> = {};
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) pages[file] = readFileSync(resolve(dir, file), "utf8");
      for (const failure of anchorFailures(pages)) failures.push(`${lang.name}/${failure}`);
    }
    expect(failures).toEqual([]);
  });

  // The red counter-check, kept instead of run once by hand: the parser below is what the test above stands on.
  describe("the reader", () => {
    it("makes the slug of a heading the way the website does, in every script the handbook uses", () => {
      expect(slugOf(headingText("Databases (`.base`)"))).toBe("databases-base");
      expect(slugOf(headingText("Bases de données (`.base`)"))).toBe("bases-de-données-base");
      expect(slugOf(headingText("データベース (`.base`)"))).toBe("データベース-base");
      expect(slugOf(headingText("数据库（`.base`）"))).toBe("数据库base");
      expect(slugOf(headingText("Header color / Icon / Tags · whole note"))).toBe("header-color--icon--tags--whole-note");
      expect(slugOf(headingText("**Bold** and [a link](x.md) ##"))).toBe("bold-and-a-link");
      // The website cuts one hyphen at the end: a blank before a question mark leaves none.
      expect(slugOf(headingText("Qu'est-ce qui part ?"))).toBe("quest-ce-qui-part");
      expect(slugOf(headingText("Pourquoi X (Proton, Drive …) ?"))).toBe("pourquoi-x-proton-drive-");
    });

    it("numbers a repeated heading and skips fenced code", () => {
      const md = ["# Title", "## Same", "## Same", "```", "## Not a heading", "```"].join("\n");
      // The title is no anchor of the website; a repeated heading is numbered.
      expect([...headingSlugs(md)]).toEqual(["same", "same-1"]);
    });

    it("finds page and in-page anchors, but not a sample in code or a link without an anchor", () => {
      const md = ["[a](Other.md#x) and [b](#y) and [c](Other.md) and `[d](Other.md#z)`", "```", "[e](#w)", "```"].join("\n");
      expect(anchorLinks(md).map((a) => `${a.page ?? ""}#${a.slug}`)).toEqual(["Other.md#x", "#y"]);
    });

    it("rejects the English slug in a German page, the incident this test exists for", () => {
      const pages = {
        "File_Format_Reference.md": "## Datenbanken (`.base`)\n",
        "Automation_and_Scripts.md": "Siehe [Datenbanken](File_Format_Reference.md#databases-base).\n",
      };
      expect(anchorFailures(pages)).toEqual([
        'Automation_and_Scripts.md: File_Format_Reference.md#databases-base — File_Format_Reference.md has no heading with the slug "databases-base"',
      ]);
      pages["Automation_and_Scripts.md"] = "Siehe [Datenbanken](File_Format_Reference.md#datenbanken-base).\n";
      expect(anchorFailures(pages)).toEqual([]);
    });
  });
});
