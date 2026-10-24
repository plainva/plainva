import { visit } from "unist-util-visit";

/** `[!info]`: ASCII letters and `-` between `[!` and `]`. */
function calloutAt(text: string, at: number): { index: number; end: number; raw: string } | null {
  if (text[at] !== "[" || text[at + 1] !== "!") return null;
  let end = at + 2;
  while (end < text.length && /[a-zA-Z-]/.test(text[end])) end++;
  if (end === at + 2 || text[end] !== "]") return null;
  return { index: at, end: end + 1, raw: text.slice(at, end + 1) };
}

/**
 * The callout markers `[!info]` of one text, left to right — what
 * `/\[![a-zA-Z-]+\]/g` finds, read in one pass (plan Befunde 24.09., E6).
 *
 * Wiki links and embeds were cut out of the text here as well, until
 * 2026-10-12: they are read by the tokenizer now and reach the tree as nodes
 * of their own (`wikiLinkSyntax.ts`), so a text node holds none any more. A
 * `[[…]]` that still stands in a text's value was written with a backslash or
 * a character reference (`\[[Note]]`), and is the text its writer meant.
 */
function* preservedTokens(text: string): Generator<{ index: number; end: number; raw: string }> {
  for (let at = text.indexOf("[!"); at >= 0; ) {
    const token = calloutAt(text, at);
    if (token) yield token;
    at = text.indexOf("[!", token ? token.end : at + 1);
  }
}

/**
 * Keeps a callout's marker as it is written when a tree is serialized: the
 * marker becomes a node the serializer writes as it stands, where a text
 * would get a backslash in front of its bracket.
 */
export default function remarkObsidianPreserve() {
  return (tree: any) => {
    visit(tree, "text", (node: any, index: number | undefined, parent: any) => {
      if (typeof index !== "number" || !parent) return;

      const text = node.value;
      if (typeof text !== "string") return;
      const tokens = [...preservedTokens(text)];

      if (tokens.length === 0) return;

      const newNodes: any[] = [];
      let lastIndex = 0;

      // The split nodes keep a position, derived from the text node's own
      // start — the line advances by the newlines before the match, the offset
      // by its index; the column is only exact on the first line and
      // approximate after. The newlines are found once: counting them again in
      // the text up to every match was quadratic in a long paragraph (E6).
      const start = node.position?.start;
      const breaks: number[] = [];
      for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) breaks.push(i);
      const breaksBefore = (offset: number) => {
        let lo = 0, hi = breaks.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (breaks[mid] < offset) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      };
      const col = (upTo: number) => {
        const k = breaksBefore(upTo);
        return k > 0 ? upTo - breaks[k - 1] : start.column + upTo;
      };
      const positionAt = (from: number, to: number) => {
        if (!start) return undefined;
        const lineFrom = start.line + breaksBefore(from);
        const lineTo = lineFrom + (breaksBefore(to) - breaksBefore(from));
        return {
          start: { line: lineFrom, column: col(from), offset: typeof start.offset === "number" ? start.offset + from : undefined },
          end: { line: lineTo, column: col(to), offset: typeof start.offset === "number" ? start.offset + to : undefined },
        };
      };

      for (const token of tokens) {
        if (token.index > lastIndex) {
          newNodes.push({ type: "text", value: text.slice(lastIndex, token.index), position: positionAt(lastIndex, token.index) });
        }
        // Using "html" node type because remark-stringify outputs html nodes exactly as-is without escaping.
        newNodes.push({ type: "html", value: token.raw, position: positionAt(token.index, token.end) });
        lastIndex = token.end;
      }

      if (lastIndex < text.length) {
        newNodes.push({ type: "text", value: text.slice(lastIndex), position: positionAt(lastIndex, text.length) });
      }

      parent.children.splice(index, 1, ...newNodes);
      return index + newNodes.length;
    });
  };
}
