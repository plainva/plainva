import { visit } from "unist-util-visit";
import { MarkdownAst, MarkdownListItemNode } from "./markdown-ast.js";

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

// Renaming the target of a link is no change to a tree: a note written back
// from its tree comes back in the serializer's form. `renameNoteLinks` in
// linkRewrite.ts changes the link where it stands in the text.
