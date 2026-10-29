/**
 * Vault-wide task scanning (B4). Finds GFM task list items (`- [ ]` / `- [x]`,
 * also `*`/`+`/ordered, nested, inside blockquotes, never in fenced code — the
 * one fence rule of `markdownFence.ts`, a fence inside a quote included) and
 * returns each with the SAME document-order ordinal that `@plainva/ui`'s
 * `toggleTaskAtIndex` counts — so a vault-wide Tasks view can flip a checkbox
 * back through that helper. Every writer that finds a box by its ordinal
 * counts through this scan; an alignment test cross-checks the toggle.
 */

/**
 * What may stand in a task's box: open, done — and the two states other tools
 * write and Plainva now reads (plan Aufgaben-Oberflaeche, E12): `/` in progress,
 * `-` cancelled. They were invisible before: a line with `[/]` was no task at
 * all, not even a box. Plainva never writes them on its own; a click still only
 * moves between open and done.
 */
export const GFM_TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX/-])(\]\s|\]$)/;

export type TaskBoxState = "open" | "progress" | "done" | "cancelled";

/** The state a box character stands for. */
export function taskBoxState(char: string): TaskBoxState {
  return char === "/" ? "progress" : char === "-" ? "cancelled" : char === " " ? "open" : "done";
}

/** The character written for a state. */
export function taskBoxChar(state: TaskBoxState): string {
  return state === "progress" ? "/" : state === "cancelled" ? "-" : state === "done" ? "x" : " ";
}

/** In progress still counts as open; cancelled counts as closed. */
export const isOpenTaskState = (state: TaskBoxState): boolean => state === "open" || state === "progress";
const TASK_LINE = GFM_TASK_LINE;
import { readTasksMetadata, readTasksPriorityLevel, type TasksPriorityLevel } from "./taskMetadata.js";
import { readFrontmatterPath } from "../frontmatter-surgical.js";
import { frontmatterSpan } from "../frontmatter-block.js";
import { findInlineTagsInLine } from "../tagRule.js";
import { createFenceTracker } from "../markdownFence.js";

export interface ScannedTask {
  /** 0-based line index of the task in the content. */
  line: number;
  /** 0-based checkbox index in document order — matches toggleTaskAtIndex. */
  ordinal: number;
  /** Ticked off (`[x]`). A cancelled task is closed but not done — see `state`. */
  done: boolean;
  /** What the box holds: open, in progress (`[/]`), done, cancelled (`[-]`). */
  state: TaskBoxState;
  /** Raw task text after the checkbox marker, trimmed. */
  text: string;
  /** Inline `#tags` found in the task text. */
  tags: string[];
  /** ISO date (YYYY-MM-DD) from a `📅` marker in the task text, or null. */
  due: string | null;
  created?: string;
  completed?: string;
  scheduled?: string;
  start?: string;
  taskId?: string;
  recurrence?: string;
  recurrenceSupported?: boolean;
  /** 1 = high … 3 = low, from a Tasks-plugin priority mark; absent = none. */
  priority?: 1 | 2 | 3;
  /**
   * The same mark in the Tasks plugin's six levels (🔺 highest … ⏬ lowest),
   * for its queries; absent = none. `priority` above stays the Tasks tab's.
   */
  priorityLevel?: Exclude<TasksPriorityLevel, "none">;
  /** ISO date from a `❌` marker: the day the task was cancelled. */
  cancelled?: string;
  /**
   * The text of the closest heading above the task, whatever its level — the
   * Tasks plugin's `heading` (ATX headings outside code, quotes and the
   * properties block). Absent when no heading stands above it.
   */
  heading?: string;
  /**
   * The task's list marker stands in from the left edge of its quote: a
   * sub-item, under a task or a plain bullet (the Tasks plugin's
   * `exclude sub-items`). Absent for a top-level item.
   */
  indented?: true;
  /**
   * The ordinal of the task this one is indented under — its nearest enclosing
   * checkbox in the same list (a subtask, the Tasks plugin's `show tree`).
   * Absent at the top of a list.
   */
  parent?: number;
  /**
   * Bullets without a box indented directly under this task — questions,
   * notes — at most {@link TASK_DETAIL_LIMIT}, in document order, without
   * their marker. Absent when there are none.
   */
  details?: string[];
}

