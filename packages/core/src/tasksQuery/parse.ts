/**
 * The parser of a Tasks query — the text of a ```` ```tasks ```` block, in the
 * language of the Obsidian Tasks plugin (8.6.0). Pure: no clock (today is
 * handed in), no I/O, and nothing from the note is ever executed.
 *
 * Every instruction line ends up in exactly one of four states:
 *
 * - `understood` — Plainva does what Tasks does;
 * - `noEffect` — a layout line without a counterpart in Plainva (`hide edit
 *   button`, `short mode`, …); it changes nothing about which tasks appear;
 * - `unsupported` — Tasks knows the line, Plainva does not yet (case a of the
 *   plan): code (`filter by function`, never run), regular expressions, the
 *   dependency fields, presets, date phrases beyond the ones in `dates.ts`.
 *   The line is left out — a filter then lets more tasks through, a sort or
 *   group may order differently — and the block says so;
 * - `error` — Tasks rejects the line too (case c): a typo, mixed brackets,
 *   an impossible date. A query with an error shows no result.
 *
 * Reasons are codes; the user interface words them in the app's language.
 */

import { TASKS_PRIORITY_LEVELS, type TasksPriorityLevel } from "../vault/taskMetadata.js";
import { parseTasksDate, type DayKey, type TasksDateValue } from "./dates.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** The status types of the Tasks plugin. Plainva's boxes are TODO `[ ]`, IN_PROGRESS `[/]`, DONE `[x]`, CANCELLED `[-]`. */
export type TasksStatusType = "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "ON_HOLD" | "NON_TASK";
export const TASKS_STATUS_TYPES: readonly TasksStatusType[] = ["IN_PROGRESS", "TODO", "ON_HOLD", "DONE", "CANCELLED", "NON_TASK"];

/** The date fields a filter, sort or group names. `start` is written `starts` in a filter. */
export type TasksDateFieldName = "due" | "scheduled" | "start" | "done" | "created" | "cancelled" | "happens";

export type TasksDateOperator = "on" | "before" | "after" | "onOrBefore" | "onOrAfter" | "in" | "inOrBefore" | "inOrAfter";

export type TasksTextField = "description" | "path" | "filename" | "folder" | "root" | "heading" | "recurrence";

export type TasksFilter =
  | { kind: "status"; done: boolean }
  | { kind: "statusType"; type: TasksStatusType; negate: boolean }
  | { kind: "date"; field: TasksDateFieldName; operator: TasksDateOperator; value: TasksDateValue; phrase: string }
  | { kind: "dateExists"; field: TasksDateFieldName; has: boolean }
  | { kind: "dateInvalid"; field: Exclude<TasksDateFieldName, "happens"> }
  | { kind: "recurring"; recurring: boolean }
  | { kind: "text"; field: TasksTextField; includes: boolean; value: string }
  | { kind: "tags"; includes: boolean; value: string }
  | { kind: "hasTags"; has: boolean }
  | { kind: "priority"; operator: "is" | "not" | "above" | "below"; level: TasksPriorityLevel }
  | { kind: "excludeSubItems" }
  | { kind: "boolean"; expression: TasksBooleanExpression };

/** A Boolean instruction as a tree; leaves carry the filter text as written between the delimiters. */
export type TasksBooleanExpression =
  | { op: "and" | "or" | "xor"; left: TasksBooleanExpression; right: TasksBooleanExpression }
  | { op: "not"; operand: TasksBooleanExpression }
  | { op: "filter"; filter: TasksFilter; source: string };

export type TasksSortKey =
  | "status" | "statusType" | "urgency" | "priority" | "recurring" | "description" | "tag" | "path" | "filename" | "heading"
  | TasksDateFieldName;

export interface TasksSorter {
  key: TasksSortKey;
  reverse: boolean;
  /** For `sort by tag N`: 1-based, default 1. */
  tagIndex?: number;
}

export type TasksGroupKey =
  | "status" | "statusType" | "priority" | "urgency" | "recurring" | "recurrence" | "tags"
  | "path" | "root" | "folder" | "filename" | "backlink" | "heading"
  | TasksDateFieldName;

