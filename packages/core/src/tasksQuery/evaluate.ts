/**
 * Runs a parsed Tasks query over the vault's tasks — the records of
 * `VaultQueryService.listTasks()`, unchanged. In the order of the Tasks
 * plugin: filter, sort (the query's sort lines, then Tasks' default sort:
 * status type, urgency, due, priority, path), `limit`, group (up to three
 * levels), `limit groups`, and for `show tree` the subtasks under each task.
 *
 * Notes that opt out of the Tasks tab (`plainva.tasks: false`) are part of the
 * result, as in Obsidian, which does not know the property (plan E13).
 */

import type { TaskRecord } from "../vault/VaultQueryService.js";
import { readTasksInvalidDates, stripTasksPriority, tasksDescription, TASKS_PRIORITY_LEVELS, type TasksDateField, type TasksPriorityLevel } from "../vault/taskMetadata.js";
import { dayNumberOf, type DayKey } from "./dates.js";
import {
  TASKS_DEFAULT_SORTERS,
  TASKS_STATUS_TYPES,
  type TasksBooleanExpression,
  type TasksDateFieldName,
  type TasksFilter,
  type TasksGroupKey,
  type TasksQuery,
  type TasksQueryLayout,
  type TasksQueryLine,
  type TasksSorter,
  type TasksStatusType,
} from "./parse.js";
import { tasksUrgency } from "./urgency.js";

// ── Result types ────────────────────────────────────────────────────────────

/** One task in the result; with `show tree`, its subtasks below it in file order, matching or not. */
export interface TasksQueryItem {
  task: TaskRecord;
  /** The Tasks plugin's urgency score for today. */
  urgency: number;
  /** False for a subtask shown only because its parent matched (`show tree`). */
  matched: boolean;
  children: TasksQueryItem[];
}

/** What a group heading stands for — data; the interface words it in the app's language. */
export type TasksGroupHeading =
  | { key: "status"; done: boolean }
  | { key: "statusType"; type: TasksStatusType }
  | { key: TasksDateFieldName; day: DayKey | null; invalid: boolean }
  | { key: "priority"; level: TasksPriorityLevel }
  | { key: "urgency"; urgency: number }
  | { key: "recurring"; recurring: boolean }
  | { key: "recurrence"; rule: string | null }
  | { key: "tags"; tag: string | null }
  | { key: "path"; path: string }
  | { key: "root"; root: string }
  | { key: "folder"; folder: string }
  | { key: "filename"; filename: string }
  | { key: "backlink"; path: string; heading: string | null }
  | { key: "heading"; heading: string | null };

export interface TasksQueryGroup {
  /** Null for the root of the result. */
  heading: TasksGroupHeading | null;
  /** 0 for the root, 1–3 for the group levels. */
  level: number;
  /** Matched tasks in this group and below (subtasks shown only for the tree not counted). */
  taskCount: number;
  /** Groups of the next level; empty at the deepest level. */
  groups: TasksQueryGroup[];
  /** The tasks, sorted; only at the deepest level (the root itself when ungrouped). */
  items: TasksQueryItem[];
}

export type TasksQueryResult =
  | {
      status: "ok";
      today: DayKey;
      /** Tasks matching the filters, before `limit`. */
      total: number;
      /** Distinct tasks in the result after `limit` and `limit groups` — "shown of total". */
      shown: number;
      root: TasksQueryGroup;
      layout: TasksQueryLayout;
      /** Lines Plainva left out (case a), for the hint above the result. */
      notices: TasksQueryLine[];
      explain: boolean;
    }
  | { status: "error"; errors: TasksQueryLine[] };

// ── Prepared tasks ──────────────────────────────────────────────────────────