/** How many indented bullets a task carries as its preview. */
export const TASK_DETAIL_LIMIT = 2;

/** A list item without a box: the marker and at least one character of text. */
const PLAIN_ITEM = /^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])\s+(\S.*)$/;

/**
 * How far a line stands in: its leading blanks and quote marks, a tab as four
 * columns. Only compared between lines of one note, so the unit is arbitrary.
 */
function lineIndent(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " " || ch === ">") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

/**
 * The text of an ATX heading line (`# Title`, `## Title ##`), or null. At most
 * three blanks in front, one to six `#`, then a blank or the end; a closing
 * run of `#` behind a blank is no part of the text. Written by hand, no
 * backtracking pattern.
 */
export function atxHeadingText(line: string): string | null {
  let at = 0;
  while (at < 3 && line[at] === " ") at++;
  let hashes = 0;
  while (line[at + hashes] === "#") hashes++;
  if (hashes < 1 || hashes > 6) return null;
  const after = line[at + hashes];
  if (after !== undefined && after !== " " && after !== "\t" && after !== "\r") return null;
  let text = line.slice(at + hashes).trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  if (end === 0) text = "";
  else if (end < text.length && (text[end - 1] === " " || text[end - 1] === "\t")) text = text.slice(0, end).trimEnd();
  return text;
}

/**
 * Whether a task's list marker stands in, as the Tasks plugin reads it: the
 * blanks and quote marks in front of the marker, where in a quote one blank
 * behind the last `>` is still the left edge.
 */
function isIndentedItem(line: string, first: boolean): boolean {
  let at = first && line.charCodeAt(0) === 0xfeff ? 1 : 0;
  let lead = "";
  for (; at < line.length; at++) {
    const ch = line[at];
    if (ch !== " " && ch !== "\t" && ch !== ">") break;
    lead += ch;
  }
  const lastQuote = lead.lastIndexOf(">");
  const rest = lastQuote < 0 ? lead : lead.slice(lastQuote + 1);
  return lastQuote < 0 ? rest.length > 0 : rest !== "" && rest !== " ";
}

/** The three ranks of the Tasks tab, read off the six levels. */
const PRIORITY_RANK_OF: Record<TasksPriorityLevel, 0 | 1 | 2 | 3> = { highest: 1, high: 1, medium: 2, none: 0, low: 3, lowest: 3 };

/** How many lines the properties block at the top takes (0 without one). */
function propertiesLineCount(content: string): number {
  const span = frontmatterSpan(content);
  if (!span) return 0;
  let count = 0;
  for (let k = 0; k < span.end; k++) if (content.charCodeAt(k) === 10) count++;
  // A block that ends at the end of the text has no line break behind it.
  return span.end === content.length ? count + 1 : count;
}

