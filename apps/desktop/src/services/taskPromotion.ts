import { TASK_LINE_RE, FENCE_RE, parseBaseConfig, resolveNewItemTarget } from "@plainva/ui";
import { scanTasks, wikiTargetForPath } from "@plainva/core";
import { buildNewItemContent } from "./newItemFlow";
import { taskDbFileStem } from "./taskDatabase";

/**
 * Checkbox-task promotion (PIM plan, package 1a): turns an inline GFM checkbox
 * into a first-class note inside the vault's task database. The checkbox line
 * is REPLACED in place by a wiki link to the new note ("promote in place" — the
 * item stays visible where it was written and the task note gets a backlink via
 * the link index), its `#tags` move into the note's frontmatter tags, a
 * `📅` due date lands in the database's date column and the note links back to
 * its source via a `source` wiki link.
 *
 * Ordinal counting MUST stay in lock-step with `scanTasks`/`toggleTaskAtIndex`
 * (shared `TASK_LINE_RE`/`FENCE_RE`), otherwise a promotion would rewrite the
 * wrong line. The note body itself is assembled by the already-tested
 * `buildNewItemContent` (template of the database, OKF defaults, tag merge).
 */

const TITLE_DUE = /\s*📅\s*\d{4}-\d{2}-\d{2}/gu;
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
 * verbatim — the full title still lands in the H1). */
export function taskFileStem(title: string): string | null {
  const stem = taskDbFileStem(title);
  if (!stem) return null;
  if (stem.length <= MAX_STEM_LENGTH) return stem;
  const cut = stem.slice(0, MAX_STEM_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/\.+$/, "").trim();
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
      lines[i] = `${prefix}${link}`;
      return { content: lines.join("\n"), changed: true };
    }
    seen++;
  }
  return { content, changed: false };
}

/** First column key of the parsed base config matching the predicate. */
function findColumnKey(config: any, pred: (col: any) => boolean): string | null {
  const cols = config?.columns ?? {};
  for (const [key, col] of Object.entries(cols)) {
    if (col && pred(col)) return key;
  }
  return null;
}

export interface PromoteTaskOptions {
  adapter: {
    readTextFile(path: string): Promise<string>;
    writeTextFile(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
  };
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

/**
 * Promotes one checkbox into the task database: resolves the database's storage
 * folder (`resolveNewItemTarget`, exactly like the base's "+ Eintrag" button),
 * creates the note (template + OKF defaults + tag merge + due/status/source
 * pre-fills), then rewrites the source line into a wiki link. The source is
 * re-read and ordinal-verified first — a stale listing never rewrites the wrong
 * line (same guard as the checkbox toggle).
 */
export async function promoteTask(opts: PromoteTaskOptions): Promise<PromoteTaskResult> {
  const { adapter, sourcePath, task, dbPath, noteType, allNotePaths, fallbackTitle } = opts;

  let config: any;
  try {
    config = parseBaseConfig(await adapter.readTextFile(dbPath));
  } catch {
    return { ok: false, reason: "dbUnreadable" };
  }
  const target = resolveNewItemTarget(config);
  if (!target.folder) return { ok: false, reason: "noFolder" };

  // Stale guard BEFORE any write: the note must still carry this exact task.
  const source = await adapter.readTextFile(sourcePath);
  if (scanTasks(source)[task.ordinal]?.text !== task.text) {
    return { ok: false, reason: "stale" };
  }

  const title = taskTextToTitle(task.text) || fallbackTitle;
  const stem = taskFileStem(title) ?? fallbackTitle;
  const dir = target.folder.replace(/\/+$/, "");
  const prefix = dir ? dir + "/" : "";
  let name = stem;
  for (let n = 2; await adapter.exists(prefix + name + ".md"); n++) {
    name = `${stem} ${n}`;
  }
  const notePath = prefix + name + ".md";

  let templateText: string | null = null;
  if (config.newItemTemplate) {
    try {
      templateText = await adapter.readTextFile(config.newItemTemplate);
    } catch {
      /* template missing — create without it, like the base's "+ Eintrag" */
    }
  }

  // Pre-fills: due date into the database's (first) date column, an open task
  // into the first status option (a done checkbox gets no status guess), and
  // the backlink to the source note. Template-defined keys win downstream.
  const prefills: Record<string, any> = {};
  const dueKey = findColumnKey(config, (c) => c.input === "date" || c.input === "datetime");
  if (task.due && dueKey) prefills[dueKey] = task.due;
  const statusKey = findColumnKey(
    config,
    (c) => (c.input === "status" || c.input === "select") && Array.isArray(c.options) && c.options.length > 0
  );
  if (!task.done && statusKey) {
    const first = config.columns[statusKey].options[0];
    const value = typeof first === "string" ? first : first?.value;
    if (value) prefills[statusKey] = value;
  }
  prefills.source = `[[${wikiTargetForPath(sourcePath, allNotePaths)}]]`;

  const inheritTags = [...new Set([...(target.inheritTags ?? []), ...task.tags])];
  const content = buildNewItemContent({ templateText, noteType, title, inheritTags, prefills });
  await adapter.writeTextFile(notePath, content);

  // Replace the checkbox with a link to the new note (alias = cleaned title so
  // the line reads naturally even when the link target is a qualified path).
  const linkTarget = wikiTargetForPath(notePath, [...allNotePaths, notePath]);
  const replaced = replaceCheckboxWithLink(source, task.ordinal, linkTarget, title);
  if (replaced.changed) await adapter.writeTextFile(sourcePath, replaced.content);

  return { ok: true, notePath, title };
}
