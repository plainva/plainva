import { DATABASE_METADATA } from "@plainva/core";
import { buildUIFilterModel } from "./filterExpr";

/**
 * What a new entry inherits from the VIEW it is created in, so it does not
 * vanish from that view the moment it exists (plan Befunde 2026-09-24, E16).
 *
 * One rule for both shells. The phone read the active view's simple rules;
 * the desktop read `config.filters.and` — which, since property filters moved
 * into the views (`migrateFiltersToPerView`), holds nothing but source
 * conditions, so a desktop entry in a filtered view came out without the very
 * value the view filters on.
 *
 * Covered under ALL logic: `==` rules (typed by the column's input) and
 * `contains` on a list-valued column; `file.tags` rules become tags. Relation
 * and link columns, other `file.` keys and formulas are never pre-filled — a
 * guessed link is worse than none.
 */
export interface ViewPrefill {
  /** Frontmatter values keyed by the bare property name. */
  props: Record<string, unknown>;
  /** Tags the view requires (without `#`). */
  tags: string[];
}

export function viewPrefill(
  config: any,
  viewIndex: number,
  getInput?: (column: string) => string | undefined,
): ViewPrefill {
  const out: ViewPrefill = { props: {}, tags: [] };
  const views = Array.isArray(config?.views) ? config.views : [];
  const view = views[viewIndex] ?? views[0];
  if (!view) return out;
  const model = buildUIFilterModel(view);
  if (model.topLogic !== "all") return out;
  const inputOf = (col: string): string | undefined => {
    const given = getInput?.(col);
    if (given) return given;
    const schema = config?.columns?.[col];
    return schema && typeof schema.input === "string" ? schema.input : undefined;
  };
  for (const entry of model.entries) {
    if (entry.kind !== "rule") continue;
    const { column, op, value } = entry.rule;
    if (!value) continue;
    if (column === DATABASE_METADATA.tags) {
      if (op === "==" || op === "contains") {
        const tag = value.replace(/^#/, "");
        if (tag && !out.tags.includes(tag)) out.tags.push(tag);
      }
      continue;
    }
    const col = column.replace(/^note\./, "");
    if (col.startsWith("file.") || col.startsWith("formula.")) continue;
    const input = inputOf(col);
    if (input === "relation" || input === "link") continue;
    if (op === "==") {
      out.props[col] =
        input === "number" && value.trim() !== "" && !Number.isNaN(Number(value)) ? Number(value)
          : input === "checkbox" ? value === "true"
            : input === "multiselect" || input === "list" ? [value]
              : value;
    } else if (op === "contains" && (input === "multiselect" || input === "list")) {
      const prev = out.props[col];
      out.props[col] = Array.isArray(prev) ? (prev.includes(value) ? prev : [...prev, value]) : [value];
    }
  }
  return out;
}
