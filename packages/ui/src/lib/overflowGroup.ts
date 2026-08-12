/**
 * Fold the surplus of a segmented control into a menu (E4).
 *
 * A row of view pills clipped its FIRST entry as soon as a fourth one joined,
 * and a period selector ran off a 375 px screen entirely. Neither clipping nor
 * sideways scrolling answers it: a clipped name is unreadable, and a row that
 * scrolls hides the fact that anything is missing. In a menu every entry keeps
 * its full name.
 *
 * Two rules make it predictable:
 *
 *  - The ACTIVE entry is always visible. A switcher whose current state lives
 *    in a menu tells you nothing about where you are.
 *  - Order never changes. The visible ones keep their original sequence, so an
 *    entry does not jump to the front just because it was selected — muscle
 *    memory would break every time the choice changed.
 */
export interface OverflowSplit<T> {
  visible: T[];
  overflow: T[];
}

export function splitOverflow<T>(items: T[], limit: number, isActive: (item: T) => boolean): OverflowSplit<T> {
  if (limit < 1 || items.length <= limit) return { visible: items, overflow: [] };

  const activeIndex = items.findIndex(isActive);
  // The menu takes one slot of its own, so the visible run is one shorter than
  // the limit — otherwise the fold would itself cause the overflow it fixes.
  const room = Math.max(1, limit - 1);

  const keep = new Set<number>();
  if (activeIndex >= 0) keep.add(activeIndex);
  for (let i = 0; i < items.length && keep.size < room; i++) keep.add(i);

  const visible: T[] = [];
  const overflow: T[] = [];
  items.forEach((item, i) => (keep.has(i) ? visible : overflow).push(item));
  return { visible, overflow };
}
