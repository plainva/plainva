/**
 * File-list equality for the file tree (autosave-lag fix).
 *
 * Every autosave bumps `fileTreeVersion`, which re-queries the file list. Without
 * this guard `setFiles` handed back a NEW array each time, so `buildTree()`
 * rebuilt the whole tree (500+ nodes) and the tree re-rendered on every
 * keystroke-save — a synchronous main-thread stall that made typing lag during
 * saves. A content-only save does not change the list (same paths/titles/mode),
 * so the tree can keep its previous reference and skip the rebuild.
 */
export type TreeFile = {
  path: string;
  title: string;
  mode?: string;
  isDir?: boolean;
  snippet?: string | null;
  titleHl?: string | null;
};

/** True when two file lists are equal for tree purposes (path/title/mode/isDir). */
export function sameTreeFiles(a: TreeFile[], b: TreeFile[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].path !== b[i].path || a[i].title !== b[i].title || a[i].mode !== b[i].mode || a[i].isDir !== b[i].isDir) {
      return false;
    }
  }
  return true;
}
