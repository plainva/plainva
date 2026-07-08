import { visit } from "unist-util-visit";
import { MarkdownAst, MarkdownListItemNode, MarkdownHtmlNode, MarkdownLinkNode } from "./markdown-ast.js";

function extractText(node: any): string {
  if (!node || !node.children) return "";
  return node.children.map((c: any) => c.value || extractText(c)).join("");
}

/**
 * Toggles the checked status of a task list item.
 * @param ast The markdown AST
 * @param textSnippet A substring of the task text to identify which task to toggle
 * @param newStatus Optional new status. If undefined, toggles current status.
 * @returns true if a task was found and modified, false otherwise.
 */
export function toggleTaskStatusByText(ast: MarkdownAst, textSnippet: string, newStatus?: boolean): boolean {
  let found = false;
  visit(ast as any, "listItem", (node: MarkdownListItemNode) => {
    // Only target list items that are actually tasks (have a checked property)
    if (node.checked !== undefined && node.checked !== null) {
      const text = extractText(node);
      if (text.includes(textSnippet)) {
        node.checked = newStatus !== undefined ? newStatus : !node.checked;
        found = true;
      }
    }
  });
  return found;
}

/**
 * Renames all vault links (wikilinks, embeds, standard markdown links) pointing to oldTarget.
 * Heading/block anchors (`[[Note#H]]`, `note.md#h`) are preserved: matching is
 * done on the target without its `#…` suffix, which is re-attached on rewrite.
 * @param ast The markdown AST
 * @param oldTarget The current target of the link (without anchor)
 * @param newTarget The new target of the link
 * @returns The number of links that were renamed
 */
export function renameVaultLink(ast: MarkdownAst, oldTarget: string, newTarget: string): number {
  let renamedCount = 0;

  const splitAnchor = (target: string): { base: string; anchor: string } => {
    const hashIdx = target.indexOf("#");
    if (hashIdx < 0) return { base: target, anchor: "" };
    return { base: target.slice(0, hashIdx), anchor: target.slice(hashIdx) };
  };

  visit(ast as any, (node: any) => {
    if (node.type === "html") {
      const htmlNode = node as MarkdownHtmlNode;
      const value = htmlNode.value;
      const isEmbed = value.startsWith("![[") && value.endsWith("]]");
      const isLink = value.startsWith("[[") && value.endsWith("]]");

      if (isEmbed || isLink) {
        const prefix = isEmbed ? "![[" : "[[";
        const inner = value.slice(prefix.length, -2);
        const parts = inner.split("|");
        const { base, anchor } = splitAnchor(parts[0]);

        if (base === oldTarget) {
          const alias = parts.length > 1 ? parts.slice(1).join("|") : undefined;
          if (alias) {
            htmlNode.value = `${prefix}${newTarget}${anchor}|${alias}]]`;
          } else {
            htmlNode.value = `${prefix}${newTarget}${anchor}]]`;
          }
          renamedCount++;
        }
      }
    } else if (node.type === "link") {
      const linkNode = node as MarkdownLinkNode;
      try {
        const decoded = splitAnchor(decodeURIComponent(linkNode.url));
        const rawSplit = splitAnchor(linkNode.url);
        if (decoded.base === oldTarget || rawSplit.base === oldTarget) {
           linkNode.url = encodeURI(newTarget) + decoded.anchor;
           renamedCount++;
        }
      } catch {
        // Ignore malformed URIs
      }
    }
  });

  return renamedCount;
}
