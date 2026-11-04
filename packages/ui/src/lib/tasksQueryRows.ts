import {
  explainTasksQuery,
  type TaskRecord,
  type TasksExplainedDays,
  type TasksExplainedExpression,
  type TasksExplainedFilter,
  type TasksGroupHeading,
  type TasksPluginSettings,
  type TasksQuery,
  type TasksQueryGroup,
  type TasksQueryItem,
  type TasksQueryLayout,
  type TasksQueryLine,
  type TasksQueryResult,
} from "@plainva/core";
import { noteDisplayName } from "./noteTitle";
import type { PlannerRow, PlannerSection, TaskState } from "./taskPlanner";
import { plannerRowsFromTasks, plannerTaskId } from "./taskPlannerRows";
import type { PlannerRowDisplay } from "../components/TaskPlannerList";

/**
 * A Tasks query's result as the planner draws it (plan Tasks-Abfragen, T3):
 * the core's groups become planner sections with a heading in the app's
 * language, its tasks become planner rows, and every line the query has a
 * word to say about — a hint, an error, the explanation — becomes a sentence.
 * Pure: the component hands in `t` and the locale.
 */

/** How many top-level rows a block draws before it offers "Show all n" (E6). */
export const TASKS_QUERY_DRAW_LIMIT = 100;

export type TasksQueryT = (key: string, options?: Record<string, unknown>) => string;

/** A line the block says something about: its number, its text, and the sentence. */
export interface TasksQueryLineNote {
  line: number;
  source: string;
  text: string;
}

export interface TasksQueryView {
  status: "ok";
  sections: PlannerSection[];
  /** Rows of every subtask shown under a task (`show tree`); absent without the tree. */
  subtasks?: PlannerRow[];
  /** Matching tasks, and those shown after `limit` / `limit groups`. */
  total: number;
  shown: number;
  /** Top-level rows not drawn yet (more than 100 and "Show all" not pressed). */
  hidden: number;
  display: PlannerRowDisplay;
  layout: TasksQueryLayout;
  notices: TasksQueryLineNote[];
}

export interface TasksQueryErrorView {
  status: "error";
  errors: TasksQueryLineNote[];
}

const dayFormat = (locale: string, withYear: boolean) =>
  new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}) });

/** A day key as a heading or in a sentence: "Wednesday, 4 November" (with the year outside this one). */
export function tasksQueryDayText(day: string, locale: string, today: string, alwaysYear = false): string {
  const [y, m, d] = day.split("-").map(Number);
  return dayFormat(locale, alwaysYear || day.slice(0, 4) !== today.slice(0, 4)).format(new Date(y, m - 1, d));
}

const STATUS_TYPE_KEY: Record<string, string> = {
  TODO: "tasks.open",
  IN_PROGRESS: "tasks.stateProgress",
  DONE: "tasks.done",
  CANCELLED: "tasks.stateCancelled",
  ON_HOLD: "tasksQuery.statusOnHold",
  NON_TASK: "tasksQuery.statusNonTask",
};
const PRIORITY_KEY: Record<string, string> = {
  highest: "tasksQuery.priorityHighest",
  high: "tasks.priorityHigh",
  medium: "tasks.priorityMedium",
  none: "tasks.priorityNone",
  low: "tasks.priorityLow",
  lowest: "tasksQuery.priorityLowest",
};
const NO_DATE_KEY: Record<string, string> = {
  due: "tasksQuery.groupNoDue",
  scheduled: "tasksQuery.groupNoScheduled",
  start: "tasksQuery.groupNoStart",
  done: "tasksQuery.groupNoDone",
  created: "tasksQuery.groupNoCreated",
  cancelled: "tasksQuery.groupNoCancelled",
  happens: "tasksQuery.groupNoHappens",
};

