import {
  readFrontmatterPath,
  upsertFrontmatterKeys,
  deleteFrontmatterPath,
  setFrontmatterPath,
  type PimAccountRow,
  type PimCacheRepository,
  type PimTask,
  type PimTaskFields,
  type IPimTarget,
  PimConflictError,
} from "@plainva/core";
import { parseBaseConfig, resolveNewItemTarget } from "@plainva/ui";
import { buildNewItemContent } from "../newItemFlow";
import { taskDbFileStem, resolveTaskCompletionModel, classifyTaskCompletion, applyTaskCompletion, type TaskCompletionModel } from "../taskDatabase";
import { findColumnKey } from "../taskPromotion";

/**
 * Task <-> note reconciler (PIM stage 3): mirrors the SELECTED task lists of
 * every enabled account into the vault's standard task database as `type`
 * notes, and pushes local note edits (title/due/status) back. This clones the
 * file sync's three-way reconcile by UID instead of path:
 *
 *   base  = pim_task_state.base_fields (last agreed state)
 *   local = the note's H1 + due/status frontmatter
 *   remote= the cached pull (pim_tasks, fresh after a worker cycle)
 *
 * Divergence resolves FIELD-WISE with local wins (a title edited here beats a
 * remote rename of the same task; untouched fields follow the remote). Data
 * safety rules, in the file sync's spirit:
 *   - a locally deleted note NEVER deletes the remote task — it tombstones
 *     the state row (notePath null) so the task is not re-imported either
 *   - a remotely deleted task NEVER deletes the note — the state row is
 *     dropped and the note stays as a normal note
 *   - local -> remote creation is deliberately out of scope (a new remote
 *     task needs an explicit list choice; documented follow-up)
 */

export interface TaskSyncAdapter {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
}

export interface TaskSyncOptions {
  adapter: TaskSyncAdapter;
  cache: PimCacheRepository;
  buildTarget: (account: PimAccountRow) => Promise<IPimTarget | null>;
  /** Vault-relative path of the standard task database (`.base`); null = off. */
  taskDbPath: string | null;
  /** Configured OKF `type` for created notes. */
  noteType: string;
  /** Every vault note path (collision-free naming + move-detection scope). */
  allNotePaths: string[];
}

export interface TaskSyncResult {
  createdNotes: string[];
  changedNotes: string[];
  pushed: number;
  conflicts: number;
  errors: string[];
}

interface DbShape {
  folder: string;
  inheritTags: string[];
  templatePath: string | null;
  dueKey: string | null;
  /** How the database expresses "done" (checkbox column preferred, else the
   * status-option convention) — see taskDatabase.resolveTaskCompletionModel. */
  completion: TaskCompletionModel | null;
}

