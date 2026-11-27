import { afterAll, describe, expect, it } from "vitest";
import { DESKTOP_NOTE_BUDGET, NOTE_BUDGET, overBudgetInlineRanges, readAsTextParts, setNoteBudget, type BoundedRange } from "../src/inlineParseBudget.ts";
import { parseMarkdownAst } from "../src/markdown-parser.ts";
import { extractLinksAndTags } from "../src/ast-scanner.ts";
import { readNoteLinks, renameNoteLinks } from "../src/linkRewrite.ts";
import { analyzeNoteSource } from "../src/noteSource.ts";

/**
 * Every reading of a note over its budget against the same note read whole,
 * with the budget of each shell and nothing else set: notes in which a part
 * stays formatted, a part is read as text (and read in pieces) and a part is
 * not read at all — a quote of a list too heavy for a piece, a paragraph over
 * the inline budget. Outside what is not read, the index (links and their
 * lines), a rename (byte for byte) and the note source (headings, block ids)
 * are the note read whole's; inside it, a rename leaves every character as it
 * is, and the index holds no tag the note read whole does not.
 *
 * The building blocks are the forms that read differently alone than in a
 * note (setext, lazy lines, lists and their numbers, fences and HTML across
 * blank lines, definitions and footnotes where they stand, tables in items,
 * callouts, comments, block ids, CRLF, tabs, astral characters …), and the
 * references whose reading depends on a definition elsewhere in the note:
 * `[x][label](…)`, `![a][label](…)`, `[T][](…)`, labels folded and escaped
 * (review of L14, 2026-11-26: a definition in a block read as text did not
 * reach the formatted rest, and `[foo][bar](x.md)` became a link there).
 */

const SECONDS = 1000;
afterAll(() => setNoteBudget(NOTE_BUDGET));

// Renames of names as long as the old ones: every place of the note stays where it is, the readings compare by place.
const RENAMES = new Map([
  ["Target", "Tbrget"],
  ["Target.md", "Tbrget.md"],
  ["x.md", "y.md"],
  ["Foo", "Fob"],
]);

