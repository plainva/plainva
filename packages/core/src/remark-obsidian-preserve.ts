import { visit } from "unist-util-visit";
import { wikiLinkMatcher } from "./linkScan.js";

/** `[!info]`: ASCII letters and `-` between `[!` and `]`. */
function calloutAt(text: string, at: number): { index: number; end: number; raw: string } | null {
  if (text[at] !== "[" || text[at + 1] !== "!") return null;
  let end = at + 2;
  while (end < text.length && /[a-zA-Z-]/.test(text[end])) end++;
  if (end === at + 2 || text[end] !== "]") return null;
  return { index: at, end: end + 1, raw: text.slice(at, end + 1) };
}

/**
 * Wikilinks [[...]], embeds ![[...]] and callouts [!info] in one text: what
 * `/(!?\[\[.*?\]\]|\[![a-zA-Z-]+\])/g` found, read in one pass (plan Befunde
 * 24.09., E6). The pattern looked for `]]` again from every `[[`, quadratic on
 * a long run of `[`.
 */
function* preservedTokens(text: string): Generator<{ index: number; end: number; raw: string }> {
  const wikiAt = wikiLinkMatcher(text, { bang: true, anyInLine: true });
  for (let at = 0; at < text.length; ) {
    const token = wikiAt(at) ?? calloutAt(text, at);
    if (token) {
      yield token;
      at = token.end;
    } else at++;
  }
}

export default function remarkObsidianPreserve() {
  return (tree: any) => {
    visit(tree, "text", (node: any, index: number | undefined, parent: any) => {
      if (typeof index !== "number" || !parent) return;

      const text = node.value;
      if (typeof text !== "string") return;
      // Matches wikilinks [[...]], embeds ![[...]], and callouts [!info]
      const tokens = [...preservedTokens(text)];

      if (tokens.length === 0) return;

      const newNodes: any[] = [];
      let lastIndex = 0;

      // The split nodes keep a position (Build-91 feedback, P7): a wiki link's
      // line is what its backlink shows as its place, and the scanner reads it
      // from `position.start.line`. Derived from the text node's own start —
      // the line advances by the newlines before the match, the offset by its
      // index; the column is only exact on the first line and approximate after.
      // The newlines are found once: counting them again in the text up to
      // every match was quadratic in a long paragraph of links (E6).
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