const STATUS_TYPE_OF: Record<TaskRecord["state"], TasksStatusType> = { open: "TODO", progress: "IN_PROGRESS", done: "DONE", cancelled: "CANCELLED" };
const PRIORITY_NUMBER: Record<TasksPriorityLevel, number> = Object.fromEntries(TASKS_PRIORITY_LEVELS.map((level, i) => [level, i])) as Record<TasksPriorityLevel, number>;
const STATUS_TYPE_RANK: Record<TasksStatusType, number> = Object.fromEntries(TASKS_STATUS_TYPES.map((type, i) => [type, i])) as Record<TasksStatusType, number>;
const collator = new Intl.Collator("en", { numeric: true });

interface Prepared {
  task: TaskRecord;
  statusType: TasksStatusType;
  /** DONE, CANCELLED and NON_TASK count as done in Tasks. */
  done: boolean;
  level: TasksPriorityLevel;
  urgency?: number;
  description?: string;
  sortDescription?: string;
  invalid?: TasksDateField[];
}

function prepare(task: TaskRecord): Prepared {
  const statusType = STATUS_TYPE_OF[task.state];
  return { task, statusType, done: statusType === "DONE" || statusType === "CANCELLED", level: task.priorityLevel ?? "none" };
}

function urgencyOf(p: Prepared, today: DayKey): number {
  if (p.urgency === undefined) p.urgency = tasksUrgency({ due: p.task.due, scheduled: p.task.scheduled, start: p.task.start, priorityLevel: p.level }, today);
  return p.urgency;
}

/**
 * The description as Tasks searches it: the text without its emoji fields —
 * dates, recurrence, id, dependencies, on-completion, priority — and without
 * a trailing block id. Tags stay.
 */