export interface TasksGrouper {
  key: TasksGroupKey;
  reverse: boolean;
}

/** What a `show`/`hide` line can switch in Plainva. */
export type TasksLayoutItem =
  | "tree" | "backlink" | "nestedBacklink" | "taskCount" | "groupCount"
  | "dueDate" | "scheduledDate" | "startDate" | "doneDate" | "createdDate" | "cancelledDate"
  | "priority" | "recurrenceRule" | "tags";

/** `show`/`hide` lines Tasks knows that change nothing in Plainva. */
export type TasksNoEffectLayoutItem = "editButton" | "postponeButton" | "toolbar" | "urgency" | "id" | "dependsOn" | "onCompletion";

export type TasksQueryLayout = Record<TasksLayoutItem, boolean>;

/** Tasks' defaults: every task element shown; tree and group count off. */
export const TASKS_DEFAULT_LAYOUT: Readonly<TasksQueryLayout> = Object.freeze({
  tree: false, backlink: true, nestedBacklink: true, taskCount: true, groupCount: false,
  dueDate: true, scheduledDate: true, startDate: true, doneDate: true, createdDate: true, cancelledDate: true,
  priority: true, recurrenceRule: true, tags: true,
});

export type TasksQueryInstruction =
  | { type: "filter"; filter: TasksFilter }
  | { type: "sort"; sorter: TasksSorter }
  | { type: "group"; grouper: TasksGrouper }
  | { type: "layout"; item: TasksLayoutItem; show: boolean }
  | { type: "noEffectLayout"; item: TasksNoEffectLayoutItem | "shortMode" | "fullMode"; show: boolean }
  | { type: "limit"; count: number }
  | { type: "limitGroups"; count: number }
  | { type: "explain" }
  | { type: "ignoreGlobalQuery" };

/** Why Plainva leaves a line out (case a). */
export type TasksQueryUnsupportedReason =
  | "code" | "regex" | "statusName" | "dependencies" | "preset" | "placeholder" | "datePhrase" | "sortRandom" | "sortId" | "groupId" | "groupDepth";

/** What leaving the line out means for the result — the sentence the block shows. */
export type TasksQueryUnsupportedEffect = "filter" | "sort" | "group" | "query";

/** Why Tasks rejects the line too (case c). */
export type TasksQueryErrorReason =
  | "unknownInstruction" | "unknownSortKey" | "unknownGroupKey" | "unknownLayoutItem"
  | "invalidDate" | "missingDate" | "invalidPriority" | "invalidStatusType" | "invalidLimit"
  | "booleanMixedDelimiters" | "booleanMalformed" | "placeholderWithoutFile";

export type TasksQueryLineStatus = "understood" | "noEffect" | "unsupported" | "error";

export interface TasksQueryLine {
  /** 1-based number of the line in the block where the instruction starts. */
  line: number;
  /** How many lines of the block it takes (more with `\` continuations). */
  lineCount: number;
  /** The instruction as Plainva read it: continuations joined, placeholders filled in, trimmed. */
  source: string;
  status: TasksQueryLineStatus;
  instruction?: TasksQueryInstruction;
  unsupported?: { reason: TasksQueryUnsupportedReason; effect: TasksQueryUnsupportedEffect };
  error?: { reason: TasksQueryErrorReason; /** The part the reason is about (a Boolean leaf, a date phrase). */ detail?: string };
}

export interface TasksQueryContext {
  /** The calendar day a relative date counts from (`calendarDay`, not the journal day). */
  today: DayKey;
  /** Vault path of the note the block stands in, for `{{query.file.*}}`. */
  filePath?: string;
}

export interface TasksQuery {
  source: string;
  today: DayKey;
  filePath?: string;
  /** Every instruction line in order; blank lines and comments are not listed. */
  lines: TasksQueryLine[];
  /** The understood filters; all must hold (lines combine with AND). */
  filters: TasksFilter[];
  /** The query's own sort lines; the default sort is appended when evaluating. */
  sorters: TasksSorter[];
  /** Up to three group levels. */
  groupers: TasksGrouper[];
  layout: TasksQueryLayout;
  limit: number | null;
  /** `limit groups N`: at most N tasks in each group. */
  limitGroups: number | null;
  explain: boolean;
  /** The lines with status `unsupported` — a hint above the result. */
  notices: TasksQueryLine[];
  /** The lines with status `error` — no result while there is one. */
  errors: TasksQueryLine[];
}

