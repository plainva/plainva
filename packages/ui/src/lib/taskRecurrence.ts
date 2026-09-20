import { readFrontmatterPath, setFrontmatterPath, deleteFrontmatterPath, workspaceSha256Hex, utf8Encode, tasksDayNumber } from "@plainva/core";

/**
 * Recurring tasks (issue #34, wave 3; shared by both shells since S24).
 *
 * Events have a real recurrence RULE (RRULE, expanded by the provider). Tasks
 * cannot work that way here: a database entry IS a note on disk, so a rule
 * would have to materialise notes for occurrences nobody has looked at yet.
 * Instead this is a GENERATOR — checking a task off writes the NEXT one — which
 * matches how a repeating task actually behaves: only one instance is ever
 * open, and the next one exists because the last was done.
 *
 * The four questions the plan left open, and the answers this implements:
 *
 * 1. WHERE DOES THE RULE LIVE? In the note's frontmatter, under the
 *    Obsidian-inert `plainva` namespace — not as a database column. Repetition
 *    belongs to the single task, not to every row of a database, and a column
 *    would have to be added to every task database to be usable at all.
 *
 * 2. SKIPPED DUE DATES? `from: "due"` counts from the due date (a fixed rhythm:
 *    "every Monday"), `from: "completion"` from the day it was ticked ("every
 *    3 days after I do it"). A long-overdue fixed task jumps to the next date
 *    in the FUTURE rather than generating the pile it missed — a backlog of
 *    identical overdue notes is rubbish nobody asked for.
 *
 * 3. DELETING ONE INSTANCE? There is no series to delete from. Each generated
 *    task is an ordinary note; deleting it ends the chain, which is what
 *    deleting a repeating task means. No "delete all occurrences?" dialog can
 *    lie to the user because no hidden series exists.
 *
 * 4. MIRRORED REMOTE TASKS? A note carrying the `plainva.pim` anchor of a
 *    mirrored provider task never gets a local rule (see `canRepeat`): the
 *    provider owns its own recurrence, and a second generator on top would
 *    push duplicates back at it.
 */

export type RepeatFreq = "daily" | "weekly" | "monthly" | "yearly";
/** Anchor the next due date is counted from. */
export type RepeatFrom = "due" | "completion";

export interface RepeatRule {
  freq: RepeatFreq;
  /** Every N periods; 1 = every period. */
  interval: number;
  from: RepeatFrom;
}

const FREQS: RepeatFreq[] = ["daily", "weekly", "monthly", "yearly"];
const MAX_INTERVAL = 999;

/** Frontmatter path of the rule (Obsidian-inert namespace). */
export const REPEAT_PATH = ["plainva", "repeat"];

/**
 * The rule out of an INDEXED `plainva` namespace value, as the database query
 * hands it over (a JSON string, like the document icons read it). This is what
 * keeps the list cheap: no file read per row just to show a badge.
 */
export function repeatFromNamespace(raw: unknown): RepeatRule | null {
  if (raw == null) return null;
  let ns: unknown = raw;
  if (typeof raw === "string") {
    try {
      ns = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!ns || typeof ns !== "object") return null;
  return normalizeRule((ns as Record<string, unknown>).repeat);
}

/**
 * Whether an INDEXED `plainva` namespace value belongs to a task mirrored from
 * a provider list. Such a task keeps its provider's recurrence, so the list
 * does not offer the local one at all — better than offering it and refusing
 * afterwards.
 */
export function isMirroredNamespace(raw: unknown): boolean {
  if (raw == null) return false;
  let ns: unknown = raw;
  if (typeof raw === "string") {
    try {
      ns = JSON.parse(raw);
    } catch {
      return false;
    }
  }
  const pim = (ns as Record<string, unknown> | null)?.pim as Record<string, unknown> | undefined;
  return typeof pim?.uid === "string" && pim.uid.length > 0;
}

/**
 * Whether the reconciler has seen the PROVIDER repeat this task
 * (`plainva.pim.recurring`, finding 2026-09-20): completed here or there, then
 * back open under the same id with a later due date. Same input shapes as
 * `isMirroredNamespace` — the indexed namespace arrives as an object or as JSON.
 */
export function isRecurringAtProviderNamespace(raw: unknown): boolean {
  if (raw == null) return false;
  let ns: unknown = raw;
  if (typeof raw === "string") {
    try {
      ns = JSON.parse(raw);
    } catch {
      return false;
    }
  }
  const pim = (ns as Record<string, unknown> | null)?.pim as Record<string, unknown> | undefined;
  return typeof pim?.uid === "string" && pim.uid.length > 0 && pim.recurring === true;
}

/** Shared shape check + repair for both readers. */
function normalizeRule(raw: unknown): RepeatRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const freq = String(obj.freq ?? "");
  if (!FREQS.includes(freq as RepeatFreq)) return null;
  const interval = Math.floor(Number(obj.interval ?? 1));
  return {
    freq: freq as RepeatFreq,
    interval: Number.isFinite(interval) && interval >= 1 ? Math.min(interval, MAX_INTERVAL) : 1,
    from: obj.from === "completion" ? "completion" : "due",
  };
}

