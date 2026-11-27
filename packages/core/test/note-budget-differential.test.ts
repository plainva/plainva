import { afterAll, describe, expect, it } from "vitest";
import { NOTE_BUDGET, PIECE_SHARE, overBudgetInlineRanges, readAsTextParts, setNoteBudget, setPieceShare, type BoundedRange } from "../src/inlineParseBudget.ts";
import { parseMarkdownAst } from "../src/markdown-parser.ts";
import { extractLinksAndTags } from "../src/ast-scanner.ts";
import { readNoteLinks, renameNoteLinks } from "../src/linkRewrite.ts";

/**
 * Small notes of building blocks, each read with budgets that make part of it
 * formatted, part read in pieces and part not read at all — every block a
 * piece of its own, and 15, 30, 50, 70 and 90 percent of the note's weight —
 * against the same note read whole (the yardstick of the review of L14,
 * 2026-11-26, round two):
 *
 * 1. every link read (its places, target, kind, whether it stands in a label
 *    or a table) is the note read whole's;
 * 2. every link of the note read whole is read so, or stands where nothing
 *    is read (`NoteLinks.unread`);
 * 3. a rename is the note read whole's byte for byte, except where nothing is
 *    read, where the note's own text stays;
 * 4. no tag the note read whole does not have.
 *
 * The blocks are those a reading in parts may read otherwise than the note
 * whole: references and the definitions they need in every kind of block,
 * labels over lines and in quotes, `[ ^x]`, references in a link's text, wiki
 * links in a reference's text, definitions over three lines and over 4 096
 * characters, a note that begins indented — in every one of the sixteen
 * wrappings of CRLF, a properties block, a byte order mark and an unclosed
 * `---`.
 */

afterAll(() => {
  setNoteBudget(NOTE_BUDGET);
  setPieceShare(PIECE_SHARE);
});

const SECONDS = 1000;
const RENAMES = new Map([
  ["x.md", "y.md"],
  ["A", "B"],
  ["Target", "Tbrget"],
  ["Target.md", "Tbrget.md"],
  ["def.md", "deg.md"],
]);

const BLOCKS = [
  // References and labels that run into `(`, and their definitions.
  "See [foo][bar](x.md) here.", "[a][b][c](x.md)", "[a][b] (x.md)", "[a][b]\n(x.md)", "[a][b]<x.md>", "[b](x.md) plain",
  "![a][pic](x.md)", "[T][](x.md)", "[^fn](x.md)", "[[[A]]][bar](x.md)", "[#tag [[A]]][bar](x.md)", "[a][STRASSE](x.md)",
  "[a][b\\]c](x.md)", "see [x [b]](x.md) here", "[x [t][b]](x.md)", "[x ![i][pic]](x.md)", "[a][ ^x](x.md)",
  "> quoted [a][multi\n> line](x.md)", "- item [a][multi\n  line](x.md)", "[use [[A]]][bar]\n===", "## [[[A]]][bar] heading ^hid",
  "see [use [[A]]][bar] here", "text[^fn] and [^n2]", "[bar] and [pic] and [Straße]", "[a b c] then [[Target]]",
  // Definitions in every kind of block.
  "[bar]: def.md", "[bar]: other.md \"t\"", "[pic]: x.md", "[Straße]: def.md", "[b\\]c]: def.md", "[ ^x]: def.md",
  "[multi line]: def.md", "> [bar]: def.md", "- [bar]: def.md", "   [bar]: def.md", "[bar]:\n  def.md\n  \"title\"",
  "[bar]: <def file.md>", "[multi\nline]: def.md", "[a\nb\nc]: def.md", `[lng]: def.md "${"t".repeat(4200)}"`, "[^fn]: footnote [[A]] text",
  "[^n2]: note two [[Target]]\n    more [x](x.md)", "```\n[bar]: def.md\n```", "    [bar]: def.md", "<div>\n[bar]: def.md\n</div>",
  "<!--\n[bar]: def.md\n-->", "$$\n[bar]: def.md\n$$", "para line\n[bar]: def.md", "%% [bar]: def.md %%",
  // Heavy blocks, read as text, in pieces or not at all.
  Array.from({ length: 30 }, (_, i) => `**b${i}** _c_ \`d\` [[Target]] <e> &amp; ~~s~~ words [x](x.md)`).join("\n"),
  Array.from({ length: 40 }, (_, i) => `- item ${i} [[A]] #t${i % 3} [l](x.md)`).join("\n"),
  `- top\n${Array.from({ length: 60 }, (_, i) => `  - sub ${i} [[Target]] [x](x.md)`).join("\n")}`,
  Array.from({ length: 40 }, (_, i) => `line ${i} of one paragraph [[A]] mail a${i}@b.co www.x${i}.org`).join("\n"),
  `| a | b |\n|---|---|\n${Array.from({ length: 30 }, (_, i) => `| [[Target]] ${i} | [x](x.md) |`).join("\n")}`,
  `> [!note] callout\n${Array.from({ length: 30 }, (_, i) => `> line ${i} [[A]] [x](x.md)`).join("\n")}`,
  // Blocks that read otherwise alone.
  "    code first [[NotA]]\nlazy [[A]] after", "- [ ] task [[Target]]\n- [x] done [x](x.md)", "#tag and #other/tag and `#no`",
  "Heading\n---", "***", "<span>[[A]]</span>", "😀 [[Target]] 𝔘 [x](x.md)", "a\tb [[A]]\t[x](x.md)",
];

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const FILL = Array.from({ length: 300 }, (_, i) => `filler ${i} words`).join(" ");

