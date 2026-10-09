import { buildLinkTargetIndex, linkTargetName, resolveLinkTargetIndexed } from "@plainva/core";
import { parseWikiLinkValue } from "./propertyModel";

/**
 * Flat query rows -> hierarchical display list for the table's sub-items mode
 * (Gesamtplan Base-Relationen, P10; Notion "Sub-items"). Pure and DB-free —
 * shared since S21 so the phone nests the same way rather than approximating
 * it: the cycle guard and the "parent outside the result set" rule are the
 * kind of detail two implementations get subtly different.
 *
 * Semantics:
 * - The parent reference is the row's self-relation value (a wiki link; lists
 *   use their first entry). Where it leads is the link rule's answer for the
 *   vault (`resolveRef`); a parent outside the FILTERED result set makes the
 *   child a top-level row.
 * - Sibling order preserves the input order, so the query's sort applies per
 *   nesting level for free.
 * - Collapsed nodes contribute their child count but no descendants.
 * - Cycle guard: a covered-set DFS emits every row exactly once; rows only
 *   reachable through a cycle become additional top-level roots in input order.
 * - Two notes of one name: the link rule's order decides — the note beside
 *   the child's own, then the shorter path, then the alphabet.
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
    /**
     * Where a link leads in the vault — the link rule over ALL its files, as a
     * click on the link is answered (`wikiTargetPath` over the shell's lookup).
     * With it a row is the parent only where the link leads to that row: of two
     * notes of one name, one in the result and one outside, the table nests
     * under the one the chip opens, or not at all. Absent (the lookup is not
     * loaded yet, or there is no index), the rows of the result stand in for
     * the vault.
     */
    resolveRef?(fromPath: string, target: string): string | null;
  }
): SubItemNode<R>[] {
  const maxDepth = opts.maxDepth ?? 32;
  const byKey = new Map<string, R>();
  const corpus: { path: string; title: string }[] = [];

  for (const r of rows) {
    const key = opts.keyOf(r);
    if (byKey.has(key)) continue;
    byKey.set(key, r);
    corpus.push({ path: key, title: opts.titleOf(r) });
  }
  // Which row a parent link means is the link rule's answer (`LinkResolver.ts`
  // in the core): the file's name, part of its path or the title of its
  // properties, read from the child's own folder. A set of lowercased titles
  // and paths used to stand here — a row with a title of its own was not found
  // under its file's name (finding 2026-10-08).
  const rowsOnly = opts.resolveRef ? null : buildLinkTargetIndex(corpus);

  const parentKeyOf = (r: R): string | null => {
    let ref = opts.parentRefOf(r);
    if (Array.isArray(ref)) ref = ref[0];
    if (typeof ref !== "string" || !ref.trim()) return null;
    const own = opts.keyOf(r);
    const target = linkTargetName(parseWikiLinkValue(ref)?.target ?? ref);
    const key = rowsOnly ? resolveLinkTargetIndexed(own, target, rowsOnly) : opts.resolveRef!(own, target);
    // A parent outside the result set makes the child a top-level row.
    return key !== null && key !== own && byKey.has(key) ? key : null;
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
