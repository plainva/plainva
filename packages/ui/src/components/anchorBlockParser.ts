import type { markdown } from "@codemirror/lang-markdown";

/**
 * The HTML-block rule, with one exception for a comment anchor (finding
 * 2026-09-03).
 *
 * CommonMark: a line that begins with `<!--` is an HTML block, opaque until
 * the line that carries `-->`. A hard anchor is an HTML comment, and the most
 * common comment - on a whole list item, a whole paragraph - puts its opening
 * marker exactly at the start of the block's text. The parser then sees one
 * `CommentBlock` where a list item with emphasis and links used to be: no
 * `ListMark` for the bullet, no `ListItem` for the indent, the whole line
 * dimmed as a comment. The writer keeps the marker out of the block PREFIX
 * (`placeAnchorRange` in core); this is the other half: a line whose first
 * thing is an anchor marker is never an HTML block, so the marker stays an
 * inline `Comment` and the text around it is parsed as it would be without
 * the marker. Every other HTML block keeps CommonMark's reading, including the
 * block-drag list separator `<!-- -->`.
 *
 * It REPLACES lezer's parser under the same name, because a parser cannot
 * veto another: `parseBlock` with a known name swaps it in place. The body is
 * lezer's (MIT), written against the public `BlockContext` surface; only the
 * start test differs. The default "this construct interrupts a paragraph"
 * predicate stays lezer's, so a marker at the head of a soft-wrapped
 * continuation line still starts a new paragraph - invisible in the editor,
 * where a paragraph is its lines.
 */
type MarkdownExtensions = NonNullable<NonNullable<Parameters<typeof markdown>[0]>["extensions"]>;

const ANCHOR_MARKER_FIRST = /^[ \t]*<!--\/?pv#[0-9a-f]{4}-->/;
const EmptyLine = /^[ \t]*$/;
const CommentEnd = /-->/;
const ProcessingEnd = /\?>/;
const HTMLBlockStyle: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [/^<(?:script|pre|style)(?:\s|>|$)/i, /<\/(?:script|pre|style)>/i],
  [/^\s*<!--/, CommentEnd],
  [/^\s*<\?/, ProcessingEnd],
  [/^\s*<![A-Z]/, />/],
  [/^\s*<!\[CDATA\[/, /\]\]>/],
  [/^\s*<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i, EmptyLine],
  [/^\s*(?:<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(\s+[a-z:_][\w-.]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*>)\s*$/i, EmptyLine],
];

/** True when the line's first token is an anchor marker. */
export function startsWithAnchorMarker(rest: string): boolean {
  return ANCHOR_MARKER_FIRST.test(rest);
}

export const anchorAwareHtmlBlock: MarkdownExtensions = {
  parseBlock: [
    {
      name: "HTMLBlock",
      parse(cx, line) {
        if (line.next !== 60 /* '<' */) return false;
        const rest = line.text.slice(line.pos);
        if (startsWithAnchorMarker(rest)) return false;
        const type = HTMLBlockStyle.findIndex(([start]) => start.test(rest));
        if (type < 0) return false;
        const from = cx.lineStart + line.pos;
        const end = HTMLBlockStyle[type][1];
        const marks: typeof line.markers = [];
        let trailing = end !== EmptyLine;
        while (!end.test(line.text) && cx.nextLine()) {
          // `depth` is the number of enclosing blocks this line still continues;
          // fewer than the context has means the container (a blockquote, a
          // list item) ended and the HTML block with it.
          if ((line as unknown as { depth: number }).depth < cx.depth) {
            trailing = false;
            break;
          }
          marks.push(...line.markers);
        }
        if (trailing) cx.nextLine();
        const nodeType = end === CommentEnd ? "CommentBlock" : end === ProcessingEnd ? "ProcessingInstructionBlock" : "HTMLBlock";
        cx.addElement(cx.elt(nodeType, from, cx.prevLineEnd(), marks));
        return true;
      },
    },
  ],
};