/** The sort Tasks appends to every query. */
export const TASKS_DEFAULT_SORTERS: readonly TasksSorter[] = Object.freeze([
  { key: "statusType", reverse: false },
  { key: "urgency", reverse: false },
  { key: "due", reverse: false },
  { key: "priority", reverse: false },
  { key: "path", reverse: false },
] as TasksSorter[]);

/** More group levels are left out (case a). */
export const TASKS_MAX_GROUP_LEVELS = 3;

// ── Filters ─────────────────────────────────────────────────────────────────

type FilterParse =
  | { kind: "ok"; filter: TasksFilter }
  | { kind: "unsupported"; reason: TasksQueryUnsupportedReason }
  | { kind: "error"; reason: TasksQueryErrorReason; detail?: string };

const DATE_FIELD_WORDS: Record<string, TasksDateFieldName> = {
  due: "due", scheduled: "scheduled", starts: "start", start: "start", done: "done", created: "created", cancelled: "cancelled", happens: "happens",
};
const DATE_OPERATORS: Array<[string, TasksDateOperator]> = [
  ["on or before ", "onOrBefore"], ["on or after ", "onOrAfter"], ["in or before ", "inOrBefore"], ["in or after ", "inOrAfter"],
  ["before ", "before"], ["after ", "after"], ["on ", "on"], ["in ", "in"],
];
const STATUS_TYPE_WORDS = new Set<string>(["TODO", "IN_PROGRESS", "DONE", "CANCELLED", "ON_HOLD", "NON_TASK"]);

function parseDateFilter(field: TasksDateFieldName, rest: string, today: DayKey): FilterParse {
  const lower = rest.toLowerCase();
  if (DATE_OPERATORS.some(([word]) => lower.trim() === word.trim())) return { kind: "error", reason: "missingDate" };
  let operator: TasksDateOperator = "on";
  let phrase = rest;
  for (const [word, op] of DATE_OPERATORS) {
    if (lower.startsWith(word)) {
      operator = op;
      phrase = rest.slice(word.length);
      break;
    }
  }
  phrase = phrase.trim();
  if (phrase === "") return { kind: "error", reason: "missingDate" };
  let parsed = parseTasksDate(phrase, today);
  // "due in 2 days": the `in` belongs to the date.
  if (!parsed.ok && parsed.reason === "unknown" && operator === "in") {
    const whole = parseTasksDate(rest, today);
    if (whole.ok) {
      parsed = whole;
      operator = "on";
      phrase = rest.trim();
    }
  }
  if (!parsed.ok) return parsed.reason === "invalid" ? { kind: "error", reason: "invalidDate", detail: phrase } : { kind: "unsupported", reason: "datePhrase" };
  return { kind: "ok", filter: { kind: "date", field, operator, value: parsed.value, phrase } };
}

/**
 * One filter, as a line of its own or a leaf of a Boolean instruction. Null
 * for text that is no filter Tasks knows.
 */
