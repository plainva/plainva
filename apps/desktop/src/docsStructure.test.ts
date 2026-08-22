import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The user guide exists in ten languages with identical file names, and
 * docsParity.test.ts holds THAT together — it compares file LISTS. What it
 * cannot see is a page that lost a paragraph, a bullet or a whole section in
 * some languages while keeping its name: eight of the ten are produced by
 * machine and two are maintained by hand, so drift appears exactly where a
 * hand round touches one page.
 *
 * Three findings from the first run make the case better than an argument:
 *  - the "Experimental" caveat on the calendar page was missing in four
 *    languages — a warning about real external accounts that those readers
 *    never saw;
 *  - a whole paragraph about vault slices and sanitized projections was
 *    missing in eight;
 *  - a bullet in Import.md existed in all ten but sat at the END of four
 *    files instead of inside its list, left there by an abandoned run. The
 *    line count was identical, which is why nothing had caught it.
 *
 * WHAT IT COMPARES, AND WHAT IT DELIBERATELY DOES NOT
 * The STRUCTURE of each page: the sequence and depth of its headings, and how
 * many list items, table rows and paragraphs sit under each one. Never the
 * text — comparing text would be comparing translations, and no assertion can
 * do that. A missing paragraph therefore shows up like a missing file.
 *
 * The majority is used to LOCATE the difference, not to decide who is right:
 * in README.md the two hand-written languages are the minority and correct.
 * That is what the exception list is for.
 */

const userDocs = resolve(__dirname, "../../../docs/user");

type Block = { heading: string; level: number; items: number; rows: number; paras: number };

/** Exported for the fixture tests at the bottom — they are the red
 *  counter-check for this parser, kept instead of run once by hand. */