const FRAGMENTS = [
  "Setext [[Target]]\n===",
  "Setext two [x](x.md)\n---",
  "para line\n---\nafter rule [[Foo]]",
  "> quote [[Target]]\nlazy [[Foo]] continuation",
  "> > deep [[Target]]\n> > - item [x](x.md)\n> lazy",
  "- a [[Target]]\n- b\n\n  para of b [[Foo]]\n\n      code in b [[NotA]]",
  "3. three [[Target]]\n4. four\n\n5. five [x](x.md)",
  "1) paren [[Target]]\n2) two\n1. dot [[Foo]]",
  "  - indented two [[Target]]\n    - deeper [[Foo]]\n - one [x](x.md)",
  "- loose [[Target]]\n\n- loose b [[Foo]]\n\n- loose c",
  "~~~js title=x\n[[NotA]] ```\n\n[[NotB]]\n~~~",
  "````md\n```\n[[NotA]]\n```\n\n[[NotB]]\n````",
  "<!-- comment [[NotA]]\n\n[[NotB]] -->\n[[AfterComment]]",
  "<script>\n[[NotA]]\n\n[[NotB]]\n</script>",
  "<details>\n<summary>S [[Target]]</summary>\n\n[[InDetails]]\n\n</details>",
  "[ref]: Target.md\n[ref]: second.md\n\nuse [ref] and [REF][] and [t][Ref]",
  "[ml]: x.md\n  \"multi\n  line title\"\n\n[a][ml]",
  "> [inq]: Target.md\n\n[x][inq]",
  "- [inl]: x.md\n\n[y][inl]",
  "[  Spaced   Label ]: Target.md\n\n[x][spaced label]",
  "[^fn]: footnote [[Target]]\n    continued [[Foo]]\n\n    second para [x](x.md)\n\ntext[^fn]",
  "- item\n\n  | a | b |\n  |---|---|\n  | [[Target]] | [x](x.md) |",
  "| w | x |\n|---|---|\n| [[Target\\|alias]] | [[Foo|b]] |",
  "> [!note] Callout [[Target]]\n> body [x](x.md)\n>\n> more [[Foo]]",
  "%% comment [[Target]]\n\nstill %% after",
  "paragraph with id [[Target]] ^blk-1",
  "- item with id ^item-id\n- next [[Foo]]",
  "# Heading [[Target]]\n\n## Heading [[Target]]",
  "Text with #tag and `#notag` and https://x.y/#frag [[Foo#Sec]]",
  "    indented code [[NotA]]\n\n    more code\n\nafter [[Target]]",
  "para\n    lazy indented [[Target]]",
  "<div>\n\n[[TargetInDiv]]\n\n</div>",
  "\\[[NotLink]] \\[x](x.md) [\\[x\\]](Target.md)",
  "line one\r\nline two [[Target]]\r\n\r\n- crlf item [x](x.md)",
  "[[Target]]\t[[Foo]]\n-\t\ttab item [x](x.md)",
  "😀 [[Target]] 𝔘𝔘 [x](x.md)",
  "![[Target]] ![img](x.md) ![[Foo#^blk-1]]",
  "1. a\n   ```\n   [[NotA]]\n\n   [[NotB]]\n   ```\n2. b [[Target]]",
  "> ```\n> [[NotA]]\n>\n> [[NotB]]\n> ```\n\n[[Target]]",
  // References whose reading depends on a definition elsewhere in the note, and the definitions.
  "see [foo][bar](x.md) here",
  "[bar]: def.md",
  "see ![a][pic](x.md) here",
  "[pic]: def.png",
  "see [Target][](x.md) here",
  "[Target]: q.md",
  "see [a][Straße](x.md) and [b][ẞ](x.md) here",
  "[STRASSE]: def.md\n\n[SS]: def.md",
  "see [a][b\\]c](x.md) and [c][b\\\\c](x.md) here",
  "[b\\]c]: def.md\n\n[b\\\\c]: def.md",
  "text[^n](x.md) and more",
  "[^n]: note with [[Target]]",
];

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Lines of a paragraph with links (a piece when read as text), and in every tenth block a list cut at its items. */
const ballast = (k: number, lines: number) => Array.from({ length: lines }, (_, i) => `${k % 10 === 0 ? "- " : ""}ballast ${k}.${i} [[Ballast ${i % 9}]] [x](x.md) #b${i % 5}`).join("\n");
/** A quote of one paragraph, too heavy for a piece and not cut: not read. */
const quoteList = (lines: number) => Array.from({ length: lines }, (_, i) => `> quoted ${i} [[Target]] [x](x.md)`).join("\n");

/** A note of the fragments, some of them in blocks heavy with ballast; with or without a part not read. */
function noteOf(seed: number, budget: number, unread: boolean): string {
  const r = random(seed);
  const blocks: string[] = [];
  // Ballast lists of about a tenth of the budget each, enough of them to bring the note over it.
  const per = Math.round((budget / NOTE_BUDGET) * 450);
  const order = FRAGMENTS.map((fragment) => ({ fragment, key: r() })).sort((a, b) => a.key - b.key);
  for (const [k, { fragment }] of order.entries()) {
    const parts = r() < 0.3 ? fragment.replace(/\n/g, "\r\n") : fragment;
    // A fragment and a list behind it in one block, or the fragment alone.
    blocks.push(r() < 0.4 ? `${parts}\n${ballast(k, per)}` : parts);
    if (r() < 0.25) blocks.push(ballast(1000 + k, per));
  }
  if (unread) {
    blocks.splice(Math.floor(r() * blocks.length), 0, quoteList(Math.round((budget / NOTE_BUDGET) * 3_000)));
    blocks.splice(Math.floor(r() * blocks.length), 0, `${"]".repeat(120_000)} [[Target]] #inner`);
  }
  return `${r() < 0.3 ? "---\ntitle: T\n---\n" : ""}# Title\n\n${blocks.join("\n\n")}\n`;
}

const inAny = (ranges: readonly BoundedRange[], at: number) => ranges.some((range) => range.from <= at && at < range.to);

function facts(note: string) {
  const { links, tags } = extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true }), note);
  return {
    links: links.map((link) => `${link.type} ${link.target} ${link.anchor ?? ""} @${link.line}`),
    tags: tags.map((tag) => tag.name).sort(),
    places: readNoteLinks(note).links.map((link) => ({ at: link.start, text: `${link.type} ${link.target} ${link.start}-${link.end}` })),
    // What is not read for links: what the budget leaves, and where a definition a part does not see may change it.
    unread: readNoteLinks(note).unread,
    renamed: renameNoteLinks(note, RENAMES).content,
    source: analyzeNoteSource(note),
  };
}

