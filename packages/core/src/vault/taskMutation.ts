import { sha256Hex, utf8Encode } from "../workspace/encoding.js";
import { GFM_TASK_LINE, scanTasks, type ScannedTask } from "./taskScan.js";
import { nextTasksDates, readTasksMetadata, setTasksField, setTasksPriority, tasksDayNumber } from "./taskMetadata.js";

export interface ChecklistMutationOptions { today?: string; newId?: () => string }
export interface ChecklistMutationResult { content: string; changed: boolean }

/** Explicit identities survive a line move. Duplicate IDs are ambiguous. */
export function resolveTaskOrdinal(content: string, reference: Pick<ScannedTask, "ordinal" | "text" | "taskId">): number {
  const tasks = scanTasks(content);
  if (reference.taskId) {
    const matches = tasks.filter(t => t.taskId === reference.taskId);
    return matches.length === 1 ? matches[0].ordinal : -1;
  }
  return tasks[reference.ordinal]?.text === reference.text ? reference.ordinal : -1;
}

/** Checkbox and successor are one Markdown edit, so a retry cannot write half a recurrence. */
export function setChecklistTaskDone(content: string, index: number, checked: boolean, options: ChecklistMutationOptions = {}): ChecklistMutationResult {
  const tasks = scanTasks(content), task = tasks[index];
  if (!task || task.done === checked) return { content, changed: false };
  const date = new Date(), today = options.today ?? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (tasksDayNumber(today) === null) throw new Error("invalid_task_completion_day");
  const lines = content.split("\n"), raw = lines[task.line], cr = raw.endsWith("\r") ? "\r" : "";
  const match = GFM_TASK_LINE.exec(raw)!;
  const suffix = match[3].replace(/\r$/, "");
  let body = raw.slice(match[0].length).replace(/\r$/, "");
  const metadata = readTasksMetadata(body);
  const hasFields = [metadata.created, metadata.completed, metadata.due, metadata.start, metadata.scheduled, metadata.taskId, metadata.recurrence].some(value => value !== null);
  let successor: string | null = null;
  if (checked && task.recurrenceSupported) {
    const nextDates = nextTasksDates(metadata, today);
    if (nextDates) {
      const id = metadata.taskId ?? (options.newId ?? (() => crypto.randomUUID()))();
      if (!/^[A-Za-z0-9_-]{1,256}$/.test(id)) throw new Error("invalid_task_id");
      if (tasks.filter(t => t.taskId === id).length > 1) throw new Error("ambiguous_task_id");
      const nextId = "pv-" + sha256Hex(utf8Encode("tasks-successor-v1:" + id)).slice(0, 32);
      body = setTasksField(body, "taskId", id);
      // Reopening a completed predecessor does not duplicate its existing child.
      if (!tasks.some(t => t.taskId === nextId)) {
        let nextBody = setTasksField(body, "taskId", nextId);
        nextBody = setTasksField(nextBody, "completed", null);
        if (metadata.created) nextBody = setTasksField(nextBody, "created", today);
        for (const field of ["due", "scheduled", "start"] as const) if (nextDates[field]) nextBody = setTasksField(nextBody, field, nextDates[field]);
        successor = match[1] + " " + suffix + nextBody + cr;
      }
    }
  }
  if (hasFields) body = setTasksField(body, "completed", checked ? today : null);
  lines[task.line] = match[1] + (checked ? "x" : " ") + suffix + body + cr;
  if (successor !== null) lines.splice(task.line, 0, successor);
  return { content: lines.join("\n"), changed: true };
}

/**
 * Rewrites the TEXT of one checkbox line — everything after the `[ ]` marker.
 * Indent, list marker, box and line ending stay byte for byte; a rewrite that
 * returns the text unchanged writes nothing.
 */
export function rewriteChecklistTaskText(content: string, index: number, rewrite: (text: string) => string): ChecklistMutationResult {
  const task = scanTasks(content)[index];
  if (!task) return { content, changed: false };
  const lines = content.split("\n"), raw = lines[task.line], cr = raw.endsWith("\r") ? "\r" : "";
  const match = GFM_TASK_LINE.exec(raw)!;
  const body = raw.slice(match[0].length).replace(/\r$/, "");
  const next = rewrite(body);
  if (next === body) return { content, changed: false };
  lines[task.line] = match[0] + next + cr;
  return { content: lines.join("\n"), changed: true };
}

/** Sets or clears the priority mark of one checkbox (1 = high … 3 = low, 0 = none). */
export function setChecklistTaskPriority(content: string, index: number, rank: 0 | 1 | 2 | 3): ChecklistMutationResult {
  return rewriteChecklistTaskText(content, index, (text) => setTasksPriority(text, rank));
}
