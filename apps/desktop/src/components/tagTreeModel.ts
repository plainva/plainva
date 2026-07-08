/** Pure helpers for the sidebar tag tree (kept out of the component so they
 *  are testable without the vault context — same pattern as fileTreeModel). */

export interface TagNode {
  name: string;
  fullTag: string;
  count: number;
  children: Record<string, TagNode>;
  isExpanded: boolean;
}

/** Sidebar search filter (plan Suche O5): keeps a node when its fullTag
 *  contains the query (case-insensitive) or any descendant matches; matching
 *  parents keep their whole subtree (like path filters do). */
export function pruneTagTree(tree: Record<string, TagNode>, query: string): Record<string, TagNode> {
  const q = query.trim().toLowerCase();
  if (!q) return tree;
  const pruned: Record<string, TagNode> = {};
  for (const [key, node] of Object.entries(tree)) {
    if (node.fullTag.toLowerCase().includes(q)) {
      pruned[key] = node;
      continue;
    }
    const children = pruneTagTree(node.children, q);
    if (Object.keys(children).length > 0) {
      pruned[key] = { ...node, children };
    }
  }
  return pruned;
}
