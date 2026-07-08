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

      let match;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          newNodes.push({ type: "text", value: text.slice(lastIndex, match.index) });
        }
        // Using "html" node type because remark-stringify outputs html nodes exactly as-is without escaping.
        newNodes.push({ type: "html", value: match[0] });
        lastIndex = regex.lastIndex;
      }

      if (lastIndex < text.length) {
        newNodes.push({ type: "text", value: text.slice(lastIndex) });
      }

      parent.children.splice(index, 1, ...newNodes);
      return index + newNodes.length;
    });
  };
}
