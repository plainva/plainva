import { scanTasks, trimEndChars, updateVaultText, wikiTargetForPath, type TextUpdateFiles } from "@plainva/core";
import { TASK_LINE_RE, FENCE_RE } from "./taskToggle";
import { parseBaseConfig } from "../base/baseFormat";
import { resolveNewItemTarget } from "../base/baseRelations";
import { buildNewItemContent } from "./newItemContent";
import { taskDbFileStem } from "./taskDatabase";
import { priorityValue, resolveTaskPriorityModel } from "./taskPriority";
import { writeRepeatRule, type RepeatRule } from "./taskRecurrence";
import type { TaskPriority } from "./taskPlanner";

/**
 * Checkbox-task promotion, shared by both shells (S23).
 *
 * Turns an inline GFM checkbox into a first-class note inside the vault's task
 * database. The checkbox line is REPLACED in place by a wiki link to the new
 * note ("promote in place" — the item stays visible where it was written and
 * the task note gets a backlink via the link index), its `#tags` move into the
 * note's frontmatter tags, a `📅` due date lands in the database's date column
 * and the note links back to its source via a `source` wiki link.
 *
 * Ordinal counting MUST stay in lock-step with `scanTasks`/`toggleTaskAtIndex`
 * (shared `TASK_LINE_RE`/`FENCE_RE`), otherwise a promotion would rewrite the
 * wrong line.
 */

const TITLE_DUE = /📅\s*\d{4}-\d{2}-\d{2}/gu;
const TITLE_TAG = /(^|\s)#[\p{L}\p{N}][\p{L}\p{N}_/-]*/gu;
const MAX_STEM_LENGTH = 60;

/** Cleaned title for a promoted task: the checkbox text without its `#tags` and
 * `📅` due marker (both move into structured fields), whitespace collapsed.
 * Empty when the text was only tags/date — the caller supplies a fallback. */
