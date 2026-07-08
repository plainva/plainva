import { parseWikiLinkValue } from "../propertyModel";

/**
 * Flat query rows -> hierarchical display list for the table's sub-items mode
 * (Gesamtplan Base-Relationen, P10; Notion "Sub-items"). Pure and DB-free.
 *
 * Semantics:
 * - The parent reference is the row's self-relation value (a wiki link; lists
 *   use their first entry). It resolves against the FILTERED result set only —
 *   a parent outside the result makes the child a top-level row.
 * - Sibling order preserves the input order, so the query's sort applies per
 *   nesting level for free.
 * - Collapsed nodes contribute their child count but no descendants.
 * - Cycle guard: a covered-set DFS emits every row exactly once; rows only
 *   reachable through a cycle become additional top-level roots in input order.
 * - Duplicate titles: the first row wins the title mapping (vault convention).
 */

export interface SubItemNode<R = unknown> {
  row: R;
  depth: number;
  hasChildren: boolean;
  childCount: number;
  isExpanded: boolean;
}

export function buildSubItemsTree<R>(
  rows: R[],
  opts: {
    keyOf(r: R): string;
    titleOf(r: R): string;
    parentRefOf(r: R): unknown;
    expandedKeys: ReadonlySet<string>;
    maxDepth?: number;
  }
): SubItemNode<R>[] {
  const maxDepth = opts.maxDepth ?? 32;
  const byKey = new Map<string, R>();
  const refIndex = new Map<string, string>(); // lowercase title/path/path-sans-md -> key

  for (const r of rows) {
    const key = opts.keyOf(r);
    if (byKey.has(key)) continue;
    byKey.set(key, r);
    const title = opts.titleOf(r).toLowerCase();
    if (!refIndex.has(title)) refIndex.set(title, key);
    const lower = key.toLowerCase();
    if (!refIndex.has(lower)) refIndex.set(lower, key);
    const sansMd = lower.replace(/\.md$/, "");
    if (!refIndex.has(sansMd)) refIndex.set(sansMd, key);
  }

  const parentKeyOf = (r: R): string | null => {
    let ref = opts.parentRefOf(r);
    if (Array.isArray(ref)) ref = ref[0];
    if (typeof ref !== "string" || !ref.trim()) return null;
    const target = (parseWikiLinkValue(ref)?.target ?? ref).trim().toLowerCase();
    const key = refIndex.get(target) ?? refIndex.get(`${target}.md`) ?? null;
    return key !== null && key !== opts.keyOf(r) ? key : null;
  };

  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const r of rows) {
    const key = opts.keyOf(r);
    if (byKey.get(key) !== r) continue; // duplicate key — first occurrence won
    const parent = parentKeyOf(r);
    if (parent === null) {
      roots.push(key);
    } else {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent)!.push(key);
    }
  }

  const out: SubItemNode<R>[] = [];
  const covered = new Set<string>();
  const walk = (key: string, depth: number, emit: boolean) => {
    covered.add(key);
    const row = byKey.get(key)!;
    const kids = children.get(key) ?? [];
    const fresh = kids.filter((k) => !covered.has(k));
    const isExpanded = fresh.length > 0 && opts.expandedKeys.has(key);
    if (emit) out.push({ row, depth, hasChildren: fresh.length > 0, childCount: fresh.length, isExpanded });
    const descend = emit && isExpanded && depth + 1 <= maxDepth;
    for (const kid of fresh) walk(kid, depth + 1, descend);
  };

  for (const key of roots) walk(key, 0, true);
  // Rows unreachable from any root (pure cycles) surface as top-level roots.
  for (const r of rows) {
    const key = opts.keyOf(r);
    if (!covered.has(key) && byKey.get(key) === r) walk(key, 0, true);
  }
  return out;
}
