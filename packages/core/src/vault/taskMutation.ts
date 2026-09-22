import { sha256Hex, utf8Encode } from "../workspace/encoding.js";
import { GFM_TASK_FENCE, GFM_TASK_LINE, scanTasks, taskBoxChar, type ScannedTask, type TaskBoxState } from "./taskScan.js";
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
  // Judged by the BOX, not by `done`: un-ticking a cancelled task (`[-]`, not
  // done) reopens it, and ticking one in progress (`[/]`) completes it.
  if (!task || (checked ? task.state === "done" : task.state === "open")) return { content, changed: false };
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
  const lines = content.split("\n"), raw = lines[task.line];
  const match = GFM_TASK_LINE.exec(raw)!;
  lines[task.line] = match[1] + taskBoxChar(state) + raw.slice(match[1].length + 1);
  return { content: lines.join("\n"), changed: true };
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
 * code is skipped, exactly as the GFM scan skips it.
 */
/**
 * ONE element, TWO attributes. A tag carrying anything else — a handler, a
 * name, a value, another type — is not one of ours and stays the text it was.
 * Reader and writer ask this same question, or their ordinals drift apart and
 * a tick lands on the wrong row.
 */
const HTML_CHECKBOX_RE = /<input((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/gi;
const CHECKBOX_ATTR_RE = /\s+([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

export function readHtmlCheckbox(tag: string): { checked: boolean } | null {
  const shape = new RegExp(`^${HTML_CHECKBOX_RE.source}$`, "i").exec(tag.trim());
  if (!shape) return null;
  let type: string | null = null;
  let checked = false;
  CHECKBOX_ATTR_RE.lastIndex = 0;
  for (let m = CHECKBOX_ATTR_RE.exec(shape[1] ?? ""); m; m = CHECKBOX_ATTR_RE.exec(shape[1] ?? "")) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? null;
    if (name === "type") type = (value ?? "").toLowerCase();
    else if (name === "checked") checked = true;
    else return null;
  }
  return type === "checkbox" ? { checked } : null;
}


export function setHtmlCheckboxChecked(content: string, index: number, checked: boolean): ChecklistMutationResult {
  const lines = content.split("\n");
  let ordinal = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (GFM_TASK_FENCE.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    let changedLine: string | null = null;
    lines[i] = lines[i].replace(HTML_CHECKBOX_RE, (tag) => {
      const box = readHtmlCheckbox(tag);
      if (!box) return tag;
      if (ordinal++ !== index) return tag;
      if (box.checked === checked) return tag;
      // The tag keeps everything else byte for byte: a vault file is the
      // user's, and a rewrite that tidies attributes is a rewrite they did
      // not ask for.
      const next = checked
        ? tag.replace(/\s*\/?>$/, (end) => ` checked${end.trimStart()}`)
        : tag.replace(/\s+checked(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/i, "");
      changedLine = next;
      return next;
    });
    if (changedLine !== null) return { content: lines.join("\n"), changed: true };
  }
  return { content, changed: false };
}
