import { readFrontmatterPath, setFrontmatterPath, deleteFrontmatterPath } from "@plainva/core";

/**
 * Recurring tasks (issue #34, wave 3).
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
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function formatDay(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Adds whole days on the civil calendar. */
function addDays(key: string, days: number): string {
  const p = parseDay(key);
  if (!p) return key;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
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
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
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
  if (!parseDay(anchor)) return null;
  let next = step(anchor, rule);
  if (rule.from === "due" && parseDay(completedOn)) {
    // Catch up without materialising the misses. The bound is generous enough
    // for years of a daily task and still terminates on absurd input.
    for (let i = 0; i < 4000 && next <= completedOn; i++) next = step(next, rule);
  }
  return next;
}

/** The next free "<stem> N.md" beside the completed note. The occurrence is an
 * ordinary sibling note, so the finished one stays as the record of what was
 * done. Pure except for the existence probe. */
export async function writeNextOccurrenceNote(
  adapter: { exists(path: string): Promise<boolean>; writeTextFile(path: string, content: string): Promise<void> },
  sourcePath: string,
  content: string
): Promise<string | null> {
  const dot = sourcePath.lastIndexOf(".");
  const base = dot > 0 ? sourcePath.slice(0, dot) : sourcePath;
  const ext = dot > 0 ? sourcePath.slice(dot) : ".md";
  // Strip a trailing counter so a chain reads "Task 2", "Task 3" — not
  // "Task 2 2 2" after the third repetition.
  const stem = base.replace(/ \d+$/, "");
  for (let n = 2; n < 500; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!(await adapter.exists(candidate))) {
      await adapter.writeTextFile(candidate, content);
      return candidate;
    }
  }
  return null;
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
