/**
 * Vault-wide task scanning (B4). Finds GFM task list items (`- [ ]` / `- [x]`,
 * also `*`/`+`/ordered, nested, inside blockquotes, never in fenced code) and
 * returns each with the SAME document-order ordinal that `@plainva/ui`'s
 * `toggleTaskAtIndex` counts — so a vault-wide Tasks view can flip a checkbox
 * back through that helper. The `TASK_LINE`/`FENCE` regexes here MUST stay in
 * lock-step with the toggle; an alignment test cross-checks both.
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
export const GFM_TASK_FENCE = /^\s*(?:```|~~~)/;
const TASK_LINE = GFM_TASK_LINE, FENCE = GFM_TASK_FENCE;
import { readTasksMetadata, readTasksPriority } from "./taskMetadata.js";
import { readFrontmatterPath } from "../frontmatter-surgical.js";
import { findInlineTagsInLine } from "../tagRule.js";

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
}

/** Extracts every GFM task checkbox from a note's raw markdown, in order. */
export function scanTasks(content: string): ScannedTask[] {
  const lines = content.split("\n");
  const out: ScannedTask[] = [];
  let inFence = false;
  let ordinal = 0;
  let nativeRecurrenceOwner: boolean | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = lines[i].match(TASK_LINE);
    if (!m) continue;
    const text = lines[i].slice(m[0].length).trim();
    const metadata = readTasksMetadata(text);
    const priority = readTasksPriority(text);
    if (metadata.recurrence !== null && nativeRecurrenceOwner === undefined) nativeRecurrenceOwner = readFrontmatterPath(content, ["plainva", "repeat"]) != null || readFrontmatterPath(content, ["plainva", "pim", "uid"]) != null;
    let following = i + 1;
    while (following < lines.length && !lines[following].trim()) following++;
    const continuation = following < lines.length && (lines[following].match(/^\s*/)?.[0].length ?? 0) > (lines[i].match(/^\s*/)?.[0].length ?? 0);
    const tags: string[] = [];
    // The task text is SOURCE (it may carry code and links), hence the line rule.
    for (const tag of findInlineTagsInLine(text)) tags.push(tag.name);
    out.push({
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
      ...(metadata.recurrence !== null ? { recurrence: metadata.recurrence, recurrenceSupported: !!metadata.repeatRule && !nativeRecurrenceOwner && !continuation } : {}),
    });
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
