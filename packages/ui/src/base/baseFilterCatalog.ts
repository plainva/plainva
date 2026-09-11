import type { TFunction } from "i18next";
import { DATABASE_METADATA, databaseFilterValue, normalizeDatabaseFilterValue } from "@plainva/core";
import type { FilterOp } from "./filterExpr";

export type BaseFilterKind = "property" | "color" | "icon" | "tags" | "labels";
export interface BaseFilterField { column: string; label: string; kind: BaseFilterKind }

/** One vocabulary for both shells. Pinboard labels name their actual source;
 * the default tag source never becomes a second identical filter. */
export function baseFilterCatalog(
  columns: readonly string[],
  columnLabel: (column: string) => string,
  t: TFunction,
  labelProperty?: string,
): BaseFilterField[] {
  const label = labelProperty && labelProperty !== "tags" ? labelProperty.replace(/^note\./, "") : undefined;
  return [
    { column: DATABASE_METADATA.color, label: t("database.filterColor"), kind: "color" },
    { column: DATABASE_METADATA.icon, label: t("database.filterIcon"), kind: "icon" },
    { column: DATABASE_METADATA.tags, label: t("database.filterTags"), kind: "tags" },
    ...[...new Set([...columns, ...(label ? [label] : [])])]
      .filter((column) => column !== "plainva" && !Object.values(DATABASE_METADATA).includes(column as typeof DATABASE_METADATA[keyof typeof DATABASE_METADATA]))
      .map((column): BaseFilterField => ({
        column,
        label: column === label ? t("database.filterLabelsFrom", { property: columnLabel(column) })
          : column.replace(/^note\./, "").toLowerCase() === "tags" ? t("database.filterPropertyTags", { property: columnLabel(column) }) : columnLabel(column),
        kind: column === label ? "labels" : "property",
      })),
  ];
}

export function baseFilterKind(column: string): BaseFilterKind {
  if (column === DATABASE_METADATA.color) return "color";
  if (column === DATABASE_METADATA.icon) return "icon";
  if (column === DATABASE_METADATA.tags) return "tags";
  return "property";
}

export function baseFilterOperators(kind: BaseFilterKind): FilterOp[] | null {
  if (kind === "tags") return ["contains", "notContains", "empty", "notEmpty"];
  if (kind === "color" || kind === "icon" || kind === "labels") return ["==", "!=", "empty", "notEmpty"];
  return null;
}

export function baseFilterOpLabels(t: TFunction, isDate = false): Record<FilterOp, string> {
  return {
    "==": t("database.opIs"), "!=": t("database.opIsNot"),
    contains: t("database.opContains"), notContains: t("database.opNotContains"),
    ">": t(isDate ? "database.opAfter" : "database.opGt"),
    "<": t(isDate ? "database.opBefore" : "database.opLt"),
    ">=": t(isDate ? "database.opFrom" : "database.opGte"),
    "<=": t(isDate ? "database.opUntil" : "database.opLte"),
    empty: t("database.opEmpty"), notEmpty: t("database.opNotEmpty"),
  };
}

/** Source rows, not matches; retain values no longer present in the vault. */
export function baseFilterValues(rows: ReadonlyArray<Record<string, unknown>>, column: string, current = ""): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    const raw = databaseFilterValue(row, column);
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
      const text = normalizeDatabaseFilterValue(column, String(value));
      if (text !== "") values.add(text);
    }
  }
  if (current) values.add(current);
  return [...values].sort((a, b) => a.localeCompare(b));
}