function parseFilter(text: string, today: DayKey): FilterParse | null {
  const t = text.trim();
  const l = t.toLowerCase();
  let m: RegExpExecArray | null;
  if (l === "done") return { kind: "ok", filter: { kind: "status", done: true } };
  if (l === "not done") return { kind: "ok", filter: { kind: "status", done: false } };
  if (l === "exclude sub-items") return { kind: "ok", filter: { kind: "excludeSubItems" } };
  if (l === "is recurring") return { kind: "ok", filter: { kind: "recurring", recurring: true } };
  if (l === "is not recurring") return { kind: "ok", filter: { kind: "recurring", recurring: false } };
  if (l === "has tags" || l === "has tag") return { kind: "ok", filter: { kind: "hasTags", has: true } };
  if (l === "no tags" || l === "no tag") return { kind: "ok", filter: { kind: "hasTags", has: false } };
  if ((m = /^status\.type (is not|is) (\S+)$/i.exec(t))) {
    const type = m[2].toUpperCase();
    if (!STATUS_TYPE_WORDS.has(type)) return { kind: "error", reason: "invalidStatusType", detail: m[2] };
    return { kind: "ok", filter: { kind: "statusType", type: type as TasksStatusType, negate: m[1].toLowerCase() === "is not" } };
  }
  if (/^status\.name\b/i.test(t)) return { kind: "unsupported", reason: "statusName" };
  if (/^status\.type\b/i.test(t)) return { kind: "error", reason: "unknownInstruction" };
  if (/^(?:is (?:not )?(?:blocked|blocking)|(?:has|no) (?:id|depends on)|id\b)/i.test(t)) return { kind: "unsupported", reason: "dependencies" };
  if (/^\S+ regex (?:matches|does not match)\b/i.test(t)) return { kind: "unsupported", reason: "regex" };
  if (/^(?:filter|sort|group) by function\b/i.test(t)) return { kind: "unsupported", reason: "code" };
  if ((m = /^(description|path|filename|folder|root|heading|recurrence) (includes|does not include)(?: (.*))?$/i.exec(t))) {
    return { kind: "ok", filter: { kind: "text", field: m[1].toLowerCase() as TasksTextField, includes: m[2].toLowerCase() === "includes", value: (m[3] ?? "").trim() } };
  }
  if ((m = /^tags? (include|includes|do not include|does not include)(?: (.*))?$/i.exec(t))) {
    return { kind: "ok", filter: { kind: "tags", includes: !m[1].toLowerCase().includes("not"), value: (m[2] ?? "").trim() } };
  }
  if ((m = /^priority (?:is )?(above |below |not )?(\S+)$/i.exec(t))) {
    const level = m[2].toLowerCase() as TasksPriorityLevel;
    if (!TASKS_PRIORITY_LEVELS.includes(level)) return { kind: "error", reason: "invalidPriority", detail: m[2] };
    const op = (m[1] ?? "is ").trim().toLowerCase() as "is" | "not" | "above" | "below";
    return { kind: "ok", filter: { kind: "priority", operator: op, level } };
  }
  if (/^priority\b/i.test(t)) return { kind: "error", reason: "invalidPriority" };
  if ((m = /^(has|no) (due|scheduled|start|done|created|cancelled|happens) dates?$/i.exec(t))) {
    return { kind: "ok", filter: { kind: "dateExists", field: DATE_FIELD_WORDS[m[2].toLowerCase()], has: m[1].toLowerCase() === "has" } };
  }
  if ((m = /^(due|scheduled|start|done|created|cancelled) date is invalid$/i.exec(t))) {
    return { kind: "ok", filter: { kind: "dateInvalid", field: DATE_FIELD_WORDS[m[1].toLowerCase()] as Exclude<TasksDateFieldName, "happens"> } };
  }
  if ((m = /^(due|scheduled|starts|start|done|created|cancelled|happens)(?: (.*))?$/i.exec(t))) {
    return parseDateFilter(DATE_FIELD_WORDS[m[1].toLowerCase()], m[2] ?? "", today);
  }
  return null;
}

// ── Boolean instructions ────────────────────────────────────────────────────

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"' };
const OPENERS = new Set(Object.keys(PAIRS));
const CLOSERS = new Set([")", "]", "}"]);