/** Extracts every GFM task checkbox from a note's raw markdown, in order. */
export function scanTasks(content: string): ScannedTask[] {
  const lines = content.split("\n");
  const out: ScannedTask[] = [];
  const fence = createFenceTracker();
  let ordinal = 0;
  let nativeRecurrenceOwner: boolean | undefined;
  // The closest heading above the current line. The properties block is no
  // text: its `# comment` lines are YAML. Its extent is only looked up once
  // the first heading-like line shows up.
  let heading: string | undefined;
  let propertiesEnd = -1;
  // The list items above the current line that are still open, innermost
  // last: a task's parent and a bullet's task are read off it. A line that
  // stands no further in than an item ends that item (a heading, a paragraph,
  // the next sibling); a blank line ends nothing.
  const open: Array<{ indent: number; task: ScannedTask | null }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (fence.step(lines[i]) !== null) {
      open.length = 0;
      continue;
    }
    if (!lines[i].trim()) continue;
    const indent = lineIndent(lines[i]);
    while (open.length > 0 && open[open.length - 1].indent >= indent) open.pop();
    const m = lines[i].match(TASK_LINE);
    if (!m) {
      const raw = i === 0 && lines[0].charCodeAt(0) === 0xfeff ? lines[0].slice(1) : lines[i];
      const headingText = raw.includes("#") ? atxHeadingText(raw) : null;
      if (headingText !== null) {
        if (propertiesEnd < 0) propertiesEnd = propertiesLineCount(content);
        if (i >= propertiesEnd) heading = headingText;
        continue;
      }
      const plain = lines[i].match(PLAIN_ITEM);
      if (!plain) continue;
      const owner = open.length > 0 ? open[open.length - 1].task : null;
      if (owner) {
        const details = owner.details ?? (owner.details = []);
        if (details.length < TASK_DETAIL_LIMIT) details.push(plain[1].trim());
      }
      open.push({ indent, task: null });
      continue;
    }
    const text = lines[i].slice(m[0].length).trim();
    const metadata = readTasksMetadata(text);
    const priorityLevel = readTasksPriorityLevel(text);
    const priority = PRIORITY_RANK_OF[priorityLevel];
    if (metadata.recurrence !== null && nativeRecurrenceOwner === undefined) nativeRecurrenceOwner = readFrontmatterPath(content, ["plainva", "repeat"]) != null || readFrontmatterPath(content, ["plainva", "pim", "uid"]) != null;
    let following = i + 1;
    while (following < lines.length && !lines[following].trim()) following++;
    const continuation = following < lines.length && (lines[following].match(/^\s*/)?.[0].length ?? 0) > (lines[i].match(/^\s*/)?.[0].length ?? 0);
    const tags: string[] = [];
    // The task text is SOURCE (it may carry code and links), hence the line rule.
    for (const tag of findInlineTagsInLine(text)) tags.push(tag.name);
    let parent: number | undefined;
    for (let k = open.length - 1; k >= 0; k--) {
      const above = open[k].task;
      if (above) {
        parent = above.ordinal;
        break;
      }
    }
    const task: ScannedTask = {
      line: i,
      ordinal,
      done: m[2].toLowerCase() === "x",
      state: taskBoxState(m[2]),
      text,
      tags,
      due: metadata.due,
      ...(metadata.created ? { created: metadata.created } : {}),
      ...(metadata.completed ? { completed: metadata.completed } : {}),
      ...(metadata.scheduled ? { scheduled: metadata.scheduled } : {}),
      ...(metadata.start ? { start: metadata.start } : {}),
      ...(metadata.taskId ? { taskId: metadata.taskId } : {}),
      ...(priority ? { priority } : {}),
      ...(priorityLevel !== "none" ? { priorityLevel } : {}),
      ...(metadata.cancelled ? { cancelled: metadata.cancelled } : {}),
      ...(heading !== undefined ? { heading } : {}),
      ...(isIndentedItem(lines[i], i === 0) ? { indented: true as const } : {}),
      ...(metadata.recurrence !== null ? { recurrence: metadata.recurrence, recurrenceSupported: !!metadata.repeatRule && !nativeRecurrenceOwner && !continuation } : {}),
      ...(parent !== undefined ? { parent } : {}),
    };
    out.push(task);
    open.push({ indent, task });
    ordinal++;
  }
  const ids = new Map<string, number>();
  for (const task of out) if (task.taskId) ids.set(task.taskId, (ids.get(task.taskId) ?? 0) + 1);
  for (const task of out) if (task.taskId && ids.get(task.taskId)! > 1 && task.recurrence !== undefined) task.recurrenceSupported = false;
  return out;
}

/** Checkbox progress of a note's body (issue #83): the `file.tasks` column. */
export interface TaskProgress {
  done: number;
  total: number;
}

export function taskProgressOf(content: string): TaskProgress {
  // A cancelled sub-task is neither done nor left to do: it leaves the count,
  // so "2/2" means finished and not "2/3 forever".
  const scanned = scanTasks(content).filter((t) => t.state !== "cancelled");
  let done = 0;
  for (const t of scanned) if (t.done) done++;
  return { done, total: scanned.length };
}

/** The column value: "done/total", or "" for a note without a checklist — an
 * empty cell, so a card without sub-tasks shows nothing rather than "0/0". */
export function formatTaskProgress(p: TaskProgress): string {
  return p.total === 0 ? "" : `${p.done}/${p.total}`;
}