/** A group heading in the app's language (E15) — the words of the Tasks tab, not Tasks' own. */
export function tasksQueryGroupLabel(heading: TasksGroupHeading, t: TasksQueryT, locale: string, today: string): string {
  switch (heading.key) {
    case "status": return t(heading.done ? "tasks.done" : "tasks.open");
    case "statusType": return t(STATUS_TYPE_KEY[heading.type]);
    case "priority": return t("tasksQuery.groupPriority", { level: t(PRIORITY_KEY[heading.level]) });
    case "urgency": return t("tasksQuery.groupUrgency", { value: new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(heading.urgency) });
    case "recurring": return t(heading.recurring ? "tasksQuery.groupRecurring" : "tasksQuery.groupNotRecurring");
    case "recurrence": return heading.rule ?? t("tasksQuery.groupNoRecurrence");
    case "tags": return heading.tag ?? t("tasksQuery.groupNoTags");
    case "path": return heading.path;
    case "root": return heading.root;
    case "folder": return heading.folder;
    case "filename": return heading.filename;
    case "backlink": return heading.heading ? `${noteDisplayName(heading.path)} › ${heading.heading}` : noteDisplayName(heading.path);
    case "heading": return heading.heading ?? t("tasksQuery.groupNoHeading");
    default:
      if (heading.invalid) return t("tasksQuery.groupInvalidDate");
      return heading.day ? tasksQueryDayText(heading.day, locale, today) : t(NO_DATE_KEY[heading.key]);
  }
}

/** The sentence for a line Plainva leaves out (case a): why, and what that means for the list. */
export function tasksQueryNoticeText(line: TasksQueryLine, t: TasksQueryT): string {
  const u = line.unsupported!;
  return `${t(`tasksQuery.unsupported.${u.reason}`)} ${t(`tasksQuery.effect.${u.effect}`)}`;
}

/** The sentence for a line Tasks rejects too (case c). */
export function tasksQueryErrorText(line: TasksQueryLine, t: TasksQueryT): string {
  return t(`tasksQuery.error.${line.error!.reason}`);
}

const noteOf = (line: TasksQueryLine, text: string): TasksQueryLineNote => ({ line: line.line, source: line.source, text });

export function tasksQueryErrors(query: TasksQuery, t: TasksQueryT): TasksQueryErrorView {
  return { status: "error", errors: query.errors.map((line) => noteOf(line, tasksQueryErrorText(line, t))) };
}

function itemsOf(group: TasksQueryGroup): TasksQueryItem[] {
  return group.groups.length > 0 ? group.groups.flatMap(itemsOf) : group.items;
}

/**
 * The result as planner sections. `states` overrides a row's state until the
 * next load (a tick shows at once); `showAll` lifts the 100-row cap.
 */
export function tasksQueryView(
  result: Extract<TasksQueryResult, { status: "ok" }>,
  opts: { t: TasksQueryT; locale: string; states?: ReadonlyMap<string, TaskState>; showAll?: boolean },
): TasksQueryView {
  const { t, locale } = opts;
  const today = result.today;
  const layout = result.layout;
  const rowOf = (task: TaskRecord): PlannerRow => {
    const row = plannerRowsFromTasks([task])[0];
    const state = opts.states?.get(row.id);
    return state ? { ...row, state } : row;
  };
  let budget = opts.showAll ? Infinity : TASKS_QUERY_DRAW_LIMIT;
  let hidden = 0;
  const sections: PlannerSection[] = [];
  const walk = (group: TasksQueryGroup, path: string) => {
    if (group.groups.length > 0) {
      // A heading over further groups: its own section, without rows.
      if (group.heading && budget > 0) sections.push(sectionOf(group, path, []));
      group.groups.forEach((child, i) => walk(child, `${path}/${i}`));
      return;
    }
    const drawn = group.items.slice(0, Math.max(0, budget));
    hidden += group.items.length - drawn.length;
    budget -= drawn.length;
    if (drawn.length === 0 && group.heading && budget <= 0) return;
    sections.push(sectionOf(group, path, drawn.map((item) => rowOf(item.task))));
  };
  const sectionOf = (group: TasksQueryGroup, path: string, rows: PlannerRow[]): PlannerSection => {
    const heading = group.heading;
    const dated = heading !== null && "day" in heading;
    return {
      key: `q${path}`,
      kind: "group",
      rows,
      ...(heading ? { label: tasksQueryGroupLabel(heading, t, locale, today), level: group.level } : {}),
      ...(heading && layout.groupCount ? { count: group.taskCount } : {}),
      ...(dated && heading.key === "due" && heading.day !== null && heading.day < today ? { late: true } : {}),
      ...(dated && (heading.key === "due" || heading.key === "happens") && heading.day !== null ? { dayHeading: true } : {}),
    };
  };
  walk(result.root, "");

  let subtasks: PlannerRow[] | undefined;
  if (layout.tree) {
    // Every row a task of the result shows under it, matching or not —
    // the planner hangs them by `parentId`, in the order of the note.
    const seen = new Map<string, PlannerRow>();
    const collect = (item: TasksQueryItem) => {
      const row = rowOf(item.task);
      if (!seen.has(row.id)) seen.set(row.id, row);
      item.children.forEach(collect);
    };
    itemsOf(result.root).forEach(collect);
    subtasks = [...seen.values()];
  }

  return {
    status: "ok",
    sections,
    ...(subtasks ? { subtasks } : {}),
    total: result.total,
    shown: result.shown,
    hidden,
    display: {
      source: layout.backlink,
      childSource: layout.backlink && layout.nestedBacklink,
      due: layout.dueDate,
      tags: layout.tags,
      priority: layout.priority,
      repeat: layout.recurrenceRule,
    },
    layout,
    notices: result.notices.map((line) => noteOf(line, tasksQueryNoticeText(line, t))),
  };
}