for (const [shell, budget, notes] of [["phone", NOTE_BUDGET, 6], ["desktop", DESKTOP_NOTE_BUDGET, 1]] as const) {
  describe(`a note read in part formatted, in part in pieces, in part not at all, on the ${shell}`, () => {
    for (const unread of [false, true]) {
      it(`reads as the note read whole outside what it does not read${unread ? " (with a part not read)" : ""}`, () => {
        expect.hasAssertions();
        for (let seed = 1; seed <= notes; seed++) {
          const note = noteOf(seed + (unread ? 100 : 0), budget, unread);
          setNoteBudget(budget);
          const parts = readAsTextParts(note);
          const head = facts(note);
          setNoteBudget(Number.MAX_SAFE_INTEGER);
          const whole = facts(note);
          setNoteBudget(budget);
          const name = `${shell} seed ${seed}`;
          // A part formatted, a part read in pieces, and a part not read where there should be one.
          expect(overBudgetInlineRanges(note).filter((range) => range.block).length, `${name}: blocks read as text`).toBeGreaterThan(0);
          expect(parts.pieces.length, `${name}: pieces`).toBeGreaterThan(0);
          const notRead = head.unread;
          if (!unread) expect(parts.unread, name).toEqual([]);
          else expect(parts.unread.length, `${name}: a part not read`).toBeGreaterThan(0);
          // Lines that lie wholly in what is not read.
          // As the parser counts them: a CR alone ends a line too.
          const lineStarts = [0];
          for (const end of note.matchAll(/\r\n|\r|\n/g)) lineStarts.push(end.index + end[0].length);
          // A line that a part not read meets: a link of the note read whole there may be one the head does not read.
          const unreadLine = (line: number) => notRead.some((range) => range.from < (lineStarts[line] ?? note.length + 1) && range.to > lineStarts[line - 1]);
          const lineOf = (text: string) => Number(text.slice(text.lastIndexOf("@") + 1));
          // The index: every link of the note read whole's, in its order; those it lacks stand on a line not read.
          const lacked = [...whole.links];
          for (const link of head.links) {
            const at = lacked.indexOf(link);
            expect(at, `${name}: the index's ${link}`).toBeGreaterThanOrEqual(0);
            lacked.splice(at, 1);
          }
          for (const link of lacked) expect(unreadLine(lineOf(link)), `${name}: the index lacks ${link}`).toBe(true);
          if (notRead.length === 0) expect(head.links, `${name}: the index`).toEqual(whole.links);
          expect(head.places.map((link) => link.text), `${name}: a rename's links`).toEqual(whole.places.filter((link) => !inAny(notRead, link.at)).map((link) => link.text));
          // A rename, byte for byte: the note read whole's outside, the note's own inside what is not read.
          expect(head.renamed.length, name).toBe(note.length);
          let differs = -1;
          for (let i = 0; i < note.length && differs < 0; i++) if (head.renamed[i] !== (inAny(notRead, i) ? note[i] : whole.renamed[i])) differs = i;
          expect(differs, `${name}: the rename differs at ${differs}: ${JSON.stringify(head.renamed.slice(differs - 20, differs + 40))}`).toBe(-1);
          // The note source outside what is not read; slugs count on in the order of the text, so they are compared where nothing is unread.
          // A heading a part not read meets may read its text otherwise: where a definition elsewhere may change its brackets.
          const strip = (items: Array<{ from: number; to: number; slug?: string }>) => items.filter((item) => !notRead.some((range) => range.from < Math.max(item.to, item.from + 1) && range.to > item.from)).map((item) => ({ ...item, slug: notRead.length ? "" : item.slug }));
          expect(strip(head.source.headings), `${name}: headings`).toEqual(strip(whole.source.headings));
          expect(strip(head.source.blocks), `${name}: block ids`).toEqual(strip(whole.source.blocks));
          // No tag the note read whole does not have.
          const left = [...whole.tags];
          for (const tag of head.tags) {
            const at = left.indexOf(tag);
            expect(at, `${name}: the tag ${tag}`).toBeGreaterThanOrEqual(0);
            left.splice(at, 1);
          }
          if (notRead.length === 0) expect(head.tags, name).toEqual(whole.tags);
        }
      }, 600 * SECONDS);
    }
  });
}