/** A line is a Boolean instruction when it starts with a delimiter, or with `NOT` and one. */
export function isBooleanInstruction(text: string): boolean {
  return /^(?:NOT\s*)*[([{"]/.test(text.trim());
}

class BooleanFailure extends Error {
  constructor(readonly reason: TasksQueryErrorReason, readonly detail?: string) {
    super(reason);
  }
}

interface Leaf {
  source: string;
  parse: FilterParse | null;
}

function parseBoolean(text: string, today: DayKey): { expression: TasksBooleanExpression; leaves: Leaf[] } | BooleanFailure {
  const src = text.trim();
  const open = /^(?:NOT\s*)*([([{"])/.exec(src)![1];
  const close = PAIRS[open];
  const leaves: Leaf[] = [];

  const parse = (s: string): TasksBooleanExpression => {
    let pos = 0;
    const skip = () => {
      while (pos < s.length && /\s/.test(s[pos])) pos++;
    };
    const word = (w: string): boolean => {
      skip();
      if (!s.startsWith(w, pos)) return false;
      const after = s[pos + w.length];
      if (after !== undefined && /[A-Za-z_]/.test(after)) return false;
      pos += w.length;
      return true;
    };
    const primary = (): TasksBooleanExpression => {
      skip();
      const ch = s[pos];
      if (ch === undefined) throw new BooleanFailure("booleanMalformed");
      if (ch !== open) {
        if (OPENERS.has(ch)) throw new BooleanFailure("booleanMixedDelimiters");
        throw new BooleanFailure("booleanMalformed", s.slice(pos));
      }
      let end = -1;
      if (open === '"') end = s.indexOf('"', pos + 1);
      else {
        let depth = 0;
        for (let k = pos; k < s.length; k++) {
          if (s[k] === open) depth++;
          else if (s[k] === close && --depth === 0) {
            end = k;
            break;
          }
        }
      }
      if (end < 0) throw new BooleanFailure("booleanMalformed", s.slice(pos));
      const content = s.slice(pos + 1, end).trim();
      pos = end + 1;
      if (open !== '"' && (content.startsWith(open) || /^NOT\s*[([{"]/.test(content))) return parse(content);
      if (OPENERS.has(content[0] ?? "") && content[0] !== open) throw new BooleanFailure("booleanMixedDelimiters");
      // Tasks reads a filter that ends in its own closing delimiter as the end of the group.
      if (open !== '"' && content.endsWith(close)) throw new BooleanFailure("booleanMalformed", content);
      const leafParse = parseFilter(content, today);
      leaves.push({ source: content, parse: leafParse });
      const filter: TasksFilter = leafParse?.kind === "ok" ? leafParse.filter : { kind: "status", done: false };
      return { op: "filter", filter, source: content };
    };
    const unary = (): TasksBooleanExpression => (word("NOT") ? { op: "not", operand: unary() } : primary());
    const xor = (): TasksBooleanExpression => {
      let left = unary();
      while (word("XOR")) left = { op: "xor", left, right: unary() };
      return left;
    };
    const and = (): TasksBooleanExpression => {
      let left = xor();
      while (word("AND")) left = { op: "and", left, right: xor() };
      return left;
    };
    const or = (): TasksBooleanExpression => {
      let left = and();
      while (word("OR")) left = { op: "or", left, right: and() };
      return left;
    };
    const expression = or();
    skip();
    if (pos < s.length) {
      const rest = s.slice(pos);
      if (OPENERS.has(rest[0]) || CLOSERS.has(rest[0])) throw new BooleanFailure(OPENERS.has(rest[0]) && rest[0] !== open ? "booleanMixedDelimiters" : "booleanMalformed", rest);
      throw new BooleanFailure("booleanMalformed", rest);
    }
    return expression;
  };

  try {
    return { expression: parse(src), leaves };
  } catch (failure) {
    if (failure instanceof BooleanFailure) return failure;
    throw failure;
  }
}

// ── Sort, group, layout ─────────────────────────────────────────────────────

const SORT_KEYS: Record<string, TasksSortKey> = {
  status: "status", "status.type": "statusType", due: "due", done: "done", scheduled: "scheduled", start: "start", starts: "start",
  created: "created", cancelled: "cancelled", happens: "happens", description: "description", priority: "priority",
  urgency: "urgency", recurring: "recurring", tag: "tag", tags: "tag", path: "path", filename: "filename", heading: "heading",
};
const GROUP_KEYS: Record<string, TasksGroupKey> = {
  status: "status", "status.type": "statusType", due: "due", done: "done", scheduled: "scheduled", start: "start", starts: "start",
  created: "created", cancelled: "cancelled", happens: "happens", priority: "priority", urgency: "urgency", recurring: "recurring",
  recurrence: "recurrence", tags: "tags", tag: "tags", path: "path", root: "root", folder: "folder", filename: "filename",
  backlink: "backlink", heading: "heading",
};
const LAYOUT_ITEMS: Record<string, TasksLayoutItem> = {
  tree: "tree", backlink: "backlink", backlinks: "backlink", "nested backlink": "nestedBacklink", "nested backlinks": "nestedBacklink",
  "task count": "taskCount", "group count": "groupCount", "due date": "dueDate", "scheduled date": "scheduledDate",
  "start date": "startDate", "done date": "doneDate", "created date": "createdDate", "cancelled date": "cancelledDate",
  priority: "priority", "recurrence rule": "recurrenceRule", tags: "tags",
};
const NO_EFFECT_LAYOUT: Record<string, TasksNoEffectLayoutItem> = {
  "edit button": "editButton", "postpone button": "postponeButton", toolbar: "toolbar", urgency: "urgency", id: "id",
  "depends on": "dependsOn", "on completion": "onCompletion",
};

type LineParse =
  | { status: "understood" | "noEffect"; instruction: TasksQueryInstruction }
  | { status: "unsupported"; reason: TasksQueryUnsupportedReason; effect: TasksQueryUnsupportedEffect }
  | { status: "error"; reason: TasksQueryErrorReason; detail?: string };

function parseSort(rest: string): LineParse {
  const words = rest.trim().toLowerCase().split(/\s+/);
  const key = words[0] ?? "";
  if (key === "function") return { status: "unsupported", reason: "code", effect: "sort" };
  if (key === "random") return { status: "unsupported", reason: "sortRandom", effect: "sort" };
  if (key === "id") return { status: "unsupported", reason: "sortId", effect: "sort" };
  if (key === "status.name") return { status: "unsupported", reason: "statusName", effect: "sort" };
  const sortKey = SORT_KEYS[key];
  if (!sortKey) return { status: "error", reason: "unknownSortKey", detail: key };
  const tail = words.slice(1);
  const reverse = tail.includes("reverse");
  const others = tail.filter((w) => w !== "reverse");
  if (sortKey === "tag" && others.length === 1 && /^[1-9]\d{0,2}$/.test(others[0])) {
    return { status: "understood", instruction: { type: "sort", sorter: { key: "tag", reverse, tagIndex: Number(others[0]) } } };
  }
  if (others.length > 0) return { status: "error", reason: "unknownSortKey", detail: rest.trim() };
  return { status: "understood", instruction: { type: "sort", sorter: { key: sortKey, reverse, ...(sortKey === "tag" ? { tagIndex: 1 } : {}) } } };
}

function parseGroup(rest: string): LineParse {
  const words = rest.trim().toLowerCase().split(/\s+/);
  const key = words[0] ?? "";
  if (key === "function") return { status: "unsupported", reason: "code", effect: "group" };
  if (key === "id") return { status: "unsupported", reason: "groupId", effect: "group" };
  if (key === "status.name") return { status: "unsupported", reason: "statusName", effect: "group" };
  const groupKey = GROUP_KEYS[key];
  if (!groupKey) return { status: "error", reason: "unknownGroupKey", detail: key };
  const tail = words.slice(1);
  if (tail.some((w) => w !== "reverse")) return { status: "error", reason: "unknownGroupKey", detail: rest.trim() };
  return { status: "understood", instruction: { type: "group", grouper: { key: groupKey, reverse: tail.includes("reverse") } } };
}

function parseLayout(show: boolean, rest: string): LineParse {
  const item = rest.trim().toLowerCase().replace(/\s+/g, " ");
  if (item in LAYOUT_ITEMS) return { status: "understood", instruction: { type: "layout", item: LAYOUT_ITEMS[item], show } };
  if (item in NO_EFFECT_LAYOUT) return { status: "noEffect", instruction: { type: "noEffectLayout", item: NO_EFFECT_LAYOUT[item], show } };
  return { status: "error", reason: "unknownLayoutItem", detail: rest.trim() };
}

function parseInstruction(text: string, today: DayKey): LineParse {
  const l = text.toLowerCase().replace(/\s+/g, " ");
  let m: RegExpExecArray | null;
  if (l === "explain") return { status: "understood", instruction: { type: "explain" } };
  if (l === "ignore global query") return { status: "noEffect", instruction: { type: "ignoreGlobalQuery" } };
  if (l === "short mode" || l === "short") return { status: "noEffect", instruction: { type: "noEffectLayout", item: "shortMode", show: true } };
  if (l === "full mode" || l === "full") return { status: "noEffect", instruction: { type: "noEffectLayout", item: "fullMode", show: true } };
  if ((m = /^limit groups (?:to )?(\d+)(?: tasks?)?$/.exec(l))) return { status: "understood", instruction: { type: "limitGroups", count: Number(m[1]) } };
  if ((m = /^limit (?:to )?(\d+)(?: tasks?)?$/.exec(l))) return { status: "understood", instruction: { type: "limit", count: Number(m[1]) } };
  if (/^limit\b/.test(l)) return { status: "error", reason: "invalidLimit" };
  if ((m = /^(show|hide) (.+)$/.exec(l))) return parseLayout(m[1] === "show", m[2]);
  if ((m = /^sort by(?: (.*))?$/.exec(l))) return parseSort(m[1] ?? "");
  if ((m = /^group by(?: (.*))?$/.exec(l))) return parseGroup(m[1] ?? "");
  if (/^preset\b/.test(l)) return { status: "unsupported", reason: "preset", effect: "query" };
  if (isBooleanInstruction(text)) {
    const parsed = parseBoolean(text, today);
    if (parsed instanceof BooleanFailure) return { status: "error", reason: parsed.reason, ...(parsed.detail ? { detail: parsed.detail } : {}) };
    // A leaf Tasks rejects rejects the line; a leaf Plainva does not read
    // leaves the whole line out, so that the result can only grow.
    for (const leaf of parsed.leaves) {
      if (leaf.parse === null) return { status: "error", reason: "unknownInstruction", detail: leaf.source };
      if (leaf.parse.kind === "error") return { status: "error", reason: leaf.parse.reason, detail: leaf.parse.detail ?? leaf.source };
    }
    for (const leaf of parsed.leaves) {
      if (leaf.parse?.kind === "unsupported") return { status: "unsupported", reason: leaf.parse.reason, effect: "filter" };
    }
    return { status: "understood", instruction: { type: "filter", filter: { kind: "boolean", expression: parsed.expression } } };
  }
  const filter = parseFilter(text, today);
  if (filter === null) return { status: "error", reason: "unknownInstruction" };
  if (filter.kind === "unsupported") return { status: "unsupported", reason: filter.reason, effect: "filter" };
  if (filter.kind === "error") return { status: "error", reason: filter.reason, ...(filter.detail ? { detail: filter.detail } : {}) };
  return { status: "understood", instruction: { type: "filter", filter: filter.filter } };
}

// ── Lines, comments, continuations, placeholders ────────────────────────────

/** The six `{{query.file.*}}` placeholders of Tasks 4.7.0, for a vault path. */
export function tasksQueryFilePlaceholders(filePath: string): Record<string, string> {
  const slash = filePath.lastIndexOf("/");
  const filename = filePath.slice(slash + 1);
  const dot = filename.lastIndexOf(".");
  const withoutExtension = dot > 0 ? filename.slice(0, dot) : filename;
  const folder = slash < 0 ? "/" : filePath.slice(0, slash + 1);
  const firstSlash = filePath.indexOf("/");
  return {
    "query.file.path": filePath,
    "query.file.pathWithoutExtension": slash < 0 ? withoutExtension : filePath.slice(0, slash + 1) + withoutExtension,
    "query.file.root": firstSlash < 0 ? "/" : filePath.slice(0, firstSlash + 1),
    "query.file.folder": folder,
    "query.file.filename": filename,
    "query.file.filenameWithoutExtension": withoutExtension,
  };
}

type Expansion = { text: string } | { unsupported: TasksQueryUnsupportedReason } | { error: TasksQueryErrorReason; detail: string };

function expandPlaceholders(text: string, filePath: string | undefined): Expansion {
  if (!text.includes("{{")) return { text };
  const values = filePath === undefined ? null : tasksQueryFilePlaceholders(filePath);
  let failure: Expansion | null = null;
  const out = text.replace(/\{\{([^{}]*)\}\}/g, (whole, inner: string) => {
    if (failure) return whole;
    const name = inner.trim();
    if (name.startsWith("preset.")) failure = { unsupported: "preset" };
    else if (name.startsWith("query.file.") && name in tasksQueryFilePlaceholders("a.md")) {
      if (values) return values[name];
      failure = { error: "placeholderWithoutFile", detail: whole };
    } else failure = { unsupported: "placeholder" };
    return whole;
  });
  return failure ?? { text: out };
}

/** `{{! … }}` comments, which may run over lines; their line breaks stay so line numbers hold. */
function removeInlineComments(source: string): string {
  return source.replace(/\{\{!([\s\S]*?)\}\}/g, (whole) => whole.replace(/[^\n]/g, ""));
}

/**
 * Parses the text of a ```` ```tasks ```` block. Never throws; whatever it
 * cannot use ends up in `notices` or `errors`.
 */
export function parseTasksQuery(source: string, context: TasksQueryContext): TasksQuery {
  const physical = removeInlineComments(source).split("\n").map((line) => line.replace(/\r$/, ""));
  const query: TasksQuery = {
    source,
    today: context.today,
    ...(context.filePath !== undefined ? { filePath: context.filePath } : {}),
    lines: [],
    filters: [],
    sorters: [],
    groupers: [],
    layout: { ...TASKS_DEFAULT_LAYOUT },
    limit: null,
    limitGroups: null,
    explain: false,
    notices: [],
    errors: [],
  };
  for (let i = 0; i < physical.length; i++) {
    const start = i;
    let text = physical[i].trimEnd();
    // `\` at the end continues the line; `\\` is one real backslash.
    while (text.endsWith("\\") && !text.endsWith("\\\\") && i + 1 < physical.length) {
      i++;
      text = text.slice(0, -1).trimEnd() + " " + physical[i].trim();
      text = text.trimEnd();
    }
    if (text.endsWith("\\\\")) text = text.slice(0, -1);
    else if (text.endsWith("\\")) text = text.slice(0, -1);
    text = text.trim();
    if (text === "" || text.startsWith("#")) continue;
    const line: TasksQueryLine = { line: start + 1, lineCount: i - start + 1, source: text, status: "understood" };
    const expanded = expandPlaceholders(text, context.filePath);
    let parsed: LineParse;
    if ("unsupported" in expanded) parsed = { status: "unsupported", reason: expanded.unsupported, effect: "query" };
    else if ("error" in expanded) parsed = { status: "error", reason: expanded.error, detail: expanded.detail };
    else {
      line.source = expanded.text;
      parsed = parseInstruction(expanded.text, context.today);
    }
    line.status = parsed.status;
    if (parsed.status === "understood" || parsed.status === "noEffect") {
      line.instruction = parsed.instruction;
      const ins = parsed.instruction;
      if (ins.type === "filter") query.filters.push(ins.filter);
      else if (ins.type === "sort") query.sorters.push(ins.sorter);
      else if (ins.type === "group") {
        if (query.groupers.length >= TASKS_MAX_GROUP_LEVELS) {
          line.status = "unsupported";
          delete line.instruction;
          line.unsupported = { reason: "groupDepth", effect: "group" };
        } else query.groupers.push(ins.grouper);
      } else if (ins.type === "layout") query.layout[ins.item] = ins.show;
      else if (ins.type === "limit") query.limit = ins.count;
      else if (ins.type === "limitGroups") query.limitGroups = ins.count;
      else if (ins.type === "explain") query.explain = true;
    } else if (parsed.status === "unsupported") line.unsupported = { reason: parsed.reason, effect: parsed.effect };
    else if (parsed.status === "error") line.error = { reason: parsed.reason, ...(parsed.detail !== undefined ? { detail: parsed.detail } : {}) };
    query.lines.push(line);
    if (line.status === "unsupported") query.notices.push(line);
    if (line.status === "error") query.errors.push(line);
  }
  return query;
}