export function pageStructure(md: string): Block[] {
  const out: Block[] = [];
  let fence: string | null = null;
  let current: Block = { heading: "(top)", level: 0, items: 0, rows: 0, paras: 0 };
  let inPara = false;

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();

    // Fenced code first: a "#" or "- " inside a sample must not read as structure.
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0].repeat(3);
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      inPara = false;
      continue;
    }
    if (fence !== null) continue;

    const heading = line.match(/^(#{1,6})\s+/);
    if (heading) {
      out.push(current);
      current = { heading: line.replace(/^#+\s+/, ""), level: heading[1].length, items: 0, rows: 0, paras: 0 };
      inPara = false;
      continue;
    }

    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      current.items += 1;
      inPara = false;
    } else if (/^\s*\|.*\|\s*$/.test(line)) {
      // A table row. The |---|---| separator is neither a row nor a paragraph —
      // it has to be caught HERE, because falling through would count it as one.
      if (!/^\s*\|[\s:|-]+\|\s*$/.test(line)) current.rows += 1;
      inPara = false;
    } else if (line.trim() === "") {
      inPara = false;
    } else if (!inPara) {
      // A paragraph counts once, however many lines it wraps over. A block
      // quote counts as one too — which is how the missing caveat surfaced.
      current.paras += 1;
      inPara = true;
    }
  }
  out.push(current);
  return out;
}

const sigOf = (b: Block) => `h${b.level}:${b.items}i/${b.rows}r/${b.paras}p`;
const signature = (blocks: Block[]) => blocks.map(sigOf).join(" ");

/**
 * Deliberate structural differences. Each needs a real reason: a page that
 * simply drifted does NOT belong here, it belongs fixed.
 */
const EXCEPTIONS: Array<{ page: string; languages: string[]; reason: string }> = [
  {
    page: "README.md",
    languages: ["de", "en"],
    reason:
      "The eight machine-translated guides carry a one-line notice saying so; de and en are " +
      "written by hand and do not. That notice is a deliberate piece of honesty towards the " +
      "reader, so here the two hand-written languages are the minority on purpose.",
  },
];

const languages = readdirSync(userDocs, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const pages = readdirSync(resolve(userDocs, "en")).filter((f) => f.endsWith(".md"));

const structureOf = (lang: string, page: string) =>
  pageStructure(readFileSync(resolve(userDocs, lang, page), "utf8"));

function majoritySignature(page: string): string {
  const votes = new Map<string, number>();
  for (const lang of languages) {
    const sig = signature(structureOf(lang, page));
    votes.set(sig, (votes.get(sig) ?? 0) + 1);
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0][0];
}

describe("user guide structure", () => {
  it("has ten languages and pages to compare", () => {
    // Without this the loops below could pass by checking nothing.
    expect(languages.length).toBeGreaterThanOrEqual(10);
    expect(pages.length).toBeGreaterThanOrEqual(20);
  });

  it("every exception carries a real reason", () => {
    for (const e of EXCEPTIONS) {
      expect(e.languages.length, `${e.page}: an exception without languages exempts nothing`).toBeGreaterThan(0);
      expect(e.reason.trim().length, `${e.page}: the reason is too short to be one`).toBeGreaterThan(40);
      expect(
        /\b(tbd|todo|fixme|later|xxx|placeholder)\b/i.test(e.reason),
        `${e.page}: that reason is a placeholder, not a reason`,
      ).toBe(false);
    }
  });

  it("each page has the same structure in all ten languages", () => {
    const problems: string[] = [];

    for (const page of pages) {
      const structures = new Map(languages.map((lang) => [lang, structureOf(lang, page)]));
      const majority = majoritySignature(page);
      if ([...structures.values()].every((b) => signature(b) === majority)) continue;

      const reference = [...structures.values()].find((b) => signature(b) === majority)!;
      const exempt = new Set(EXCEPTIONS.filter((e) => e.page === page).flatMap((e) => e.languages));

      for (const [lang, blocks] of structures) {
        if (signature(blocks) === majority || exempt.has(lang)) continue;
        const at = reference.findIndex((b, i) => !blocks[i] || sigOf(b) !== sigOf(blocks[i]));
        const r = reference[at];
        const g = blocks[at];
        problems.push(
          `${page} [${lang}]: first difference at block #${at} — ` +
            `others have ${sigOf(r)} "${r?.heading.slice(0, 40)}", ` +
            `${lang} has ${g ? `${sigOf(g)} "${g.heading.slice(0, 40)}"` : "nothing (the page ends)"}`,
        );
      }
    }

    expect(
      problems,
      `A page drifted apart between languages. i = list items, r = table rows, p = paragraphs.\n  ` +
        problems.join("\n  ") +
        `\nFix the page, or — if the difference is deliberate — add it to EXCEPTIONS with a reason.`,
    ).toEqual([]);
  });

  it("no exception is left over once the page agrees again", () => {
    // An exception list nobody prunes rots into a list of things that used to
    // be true. featureParity.ts refuses a closed gap for the same reason.
    const stale: string[] = [];
    for (const e of EXCEPTIONS) {
      const majority = majoritySignature(e.page);
      for (const lang of e.languages) {
        if (signature(structureOf(lang, e.page)) === majority) {
          stale.push(`${e.page} [${lang}] matches the others again — remove the exception`);
        }
      }
    }
    expect(stale, stale.join("\n  ")).toEqual([]);
  });
});

describe("user guide structure — the parser itself", () => {
  // The assertions above are only worth their runtime if the parser sees what
  // it claims to see. These fixtures are the red counter-check, kept.
  it("counts headings, bullets, table rows and paragraphs", () => {
    const md = [
      "# Title",
      "",
      "Intro text",
      "spanning two lines.",
      "",
      "## Section",
      "",
      "- one",
      "- two",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    // Two rows: the header row and the data row. The |---|---| separator is
    // neither — it counted as a paragraph until this fixture caught it.
    expect(pageStructure(md).map(sigOf)).toEqual(["h0:0i/0r/0p", "h1:0i/0r/1p", "h2:2i/2r/0p"]);
  });

  it("sees a block quote as a paragraph — that is how the missing caveat surfaced", () => {
    const withCaveat = ["# T", "", "Intro.", "", "> **Experimental.** Careful.", ""].join("\n");
    const without = ["# T", "", "Intro.", ""].join("\n");
    expect(signature(pageStructure(withCaveat))).not.toBe(signature(pageStructure(without)));
  });

  it("ignores markdown inside fenced code", () => {
    const md = ["# T", "", "```", "# not a heading", "- not a bullet", "```", ""].join("\n");
    expect(pageStructure(md).map(sigOf)).toEqual(["h0:0i/0r/0p", "h1:0i/0r/0p"]);
  });

  it("notices a bullet that moved out of its list", () => {
    // The Import.md case: same words, same line count, wrong place.
    const correct = ["## Limits", "", "- a", "- b", "", "## Related", "", "- link"].join("\n");
    const moved = ["## Limits", "", "- a", "", "## Related", "", "- link", "- b"].join("\n");
    expect(signature(pageStructure(correct))).not.toBe(signature(pageStructure(moved)));
  });
});