/**
 * Reads the rule from a note. Anything malformed reads as "no rule" rather than
 * throwing — a hand-edited frontmatter must never break checking a task off.
 */
export function readRepeatRule(content: string): RepeatRule | null {
  return normalizeRule(readFrontmatterPath(content, REPEAT_PATH));
}

/** A retry on another day must keep the date chosen by its persisted plan. */
export function readRepeatCompletionDay(content: string): string | null {
  const day = readFrontmatterPath(content, ["plainva", "repeatNext", "completedOn"]);
  return typeof day === "string" && tasksDayNumber(day) !== null ? day : null;
}

/** Writes the rule into a note, or removes it when `null`. Only the rule key is
 * touched, so a sibling anchor (`plainva.pim`, `plainva.blocks`) survives. */
export function writeRepeatRule(content: string, rule: RepeatRule | null): string {
  return rule ? setFrontmatterPath(content, REPEAT_PATH, { ...rule }) : deleteFrontmatterPath(content, REPEAT_PATH);
}

/** A mirrored provider task keeps ITS provider's recurrence; a local generator
 * on top would push duplicates back at the provider. */
export function canRepeat(content: string): boolean {
  return readFrontmatterPath(content, ["plainva", "pim", "uid"]) == null;
}

/** Civil date helpers — dates here are day-granular strings (YYYY-MM-DD) and
 * must never travel through timezone math. */
