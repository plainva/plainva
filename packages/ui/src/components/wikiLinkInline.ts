import type { markdown } from "@codemirror/lang-markdown";
import { wikiLinkParts } from "@plainva/core";

type MarkdownExtensions = NonNullable<NonNullable<Parameters<typeof markdown>[0]>["extensions"]>;

const EXCLAMATION_MARK = 33;
const LEFT_SQUARE_BRACKET = 91;
const RIGHT_SQUARE_BRACKET = 93;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;

/**
 * Per block: where a `[[` was followed to its line end without a `]]`. Every
 * `[[` further right on that line ends the same way, so it is not followed
 * again — a line that is a long run of `[` is read once, not once per bracket
 * (the same care as the core's tokenizer, `wikiLinkSyntax.ts`).
 */
const withoutClose = new WeakMap<object, { from: number; until: number }>();

/**
 * Wiki links for the editor's Markdown parser (Lezer), read the way the
 * core's tokenizer reads them for the index, the rename and the reading view
 * (`wikiLinkSyntax.ts` in core): `[[`, then anything but a line end up to the
 * first `]]`, a `!` right in front making it an embed — read from the left,
 * BEFORE anything is read into it.
 *
 * Without it the editor read emphasis into a link's name: `[[__init__]]`
 * stood there as a bold "init", `[[_private_]]` as an italic "private" — and
 * the file the link opens has another name (open-items plan 3.133 no. 2,
 * decision E9: the name as it is written, as the reading view shows it). A
 * `WikiLink` node has no children where the name stands; the alias behind
 * the bar is read as Markdown, so it is formatted as the text around it, as
 * the reading view does.
 *
 * What starts further left wins, as in core: a link inside a code span or an
 * HTML tag is none (Lezer reads those first, from the left), and an escaped
 * bracket (`\[[Note]]`) opens none — the escape parser takes the bracket.
 */
export const wikiLinkInlineSyntax: MarkdownExtensions = {
  defineNodes: [{ name: "WikiLink" }],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        let open = pos;
        if (next === EXCLAMATION_MARK) {
          if (cx.char(pos + 1) !== LEFT_SQUARE_BRACKET || cx.char(pos + 2) !== LEFT_SQUARE_BRACKET) return -1;
          open = pos + 1;
        } else if (next !== LEFT_SQUARE_BRACKET || cx.char(pos + 1) !== LEFT_SQUARE_BRACKET) {
          return -1;
        }
        const known = withoutClose.get(cx);
        if (known && open >= known.from && open < known.until) return -1;
        for (let at = open + 2; at < cx.end; at++) {
          const char = cx.char(at);
          if (char === LINE_FEED || char === CARRIAGE_RETURN) {
            withoutClose.set(cx, { from: open, until: at });
            return -1;
          }
          if (char !== RIGHT_SQUARE_BRACKET || cx.char(at + 1) !== RIGHT_SQUARE_BRACKET) continue;
          const end = at + 2;
          const inner = cx.slice(open + 2, at);
          const { aliasStart } = wikiLinkParts(inner);
          // The alias, read as Markdown: what it shows is text like the text around it.
          const children = aliasStart >= 0 && aliasStart < inner.length ? cx.parser.parseInline(inner.slice(aliasStart), open + 2 + aliasStart) : [];
          return cx.addElement(cx.elt("WikiLink", pos, end, children));
        }
        withoutClose.set(cx, { from: open, until: cx.end });
        return -1;
      },
    },
  ],
};
