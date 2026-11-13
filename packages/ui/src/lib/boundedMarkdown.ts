import type { markdown } from "@codemirror/lang-markdown";
import { boundMarkdownForParse, exceedsInlineParseBudget, READER_READING, restoreBoundedTree, type BoundedMarkdown } from "@plainva/core";

/**
 * The parse budget (`inlineParseBudget.ts` in core) for the two parsers that
 * live outside core: the reading view's (remark, through react-markdown) and
 * the editor's (Lezer). Core's own parses — the index, the note source behind
 * outline, journal and embedded sections — bound themselves.
 *
 * A paragraph, table row or table that would cost a parser more than its
 * budget is read as written, the same stretch in all three:
 * open-items plan 3.133 no. 4 (a line of 100 000 `]` held the reading view
 * for minutes).
 */

/**
 * The reading view's half: the text to hand the parser, and a remark plugin
 * that gives the parsed values back their characters. The plugin must run
 * FIRST, before any plugin reads a value; every place in the text stays where
 * it was, so the reader's source mapping holds.
 */
export function boundReaderMarkdown(text: string): BoundedMarkdown & { remarkRestore: () => (tree: unknown) => void } {
  // Weighed for the reading view's own parser: GFM without the properties block (MarkdownReader.tsx), which opens quotes and lists behind an unclosed `---`.
  const bounded = boundMarkdownForParse(text, READER_READING);
  const { ranges } = bounded;
  return {
    ...bounded,
    remarkRestore: () => (tree: unknown) => restoreBoundedTree(tree, ranges),
  };
}

type MarkdownExtensions = NonNullable<NonNullable<Parameters<typeof markdown>[0]>["extensions"]>;

/** What opens inline syntax for Lezer: `\ & ` < * _ ~ [ ] !` — in an over-budget block each is a plain character. */
const OPENS_INLINE = new Set([0x5c, 0x26, 0x60, 0x3c, 0x2a, 0x5f, 0x7e, 0x5b, 0x5d, 0x21]);

/**
 * The editor's half: an inline parser that runs before every other and, in a
 * block whose inline text is over the budget, takes each character that would
 * open inline syntax as plain text. Lezer reads emphasis like micromark does —
 * every `*` looks back over the block — so a long run of `*a` held the editor
 * as well. The answer is asked once per block.
 */
export const boundedInlineSyntax: MarkdownExtensions = {
  parseInline: [
    {
      name: "BoundedInline",
      before: "Escape",
      parse(cx, next, pos) {
        if (!OPENS_INLINE.has(next)) return -1;
        let over = overBudget.get(cx);
        if (over === undefined) {
          over = exceedsInlineParseBudget(cx.text);
          overBudget.set(cx, over);
        }
        return over ? pos + 1 : -1;
      },
    },
  ],
};

const overBudget = new WeakMap<object, boolean>();