export function tasksQueryDescription(text: string): string {
  let out = stripTasksPriority(tasksDescription(text));
  out = out.replace(/(^|\s)(?:⛔\uFE0F?\s*[A-Za-z0-9_,-]*|🏁\uFE0F?\s*\S*)/gu, "$1");
  // A date field whose value is no day (`📅 2026-02-30`) is still a field to Tasks.
  out = out.replace(/(^|\s)[➕✅📅⏳🛫❌]\uFE0F?\s*\d{4}-\d{2}-\d{2}(?!\d)/gu, "$1");
  out = out.replace(/\s\^[A-Za-z0-9-]+$/, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Worked out once per record: every block of every open note evaluates over
 * the same `listTasks()` records until the index moves on (E3), and a record
 * is never changed — a new index state brings new records.
 */
const descriptionCache = new WeakMap<TaskRecord, string>();
const invalidCache = new WeakMap<TaskRecord, TasksDateField[]>();

function descriptionOf(p: Prepared): string {
  if (p.description === undefined) {
    let description = descriptionCache.get(p.task);
    if (description === undefined) descriptionCache.set(p.task, (description = tasksQueryDescription(p.task.text)));
    p.description = description;
  }
  return p.description;
}

/**
 * Links as the text a reader sees: `[[target|alias]]` as alias, `[[target]]`
 * as target, `[text](url)` as text. One pass, no backtracking pattern.
 */
function linkTextOf(text: string): string {
  let out = "";
  let at = 0;
  while (at < text.length) {
    if (text.startsWith("[[", at)) {
      const end = text.indexOf("]]", at + 2);
      if (end >= 0) {
        const inner = text.slice(at + 2, end);
        out += inner.slice(inner.lastIndexOf("|") + 1);
        at = end + 2;
        continue;
      }
    } else if (text[at] === "[") {
      const close = text.indexOf("](", at + 1);
      const end = close >= 0 ? text.indexOf(")", close + 2) : -1;
      if (end >= 0 && !text.slice(at + 1, close).includes("[")) {
        out += text.slice(at + 1, close);
        at = end + 1;
        continue;
      }
    }
    out += text[at];
    at++;
  }
  return out;
}

/** The text to sort descriptions by: links as their visible text, no leading emphasis marks. */
function sortDescriptionOf(p: Prepared): string {
  if (p.sortDescription === undefined) {
    let text = linkTextOf(descriptionOf(p));
    for (;;) {
      const next = text.replace(/^(?:\*\*|__|==|~~|\*|_)/, "");
      if (next === text) break;
      text = next;
    }
    p.sortDescription = text;
  }
  return p.sortDescription;
}

function invalidOf(p: Prepared): TasksDateField[] {
  if (p.invalid === undefined) {
    let invalid = invalidCache.get(p.task);
    if (invalid === undefined) invalidCache.set(p.task, (invalid = readTasksInvalidDates(p.task.text)));
    p.invalid = invalid;
  }
  return p.invalid;
}

/** The value of a date field; `happens` is the earliest of start, scheduled and due. */
function dateOf(task: TaskRecord, field: TasksDateFieldName): DayKey | null {
  switch (field) {
    case "due": return task.due ?? null;
    case "scheduled": return task.scheduled ?? null;
    case "start": return task.start ?? null;
    case "done": return task.completed ?? null;
    case "created": return task.created ?? null;
    case "cancelled": return task.cancelled ?? null;
    case "happens": {
      let earliest: DayKey | null = null;
      for (const day of [task.start, task.scheduled, task.due]) if (day && (earliest === null || day < earliest)) earliest = day;
      return earliest;
    }
  }
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const withoutExtension = (name: string) => (name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name);
/** The folder with a trailing slash, `/` in the vault root. */
export function tasksQueryFolder(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "/" : path.slice(0, slash + 1);
}
/** The top-level folder with a trailing slash, `/` in the vault root. */
export function tasksQueryRoot(path: string): string {
  const slash = path.indexOf("/");
  return slash < 0 ? "/" : path.slice(0, slash + 1);
}

// ── Filters ─────────────────────────────────────────────────────────────────

function dateMatches(day: DayKey, filter: Extract<TasksFilter, { kind: "date" }>): boolean {
  const from = filter.value.kind === "day" ? filter.value.day : filter.value.from;
  const to = filter.value.kind === "day" ? filter.value.day : filter.value.to;
  switch (filter.operator) {
    case "on":
    case "in": return day >= from && day <= to;
    case "before": return day < from;
    case "after": return day > to;
    case "onOrBefore":
    case "inOrBefore": return day <= to;
    case "onOrAfter":
    case "inOrAfter": return day >= from;
  }
}

function textValue(p: Prepared, field: Extract<TasksFilter, { kind: "text" }>["field"]): string | null {
  const task = p.task;
  switch (field) {
    case "description": return descriptionOf(p);
    case "path": return task.path;
    case "filename": return fileName(task.path);
    case "folder": return tasksQueryFolder(task.path);
    case "root": return tasksQueryRoot(task.path);
    case "heading": return task.heading ?? null;
    case "recurrence": return task.recurrence ?? null;
  }
}

function matches(filter: TasksFilter, p: Prepared): boolean {
  const task = p.task;
  switch (filter.kind) {
    case "status": return p.done === filter.done;
    case "statusType": return (p.statusType === filter.type) !== filter.negate;
    case "date": {
      if (filter.field === "happens") {
        for (const day of [task.start, task.scheduled, task.due]) if (day && dateMatches(day, filter)) return true;
        return false;
      }
      const day = dateOf(task, filter.field);
      // A task without a start date can be worked on: `starts` filters let it through.
      if (day === null) return filter.field === "start" && !invalidOf(p).includes("start");
      return dateMatches(day, filter);
    }
    case "dateExists": {
      let has = dateOf(task, filter.field) !== null;
      if (!has && filter.field !== "happens") has = invalidOf(p).includes(filter.field);
      return has === filter.has;
    }
    case "dateInvalid": return invalidOf(p).includes(filter.field);
    case "recurring": return (task.recurrence !== undefined) === filter.recurring;
    case "text": {
      const needle = filter.value.toLowerCase();
      // The description is the task text with fields cut out at blanks: a
      // needle without a blank that is not in the text is not in the
      // description either, and the description need not be worked out.
      if (filter.field === "description" && !/\s/.test(needle) && !task.text.toLowerCase().includes(needle)) return !filter.includes;
      const value = textValue(p, filter.field);
      const found = value !== null && value.toLowerCase().includes(needle);
      return found === filter.includes;
    }
    case "tags": {
      const needle = filter.value.toLowerCase();
      const found = task.tags.some((tag) => ("#" + tag).toLowerCase().includes(needle));
      return found === filter.includes;
    }
    case "hasTags": return task.tags.length > 0 === filter.has;
    case "priority": {
      const mine = PRIORITY_NUMBER[p.level];
      const theirs = PRIORITY_NUMBER[filter.level];
      switch (filter.operator) {
        case "is": return mine === theirs;
        case "not": return mine !== theirs;
        case "above": return mine < theirs;
        case "below": return mine > theirs;
      }
      return false;
    }
    case "excludeSubItems": return !task.indented;
    case "boolean": return booleanMatches(filter.expression, p);
  }
}

function booleanMatches(expression: TasksBooleanExpression, p: Prepared): boolean {
  switch (expression.op) {
    case "filter": return matches(expression.filter, p);
    case "not": return !booleanMatches(expression.operand, p);
    case "and": return booleanMatches(expression.left, p) && booleanMatches(expression.right, p);
    case "or": return booleanMatches(expression.left, p) || booleanMatches(expression.right, p);
    case "xor": return booleanMatches(expression.left, p) !== booleanMatches(expression.right, p);
  }
}

// ── Sorting ─────────────────────────────────────────────────────────────────

/** Invalid dates first, then days from the earliest, then no date (Tasks 6.0.0 and later). */
function dateSortKey(p: Prepared, field: TasksDateFieldName): number {
  const day = dateOf(p.task, field);
  if (day !== null) return dayNumberOf(day) ?? Infinity;
  if (field !== "happens" && invalidOf(p).includes(field)) return -Infinity;
  return Infinity;
}

/**
 * Ranks of strings in collation order — equal strings share a rank, a missing
 * one gets `missing`. Sorting then compares numbers, not strings: each string
 * is collated once, not once per comparison.
 */
function rankStrings(values: ReadonlyArray<string | undefined>, missing: number): Float64Array {
  const distinct = [...new Set(values.filter((v): v is string => v !== undefined))].sort((a, b) => collator.compare(a, b));
  const rank = new Map<string, number>();
  let current = 0;
  for (let i = 0; i < distinct.length; i++) {
    if (i > 0 && collator.compare(distinct[i - 1], distinct[i]) !== 0) current++;
    rank.set(distinct[i], current);
  }
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    out[i] = value === undefined ? missing : rank.get(value)!;
  }
  return out;
}

/** One sort line as a column of numbers, ascending; `reverse` turns the whole column round. */
function sortColumn(sorter: TasksSorter, items: readonly Prepared[], today: DayKey): Float64Array {
  const n = items.length;
  let column: Float64Array;
  switch (sorter.key) {
    case "status": column = Float64Array.from(items, (p) => (p.done ? 1 : 0)); break;
    case "statusType": column = Float64Array.from(items, (p) => STATUS_TYPE_RANK[p.statusType]); break;
    // The most urgent first.
    case "urgency": column = Float64Array.from(items, (p) => -urgencyOf(p, today)); break;
    case "priority": column = Float64Array.from(items, (p) => PRIORITY_NUMBER[p.level]); break;
    case "recurring": column = Float64Array.from(items, (p) => (p.task.recurrence !== undefined ? 0 : 1)); break;
    case "description": column = rankStrings(items.map(sortDescriptionOf), Infinity); break;
    // Tasks without that tag after the others.
    case "tag": {
      const index = (sorter.tagIndex ?? 1) - 1;
      column = rankStrings(items.map((p) => (p.task.tags[index] !== undefined ? "#" + p.task.tags[index] : undefined)), Infinity);
      break;
    }
    case "path": column = rankStrings(items.map((p) => p.task.path), Infinity); break;
    case "filename": column = rankStrings(items.map((p) => fileName(p.task.path)), Infinity); break;
    // Tasks without a heading before the others.
    case "heading": column = rankStrings(items.map((p) => p.task.heading), -Infinity); break;
    default: {
      const field = sorter.key;
      column = Float64Array.from(items, (p) => dateSortKey(p, field));
    }
  }
  if (sorter.reverse) for (let i = 0; i < n; i++) column[i] = -column[i];
  return column;
}

/** The query's sort lines, then Tasks' default sort, then file order as the last word. */
function sortPrepared(items: Prepared[], sorters: readonly TasksSorter[], today: DayKey): Prepared[] {
  const columns = [...sorters, ...TASKS_DEFAULT_SORTERS].map((sorter) => sortColumn(sorter, items, today));
  const order = Array.from(items, (_, i) => i);
  order.sort((a, b) => {
    for (const column of columns) {
      const difference = column[a] - column[b];
      // Two missing values (both infinite) give NaN: equal.
      if (difference < 0) return -1;
      if (difference > 0) return 1;
    }
    const pa = items[a].task.path;
    const pb = items[b].task.path;
    if (pa !== pb) return pa < pb ? -1 : 1;
    return items[a].task.line - items[b].task.line;
  });
  return order.map((i) => items[i]);
}

const numberCompare = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

/** Cheap filters first: the description is worked out only for tasks the others let through. */
function filterCost(filter: TasksFilter): number {
  switch (filter.kind) {
    case "text": return filter.field === "description" ? 3 : 1;
    case "dateExists":
    case "dateInvalid": return 2;
    case "boolean": return booleanCost(filter.expression);
    default: return 1;
  }
}
function booleanCost(expression: TasksBooleanExpression): number {
  switch (expression.op) {
    case "filter": return filterCost(expression.filter);
    case "not": return booleanCost(expression.operand);
    default: return Math.max(booleanCost(expression.left), booleanCost(expression.right));
  }
}

// ── Grouping ────────────────────────────────────────────────────────────────

interface HeadingEntry {
  id: string;
  heading: TasksGroupHeading;
}

function headingsOf(p: Prepared, key: TasksGroupKey, today: DayKey): HeadingEntry[] {
  const task = p.task;
  switch (key) {
    case "status": return [{ id: String(p.done), heading: { key, done: p.done } }];
    case "statusType": return [{ id: p.statusType, heading: { key, type: p.statusType } }];
    case "priority": return [{ id: p.level, heading: { key, level: p.level } }];
    case "urgency": {
      const urgency = Math.round(urgencyOf(p, today) * 100) / 100;
      return [{ id: urgency.toFixed(2), heading: { key, urgency } }];
    }
    case "recurring": return [{ id: String(task.recurrence !== undefined), heading: { key, recurring: task.recurrence !== undefined } }];
    case "recurrence": return [{ id: task.recurrence ?? "\u0000none", heading: { key, rule: task.recurrence ?? null } }];
    case "tags":
      if (task.tags.length === 0) return [{ id: "\u0000none", heading: { key, tag: null } }];
      return [...new Set(task.tags)].map((tag) => ({ id: "#" + tag, heading: { key, tag: "#" + tag } }));
    case "path": {
      const path = withoutExtension(task.path);
      return [{ id: path, heading: { key, path } }];
    }
    case "root": {
      const root = tasksQueryRoot(task.path);
      return [{ id: root, heading: { key, root } }];
    }
    case "folder": {
      const folder = tasksQueryFolder(task.path);
      return [{ id: folder, heading: { key, folder } }];
    }
    case "filename": {
      const filename = withoutExtension(fileName(task.path));
      return [{ id: filename, heading: { key, filename } }];
    }
    case "backlink": {
      const heading = task.heading ?? null;
      return [{ id: task.path + "\u0000" + (heading ?? ""), heading: { key, path: task.path, heading } }];
    }
    case "heading": {
      const heading = task.heading ?? null;
      return [{ id: heading === null ? "\u0000none" : "h:" + heading, heading: { key, heading } }];
    }
    default: {
      const day = dateOf(task, key);
      const invalid = day === null && key !== "happens" && invalidOf(p).includes(key);
      return [{ id: day ?? (invalid ? "\u0000invalid" : "\u0000none"), heading: { key, day, invalid } }];
    }
  }
}

/** Groups in the order of the Tasks plugin: by value, not by the words of the heading. */
function compareHeadings(a: TasksGroupHeading, b: TasksGroupHeading): number {
  switch (a.key) {
    case "status": return numberCompare((a.done ? 0 : 1), ((b as typeof a).done ? 0 : 1));
    case "statusType": return STATUS_TYPE_RANK[a.type] - STATUS_TYPE_RANK[(b as typeof a).type];
    case "priority": return PRIORITY_NUMBER[a.level] - PRIORITY_NUMBER[(b as typeof a).level];
    case "urgency": return numberCompare((b as typeof a).urgency, a.urgency);
    case "recurring": return numberCompare(a.recurring ? 0 : 1, (b as typeof a).recurring ? 0 : 1);
    case "recurrence": return collator.compare(a.rule ?? "None", (b as typeof a).rule ?? "None");
    case "tags": {
      const other = (b as typeof a).tag;
      if (a.tag === null || other === null) return a.tag === other ? 0 : a.tag === null ? 1 : -1;
      return collator.compare(a.tag, other);
    }
    case "path": return collator.compare(a.path, (b as typeof a).path);
    case "root": return collator.compare(a.root, (b as typeof a).root);
    case "folder": return collator.compare(a.folder, (b as typeof a).folder);
    case "filename": return collator.compare(a.filename, (b as typeof a).filename);
    case "backlink": {
      const other = b as typeof a;
      const byFile = collator.compare(withoutExtension(fileName(a.path)), withoutExtension(fileName(other.path))) || collator.compare(a.path, other.path);
      if (byFile !== 0) return byFile;
      if (a.heading === null || other.heading === null) return a.heading === other.heading ? 0 : a.heading === null ? -1 : 1;
      return collator.compare(a.heading, other.heading);
    }
    case "heading": {
      const other = (b as typeof a).heading;
      if (a.heading === null || other === null) return a.heading === other ? 0 : a.heading === null ? -1 : 1;
      return collator.compare(a.heading, other);
    }
    default: {
      const da = a as Extract<TasksGroupHeading, { day: DayKey | null }>;
      const db = b as typeof da;
      const rank = (h: typeof da) => (h.invalid ? 0 : h.day !== null ? 1 : 2);
      return rank(da) - rank(db) || (da.day !== null && db.day !== null ? (da.day < db.day ? -1 : da.day > db.day ? 1 : 0) : 0);
    }
  }
}

// ── Evaluation ──────────────────────────────────────────────────────────────

/** Tasks of one note by the ordinal of their parent task, in file order — for `show tree`. */
type ChildIndex = Map<string, Map<number, TaskRecord[]>>;

function childIndexOf(tasks: readonly TaskRecord[]): ChildIndex {
  const index: ChildIndex = new Map();
  for (const task of tasks) {
    if (task.parent === undefined) continue;
    let note = index.get(task.path);
    if (!note) index.set(task.path, (note = new Map()));
    const list = note.get(task.parent);
    if (list) list.push(task);
    else note.set(task.parent, [task]);
  }
  for (const note of index.values()) for (const list of note.values()) list.sort((a, b) => a.ordinal - b.ordinal);
  return index;
}

const taskKey = (task: TaskRecord) => task.path + "\u0000" + task.ordinal;

/**
 * Evaluates a parsed query over the vault's tasks for the query's `today`.
 * A query with an error line gives no result (as in Obsidian), never "0 tasks".
 */
export function evaluateTasksQuery(query: TasksQuery, tasks: readonly TaskRecord[]): TasksQueryResult {
  if (query.errors.length > 0) return { status: "error", errors: query.errors };
  const today = query.today;
  // All filters must hold, so their order is free: cheap ones first.
  const filters = query.filters.map((filter, i) => ({ filter, cost: filterCost(filter), i })).sort((a, b) => a.cost - b.cost || a.i - b.i).map((entry) => entry.filter);
  const found: Prepared[] = [];
  for (const task of tasks) {
    const p = prepare(task);
    let ok = true;
    for (const filter of filters) {
      if (!matches(filter, p)) {
        ok = false;
        break;
      }
    }
    if (ok) found.push(p);
  }
  const matched = sortPrepared(found, query.sorters, today);
  const total = matched.length;
  const limited = query.limit !== null ? matched.slice(0, query.limit) : matched;

  const tree = query.layout.tree;
  const children = tree ? childIndexOf(tasks) : null;
  const matchedKeys = tree ? new Set(matched.map((p) => taskKey(p.task))) : null;
  const byKey = tree ? new Map(tasks.map((task) => [taskKey(task), task])) : null;
  const parentOf = (task: TaskRecord): TaskRecord | undefined => (task.parent === undefined ? undefined : byKey!.get(task.path + "\u0000" + task.parent));
  const shownKeys = new Set<string>();

  const itemOf = (task: TaskRecord, isMatch: boolean, urgency: number, seen: Set<string>): TasksQueryItem => {
    const item: TasksQueryItem = { task, urgency, matched: isMatch, children: [] };
    const key = taskKey(task);
    if (children && !seen.has(key)) {
      seen.add(key);
      for (const child of children.get(task.path)?.get(task.ordinal) ?? []) {
        item.children.push(itemOf(child, matchedKeys!.has(taskKey(child)), tasksUrgency({ due: child.due, scheduled: child.scheduled, start: child.start, priorityLevel: child.priorityLevel }, today), seen));
      }
    }
    return item;
  };

  const leafItems = (group: Prepared[]): TasksQueryItem[] => {
    const inGroup = query.limitGroups !== null ? group.slice(0, query.limitGroups) : group;
    for (const p of inGroup) shownKeys.add(taskKey(p.task));
    if (!tree) return inGroup.map((p) => ({ task: p.task, urgency: urgencyOf(p, today), matched: true, children: [] }));
    // A task whose parent (or grandparent …) is in the same group shows under it, not again on its own.
    const here = new Set(inGroup.map((p) => taskKey(p.task)));
    const roots = inGroup.filter((p) => {
      for (let up = parentOf(p.task); up; up = parentOf(up)) if (here.has(taskKey(up))) return false;
      return true;
    });
    return roots.map((p) => itemOf(p.task, true, urgencyOf(p, today), new Set()));
  };

  const build = (items: Prepared[], level: number, heading: TasksGroupHeading | null): TasksQueryGroup => {
    const grouper = query.groupers[level];
    if (!grouper) return { heading, level, taskCount: items.length, groups: [], items: leafItems(items) };
    const buckets = new Map<string, { heading: TasksGroupHeading; items: Prepared[] }>();
    for (const p of items) {
      for (const entry of headingsOf(p, grouper.key, today)) {
        const bucket = buckets.get(entry.id);
        if (bucket) bucket.items.push(p);
        else buckets.set(entry.id, { heading: entry.heading, items: [p] });
      }
    }
    const ordered = [...buckets.values()].sort((a, b) => compareHeadings(a.heading, b.heading));
    if (grouper.reverse) ordered.reverse();
    const groups = ordered.map((bucket) => build(bucket.items, level + 1, bucket.heading));
    return { heading, level, taskCount: items.length, groups, items: [] };
  };

  const root = build(limited, 0, null);
  return { status: "ok", today, total, shown: shownKeys.size, root, layout: query.layout, notices: query.notices, explain: query.explain };
}