export async function runTaskSync(opts: TaskSyncOptions): Promise<TaskSyncResult> {
  const result: TaskSyncResult = { createdNotes: [], changedNotes: [], pushed: 0, conflicts: 0, errors: [] };
  if (!opts.taskDbPath) return result;

  const db = await readDbShape(opts);
  if (!db) return result;

  const accounts = (await opts.cache.listAccounts()).filter((a) => a.enabled);
  for (const account of accounts) {
    const lists = (await opts.cache.listTaskLists(account.id)).filter((l) => l.selected);
    if (lists.length === 0) continue;
    let target: IPimTarget | null = null;
    let targetTried = false;
    const getTarget = async () => {
      if (!targetTried) {
        targetTried = true;
        try {
          target = await opts.buildTarget(account);
        } catch {
          target = null;
        }
      }
      return target;
    };
    for (const list of lists) {
      try {
        await reconcileList(opts, db, account, list.id, getTarget, result);
      } catch (e) {
        result.errors.push(`${account.label}/${list.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return result;
}

async function reconcileList(
  opts: TaskSyncOptions,
  db: DbShape,
  account: PimAccountRow,
  listId: string,
  getTarget: () => Promise<IPimTarget | null>,
  result: TaskSyncResult
): Promise<void> {
  const { adapter, cache } = opts;
  const remoteTasks = await cache.listTasks(account.id, listId);
  const states = await cache.getTaskStates(account.id, listId);
  const stateByUid = new Map(states.map((s) => [s.uid, s]));
  const remoteUids = new Set(remoteTasks.map((t) => t.uid));

  for (const rt of remoteTasks) {
    const st = stateByUid.get(rt.uid);
    const remoteFields = fieldsOfTask(rt);

    if (!st) {
      // New remote task -> create the note in the task database.
      const notePath = await createTaskNote(opts, db, account.id, listId, rt);
      if (notePath) {
        result.createdNotes.push(notePath);
        await cache.upsertTaskState({ accountId: account.id, listId, uid: rt.uid, notePath, remoteEtag: rt.etag ?? null, baseFields: remoteFields });
      }
      continue;
    }
    if (st.notePath === null) continue; // tombstone: never re-import

    // Locate the note — the anchor survives renames/moves inside the vault.
    let notePath: string | null = st.notePath;
    if (!(await adapter.exists(notePath))) {
      notePath = await findNoteByAnchor(opts, account.id, listId, rt.uid);
      if (!notePath) {
        // Note deleted locally: tombstone, remote stays untouched.
        await cache.upsertTaskState({ ...st, notePath: null });
        continue;
      }
    }

    let content: string;
    try {
      content = await adapter.readTextFile(notePath);
    } catch {
      continue;
    }
    const base = st.baseFields ?? remoteFields;
    // Data safety: when the note's status is empty or an UNRECOGNIZED value we
    // must not read it as an intentional "open" — that would let a garbled /
    // stale / foreign-database status un-complete the remote task (the "all
    // tasks undone at Google" failure). In that case completion follows the
    // base, so no spurious flip is ever pushed.
    const localFields = readNoteFields(content, db, base.completed);
    const remoteChanged = st.remoteEtag != null ? st.remoteEtag !== (rt.etag ?? null) : !fieldsEqual(remoteFields, base);
    const localChanged = !fieldsEqual(localFields, base);

    if (!remoteChanged && !localChanged) {
      if (notePath !== st.notePath) await cache.upsertTaskState({ ...st, notePath });
      continue;
    }

    // Field-wise three-way merge, local wins on a per-field tie.
    const merged: PimTaskFields = {
      title: localChanged && localFields.title !== base.title ? localFields.title : remoteFields.title,
      due: localChanged && localFields.due !== base.due ? localFields.due : remoteFields.due,
      completed: localChanged && localFields.completed !== base.completed ? localFields.completed : remoteFields.completed,
    };

    // Apply to the note when it differs from the local state.
    if (!fieldsEqual(merged, localFields)) {
      const updated = applyFieldsToNote(content, merged, localFields, db);
      try {
        await adapter.writeTextFile(notePath, updated);
        result.changedNotes.push(notePath);
      } catch (e) {
        result.errors.push(`${notePath}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }

    // Push when the merge differs from the remote.
    let newEtag = rt.etag ?? null;
    if (!fieldsEqual(merged, remoteFields)) {
      const target = await getTarget();
      if (!target) {
        // No credentials this run — leave the state at base so the push is
        // retried next cycle.
        continue;
      }
      try {
        const res = await target.updateTask(
          { listId, uid: rt.uid, etag: rt.etag, href: rt.href },
          { title: merged.title, due: merged.due ?? undefined, completed: merged.completed }
        );
        newEtag = res.etag ?? null;
        result.pushed++;
      } catch (e) {
        if (e instanceof PimConflictError) {
          // Remote moved again since the pull — the NEXT cycle re-pulls and
          // re-merges against the fresher remote. Keep the old base.
          result.conflicts++;
          continue;
        }
        result.errors.push(`${account.label}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }

    await cache.upsertTaskState({ accountId: account.id, listId, uid: rt.uid, notePath, remoteEtag: newEtag, baseFields: merged });
  }

  // Remote deletions: drop the state, keep the note (it becomes a normal note).
  for (const st of states) {
    if (!remoteUids.has(st.uid)) {
      await cache.deleteTaskState(account.id, listId, st.uid);
    }
  }
}

// ---- note IO ---------------------------------------------------------------

async function readDbShape(opts: TaskSyncOptions): Promise<DbShape | null> {
  if (!opts.taskDbPath) return null;
  let config: any;
  try {
    config = parseBaseConfig(await opts.adapter.readTextFile(opts.taskDbPath));
  } catch {
    return null;
  }
  const target = resolveNewItemTarget(config);
  if (!target.folder) return null;
  const dueKey = findColumnKey(config, (c) => c.input === "date" || c.input === "datetime");
  return {
    folder: target.folder.replace(/\/+$/, ""),
    inheritTags: target.inheritTags ?? [],
    templatePath: typeof config.newItemTemplate === "string" ? config.newItemTemplate : null,
    dueKey,
    completion: resolveTaskCompletionModel(config),
  };
}

async function createTaskNote(opts: TaskSyncOptions, db: DbShape, accountId: string, listId: string, task: PimTask): Promise<string | null> {
  const { adapter } = opts;
  const stem = taskDbFileStem(task.title) ?? "Task";
  const prefix = db.folder ? db.folder + "/" : "";
  let name = stem;
  for (let n = 2; await adapter.exists(prefix + name + ".md"); n++) name = `${stem} ${n}`;
  const notePath = prefix + name + ".md";

  let templateText: string | null = null;
  if (db.templatePath) {
    try {
      templateText = await adapter.readTextFile(db.templatePath);
    } catch {
      /* template missing — create without it */
    }
  }
  const prefills: Record<string, any> = {};
  if (db.dueKey && task.due) prefills[db.dueKey] = task.due;
  if (db.completion) {
    if (db.completion.kind === "checkbox") {
      prefills[db.completion.key] = task.completed;
      if (db.completion.status) prefills[db.completion.status.key] = task.completed ? db.completion.status.done : db.completion.status.open;
    } else {
      prefills[db.completion.status.key] = task.completed ? db.completion.status.done : db.completion.status.open;
    }
  }
  let content = buildNewItemContent({ templateText, noteType: opts.noteType, title: task.title || "Task", inheritTags: db.inheritTags, prefills });
  try {
    content = upsertFrontmatterKeys(content, { plainva: { pim: { kind: "task", uid: task.uid, account: accountId, list: listId } } });
  } catch {
    /* anchor best-effort — without it the note simply re-imports on rename */
  }
  try {
    if (db.folder) await adapter.createDir(db.folder).catch(() => undefined);
    await adapter.writeTextFile(notePath, content);
    return notePath;
  } catch {
    return null;
  }
}

/** Scans the vault notes for the task's frontmatter anchor (rename/move
 * survival). Bounded to the task-database folder first, then everything. */
async function findNoteByAnchor(opts: TaskSyncOptions, accountId: string, listId: string, uid: string): Promise<string | null> {
  const inFolder = opts.allNotePaths.filter((p) => p.endsWith(".md"));
  for (const p of inFolder) {
    try {
      const content = await opts.adapter.readTextFile(p);
      if (
        readFrontmatterPath(content, ["plainva", "pim", "uid"]) === uid &&
        readFrontmatterPath(content, ["plainva", "pim", "account"]) === accountId &&
        readFrontmatterPath(content, ["plainva", "pim", "list"]) === listId
      ) {
        return p;
      }
    } catch {
      /* unreadable — skip */
    }
  }
  return null;
}

// ---- field mapping ---------------------------------------------------------

export function fieldsOfTask(t: PimTask): PimTaskFields {
  return { title: t.title, due: t.due ?? null, completed: t.completed };
}

export function fieldsEqual(a: PimTaskFields, b: PimTaskFields): boolean {
  return a.title === b.title && a.due === b.due && a.completed === b.completed;
}

/** Local field surface of a task note: first H1 as the title (fallback empty),
 * the database's date column as due, the completion model (checkbox column
 * preferred, else status options) as completed. An empty or unrecognized value
 * is ambiguous — it falls back to `fallbackCompleted` (the base state) instead
 * of "open", so it can never un-complete the remote task. */
export function readNoteFields(
  content: string,
  db: Pick<DbShape, "dueKey" | "completion">,
  fallbackCompleted = false
): PimTaskFields {
  const dueRaw = db.dueKey ? readFrontmatterPath(content, [db.dueKey]) : undefined;
  const due = dueRaw != null && String(dueRaw).trim() ? String(dueRaw).slice(0, 10) : null;
  let completed = fallbackCompleted;
  if (db.completion) {
    const model = db.completion;
    const cls = classifyTaskCompletion(model, {
      checkbox: model.kind === "checkbox" ? readFrontmatterPath(content, [model.key]) : undefined,
      status: (() => {
        const statusKey = model.kind === "checkbox" ? model.status?.key : model.status.key;
        const raw = statusKey ? readFrontmatterPath(content, [statusKey]) : null;
        return raw == null ? null : String(raw);
      })(),
    });
    completed = cls ?? fallbackCompleted;
  }
  return { title: firstH1(content) ?? "", due, completed };
}

/** Applies merged fields to the note: H1 rewrite, due upsert/removal,
 * completion flip through the shared write path (checkbox + coupled status).
 * Completion only flips when it actually changed — an intermediate status
 * option ("In Arbeit") is never clobbered by completed=false. */
export function applyFieldsToNote(content: string, merged: PimTaskFields, current: PimTaskFields, db: Pick<DbShape, "dueKey" | "completion">): string {
  let out = content;
  if (merged.title !== current.title && merged.title) {
    out = replaceFirstH1(out, merged.title);
  }
  try {
    if (db.dueKey && merged.due !== current.due) {
      out = merged.due ? upsertFrontmatterKeys(out, { [db.dueKey]: merged.due }) : deleteFrontmatterPath(out, [db.dueKey]);
    }
    if (db.completion && merged.completed !== current.completed) {
      out = applyTaskCompletion(out, db.completion, merged.completed, (c, p) => readFrontmatterPath(c, p), (c, p, v) => setFrontmatterPath(c, p, v));
    }
  } catch {
    /* surgical frontmatter failed — leave the body change in place */
  }
  return out;
}

function firstH1(content: string): string | null {
  const body = stripFrontmatterBlock(content);
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function replaceFirstH1(content: string, title: string): string {
  const fmEnd = frontmatterEnd(content);
  const head = content.slice(0, fmEnd);
  const body = content.slice(fmEnd);
  if (/^#\s+.+$/m.test(body)) {
    return head + body.replace(/^#\s+.+$/m, `# ${title}`);
  }
  return head + `# ${title}\n` + body;
}

function frontmatterEnd(content: string): number {
  if (!content.startsWith("---\n")) return 0;
  const close = content.indexOf("\n---", 3);
  if (close === -1) return 0;
  const lineEnd = content.indexOf("\n", close + 4);
  return lineEnd === -1 ? content.length : lineEnd + 1;
}

function stripFrontmatterBlock(content: string): string {
  return content.slice(frontmatterEnd(content));
}
