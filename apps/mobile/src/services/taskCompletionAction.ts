import {
  applyTaskCompletion,
  canRepeat,
  localIsoKey,
  nextDueDate,
  parseBaseConfig,
  readRepeatRule,
  resolveTaskCompletionModel,
  taskDbDueKey,
  writeNextOccurrenceNote,
  type TaskCompletionModel,
} from "@plainva/ui";
import { readFrontmatterPath, setFrontmatterPath } from "@plainva/core";
import { getMobileSettings } from "./mobileSettings";
import { getMobileVault, vaultOps, type MobileVault } from "./vaultService";

/**
 * Ticking a task off, in one place (S11).
 *
 * Ticking off is not a single write: for a repeating task it is what CREATES
 * the next one, with the next due date, beside the completed one. Two callers
 * now do it — the task list and a tapped reminder — and two copies of that
 * chain would drift into two different answers to "did checking this box
 * produce the next task". So the orchestration lives here and both call it.
 */

export interface TaskCompletionResult {
  changed: boolean;
  /** Due date of the occurrence this completion created, when it created one. */
  spawnedDue?: string;
}

/** Reads the task database's schema — the same source the list reads. */
async function loadModel(
  vault: MobileVault
): Promise<{ completion: TaskCompletionModel; dueKey: string | null } | null> {
  const db = getMobileSettings().taskDatabase.trim();
  if (!db) return null;
  const config = parseBaseConfig(await vaultOps.read(vault, db));
  const completion = resolveTaskCompletionModel(config);
  // No completion column means the database cannot express "done" at all —
  // pretending otherwise would write a field nothing reads back.
  return completion ? { completion, dueKey: taskDbDueKey(config) } : null;
}

/**
 * Sets a task's completion and, when it just became done and carries a repeat
 * rule, writes the next occurrence.
 *
 * Throws what the vault throws; callers decide how to say it. Returns whether
 * anything changed so a caller can stay quiet about a no-op.
 */
export async function setTaskDone(path: string, done: boolean): Promise<TaskCompletionResult> {
  const vault = await getMobileVault();
  const model = await loadModel(vault);
  if (!model) return { changed: false };

  const raw = await vaultOps.read(vault, path);
  const next = applyTaskCompletion(
    raw,
    model.completion,
    done,
    (c, p) => readFrontmatterPath(c, p),
    (c, p, v) => setFrontmatterPath(c, p, v)
  );
  const changed = next !== raw;
  if (changed) await vaultOps.save(vault, path, next);
  if (!done) return { changed };

  // The next occurrence is EARNED by checking the box — there is no hidden
  // series, so nothing exists until then, and the completed note stays as the
  // record of what was actually done.
  const rule = readRepeatRule(raw);
  if (!rule || !canRepeat(raw)) return { changed };
  const currentDue = model.dueKey ? String(readFrontmatterPath(raw, [model.dueKey]) ?? "").slice(0, 10) : null;
  const spawnedDue = nextDueDate(rule, currentDue || null, localIsoKey(new Date()));
  if (!spawnedDue) return { changed };

  let content = applyTaskCompletion(
    raw,
    model.completion,
    false,
    (c, p) => readFrontmatterPath(c, p),
    (c, p, v) => setFrontmatterPath(c, p, v)
  );
  if (model.dueKey) content = setFrontmatterPath(content, [model.dueKey], spawnedDue);
  const created = await writeNextOccurrenceNote(
    { exists: (p) => vault.files.exists(p), writeTextFile: (p, c) => vaultOps.save(vault, p, c) },
    path,
    content
  );
  return created ? { changed: true, spawnedDue } : { changed };
}