export function taskTextToTitle(text: string): string {
  return text
    .replace(TITLE_DUE, " ")
    .replace(TITLE_TAG, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** File-name stem for the promoted note: sanitized like the task-DB name and
 * capped at a word boundary (long task sentences must not become file names
 * verbatim — the full title still lands in the H1). A cap that lands inside a
 * parenthetical drops the dangling "(rest" — an unbalanced paren in a note
 * name is ugly and used to break the read-mode link rendering. */
export function taskFileStem(title: string): string | null {
  const stem = taskDbFileStem(title);
  if (!stem) return null;
  if (stem.length <= MAX_STEM_LENGTH) return stem;
  const cut = stem.slice(0, MAX_STEM_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  let trimmed = lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
  // Drop a parenthetical the cap sliced open (unmatched trailing "(…").
  let depth = 0;
  let openAt = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "(") {
      if (depth === 0) openAt = i;
      depth++;
    } else if (trimmed[i] === ")") {
      depth = Math.max(0, depth - 1);
    }
  }
  if (depth > 0 && openAt > 0) trimmed = trimmed.slice(0, openAt);
  // Trailing dots by hand (plan Befunde 24.09., E6): `/\.+$/` retried a long
  // run of them from each of its characters.
  trimmed = trimEndChars(trimmed, ".").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface CheckboxReplaceResult {
  content: string;
  changed: boolean;
}

/**
 * Replaces the `ordinal`-th (0-based, document order) task checkbox with a wiki
 * link, preserving indentation, blockquote markers and the list bullet. Fence-
 * aware, in lock-step with `scanTasks`/`toggleTaskAtIndex`. The alias is
 * appended only when it differs from the link target.
 *
 * The lines are the ones `scanTasks` counts — the file's, split at `\n` — so
 * the ordinal it hands out names the same checkbox here. Counted in the text
 * an editor holds, a carriage return of its own between two checkboxes made
 * two lines of one, and the link replaced the checkbox after the one that was
 * promoted (finding 2026-10-22). The replaced line keeps what ends it: it
 * used to lose its `\r`, one line of the other kind in a note that lies there
 * with `\r\n` (finding 2026-10-09). And what such a line holds behind a
 * carriage return of its own — the next lines of a file from a classic Mac —
 * stays in the note: only the checkbox is replaced. The chain that writes the
 * note turns those line ends (`ConflictAwareVaultAdapter`).
 */
export function replaceCheckboxWithLink(
  content: string,
  ordinal: number,
  linkTarget: string,
  alias?: string
): CheckboxReplaceResult {
  const lines = content.split("\n");
  let inFence = false;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = lines[i].match(TASK_LINE_RE);
    if (!m) continue;
    if (seen === ordinal) {
      // m[1] ends with the checkbox "[": keep everything before it (indent +
      // blockquote markers + bullet + spacing), drop the "[x] text" rest.
      const prefix = lines[i].slice(0, m[1].length - 1);
      const link = alias && alias !== linkTarget ? `[[${linkTarget}|${alias}]]` : `[[${linkTarget}]]`;
      // What follows the checkbox's own line on the same `\n`-line: from the
      // first carriage return of its own behind the box, or the `\r` of a
      // `\r\n`. One in front of the box is part of the prefix and stays there.
      const inner = lines[i].slice(m[1].length).search(/\r(?!$)/);
      const rest = inner >= 0 ? lines[i].slice(m[1].length + inner) : lines[i].endsWith("\r") ? "\r" : "";
      lines[i] = `${prefix}${link}${rest}`;
      return { content: lines.join("\n"), changed: true };
    }
    seen++;
  }
  return { content, changed: false };
}

/** First column key of the parsed base config matching the predicate. Shared
 * with the stage-3 task reconciler (same due/status column resolution). */
export function findColumnKey(
  config: unknown,
  pred: (col: Record<string, unknown>) => boolean
): string | null {
  const cols = (config as { columns?: Record<string, unknown> } | null)?.columns ?? {};
  for (const [key, col] of Object.entries(cols)) {
    if (col && pred(col as Record<string, unknown>)) return key;
  }
  return null;
}

/**
 * Minimal adapter surface promotion needs (satisfied by both shells): a
 * vault's chain, or a storage with nothing above it. The new note is written,
 * the source note is read, changed and written in one step (`updateVaultText`).
 */
export interface TaskPromotionAdapter extends TextUpdateFiles {
  exists(path: string): Promise<boolean>;
}

export interface PromoteTaskOptions {
  adapter: TaskPromotionAdapter;
  /** Vault-relative path of the note holding the checkbox. */
  sourcePath: string;
  /** The listed task (ordinal + text act as the stale guard). */
  task: { ordinal: number; text: string; tags: string[]; due: string | null; done: boolean };
  /** Vault-relative path of the target `.base`. */
  dbPath: string;
  /** Configured default OKF `type` for new notes. */
  noteType: string;
  /** All vault note paths — collision-safe wiki link text (`wikiTargetForPath`). */
  allNotePaths: string[];
  /** Localized fallback title when the task text is only tags/date. */
  fallbackTitle: string;
}

export type PromoteTaskResult =
  | { ok: true; notePath: string; title: string }
  | { ok: false; reason: "dbUnreadable" | "noFolder" | "stale" };

interface BaseConfigShape {
  columns?: Record<string, { input?: string; options?: unknown[] }>;
  newItemTemplate?: string;
}

/** First free `<stem>.md`, `<stem> 2.md`, … below `folder`. */
async function freePath(adapter: TaskPromotionAdapter, folder: string, stem: string): Promise<string> {
  const dir = trimEndChars(folder, "/");
  const prefix = dir ? dir + "/" : "";
  let name = stem;
  for (let n = 2; await adapter.exists(prefix + name + ".md"); n++) name = `${stem} ${n}`;
  return prefix + name + ".md";
}

async function readTemplate(adapter: Pick<TaskPromotionAdapter, "readTextFile">, config: BaseConfigShape): Promise<string | null> {
  if (!config.newItemTemplate) return null;
  try {
    return await adapter.readTextFile(config.newItemTemplate);
  } catch {
    // Missing template — create without it, like the base's "+ item" does.
    return null;
  }
}

/**
 * Promotes one checkbox into the task database: resolves the database's storage
 * folder (`resolveNewItemTarget`, exactly like the base's "+ item" button),
 * creates the note (template + OKF defaults + tag merge + due/status/source
 * pre-fills), then rewrites the source line into a wiki link. The source is
 * re-read and ordinal-verified first — a stale listing never rewrites the wrong
 * line (same guard as the checkbox toggle).
 */
export async function promoteTask(opts: PromoteTaskOptions): Promise<PromoteTaskResult> {
  const { adapter, sourcePath, task, dbPath, noteType, allNotePaths, fallbackTitle } = opts;

  let config: BaseConfigShape;
  try {
    config = parseBaseConfig(await adapter.readTextFile(dbPath)) as BaseConfigShape;
  } catch {
    return { ok: false, reason: "dbUnreadable" };
  }
  // Deliberately NOT falling back to the first of several folder sources: a
  // database with an unresolved storage folder must ask, not guess where a
  // task lands.
  const target = resolveNewItemTarget(config);
  if (!target.folder) return { ok: false, reason: "noFolder" };

  // Stale guard BEFORE any write: the note must still carry this exact task.
  const source = await adapter.readTextFile(sourcePath);
  if (scanTasks(source)[task.ordinal]?.text !== task.text) {
    return { ok: false, reason: "stale" };
  }

  const title = taskTextToTitle(task.text) || fallbackTitle;
  const notePath = await freePath(adapter, target.folder, taskFileStem(title) ?? fallbackTitle);
  const templateText = await readTemplate(adapter, config);

  // Pre-fills: due date into the database's (first) date column, an open task
  // into the first status option (a done checkbox gets no status guess), and
  // the backlink to the source note. Template-defined keys win downstream.
  const prefills: Record<string, unknown> = {};
  const dueKey = findColumnKey(config, (c) => c.input === "date" || c.input === "datetime");
  if (task.due && dueKey) prefills[dueKey] = task.due;
  const statusKey = findColumnKey(
    config,
    (c) => (c.input === "status" || c.input === "select") && Array.isArray(c.options) && c.options.length > 0
  );
  if (!task.done && statusKey) {
    const first = config.columns?.[statusKey]?.options?.[0];
    const value = typeof first === "string" ? first : (first as { value?: string } | undefined)?.value;
    if (value) prefills[statusKey] = value;
  }
  // A done CHECKBOX column (the database's completion truth) mirrors the
  // promoted checkbox's state directly.
  const doneKey = findColumnKey(config, (c) => c.input === "checkbox");
  if (doneKey) prefills[doneKey] = task.done;
  prefills.source = `[[${wikiTargetForPath(sourcePath, allNotePaths)}]]`;

  const inheritTags = [...new Set([...(target.inheritTags ?? []), ...task.tags])];
  const content = buildNewItemContent({ templateText, noteType, title, inheritTags, prefills });
  await adapter.writeTextFile(notePath, content);

  // Replace the checkbox with a link to the new note (alias = cleaned title so
  // the line reads naturally even when the link target is a qualified path).
  // The source is read again where it is written: the template was read and
  // the new note written since the guard above. The line is the task at its
  // place — or, where lines moved meanwhile (or in the user's own version of
  // a note with an open conflict), the one task of that wording. A text that
  // carries no such task, or several, is left alone.
  const linkTarget = wikiTargetForPath(notePath, [...allNotePaths, notePath]);
  const linked = (fresh: string): string | null => {
    const tasks = scanTasks(fresh);
    const same = tasks[task.ordinal]?.text === task.text ? [tasks[task.ordinal]] : tasks.filter((t) => t.text === task.text);
    if (same.length !== 1) return null;
    const replaced = replaceCheckboxWithLink(fresh, same[0].ordinal, linkTarget, title);
    return replaced.changed ? replaced.content : null;
  };
  const update = await updateVaultText(adapter, sourcePath, linked);
  // The task note exists either way. A source that changed under the step
  // keeps its checkbox, and says so where somebody looks for the reason.
  if (linked(update.before) === null) console.warn(`[taskPromotion] ${sourcePath}: the task's line was not found again; its checkbox stays beside the new note`);

  return { ok: true, notePath, title };
}

export interface CreateTaskOptions {
  adapter: TaskPromotionAdapter;
  dbPath: string;
  title: string;
  noteType: string;
  /**
   * A due date for the database's date column, if it has one (S30). A task
   * made from a mail inherits the mail's day — without it every captured mail
   * lands undated in a view that sorts by date.
   */
  dueDate?: string;
  /** Appended below the generated note — e.g. the sender of a captured mail. */
  trailer?: string;
  /**
   * Minutes into the due day (quick capture, B2). The due property then reads
   * `YYYY-MM-DDTHH:mm` — the form `parseDueValue` has always understood; to the
   * providers the task still goes with its day only.
   */
  dueMinutes?: number | null;
  /** Tags typed into the capture line; merged with the ones the database hands down. */
  tags?: readonly string[];
  /** Written when the database HAS a priority column — creating a task never adds one. */
  priority?: TaskPriority;
  /** Plainva's own recurrence (`plainva.repeat`). */
  repeat?: RepeatRule | null;
}

/**
 * Creates an entry in the task database WITHOUT a source checkbox (issue #34):
 * the Tasks view could only tick and open, so the only way to add a task was to
 * open the `.base` and use "+ Entry". Shares the promotion's resolution — same
 * storage folder, template, OKF defaults, inherited tags and open-status
 * pre-fill — so both routes produce identical notes.
 */
export async function createTaskInDatabase(
  opts: CreateTaskOptions
): Promise<{ ok: true; notePath: string } | { ok: false; reason: "dbUnreadable" | "noFolder" }> {
  const prepared = await prepareTaskNote(opts);
  if (!prepared.ok) return prepared;
  const notePath = await freePath(opts.adapter, prepared.folder, taskFileStem(opts.title) ?? opts.title);
  await opts.adapter.writeTextFile(notePath, prepared.content);
  return { ok: true, notePath };
}

/**
 * The folder and the content a new task note would get — WITHOUT choosing a
 * path or writing anything. `createTaskInDatabase` is this plus a free path and
 * one write; the phone's share import (plan Aufgaben-Oberflaeche, B6) owns its
 * path and its write through a durable native plan, and only needs to know
 * where a task belongs and what it looks like.
 */
export async function prepareTaskNote(
  opts: Omit<CreateTaskOptions, "adapter"> & { adapter: Pick<TaskPromotionAdapter, "readTextFile" | "exists"> }
): Promise<{ ok: true; folder: string; content: string } | { ok: false; reason: "dbUnreadable" | "noFolder" }> {
  const { adapter, dbPath, title, noteType } = opts;
  let config: BaseConfigShape;
  try {
    config = parseBaseConfig(await adapter.readTextFile(dbPath)) as BaseConfigShape;
  } catch {
    return { ok: false, reason: "dbUnreadable" };
  }
  const target = resolveNewItemTarget(config);
  if (!target.folder) return { ok: false, reason: "noFolder" };

  const templateText = await readTemplate(adapter, config);

  const prefills: Record<string, unknown> = {};
  const statusKey = findColumnKey(
    config,
    (c) => (c.input === "status" || c.input === "select") && Array.isArray(c.options) && c.options.length > 0
  );
  if (statusKey) {
    const first = config.columns?.[statusKey]?.options?.[0];
    const value = typeof first === "string" ? first : (first as { value?: string } | undefined)?.value;
    if (value) prefills[statusKey] = value;
  }
  const doneKey = findColumnKey(config, (c) => c.input === "checkbox");
  if (doneKey) prefills[doneKey] = false;
  if (opts.dueDate) {
    const dueKey = findColumnKey(config, (c) => c.input === "date" || c.input === "datetime");
    const pad = (n: number) => String(n).padStart(2, "0");
    const time = opts.dueMinutes != null ? `T${pad(Math.floor(opts.dueMinutes / 60))}:${pad(opts.dueMinutes % 60)}` : "";
    if (dueKey) prefills[dueKey] = `${opts.dueDate}${time}`;
  }
  if (opts.priority) {
    const model = resolveTaskPriorityModel(config);
    const value = model ? priorityValue(opts.priority, model) : null;
    if (model && value) prefills[model.key] = value;
  }

  const built = buildNewItemContent({
    templateText,
    noteType,
    title,
    inheritTags: [...new Set([...(target.inheritTags ?? []), ...(opts.tags ?? [])])],
    prefills,
  });
  const withTrailer = opts.trailer ? (built.trimEnd() + "\n") + opts.trailer : built;
  const content = opts.repeat ? writeRepeatRule(withTrailer, opts.repeat) : withTrailer;
  return { ok: true, folder: target.folder, content };
}