/** The blocks as a note in one of sixteen wrappings; past 5 000 characters, below which no note is weighed. */
function noteOf(blocks: readonly string[], wrap: number): string {
  let body = `${blocks.join("\n\n")}\n\n${FILL}\n\n${FILL}\n`;
  if (wrap & 1) body = body.replace(/\n/g, "\r\n");
  if (wrap & 2) body = `---\ntitle: T\n---\n${body}`;
  if (wrap & 4) body = `\uFEFF${body}`;
  if (wrap & 8) body = `---\n${body}`;
  return body;
}

function weightOf(note: string): number {
  let total = 0;
  setNoteBudget(Number.MAX_SAFE_INTEGER);
  overBudgetInlineRanges(note, { note: (value) => (total = value) });
  return total;
}

const inAny = (ranges: readonly BoundedRange[], at: number) => ranges.some((range) => range.from <= at && at < range.to);

function facts(note: string) {
  const read = readNoteLinks(note);
  return {
    unread: read.unread,
    links: read.links.map((link) => ({ at: link.start, key: `${link.type} ${link.target} ${link.start}-${link.end} ${link.targetStart}-${link.targetEnd} label=${link.inLabel} table=${link.inTable}` })),
    renamed: renameNoteLinks(note, RENAMES).content,
    tags: extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true }), note).tags.map((tag) => tag.name),
  };
}

/** What the reading at the budget `mode` holds that the note read whole does not: one line a finding. */
function findings(note: string, mode: string): { found: string[]; parts: { pieces: number; unread: number } } {
  setNoteBudget(Number.MAX_SAFE_INTEGER);
  const whole = facts(note);
  if (mode === "apart") {
    setPieceShare(1e12, true);
    setNoteBudget(1);
  } else setNoteBudget(Math.max(1, Math.floor(weightOf(note) * Number(mode))));
  try {
    const head = facts(note);
    const parts = readAsTextParts(note);
    const found: string[] = [];
    const wholeKeys = new Set(whole.links.map((link) => link.key));
    const headKeys = new Set(head.links.map((link) => link.key));
    for (const link of head.links) if (!wholeKeys.has(link.key)) found.push(`a link the note read whole does not have: ${link.key}`);
    for (const link of whole.links) if (!headKeys.has(link.key) && !inAny(head.unread, link.at)) found.push(`a link lost without a word: ${link.key}`);
    if (head.renamed.length !== note.length) found.push("the rename changed the note's length");
    else
      for (let i = 0; i < note.length; i++)
        if (head.renamed[i] !== (inAny(head.unread, i) ? note[i] : whole.renamed[i])) {
          found.push(`the rename differs at ${i}: ${JSON.stringify(head.renamed.slice(Math.max(0, i - 20), i + 30))} for ${JSON.stringify(whole.renamed.slice(Math.max(0, i - 20), i + 30))}`);
          break;
        }
    const left = [...whole.tags];
    for (const tag of head.tags) {
      const at = left.indexOf(tag);
      if (at < 0) found.push(`a tag the note read whole does not have: ${tag}`);
      else left.splice(at, 1);
    }
    return { found, parts: { pieces: parts.pieces.length, unread: head.unread.length } };
  } finally {
    setPieceShare(PIECE_SHARE);
    setNoteBudget(NOTE_BUDGET);
  }
}

describe("a note of building blocks read in parts against the note read whole", () => {
  for (const seed of [7, 11]) {
    it(`reads what it reads as the note read whole, and says where it does not (seed ${seed})`, () => {
      expect.hasAssertions();
      const covered = { readings: 0, pieces: 0, unread: 0 };
      const wrappings = new Set<number>();
      for (let trial = 0; trial < 160; trial++) {
        const r = random(seed * 100_003 + trial);
        const blocks = Array.from({ length: 2 + Math.floor(r() * 9) }, () => BLOCKS[Math.floor(r() * BLOCKS.length)]);
        const wrap = trial % 16;
        wrappings.add(wrap);
        const note = noteOf(blocks, wrap);
        for (const mode of ["apart", "0.15", "0.3", "0.5", "0.7", "0.9"]) {
          const { found, parts } = findings(note, mode);
          covered.readings++;
          if (parts.pieces > 0) covered.pieces++;
          if (parts.unread > 0) covered.unread++;
          expect(found, `trial ${trial}, wrapping ${wrap}, budget ${mode}: ${JSON.stringify(blocks).slice(0, 600)}`).toEqual([]);
        }
      }
      // Every wrapping, and readings with pieces and with parts not read among them.
      expect(wrappings.size).toBe(16);
      expect(covered.pieces).toBeGreaterThan(covered.readings / 4);
      expect(covered.unread).toBeGreaterThan(covered.readings / 4);
    }, 600 * SECONDS);
  }
});
