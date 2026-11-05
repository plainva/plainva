import { sha256Hex, utf8Encode } from "../workspace/encoding.js";
import { createFenceTracker } from "../markdownFence.js";
import { joinSourceLines, sourceLinesOf } from "../sourceLines.js";
import { GFM_TASK_LINE, scanTasks, taskBoxChar, type ScannedTask, type TaskBoxState } from "./taskScan.js";
import { nextTasksDates, readTasksMetadata, setTasksDue, setTasksField, setTasksPriority, tasksDayNumber } from "./taskMetadata.js";
import { htmlInputTagRanges, readHtmlCheckbox, withHtmlCheckboxChecked } from "./htmlCheckbox.js";

export { readHtmlCheckbox };

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
  // Judged by the BOX, not by `done`: un-ticking a cancelled task (`[-]`, not
  // done) reopens it, and ticking one in progress (`[/]`) completes it.
  if (!task || (checked ? task.state === "done" : task.state === "open")) return { content, changed: false };
  const date = new Date(), today = options.today ?? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (tasksDayNumber(today) === null) throw new Error("invalid_task_completion_day");
  // The scan's lines (`sourceLines.ts`): each keeps the line end it has. A
  // successor took everything behind the box up to the next `\n` — in a note
  // whose lines end in `\r`, the rest of the note (open-items plan 3.142 no. 2).
  const lines = sourceLinesOf(content), raw = lines[task.line].text, eol = lines[task.line].eol || "\n";
  const match = GFM_TASK_LINE.exec(raw)!;
  // A byte order mark belongs to the file, not to its first line: the line's
  // own lead is what stands behind it. (The pattern's leading blanks take the
  // mark in, and a successor built from them carried a second one.)
  const mark = task.line === 0 && raw.charCodeAt(0) === 0xfeff ? raw[0] : "";
  const lead = match[1].slice(mark.length);
  const suffix = match[3];
  let body = raw.slice(match[0].length);
  const metadata = readTasksMetadata(body);
  const hasFields = [metadata.created, metadata.completed, metadata.due, metadata.start, metadata.scheduled, metadata.cancelled, metadata.taskId, metadata.recurrence].some(value => value !== null);
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
        // The next occurrence is neither done nor cancelled, as in the Tasks plugin.
        nextBody = setTasksField(nextBody, "cancelled", null);
        if (metadata.created) nextBody = setTasksField(nextBody, "created", today);
        for (const field of ["due", "scheduled", "start"] as const) if (nextDates[field]) nextBody = setTasksField(nextBody, field, nextDates[field]);
        successor = lead + " " + suffix + nextBody;
      }
    }
  }
  if (hasFields) body = setTasksField(body, "completed", checked ? today : null);
  lines[task.line] = { text: lead + (checked ? "x" : " ") + suffix + body, eol: lines[task.line].eol };
  if (successor !== null) lines.splice(task.line, 0, { text: successor, eol });
  // The mark goes back in front of whatever line is the first one now.
  lines[0] = { ...lines[0], text: mark + lines[0].text };
  return { content: joinSourceLines(lines), changed: true };
}

/**
 * Rewrites the TEXT of one checkbox line — everything after the `[ ]` marker.
 * Indent, list marker, box and line ending stay byte for byte; a rewrite that
 * returns the text unchanged writes nothing.
 */
export function rewriteChecklistTaskText(content: string, index: number, rewrite: (text: string) => string): ChecklistMutationResult {
  const task = scanTasks(content)[index];
  if (!task) return { content, changed: false };
  const lines = sourceLinesOf(content), raw = lines[task.line].text;
  const match = GFM_TASK_LINE.exec(raw)!;
  const body = raw.slice(match[0].length);
  const next = rewrite(body);
  if (next === body) return { content, changed: false };
  // The line end stays the line's own (`sourceLines.ts`). A text set behind a
  // box that had nothing behind it gets the blank that makes the line a task line.
  const head = match[0];
  const gap = head.endsWith("]") && next !== "" && !/^\s/.test(next) ? " " : "";
  lines[task.line] = { text: head + gap + next, eol: lines[task.line].eol };
  return { content: joinSourceLines(lines), changed: true };
}

