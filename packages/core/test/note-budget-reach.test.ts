import { afterAll, describe, expect, it } from "vitest";
import { DESKTOP_NOTE_BUDGET, NOTE_BUDGET, readAsTextParts, setNoteBudget, type BoundedRange } from "../src/inlineParseBudget.ts";
import { parseMarkdownAst } from "../src/markdown-parser.ts";
import { extractLinksAndTags } from "../src/ast-scanner.ts";
import { readNoteLinks, renameNoteLinks } from "../src/linkRewrite.ts";
import { convertWikilinksToMarkdownLinks } from "../src/okf-index.ts";

/**
 * Notes over their budget in which a part read alone does not see a
 * definition of the note (review of L14, 2026-11-26, round two): a byte order
 * mark without a properties block, a label over two lines of a quote, a link
 * label `[ ^x]`, a reference in a link's text, a wiki link in a reference's
 * text, definitions in a part not read over three lines and over 4 096
 * characters, a footnote before a note that begins indented. Each made a
 * rename write into text the note read whole has no link in, or lose a link
 * without a word. Read by the rule of `definitionReach.ts`, each such place is
 * not read: no link of the index the note read whole does not have, no
 * rename there, and every link the note read whole has stands either at the
 * same place with the same facts or in what is not read — which a rename
 * counts and the notice names.
 */

afterAll(() => setNoteBudget(NOTE_BUDGET));

const SECONDS = 1000;
// Renames of names as long as the old ones: every place stays where it is, the readings compare by place.
const RENAMES = new Map([
  ["x.md", "y.md"],
  ["A", "B"],
]);

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
/** A heavy unit that is read as text in pieces: sixty lines of inline syntax with wiki links. */
const heavy = (k: number) => Array.from({ length: 60 }, (_, i) => `**b${i}** _c_ \`d\` [[Other${k}-${i}]] <e> &amp; ~~s~~ words to read here`).join("\n");
/** A list under one item: not cut, not read. */
const longList = (items: number, inner: string) => `- top\n${Array.from({ length: items }, (_, i) => (i === 7 ? inner : `  - item ${i} [[L${i}]] words`)).join("\n")}`;

type Shell = "phone" | "desktop";
const many = (shell: Shell, phone: number) => (shell === "phone" ? phone : 4 * phone);
function heavyNote(count: number, definition: string, light: string, options: { pre?: string; lightFirst?: boolean } = {}): string {
  const blocks = Array.from({ length: count }, (_, k) => heavy(k));
  blocks.splice(3, 0, definition);
  const body = options.lightFirst ? `${light}\n\n${blocks.join("\n\n")}` : `# Title\n\n${blocks.join("\n\n")}\n\n${light}`;
  return `${options.pre ?? ""}${body}\n`;
}

const NOTES: Record<string, { shells: Shell[]; make: (shell: Shell) => string }> = {
  "a byte order mark and no properties block": { shells: ["phone", "desktop"], make: (s) => heavyNote(many(s, 170), `[bar]: def.md "${words(3000)}"`, "See [foo][bar](x.md) here.", { pre: "﻿" }) },
  "a label over two lines of a quote, formatted": { shells: ["phone"], make: (s) => heavyNote(many(s, 170), `[a b]: def.md "${words(3000)}"`, "> See [foo][a\n> b](x.md) here.") },
  "a label over two lines of a quote, in pieces": {
    shells: ["phone"],
    make: (s) => `# Title\n\n[a b]: def.md\n\n${Array.from({ length: many(s, 170) }, (_, k) => `${heavy(k).split("\n").map((line) => `> ${line}`).join("\n")}\n> see [foo][a\n> b](x.md) here`).join("\n\n")}\n`,
  },
  "a link label that folds to a footnote's, `[ ^x]`": { shells: ["phone"], make: (s) => heavyNote(many(s, 170), `[ ^x]: def.md "${words(3000)}"`, "See [foo][ ^x](x.md) here.") },
  "a reference in a link's text, in pieces": { shells: ["phone", "desktop"], make: (s) => `# Title\n\n[b]: def.md\n\n${Array.from({ length: many(s, 170) }, (_, k) => `${heavy(k)}\nsee [x [b]](x.md) here`).join("\n\n")}\n` },
  "a full reference in a link's text, in pieces": { shells: ["phone"], make: (s) => `# Title\n\n[b]: def.md\n\n${Array.from({ length: many(s, 170) }, (_, k) => `${heavy(k)}\nsee [x [t][b]](x.md) here`).join("\n\n")}\n` },
  "a definition over three lines in a part not read": { shells: ["phone"], make: (s) => heavyNote(many(s, 40), longList(many(s, 6000), "  - [a\n    b\n    c]: def.md"), "See [foo][a b c](x.md) here.") },
  "a definition on a line over 4 096 characters in a part not read": { shells: ["phone"], make: (s) => heavyNote(many(s, 40), longList(many(s, 6000), `  - [lng]: def.md "${"t".repeat(4200)}"`), "See [foo][lng](x.md) here.") },
  "a footnote before a note that begins indented": { shells: ["phone"], make: (s) => heavyNote(many(s, 170), `[^n]: ${words(3000)}`, "    code line\nlazy [[A]] text and a ref[^n]", { lightFirst: true }) },
  "a wiki link in a reference's text": { shells: ["phone"], make: (s) => heavyNote(many(s, 170), `[r]: def.md "${words(3000)}"`, "See [[[A]]][r](x.md) here.") },
};

