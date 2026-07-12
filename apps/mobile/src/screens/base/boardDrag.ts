import { UNGROUPED_KEY, parseWikiLinkValue } from "@plainva/ui";

/** Group key of a single stored entry — wiki links group by their display text. */
function entryKey(v: string): string {
  return parseWikiLinkValue(v)?.display ?? v;
}

/**
 * Value a board card drop writes into the groupBy property (E1).
 * Multi-value cells keep their other entries; the dragged group value is
 * swapped for the target column. Dropping on "no value" clears the membership.
 */
export function boardDropValue(raw: unknown, fromKey: string, overKey: string): unknown {
  if (Array.isArray(raw)) {
    const rest = raw.map(String).filter((v) => entryKey(v) !== fromKey);
    return overKey === UNGROUPED_KEY ? rest : [overKey, ...rest];
  }
  return overKey === UNGROUPED_KEY ? "" : overKey;
}
