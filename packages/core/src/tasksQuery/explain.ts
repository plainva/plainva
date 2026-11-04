/**
 * The explanation of a Tasks query (the `explain` line, and the block's
 * "Explanation" switch) — as DATA. The interface words it in the app's
 * language; Tasks' own English text is not reproduced.
 *
 * Every instruction line with its state, each date resolved to the days it
 * matches, Boolean instructions as a tree, the default sort Tasks appends, and
 * what Plainva does differently from Obsidian by design: notes with
 * `plainva.tasks: false` count (E13), and the Tasks plugin's own settings —
 * global filter, global query — are named but not applied (E12).
 */

import { addDays, dateValueBounds, type DayKey } from "./dates.js";
import {
  TASKS_DEFAULT_SORTERS,
  type TasksBooleanExpression,
  type TasksDateFieldName,
  type TasksDateOperator,
  type TasksFilter,
  type TasksQuery,
  type TasksQueryLine,
  type TasksSorter,
} from "./parse.js";

/** The days a date filter lets through, inclusive; an open end is absent. */
export interface TasksExplainedDays {
  from?: DayKey;
  to?: DayKey;
}

export type TasksExplainedFilter =
  | (Extract<TasksFilter, { kind: "date" }> & { days: TasksExplainedDays; tasksWithoutDate: boolean })
  | Exclude<TasksFilter, { kind: "date" } | { kind: "boolean" }>
  | { kind: "boolean"; expression: TasksExplainedExpression };

export type TasksExplainedExpression =
  | { op: "and" | "or" | "xor"; left: TasksExplainedExpression; right: TasksExplainedExpression }
  | { op: "not"; operand: TasksExplainedExpression }
  | { op: "filter"; filter: TasksExplainedFilter; source: string };

export interface TasksExplainedLine {
  line: number;
  source: string;
  status: TasksQueryLine["status"];
  /** For an understood filter: what it does, dates resolved. */
  filter?: TasksExplainedFilter;
  instruction?: TasksQueryLine["instruction"];
  unsupported?: TasksQueryLine["unsupported"];
  error?: TasksQueryLine["error"];
}

/** The settings of the Tasks plugin in a vault that change what Obsidian shows. */
export interface TasksPluginSettings {
  globalFilter: string | null;
  globalQuery: string | null;
}

export interface TasksQueryExplanation {
  today: DayKey;
  /** Weeks run Monday to Sunday, whatever the app's week start (E8). */
  weeks: "iso";
  lines: TasksExplainedLine[];
  /** Appended after the query's own sort lines, always. */
  defaultSorters: readonly TasksSorter[];
  /** Notes that opt out of the Tasks tab are searched too (E13). */
  includesNotesOutsideTasksTab: true;
  /** Present when the vault's Tasks plugin has a global filter or query; Plainva does not apply them (E12). */
  plugin?: TasksPluginSettings;
}

/** Which days a date filter matches, as an interval. */
export function tasksExplainedDays(operator: TasksDateOperator, value: Extract<TasksFilter, { kind: "date" }>["value"]): TasksExplainedDays {
  const { from, to } = dateValueBounds(value);
  switch (operator) {
    case "on":
    case "in": return { from, to };
    case "before": return { to: addDays(from, -1) };
    case "after": return { from: addDays(to, 1) };
    case "onOrBefore":
    case "inOrBefore": return { to };
    case "onOrAfter":
    case "inOrAfter": return { from };
  }
}

function explainFilter(filter: TasksFilter): TasksExplainedFilter {
  if (filter.kind === "date") {
    const field: TasksDateFieldName = filter.field;
    return { ...filter, days: tasksExplainedDays(filter.operator, filter.value), tasksWithoutDate: field === "start" };
  }
  if (filter.kind === "boolean") return { kind: "boolean", expression: explainExpression(filter.expression) };
  return filter;
}

function explainExpression(expression: TasksBooleanExpression): TasksExplainedExpression {
  switch (expression.op) {
    case "filter": return { op: "filter", filter: explainFilter(expression.filter), source: expression.source };
    case "not": return { op: "not", operand: explainExpression(expression.operand) };
    default: return { op: expression.op, left: explainExpression(expression.left), right: explainExpression(expression.right) };
  }
}

/**
 * Reads the Tasks plugin's settings file (`.obsidian/plugins/obsidian-tasks-plugin/data.json`)
 * for the two values that change which tasks Obsidian shows. Null for a file
 * that is no JSON object; empty values count as absent.
 */
export function readTasksPluginSettings(json: string): TasksPluginSettings | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
  return { globalFilter: text(record.globalFilter), globalQuery: text(record.globalQuery) };
}

export function explainTasksQuery(query: TasksQuery, plugin?: TasksPluginSettings | null): TasksQueryExplanation {
  const lines = query.lines.map((line): TasksExplainedLine => {
    const out: TasksExplainedLine = { line: line.line, source: line.source, status: line.status };
    if (line.instruction) {
      out.instruction = line.instruction;
      if (line.instruction.type === "filter") out.filter = explainFilter(line.instruction.filter);
    }
    if (line.unsupported) out.unsupported = line.unsupported;
    if (line.error) out.error = line.error;
    return out;
  });
  return {
    today: query.today,
    weeks: "iso",
    lines,
    defaultSorters: TASKS_DEFAULT_SORTERS,
    includesNotesOutsideTasksTab: true,
    ...(plugin && (plugin.globalFilter !== null || plugin.globalQuery !== null) ? { plugin } : {}),
  };
}
