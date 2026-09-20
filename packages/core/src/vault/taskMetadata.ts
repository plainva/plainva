import { codeSpanRanges } from "../textScan.js";
/** Obsidian Tasks emoji fields. Reading never reformats the source line. */
export interface TasksRepeatRule { unit: "day" | "week" | "month" | "year"; interval: number; whenDone: boolean }
export interface TasksMetadata {
  created: string | null; completed: string | null; due: string | null;
  scheduled: string | null; start: string | null; taskId: string | null;
  recurrence: string | null; repeatRule: TasksRepeatRule | null;
  unsafeRecurrence: boolean;
}
type Field = "created" | "completed" | "due" | "scheduled" | "start" | "taskId" | "recurrence";
interface Token { field: Field; from: number; to: number; value: string }
const symbols: Record<string, Field> = { "➕": "created", "✅": "completed", "📅": "due", "⏳": "scheduled", "🛫": "start", "🆔": "taskId", "🔁": "recurrence" };
const markers = /(?:^|(?<=\s))(➕|✅|📅|⏳|🛫|🆔|🔁)\uFE0F?\s*/gu;
const boundary = /\s(?=[➕✅📅⏳🛫🆔🔁⛔🏁🔺⏫🔼🔽⏬❌]|#[\p{L}\p{N}]|\^[\w-]+(?:\s|$))/u;

/** Civil calendar days, validated without interpreting the device timezone. */
export function tasksDayNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const stamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp / 86_400_000 : null;
}
const dayKey = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
function outsideCode(text: string, offset: number, ranges: ReturnType<typeof codeSpanRanges>): boolean {
  let low = 0, high = ranges.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ranges[mid].to <= offset) low = mid + 1; else high = mid;
  }
  return !(low < ranges.length && ranges[low].from <= offset) && (offset === 0 || text[offset - 1] !== "\\");
}
function tokens(text: string, ranges = codeSpanRanges(text)): Token[] {
  const out: Token[] = [];
  for (const match of text.matchAll(markers)) {
    const from = match.index, start = from + match[0].length;
    if (!outsideCode(text, from, ranges)) continue;
    const field = symbols[match[1]], tail = text.slice(start);
    const raw = field === "recurrence" ? tail.split(boundary, 1)[0].trimEnd() : tail.match(/^\S+/)?.[0] ?? "";
    if (field === "recurrence" || (field === "taskId" ? /^[A-Za-z0-9_-]{1,256}$/.test(raw) : tasksDayNumber(raw) !== null)) out.push({ field, from, to: start + raw.length, value: raw });
  }
  return out;
}
export function readTasksMetadata(text: string): TasksMetadata {
  const result: TasksMetadata = { created: null, completed: null, due: null, scheduled: null, start: null, taskId: null, recurrence: null, repeatRule: null, unsafeRecurrence: false };
  const ranges = codeSpanRanges(text), found = tokens(text, ranges), counts = new Map<Field, number>();
  for (const token of found) counts.set(token.field, (counts.get(token.field) ?? 0) + 1);
  for (const token of found) {
    if (counts.get(token.field) !== 1) { result.unsafeRecurrence = true; continue; }
    result[token.field] = token.value;
  }
  // Unsupported directives and malformed/duplicated dates remain verbatim.
  const validOffsets = new Set(found.map(token => token.from));
  for (const match of text.matchAll(markers)) if (outsideCode(text, match.index, ranges) && !validOffsets.has(match.index)) result.unsafeRecurrence = true;
  if (/(?:^|\s)(?:⛔|🏁|\^[A-Za-z0-9_-]+(?:\s|$))/.test(text)) result.unsafeRecurrence = true;
  const rule = result.recurrence?.match(/^every(?: ([1-9]\d{0,2}))? (day|week|month|year)s?( when done)?$/i);
  if (rule && !result.unsafeRecurrence) result.repeatRule = { unit: rule[2].toLowerCase() as TasksRepeatRule["unit"], interval: Number(rule[1] ?? 1), whenDone: !!rule[3] };
  return result;
}
/** Remove only unambiguous fields displayed separately in the metadata row. */
export function tasksDescription(text: string): string {
  const found = tokens(text), counts = new Map<Field, number>();
  for (const token of found) counts.set(token.field, (counts.get(token.field) ?? 0) + 1);
  let result = text;
  for (const token of found.reverse()) if (counts.get(token.field) === 1) result = result.slice(0, token.from) + result.slice(token.to);
  return result.replace(/\s{2,}/g, " ").trim();
}
/** Surgical replacement leaves unknown fields and surrounding Markdown alone. */
export function setTasksField(text: string, field: Field, value: string | null): string {
  const found = tokens(text).filter(t => t.field === field);
  if (found.length > 1) return text;
  const symbol = Object.entries(symbols).find(([, name]) => name === field)![0];
  if (found.length) {
    const token = found[0];
    const start = value === null && token.from > 0 && text[token.from - 1] === " " ? token.from - 1 : token.from;
    return text.slice(0, start) + (value === null ? "" : symbol + " " + value) + text.slice(token.to);
  }
  if (value === null) return text;
  const tail = text.trimEnd(), block = /\^[A-Za-z0-9_-]+$/.exec(tail);
  const at = block && block.index > 0 && /\s/.test(tail[block.index - 1]) ? tail.slice(0, block.index).trimEnd().length : tail.length;
  return text.slice(0, at) + " " + symbol + " " + value + text.slice(at);
}
/**
 * Priority marks of the Tasks plugin. READ in three ranks — 🔺 and ⏫ as high,
 * 🔼 as medium, 🔽 and ⏬ as low — because a to-do list has room for three and
 * a vault written elsewhere must not lose its "highest". Plainva writes one mark
 * per rank and only when somebody changes the priority here.
 */
