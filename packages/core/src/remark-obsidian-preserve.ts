import { visit } from "unist-util-visit";

export default function remarkObsidianPreserve() {
  return (tree: any) => {
    visit(tree, "text", (node: any, index: number | undefined, parent: any) => {
      if (typeof index !== "number" || !parent) return;

      const text = node.value;
      // Matches wikilinks [[...]], embeds ![[...]], and callouts [!info]
      const regex = /(!?\[\[.*?\]\]|\[![a-zA-Z-]+\])/g;

      if (!regex.test(text)) return;

      const newNodes: any[] = [];
      let lastIndex = 0;
      regex.lastIndex = 0;

      // The split nodes keep a position (Build-91 feedback, P7): a wiki link's
      // line is what its backlink shows as its place, and the scanner reads it
      // from `position.start.line`. Derived from the text node's own start —
      // the line advances by the newlines before the match, the offset by its
      // index; the column is only exact on the first line and approximate after.
      const start = node.position?.start;
      const positionAt = (from: number, to: number) => {
        if (!start) return undefined;
        const before = text.slice(0, from);
        const inside = text.slice(from, to);
        const lineFrom = start.line + (before.match(/\n/g)?.length ?? 0);
        const lineTo = lineFrom + (inside.match(/\n/g)?.length ?? 0);
        const col = (upTo: string) => (upTo.includes("\n") ? upTo.length - upTo.lastIndexOf("\n") : start.column + upTo.length);
        return {
          start: { line: lineFrom, column: col(before), offset: typeof start.offset === "number" ? start.offset + from : undefined },
          end: { line: lineTo, column: col(text.slice(0, to)), offset: typeof start.offset === "number" ? start.offset + to : undefined },
        };
      };

      let match;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          newNodes.push({ type: "text", value: text.slice(lastIndex, match.index), position: positionAt(lastIndex, match.index) });
        }
        // Using "html" node type because remark-stringify outputs html nodes exactly as-is without escaping.
        newNodes.push({ type: "html", value: match[0], position: positionAt(match.index, regex.lastIndex) });
        lastIndex = regex.lastIndex;
      }

      if (lastIndex < text.length) {
        newNodes.push({ type: "text", value: text.slice(lastIndex), position: positionAt(lastIndex, text.length) });
      }

      parent.children.splice(index, 1, ...newNodes);
      return index + newNodes.length;
    });
  };
}
