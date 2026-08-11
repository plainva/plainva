import { deleteFrontmatterPath, readFrontmatterPath, setFrontmatterPath } from "@plainva/core";
import {
  applyTaskCompletion,
  canRepeat,
  localIsoKey,
  nextDueDate,
  readRepeatRule,
  writeNextOccurrenceNote,
  type TaskCompletionModel,
} from "@plainva/ui";
import { applyIndexChanges } from "./fileActions";

/**
 * Ticking a task database entry off — the ONE place that does it.
 *
 * The overview and the calendar both offer the gesture, and it is more than a
 * frontmatter write: it re-indexes, refreshes the tree, nudges the PIM worker so
 * the flip reaches the provider, and — when the note carries a repeat rule —
 * creates the next occurrence. A second implementation of that sequence would
 * drift, and for a task mirrored from Google Tasks or an iCloud reminder list a
 * drift is not cosmetic: it can un-complete a remote task, or silently break the
 * repeat chain depending on WHERE the user ticked the box (issue #34, wave 4).
 *
 * This module stays free of i18n: it reports what happened and lets the caller
 * phrase it, so both surfaces can use their own wording without the service
 * knowing about React or translations.
 */

export interface TaskWriteDeps {
  vaultAdapter: {
    readTextFile(path: string): Promise<string>;
    writeTextFile(path: string, content: string): Promise<void>;
    /** Needed by `writeNextOccurrenceNote` to find a free name. */
    exists(path: string): Promise<boolean>;
  };
  /** Index of the open vault; absent in tests and while a vault is loading. */
  indexer?: Parameters<typeof applyIndexChanges>[0] | null;
  triggerFileTreeUpdate: (paths?: string[]) => void;
  /** Nudged after a write so the flip is pushed to the provider promptly. */
  pimRuntime?: { worker: { triggerImmediate(): Promise<unknown> } } | null;
  /** Lets a surface re-query its own rows after a write. */
  onChanged?: () => void;
}

export interface TaskToggleDeps extends TaskWriteDeps {
  completion: TaskCompletionModel;
  /** The database's date column, or null when it has none. */
  dueKey: string | null;
}

/** What a toggle did, so the caller can phrase the outcome. */
export interface TaskToggleResult {
  /** Due date of the occurrence that was created, or null if none was. */
  spawnedDue: string | null;
  /** The next occurrence was due but could not be written. */
  spawnFailed: boolean;
}

/**
 * Reads, mutates and writes a task note through the adapter chain, then keeps
 * index, tree and provider in step. A mutation that changes nothing writes
 * nothing. Throws on a failed read/write — the caller reports it.
 */
export async function writeTaskNote(
  deps: TaskWriteDeps,
  path: string,
  mutate: (raw: string) => string
): Promise<boolean> {
  const raw = await deps.vaultAdapter.readTextFile(path);
  const next = mutate(raw);
  let written = false;
  if (next !== raw) {
    await deps.vaultAdapter.writeTextFile(path, next);
    if (deps.indexer) await applyIndexChanges(deps.indexer, { added: [path] }).catch(() => undefined);
    deps.triggerFileTreeUpdate([path]);
    written = true;
  }
  deps.onChanged?.();
  if (deps.pimRuntime) void deps.pimRuntime.worker.triggerImmediate().catch(() => undefined);
  return written;
}

/**
 * Flips a task database entry's completion: the checkbox PROPERTY when the
 * database has one (the status column follows), else the status option
 * convention — `applyTaskCompletion` owns that decision.
 *
 * Ticking a repeating task off is what CREATES its successor. There is no
 * hidden series behind a repeat rule, so nothing exists until it is earned;
 * un-ticking therefore creates nothing.
 *
 * A failure to spawn is reported, not thrown: the completion itself already
 * succeeded, and losing it because the follow-up failed would be the worse
 * outcome.
 */
export async function toggleTaskDone(
  deps: TaskToggleDeps,
  path: string,
  done: boolean
): Promise<TaskToggleResult> {
  const model = deps.completion;
  await writeTaskNote(deps, path, (raw) =>
    applyTaskCompletion(raw, model, done, (c, p) => readFrontmatterPath(c, p), (c, p, v) => setFrontmatterPath(c, p, v))
  );
  if (!done) return { spawnedDue: null, spawnFailed: false };
  try {
    return await spawnNextOccurrence(deps, path);
  } catch (e) {
    console.error("[taskCompletion] creating the next occurrence failed", path, e);
    return { spawnedDue: null, spawnFailed: true };
  }
}

/**
 * Writes the next occurrence of a repeating task (issue #34, wave 3): a COPY of
 * the note with the next due date, open again, in the same folder. The completed
 * note stays as the record of what was done — that is the whole point of a
 * generator over a rule: history is real notes, not a projection.
 *
 * A note without a rule, a mirrored provider task, or a rule whose chain has
 * ended all resolve to "nothing to do" rather than an error.
 */
export async function spawnNextOccurrence(
  deps: TaskToggleDeps,
  path: string
): Promise<TaskToggleResult> {
  const raw = await deps.vaultAdapter.readTextFile(path);
  const rule = readRepeatRule(raw);
  if (!rule || !canRepeat(raw)) return { spawnedDue: null, spawnFailed: false };
  const currentDue = deps.dueKey ? String(readFrontmatterPath(raw, [deps.dueKey]) ?? "").slice(0, 10) : null;
  const next = nextDueDate(rule, currentDue || null, localIsoKey(new Date()));
  if (!next) return { spawnedDue: null, spawnFailed: false };

  // Reopen the copy, carry the rule, set the new due date.
  let content = applyTaskCompletion(
    raw,
    deps.completion,
    false,
    (c, p) => readFrontmatterPath(c, p),
    (c, p, v) => setFrontmatterPath(c, p, v)
  );
  if (deps.dueKey) content = setFrontmatterPath(content, [deps.dueKey], next);
  // The next occurrence must NOT inherit the dependency list. In Obsidian Tasks
  // a recurring task copies its blockedBy along and stays blocked forever —
  // the predecessor it names is the one that was already finished. A fresh
  // occurrence starts unblocked; a genuine repeating dependency has to be
  // stated again, deliberately.
  content = deleteFrontmatterPath(content, ["blockedBy"]);

  const created = await writeNextOccurrenceNote(deps.vaultAdapter, path, content);
  if (!created) return { spawnedDue: null, spawnFailed: false };
  if (deps.indexer) await applyIndexChanges(deps.indexer, { added: [created] }).catch(() => undefined);
  deps.triggerFileTreeUpdate([created]);
  deps.onChanged?.();
  return { spawnedDue: next, spawnFailed: false };
}