/** The row id of a task record, as the planner keys it. */
export const tasksQueryRowId = (task: Pick<TaskRecord, "path" | "ordinal">): string => plannerTaskId(task.path, task.ordinal);

// ── Explanation ─────────────────────────────────────────────────────────────

/** One line of the drawn explanation; `depth` > 0 for a part of a Boolean instruction. */
export interface TasksQueryExplainRow {
  line: number | null;
  source: string;
  status: TasksQueryLine["status"] | null;
  depth: number;
  detail: string | null;
}

export interface TasksQueryExplainView {
  rows: TasksQueryExplainRow[];
  /** Sentences under the lines: the default sort, the notes Plainva counts, the plugin's settings. */
  notes: string[];
}

function daysText(days: TasksExplainedDays, t: TasksQueryT, locale: string, today: string): string {
  const day = (key: string) => tasksQueryDayText(key, locale, today, true);
  if (days.from && days.to) return days.from === days.to ? t("tasksQuery.days.on", { day: day(days.from) }) : t("tasksQuery.days.range", { from: day(days.from), to: day(days.to) });
  if (days.from) return t("tasksQuery.days.from", { day: day(days.from) });
  return t("tasksQuery.days.until", { day: day(days.to!) });
}

function filterDetail(filter: TasksExplainedFilter, t: TasksQueryT, locale: string, today: string): string | null {
  if (filter.kind !== "date") return null;
  const text = daysText(filter.days, t, locale, today);
  return filter.tasksWithoutDate ? `${text} ${t("tasksQuery.days.withoutStart")}` : text;
}

/** The explanation as rows and sentences in the app's language (E9). */
export function tasksQueryExplainView(query: TasksQuery, t: TasksQueryT, locale: string, plugin?: TasksPluginSettings | null): TasksQueryExplainView {
  const explanation = explainTasksQuery(query, plugin);
  const rows: TasksQueryExplainRow[] = [];
  const expression = (node: TasksExplainedExpression, depth: number) => {
    if (node.op === "filter") {
      rows.push({ line: null, source: node.source, status: null, depth, detail: filterDetail(node.filter, t, locale, query.today) });
      return;
    }
    if (node.op === "not") {
      rows.push({ line: null, source: "NOT", status: null, depth, detail: null });
      expression(node.operand, depth + 1);
      return;
    }
    rows.push({ line: null, source: node.op.toUpperCase(), status: null, depth, detail: null });
    expression(node.left, depth + 1);
    expression(node.right, depth + 1);
  };
  for (const line of explanation.lines) {
    let detail: string | null = null;
    if (line.status === "unsupported") detail = tasksQueryNoticeText(line as TasksQueryLine, t);
    else if (line.status === "error") detail = tasksQueryErrorText(line as TasksQueryLine, t);
    else if (line.status === "noEffect") detail = t("tasksQuery.noEffect");
    else if (line.filter) detail = filterDetail(line.filter, t, locale, query.today);
    rows.push({ line: line.line, source: line.source, status: line.status, depth: 0, detail });
    if (line.filter?.kind === "boolean") expression(line.filter.expression, 1);
  }
  const notes = [t("tasksQuery.explainDefaultSort"), t("tasksQuery.explainOptOut")];
  if (explanation.plugin?.globalFilter) notes.push(t("tasksQuery.explainGlobalFilter", { value: explanation.plugin.globalFilter }));
  if (explanation.plugin?.globalQuery) notes.push(t("tasksQuery.explainGlobalQuery"));
  return { rows, notes };
}
