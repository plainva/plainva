/**
 * Board column ordering (report 2026-07-07). Columns default to the group
 * property's option order (select/status boards) or a per-view saved order
 * (relation/text boards) — never plain alphabetical, which used to discard the
 * option order. `__UNGROUPED__` sits last unless a saved order pins it earlier.
 */

import { reorderShown } from "./pinboardModel";

export const UNGROUPED_KEY = "__UNGROUPED__";

/**
 * Order the present group keys. Precedence: the property's option order first
 * (select/status default; a drag reorders those options), then the per-view
 * saved order (relation/text boards + manual layout), then remaining ad-hoc
 * values alphabetically, with the "no value" column last.
 */
export function orderBoardGroups(
  groupKeys: string[],
  opts: { optionOrder?: string[]; savedOrder?: string[] } = {}
): string[] {
  const present = new Set(groupKeys);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (k: string) => {
    if (present.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  };
  for (const k of opts.optionOrder ?? []) push(k);
  for (const k of opts.savedOrder ?? []) push(k);
  const rest = groupKeys
    .filter((k) => !seen.has(k) && k !== UNGROUPED_KEY)
    .sort((a, b) => a.localeCompare(b));
  for (const k of rest) push(k);
  push(UNGROUPED_KEY);
  return out;
}

/** Move `fromKey` so it sits directly before `toKey` in the given order. */
export function reorderBoardKeys(order: string[], fromKey: string, toKey: string): string[] {
  if (fromKey === toKey || !order.includes(fromKey) || !order.includes(toKey)) return order;
  const next = order.filter((k) => k !== fromKey);
  next.splice(next.indexOf(toKey), 0, fromKey);
  return next;
}

/**
 * The saved column order of a board (`boardColumnOrder`) after its shown
 * columns were dragged into `shownInNewOrder`.
 *
 * Columns the board does not show (a search or a scope hides every card in
 * them) keep their places: `wholeOrder` is the board's order of ALL its
 * columns, as it stands without the search. Where it holds a column that is
 * not shown, that order is written first, so a hidden column that was never
 * saved stays where it stood instead of falling behind "No value" (finding
 * B17 of the 0.9.0 defect list). Where everything is shown, the saved order
 * is reordered as it always was. Saved columns that are gone stay saved.
 */
export function boardOrderAfterMove(
  stored: readonly string[],
  shownInNewOrder: readonly string[],
  wholeOrder?: readonly string[],
): string[] {
  const shown = new Set(shownInNewOrder);
  if (!wholeOrder || wholeOrder.every((k) => shown.has(k))) return reorderShown(stored, shownInNewOrder);
  return reorderShown(reorderShown(stored, wholeOrder), shownInNewOrder);
}
