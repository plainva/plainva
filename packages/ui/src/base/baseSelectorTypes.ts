/**
 * Which property input types each view-specific `.base` config selector can
 * actually use (maintainer 2026-07-18). A selector that only makes sense for
 * certain property kinds must offer ONLY those kinds — otherwise the config
 * lets you pick a value the view silently ignores. The pinboard label source
 * already did this (tags + multiselect); this generalizes the pattern to the
 * date field, board grouping and gallery cover.
 *
 * Pure presentation metadata — no `.base` format change, Obsidian compat
 * untouched. Shared by the desktop config panel and the mobile config sheet so
 * the two never diverge, and unit-tested here.
 */

export type BaseSelectorKind = "dateField" | "boardGroup" | "galleryCover";

interface SelectorSpec {
  /** Compatible `column.input` values. */
  types: readonly string[];
  /** Whether an untyped property (no `input`) is acceptable. */
  allowUntyped: boolean;
}

const SELECTOR_INPUTS: Record<BaseSelectorKind, SelectorSpec> = {
  // Calendar/timeline placement needs a real date value.
  dateField: { types: ["date", "datetime"], allowUntyped: false },
  // Board columns come from a curated option set or a relation; grouping by
  // free text/date/number would make one column per distinct value (noise).
  // `link` is the legacy alias of a relation column.
  boardGroup: { types: ["select", "status", "multiselect", "relation", "link"], allowUntyped: false },
  // A gallery cover holds an image reference (a path, an `![[...]]` embed or an
  // http(s) URL). That lives in a text or url property — and an untyped
  // property is text by default, so it counts too (excluding it would empty the
  // picker on the many vaults whose properties carry no explicit type).
  galleryCover: { types: ["text", "url"], allowUntyped: true },
};

/**
 * True if `input` is a property type the selector can display. Reverse-relation
 * columns count as relations for board grouping (they have no own `input`).
 */
export function baseSelectorAcceptsInput(
  kind: BaseSelectorKind,
  input: string | undefined,
  isReverse = false,
): boolean {
  if (kind === "boardGroup" && isReverse) return true;
  const spec = SELECTOR_INPUTS[kind];
  if (input === undefined || input === "") return spec.allowUntyped;
  return spec.types.includes(input);
}

/**
 * Filter a column list to the property types a selector can display. The
 * currently-selected column is ALWAYS kept (prepended if it would drop) so an
 * existing — possibly incompatible — saved config value never silently
 * disappears from the picker (same guard the filter-operator dropdown uses).
 */
export function columnsForBaseSelector(
  kind: BaseSelectorKind,
  columns: readonly string[],
  getInput: (c: string) => string | undefined,
  opts?: { current?: string | null; isReverse?: (c: string) => boolean },
): string[] {
  const kept = columns.filter((c) => baseSelectorAcceptsInput(kind, getInput(c), opts?.isReverse?.(c)));
  const cur = opts?.current;
  if (cur && !kept.includes(cur) && columns.includes(cur)) return [cur, ...kept];
  return kept;
}
