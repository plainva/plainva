/**
 * The building blocks of the tests that read notes over their budget against
 * the same notes read whole (`note-budget-differential.test.ts`,
 * `note-budget-trees.test.ts`) and of the edge search of the note's budget
 * (`note-budget.ts --edge`): the forms a reading in parts may read otherwise
 * than the note whole — references and the definitions they need in every
 * kind of block, labels over lines and in quotes, references in a link's text,
 * wiki links in a reference's text, definitions over three lines and over
 * 4 096 characters, a note that begins indented — and heavy blocks that are
 * read as text, in pieces or not at all. `noteOfBlocks` wraps them in one of
 * sixteen wrappings: CRLF, a properties block, a byte order mark, an unclosed
 * `---`.
 */

export const BLOCKS: readonly string[] = [
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
  // The third review's: what a stand-in must not change around it, and code that only looks like a definition.
  "x `a\n- [[Target]] b` end", "See [foo][bar](<[[Target]]>) here.", "> [bar]:\n> def.md",
  "<!--\n\n[bar]: def.md [[NotA]]\n\n-->", "<pre>\n\n[[NotA]] [x](x.md)\n\n</pre>", "```\na\n\n[[NotA]]\n\n```",
  "```\ncode\n```\n[bar]: def.md", "# Heading\n[bar]: def.md", "> quote\n[bar]: def.md",
  "[^fn2]: first\n\n    second paragraph [[A]] [x](x.md)", "const o = { [key]: value };", "def f() -> list[int]:",
  "- [x]: done [[Target]]", "[12:30]: meeting", "- [ ] task #t1 [[A]]\n- [x] done #t2", "| a | b |\n|---|---|\n| [b]: x | [[A]] |",
  "[ ]: def.md", Array.from({ length: 40 }, (_, i) => `- item ${i} [^${i}] [ref${i}][bar] [[A]] #i${i % 3}`).join("\n"),
  Array.from({ length: 30 }, (_, i) => `[ref${i}]: R${i}.md`).join("\n"),
  Array.from({ length: 30 }, (_, i) => `Paragraph ${i} with a [link](https://example.org/${i}), an ![image](img${i}.png) and [[Note ${i}]].`).join("\n\n"),
  Array.from({ length: 30 }, (_, i) => `- [t][l${i}](x.md) **b** _c_ \`d\` [[A]] ~~s~~`).join("\n"),
  Array.from({ length: 30 }, (_, i) => `p${i} [a][b c] [d [e]] ![f](g) [^1] [[A]] [h](i)`).join("\n\n"),
  Array.from({ length: 60 }, (_, i) => `- item ${i} **b** _c_ \`d\` [[Other${i}]] <e> &amp; ~~s~~ words`).join("\n"),
];

/** A heavy block, read as text at most budgets: a list of sixty linked items with inline syntax. */
export const HEAVY = (k: number): string => Array.from({ length: 60 }, (_, i) => `- item ${k}.${i} **b** _c_ \`d\` [[Other${i}]] <e> &amp; ~~s~~ words #h${i % 4}`).join("\n");


export const FILL = Array.from({ length: 300 }, (_, i) => `filler ${i} words`).join(" ");

/** The blocks as a note in one of sixteen wrappings; past 5 000 characters, below which no note is weighed. */
export function noteOfBlocks(blocks: readonly string[], wrap: number): string {
  let body = `${blocks.join("\n\n")}\n\n${FILL}\n\n${FILL}\n`;
  if (wrap & 1) body = body.replace(/\n/g, "\r\n");
  if (wrap & 2) body = `---\ntitle: T\n---\n${body}`;
  if (wrap & 4) body = `\uFEFF${body}`;
  if (wrap & 8) body = `---\n${body}`;
  return body;
}