function parseDay(key: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m || tasksDayNumber(key.trim()) === null) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function formatDay(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Adds whole days on the civil calendar. */
function addDays(key: string, days: number): string {
  const p = parseDay(key);
  if (!p) return key;
  const dt = new Date(0); dt.setUTCFullYear(p.y, p.m - 1, p.d);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatDay(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Adds whole months, CLAMPING to the end of the target month: 31 January + 1
 * month is 28/29 February, not 3 March. Rolling over would silently drift a
 * monthly task later every year.
 */
function addMonths(key: string, months: number): string {
  const p = parseDay(key);
  if (!p) return key;
  const total = (p.y * 12 + (p.m - 1)) + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  const lastDate = new Date(0); lastDate.setUTCFullYear(y, m, 0);
  const lastDay = lastDate.getUTCDate();
  return formatDay(y, m, Math.min(p.d, lastDay));
}

/** One step of the rule from a given date. */
function step(from: string, rule: RepeatRule): string {
  switch (rule.freq) {
    case "daily":
      return addDays(from, rule.interval);
    case "weekly":
      return addDays(from, rule.interval * 7);
    case "monthly":
      return addMonths(from, rule.interval);
    case "yearly":
      return addMonths(from, rule.interval * 12);
  }
}

/**
 * The next due date after checking a task off.
 *
 * - `from: "completion"` counts from the day it was ticked, so the rhythm
 *   follows the doing ("every 3 days after I water the plants").
 * - `from: "due"` keeps the fixed rhythm, but never returns a date that is
 *   already in the past: an overdue weekly task resumes at the next occurrence
 *   from today instead of dumping every missed one into the list.
 *
 * Returns null when there is nothing to count from (no due date and no
 * completion date) — the caller then leaves the task alone. Pure.
 */
export function nextDueDate(rule: RepeatRule, currentDue: string | null, completedOn: string): string | null {
  const anchor = rule.from === "completion" ? completedOn : currentDue || completedOn;
  if (!parseDay(anchor) || !Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > MAX_INTERVAL || !FREQS.includes(rule.freq)) return null;
  let next = step(anchor, rule);
  if (rule.from === "due" && parseDay(completedOn)) {
    if (rule.freq === "daily" || rule.freq === "weekly") {
      const days = rule.interval * (rule.freq === "weekly" ? 7 : 1);
      const periods = Math.max(1, Math.floor((tasksDayNumber(completedOn.trim())! - tasksDayNumber(anchor.trim())!) / days) + 1);
      next = addDays(anchor, periods * days);
    } else {
      // Preserve each month's clamping. Four-digit civil years bound this
      // loop to fewer than 120,000 steps, including very old imported tasks.
      while (tasksDayNumber(next) !== null && next <= completedOn) next = step(next, rule);
    }
  }
  return tasksDayNumber(next) === null ? null : next;
}

/** The next free "<stem> N.md" beside the completed note. The occurrence is an
 * ordinary sibling note, so the finished one stays as the record of what was
 * done. Pure except for the existence probe. */
export async function writeNextOccurrenceNote(
  adapter: { exists(path: string): Promise<boolean>; readTextFile(path: string): Promise<string>; writeTextFile(path: string, content: string): Promise<void> },
  sourcePath: string,
  content: string,
  completedOn?: string
): Promise<string | null> {
  const planKey = ["plainva", "repeatNext"], originKey = ["plainva", "repeatOrigin"];
  type Plan = { version: 1; id: string; path: string; hash: string; complete?: boolean; completedOn?: string };
  const initial = await adapter.readTextFile(sourcePath);
  let plan = readFrontmatterPath(initial, planKey) as Plan | undefined;
  const dot = sourcePath.lastIndexOf(".");
  const base = dot > 0 ? sourcePath.slice(0, dot) : sourcePath;
  const ext = dot > 0 ? sourcePath.slice(dot) : ".md";
  // Strip a trailing counter so a chain reads "Task 2", "Task 3" — not
  // "Task 2 2 2" after the third repetition.
  const stem = base.replace(/ \d+$/, "");
  const validTarget = (path: unknown) => typeof path === "string" && Array.from({ length: 498 }, (_, i) => `${stem} ${i + 2}${ext}`).includes(path) && path !== sourcePath;
  if (plan && (plan.version !== 1 || !/^[a-f0-9-]{36}$/.test(plan.id) || !/^[a-f0-9]{64}$/.test(plan.hash) || (plan.complete !== undefined && typeof plan.complete !== "boolean"))) throw new Error("task_repeat_invalid_plan");
  if ((plan?.completedOn !== undefined && (typeof plan.completedOn !== "string" || tasksDayNumber(plan.completedOn) === null)) || (completedOn !== undefined && tasksDayNumber(completedOn) === null)) throw new Error("task_repeat_invalid_plan");
  // Completion is a receipt: deleting or editing a generated note later never
  // resurrects it when the predecessor is checked a second time.
  if (plan?.complete) return null;
  if (plan && !validTarget(plan.path)) throw new Error("task_repeat_invalid_plan");
  const id = plan?.id ?? crypto.randomUUID();
  let nextContent = deleteFrontmatterPath(content, planKey);
  nextContent = deleteFrontmatterPath(nextContent, ["blockedBy"]);
  nextContent = setFrontmatterPath(nextContent, originKey, { id, source: sourcePath });
  const hash = workspaceSha256Hex(utf8Encode(nextContent));
  if (!plan) {
    let path: string | null = null;
    for (let n = 2; n < 500; n++) {
      const candidate = `${stem} ${n}${ext}`;
      if (!await adapter.exists(candidate)) { path = candidate; break; }
    }
    if (!path) return null;
    plan = { version: 1, id, path, hash, ...(completedOn ? { completedOn } : {}) };
    await adapter.writeTextFile(sourcePath, setFrontmatterPath(initial, planKey, plan));
    if (JSON.stringify(readFrontmatterPath(await adapter.readTextFile(sourcePath), planKey)) !== JSON.stringify(plan)) throw new Error("task_repeat_plan_not_saved");
  }
  let created = false;
  if (await adapter.exists(plan.path)) {
    const origin = readFrontmatterPath(await adapter.readTextFile(plan.path), originKey) as { id?: string; source?: string } | undefined;
    if (origin?.id !== plan.id || origin.source !== sourcePath) throw new Error("task_repeat_destination_changed");
  } else {
    if (hash !== plan.hash) throw new Error("task_repeat_source_changed");
    await adapter.writeTextFile(plan.path, nextContent);
    if (workspaceSha256Hex(utf8Encode(await adapter.readTextFile(plan.path))) !== plan.hash) throw new Error("task_repeat_copy_not_saved");
    created = true;
  }
  // Re-read before the receipt so a source edit made during the copy survives.
  const latest = await adapter.readTextFile(sourcePath), current = readFrontmatterPath(latest, planKey) as Plan | undefined;
  if (current?.id !== plan.id || current.path !== plan.path || current.hash !== plan.hash) throw new Error("task_repeat_plan_changed");
  await adapter.writeTextFile(sourcePath, setFrontmatterPath(latest, planKey, { ...plan, complete: true }));
  const receipt = readFrontmatterPath(await adapter.readTextFile(sourcePath), planKey) as Plan | undefined;
  if (receipt?.id !== plan.id || receipt.complete !== true) throw new Error("task_repeat_receipt_not_saved");
  return created ? plan.path : null;
}

/** Human-readable rule, for the row badge and the dialog. The caller supplies
 * the localized wording; this only picks which one and with which number. */
export function describeRule(
  rule: RepeatRule,
  t: (key: string, opts: { defaultValue: string; n: number }) => string
): string {
  const key = `tasks.repeatEvery_${rule.freq}`;
  const fallback: Record<RepeatFreq, string> = {
    daily: "every {{n}} d",
    weekly: "every {{n}} w",
    monthly: "every {{n}} mo",
    yearly: "every {{n}} y",
  };
  return t(key, { defaultValue: fallback[rule.freq], n: rule.interval });
}