/** Sets or clears the priority mark of one checkbox (1 = high … 3 = low, 0 = none). */
export function setChecklistTaskPriority(content: string, index: number, rank: 0 | 1 | 2 | 3): ChecklistMutationResult {
  return rewriteChecklistTaskText(content, index, (text) => setTasksPriority(text, rank));
}

/**
 * Sets or clears the due day (`📅 YYYY-MM-DD`) of one checkbox — the field the
 * Tasks plugin reads. A line that already carries two due dates is ambiguous
 * and stays as it is (`changed: false`), like every other field edit.
 */
export function setChecklistTaskDue(content: string, index: number, day: string | null, time?: string | null): ChecklistMutationResult {
  if (day !== null && tasksDayNumber(day) === null) throw new Error("invalid_task_due_day");
  // `time`: undefined keeps a written time, null removes it, `HH:MM` writes it after the date (`setTasksDue`).
  return rewriteChecklistTaskText(content, index, (text) => setTasksDue(text, day, time));
}

/**
 * Sets what the box of one checkbox holds (plan Aufgaben-Oberflaeche, E12). Open
 * and done go through `setChecklistTaskDone`, so the completion date and a
 * repeating task's successor behave exactly as with a click; in progress and
 * cancelled only change the one character in the box.
 */
export function setChecklistTaskState(content: string, index: number, state: TaskBoxState, options: ChecklistMutationOptions = {}): ChecklistMutationResult {
  if (state === "open" || state === "done") return setChecklistTaskDone(content, index, state === "done", options);
  const task = scanTasks(content)[index];
  if (!task || task.state === state) return { content, changed: false };
  const lines = sourceLinesOf(content), raw = lines[task.line].text;
  const match = GFM_TASK_LINE.exec(raw)!;
  lines[task.line] = { text: match[1] + taskBoxChar(state) + raw.slice(match[1].length + 1), eol: lines[task.line].eol };
  return { content: joinSourceLines(lines), changed: true };
}

/**
 * An `<input type="checkbox">` written as HTML, ticked or cleared in place
 * (finding 2026-09-22).
 *
 * GFM knows task boxes only in LIST items, so a checklist inside a table cell
 * has no Markdown spelling — Obsidian users write the HTML tag there, and
 * Obsidian renders it. Plainva renders it now too, and a click has to reach
 * the file, or the box would lie about what it changed.
 *
 * These boxes have an ordinal space of their OWN: they carry no task
 * metadata, no due date and no recurrence, so mixing them into the GFM
 * ordinals would make every later task line address the wrong row. Fenced
 * code is skipped, by the same fence rule as the GFM scan (`markdownFence.ts`). Finding the tags and
 * reading them is `htmlCheckbox.ts` — one linear tokenizer for reader and
 * writer (plan Befunde 24.09., E6).
 */
export function setHtmlCheckboxChecked(content: string, index: number, checked: boolean): ChecklistMutationResult {
  const lines = sourceLinesOf(content);
  let ordinal = 0;
  const fence = createFenceTracker();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].text;
    if (fence.step(line) !== null) continue;
    for (const range of htmlInputTagRanges(line)) {
      const tag = line.slice(range.from, range.to);
      const box = readHtmlCheckbox(tag);
      if (!box) continue;
      if (ordinal++ !== index) continue;
      if (box.checked === checked) return { content, changed: false };
      lines[i] = { text: line.slice(0, range.from) + withHtmlCheckboxChecked(tag, checked) + line.slice(range.to), eol: lines[i].eol };
      return { content: joinSourceLines(lines), changed: true };
    }
  }
  return { content, changed: false };
}