const PRIORITY_RANK: Record<string, 1 | 2 | 3> = { "🔺": 1, "⏫": 1, "🔼": 2, "🔽": 3, "⏬": 3 };
const PRIORITY_MARK: Record<1 | 2 | 3, string> = { 1: "⏫", 2: "🔼", 3: "🔽" };
const priorityMarks = /(?:^|(?<=\s))(🔺|⏫|🔼|🔽|⏬)\uFE0F?(?=\s|$)/gu;

/** 1 = high … 3 = low, 0 = none. The first mark outside code counts. */
export function readTasksPriority(text: string): 0 | 1 | 2 | 3 {
  const ranges = codeSpanRanges(text);
  for (const match of text.matchAll(priorityMarks)) {
    if (outsideCode(text, match.index, ranges)) return PRIORITY_RANK[match[1]];
  }
  return 0;
}

/** The task text without its priority marks — for a view that draws a flag instead. */
export function stripTasksPriority(text: string): string {
  const ranges = codeSpanRanges(text);
  let out = "";
  let at = 0;
  for (const match of text.matchAll(priorityMarks)) {
    if (!outsideCode(text, match.index, ranges)) continue;
    out += text.slice(at, match.index);
    at = match.index + match[0].length;
  }
  return (out + text.slice(at)).replace(/\s{2,}/g, " ").trim();
}

/**
 * Sets the priority of a task line: every mark outside code goes, and the one
 * mark of the new rank is put in front of the first dated field (where the
 * Tasks plugin writes it) or at the end. Rank 0 only removes.
 */
export function setTasksPriority(text: string, rank: 0 | 1 | 2 | 3): string {
  const bare = stripTasksPriority(text);
  if (rank === 0) return bare;
  const first = tokens(bare)[0];
  const block = /\s\^[A-Za-z0-9_-]+\s*$/.exec(bare);
  const at = first ? first.from : block ? block.index + 1 : bare.length;
  const head = bare.slice(0, at).trimEnd();
  const tail = bare.slice(at).trimStart();
  return [head, PRIORITY_MARK[rank], tail].filter((part) => part.length > 0).join(" ");
}

/** Tasks advances one occurrence from its reference, including overdue ones.
 * The native Plainva generator deliberately skips missed dates instead. */
export function nextTasksDates(meta: TasksMetadata, today: string): Pick<TasksMetadata, "due" | "scheduled" | "start"> | null {
  const rule = meta.repeatRule;
  if (!rule || tasksDayNumber(today) === null) return null;
  const reference = meta.due ?? meta.scheduled ?? meta.start ?? today, origin = rule.whenDone ? today : reference;
  let next: string;
  if (rule.unit === "day" || rule.unit === "week") next = dayKey(tasksDayNumber(origin)! + rule.interval * (rule.unit === "week" ? 7 : 1));
  else {
    const [y, m, d] = origin.split("-").map(Number), count = rule.interval * (rule.unit === "year" ? 12 : 1);
    const date = new Date(0); date.setUTCFullYear(y, m - 1 + count, 1);
    const last = new Date(date); last.setUTCMonth(last.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(d, last.getUTCDate())); next = date.toISOString().slice(0, 10);
  }
  if (tasksDayNumber(next) === null) return null;
  const delta = tasksDayNumber(next)! - tasksDayNumber(reference)!;
  const move = (day: string | null) => day === null ? null : dayKey(tasksDayNumber(day)! + delta);
  const dates = { due: move(meta.due), scheduled: move(meta.scheduled), start: move(meta.start) };
  return Object.values(dates).some(value => value !== null && tasksDayNumber(value) === null) ? null : dates;
}
