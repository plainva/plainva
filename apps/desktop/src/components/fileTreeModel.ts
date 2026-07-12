/**
 * Pure model of the file tree (plan UI-UX-Paket P7/P9): tree building, the
 * visible row order, Explorer-style click selection, bulk-path pruning and
 * duplicate names. Kept free of React so every rule is unit-testable.
 */

export interface TreeNode {
  name: string;
  path: string; // "" for root
  title?: string;
  mode?: string;
  children?: Record<string, TreeNode>;
}

export interface TreeFileRow {
  path: string;
  title: string;
  mode?: string;
  isDir?: boolean;
}

export const buildTree = (files: TreeFileRow[]): TreeNode => {
  const root: TreeNode = { name: "root", path: "", children: {} };

  for (const file of files) {
    const parts = file.path.split(/[/\\]/);
    let current = root;
    let currentPath = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!current.children) current.children = {};

      if (i === parts.length - 1) {
        if (file.isDir) {
          if (!current.children[part]) {
            current.children[part] = { name: part, path: currentPath, children: {} };
          }
        } else {
          current.children[part] = { name: part, path: file.path, title: file.title, mode: file.mode };
        }
      } else {
        // It's a folder
        if (!current.children[part]) {
          current.children[part] = { name: part, path: currentPath, children: {} };
        }
        current = current.children[part];
      }
    }
  }
  return root;
};

/** Render order of a folder's children: the folder's own index.md first, then
 *  subfolders, then files, each A-Z. Leading with index.md keeps the folder
 *  overview at the start of the list instead of at "i" among the files (Issue #9). */
export function sortedChildren(node: TreeNode): TreeNode[] {
  return Object.values(node.children || {}).sort((a, b) => {
    const aIsIndex = !a.children && a.name.toLowerCase() === "index.md";
    const bIsIndex = !b.children && b.name.toLowerCase() === "index.md";
    if (aIsIndex !== bIsIndex) return aIsIndex ? -1 : 1;
    const aIsFolder = !!a.children;
    const bIsFolder = !!b.children;
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** Parent folder of a vault path ("" for root-level entries). */
export function parentOf(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i < 0 ? "" : norm.slice(0, i);
}

/** All ancestor folders of a path, outermost first (the path itself excluded). */
export function ancestorsOf(path: string): string[] {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur ? `${cur}/${parts[i]}` : parts[i];
    out.push(cur);
  }
  return out;
}

/** Every folder path present in the rows (explicit dirs + all file ancestors). */
export function collectFolderPaths(files: TreeFileRow[]): Set<string> {
  const folders = new Set<string>();
  for (const f of files) {
    if (f.isDir) folders.add(f.path.replace(/\\/g, "/"));
    for (const a of ancestorsOf(f.path)) folders.add(a);
  }
  return folders;
}

/** Where "+ Neu" creates: the selected folder, or the selected file's parent. */
export function resolveCreateTarget(sel: { path: string; isFolder: boolean } | null): string {
  if (!sel || !sel.path) return "";
  return sel.isFolder ? sel.path : parentOf(sel.path);
}

export interface VisibleEntry {
  path: string;
  isFolder: boolean;
}

/**
 * The tree rows currently on screen, in render order (folders first per level,
 * children only when their folder is expanded). Shift-range selection walks this.
 */
export function flattenVisibleTree(root: TreeNode, expanded: Set<string>): VisibleEntry[] {
  const out: VisibleEntry[] = [];
  const walk = (node: TreeNode) => {
    for (const child of sortedChildren(node)) {
      const isFolder = !!child.children;
      out.push({ path: child.path, isFolder });
      if (isFolder && expanded.has(child.path)) walk(child);
    }
  };
  walk(root);
  return out;
}

/**
 * Explorer-style click reducer: plain click replaces the selection, Ctrl/Meta
 * toggles, Shift selects the visible range from the anchor (replacing the
 * selection, anchor unchanged). Unknown anchors fall back to a plain click.
 */
export function applyClickSelection(
  prev: Set<string>,
  anchor: string | null,
  visible: VisibleEntry[],
  path: string,
  mode: "single" | "toggle" | "range",
): { selection: Set<string>; anchor: string } {
  if (mode === "toggle") {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return { selection: next, anchor: path };
  }
  if (mode === "range" && anchor) {
    const ai = visible.findIndex((v) => v.path === anchor);
    const bi = visible.findIndex((v) => v.path === path);
    if (ai !== -1 && bi !== -1) {
      const [from, to] = ai <= bi ? [ai, bi] : [bi, ai];
      return { selection: new Set(visible.slice(from, to + 1).map((v) => v.path)), anchor };
    }
  }
  return { selection: new Set([path]), anchor: path };
}

/** Drops paths nested inside another selected folder — bulk ops act on roots. */
export function pruneNestedPaths(paths: Iterable<string>): string[] {
  const list = [...paths].sort();
  const roots: string[] = [];
  for (const p of list) {
    if (!roots.some((r) => p === r || p.startsWith(r + "/"))) roots.push(p);
  }
  return roots;
}

/**
 * n-th duplicate name: "a/Note.md" → "a/Note (Kopie).md", then "(Kopie 2)" …
 * The suffix word is localized by the caller; extension-less names just append.
 */
export function copyCandidate(path: string, suffix: string, n: number): string {
  const norm = path.replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  const dir = slash < 0 ? "" : norm.slice(0, slash + 1);
  const name = slash < 0 ? norm : norm.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const marker = n <= 1 ? ` (${suffix})` : ` (${suffix} ${n})`;
  return `${dir}${stem}${marker}${ext}`;
}