const inAny = (ranges: readonly BoundedRange[], at: number) => ranges.some((range) => range.from <= at && at < range.to);

function facts(note: string) {
  const read = readNoteLinks(note);
  return {
    unread: read.unread,
    links: read.links.map((link) => `${link.type} ${link.target} ${link.start}-${link.end} ${link.targetStart}-${link.targetEnd} label=${link.inLabel} table=${link.inTable}`),
    starts: read.links.map((link) => link.start),
    index: extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true }), note),
    renamed: renameNoteLinks(note, RENAMES),
  };
}

/** The reading at `budget` against the note read whole, by the yardstick of the review. */
function judged(note: string, budget: number) {
  setNoteBudget(budget);
  const head = facts(note);
  const parts = readAsTextParts(note);
  setNoteBudget(Number.MAX_SAFE_INTEGER);
  const whole = facts(note);
  setNoteBudget(budget);
  return { head, whole, parts };
}

for (const [name, { shells, make }] of Object.entries(NOTES)) {
  for (const shell of shells) {
    it(`${name}, on the ${shell}: no link and no rename the note read whole does not have`, () => {
      expect.hasAssertions();
      const note = make(shell);
      const { head, whole, parts } = judged(note, shell === "phone" ? NOTE_BUDGET : DESKTOP_NOTE_BUDGET);
      expect(parts.ranges.some((range) => range.block), "blocks read as text").toBe(true);
      // Every link read is the note read whole's, at its place, with its facts.
      for (const link of head.links) expect(whole.links, "a link the note read whole does not have").toContain(link);
      // Every link the note read whole has stands as it is or where nothing is read.
      whole.links.forEach((link, i) => {
        if (!head.links.includes(link)) expect(inAny(head.unread, whole.starts[i]), `the link ${link} is lost without a word`).toBe(true);
      });
      // A rename, byte for byte: the note read whole's outside what is not read, the note's own inside.
      expect(head.renamed.content.length).toBe(note.length);
      let differs = -1;
      for (let i = 0; i < note.length && differs < 0; i++) if (head.renamed.content[i] !== (inAny(head.unread, i) ? note[i] : whole.renamed.content[i])) differs = i;
      expect(differs, `the rename differs at ${differs}: ${JSON.stringify(head.renamed.content.slice(differs - 20, differs + 40))}`).toBe(-1);
      // What a rename leaves where nothing is read, it counts.
      if (head.renamed.renamed < whole.renamed.renamed) expect(head.renamed.unplaced).toBeGreaterThan(0);
      // The index: no link and no tag the note read whole does not have.
      const left = whole.index.links.map((link) => JSON.stringify(link));
      for (const link of head.index.links) {
        const at = left.indexOf(JSON.stringify(link));
        expect(at, `the index's link ${JSON.stringify(link)}`).toBeGreaterThanOrEqual(0);
        left.splice(at, 1);
      }
      const tags = whole.index.tags.map((tag) => tag.name);
      for (const tag of head.index.tags) {
        const at = tags.indexOf(tag.name);
        expect(at, `the tag ${tag.name}`).toBeGreaterThanOrEqual(0);
        tags.splice(at, 1);
      }
    }, 300 * SECONDS);
  }
}

describe("the conversion of wiki links to Markdown links in a note over its budget", () => {
  it("leaves a wiki link in a reference's text, as in the note read whole, and writes nothing where it does not read", () => {
    expect.hasAssertions();
    const note = `# T\n\n[bar]: other.md\n\n${Array.from({ length: 170 }, (_, k) => `${heavy(k)}\nsee [use [[A]]][bar] here`).join("\n\n")}\n`;
    const files = ["A.md", "Big.md", ...Array.from({ length: 170 }, (_, k) => `Other${k}-0.md`)];
    const convert = () => convertWikilinksToMarkdownLinks(note, { sourcePath: "Big.md", allFilePaths: files });
    setNoteBudget(NOTE_BUDGET);
    const head = convert();
    const unread = readNoteLinks(note).unread;
    expect(readAsTextParts(note).pieces.length, "read in pieces").toBeGreaterThan(0);
    setNoteBudget(Number.MAX_SAFE_INTEGER);
    const whole = convert();
    setNoteBudget(NOTE_BUDGET);
    expect(whole.result.inLabels).toBe(170);
    // Byte for byte outside what is not read; inside it the note's own text.
    let differs = -1;
    const length = Math.min(head.content.length, whole.content.length);
    let i = 0;
    let j = 0;
    // The conversion changes lengths: walk both texts, the note's own where the head reads nothing.
    for (; i < length && j < length && differs < 0; ) {
      if (head.content[i] === whole.content[j]) {
        i++;
        j++;
      } else differs = i;
    }
    expect(head.content.includes("[use [A](A.md)]"), "a link written into a reference's text").toBe(false);
    expect(differs < 0 || unread.length > 0, `the conversion differs at ${differs}`).toBe(true);
  }, 300 * SECONDS);
});
