import {
  readFrontmatterPath,
  upsertFrontmatterKeys,
  deleteFrontmatterPath,
  setFrontmatterPath,
  type PimAccountRow,
  type PimCacheRepository,
  type PimTask,
  type PimTaskFields,
  type TaskAnchorRecord,
  type IPimTarget,
  PimConflictError,
} from "@plainva/core";
import { parseBaseConfig } from "../base/baseFormat";
import { resolveNewItemTarget } from "../base/baseRelations";
import { anchorMatchesTask, buildTaskAnchor, taskAnchorIdentity } from "./providerTask";
import { buildNewItemContent } from "../lib/newItemContent";
import { generatedStamp } from "../lib/okfProvenance";
import { taskDbFileStem, resolveTaskCompletionModel, classifyTaskCompletion, applyTaskCompletion, type TaskCompletionModel } from "../lib/taskDatabase";
import { findColumnKey } from "../lib/taskPromotion";

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
  /**
   * Removes a note. Only used for a deletion the journal explains (see
   * `deletionJournal`); without it such a note is kept as a plain note.
   */
  deleteFile?(path: string): Promise<void>;
}

/**
 * The slice of the sync deletion journal the task reconciler needs (feedback
 * round 2026-09-01, P1). A task whose note was deleted — and whose provider
 * copy followed — is recorded on the deleting device; the other devices then
 * remove THEIR copy of the note instead of keeping it as an orphan, provided it
 * carries no unsynced edits.
 */
export interface TaskDeletionJournal {
  recordTask(key: TaskDeletionIntent): Promise<void>;
  findTask(key: TaskDeletionIntent): { deletedAt: number } | null;
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
  /**
   * Actor for the `generated` stamp of notes this sync CREATES (OKF 0.2
   * provenance, plan P3b): `plainva-task-sync/<version>`, set by the shells.
   * Only the creation is stamped — a later field merge edits the note, it
   * does not produce it, and the stamp keeps the instant the note was born.
   * Omitted = no stamp (tests, headless callers).
   */
  generatedBy?: string;
  /**
   * Provider-task anchors from the index, grouped by uid
   * (`VaultQueryService.getTaskAnchors`). This is what lets a note be ADOPTED
   * instead of imported a second time when its state row is gone — after a
   * reconnect, on a new device, or when the index database was rebuilt.
   */
  anchorsByUid?: Map<string, TaskAnchorRecord[]>;
  /**
   * False while the vault is still filling up (first sync cycle unfinished or
   * index incomplete). The reconciler then reads and pushes as usual but
   * creates NO notes: a task whose note simply has not arrived yet would
   * otherwise be imported as a new one — which is exactly the duplicate this
   * whole change exists to prevent. Defaults to true so every existing caller
   * behaves as before.
   */
  mayCreateNotes?: boolean;
  /**
   * Deletions the user confirmed in Plainva whose provider task should follow
   * (E4b). Carried out at the START of a list's reconcile, before anything is
   * imported or pushed.
   *
   * Deliberately not derived from "the note is missing": that has too many
   * innocent causes. Only a confirmed deletion arrives here.
   */
  pendingDeletions?: ReadonlyArray<TaskDeletionIntent>;
  /** What became of one deletion. "retry" keeps it for the next cycle. */
  onDeletionResolved?(intent: TaskDeletionIntent, outcome: "done" | "conflict" | "retry"): void;
  /**
   * Deletions still inside their undo window. Not carried out — only kept from
   * being tombstoned, so that taking one back leaves a note the reconciler
   * still knows.
   */
  deletionsInFlight?: ReadonlyArray<TaskDeletionIntent>;
  /** See TaskDeletionJournal. Undefined = a remotely deleted task leaves its note as before. */
  deletionJournal?: TaskDeletionJournal;
}

/**
 * One confirmed deletion, in the shape the anchor matcher understands.
 *
 * `provider`/`identity` are optional for the same reason they are optional on
 * an anchor: a note written before the stable pair existed carries neither,
 * and refusing it would leave exactly the old notes undeletable.
 */
export interface TaskDeletionIntent {
  uid: string;
  list: string;
  provider?: string;
  identity?: string;
}

export interface TaskSyncResult {
  createdNotes: string[];
  changedNotes: string[];
  /** Notes taken over via their anchor instead of being imported again. */
  adoptedNotes: string[];
  /** Further notes claiming an adopted task — left untouched, counted here. */
  duplicateAnchors: number;
  /** Creations postponed because the vault was still filling up (E7). */
  deferredCreates: number;
  pushed: number;
  conflicts: number;
  /** Tasks deleted at the provider because their note was deleted here. */
  deletedRemote: number;
  /** Notes removed here because the journal says their task was deleted elsewhere (P1). */
  deletedNotes: string[];
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

/**
 * Which note to adopt when several claim the same task (decision E2).
 *
 * The maintainer's vault is full of these: one reconnect, one copy. Adopting
 * one and leaving the rest alone is the whole rule — creating yet another is
 * the bug. The order matters more than it looks:
 *
 * 1. The name `createTaskNote` would have given it without a collision. That
 *    IS the original note; the copies were renamed away from it.
 * 2. Otherwise the candidate without a numeric suffix, for the same reason —
 *    it still works after the task was renamed at the provider.
 * 3. Otherwise the oldest note. Deliberately third: on a NEW device `ctime`
 *    comes from the file the sync just wrote, so it says when the copy landed
 *    here, not when the work was done in it.
 * 4. Otherwise the smallest path, so the choice is at least deterministic.
 *
 * Sorting by path alone would be actively wrong: "Steuern einreichen 2.md"
 * sorts BEFORE "Steuern einreichen.md" (space 0x20 before dot 0x2E), so the
 * empty copy would win over the note holding the work.
 */
export function chooseAnchorToAdopt<T extends { path: string; ctime: number | null }>(
  candidates: readonly T[],
  remoteTitle: string
): T | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  const baseName = (p: string) => p.split("/").pop() ?? p;
  const stem = taskDbFileStem(remoteTitle) ?? "";
  const exact = stem ? candidates.filter((c) => baseName(c.path) === `${stem}.md`) : [];
  const pool = exact.length > 0 ? exact : candidates.filter((c) => !/ \d+\.md$/.test(baseName(c.path)));
  const ranked = (pool.length > 0 ? pool : candidates).slice().sort((a, b) => {
    const at = a.ctime ?? Number.POSITIVE_INFINITY;
    const bt = b.ctime ?? Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return ranked[0] ?? null;
}

export async function runTaskSync(opts: TaskSyncOptions): Promise<TaskSyncResult> {
  const result: TaskSyncResult = {
    createdNotes: [],
    changedNotes: [],
    adoptedNotes: [],
    duplicateAnchors: 0,
    deferredCreates: 0,
    pushed: 0,
    conflicts: 0,
    deletedRemote: 0,
    deletedNotes: [],
    errors: [],
  };
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

  const identity = taskAnchorIdentity(account);
  const taskId = (uid: string) => ({
    uid,
    list: listId,
    ...(account.provider ? { provider: account.provider } : {}),
    ...(identity ? { identity } : {}),
  });

  for (const rt of remoteTasks) {
    const st = stateByUid.get(rt.uid);
    const remoteFields = fieldsOfTask(rt);

    // A deletion the user confirmed in Plainva (E4b). Runs FIRST: everything
    // below reconciles a task that is supposed to stay.
    const order = (opts.pendingDeletions ?? []).find((o) => anchorMatchesTask(o, taskId(rt.uid)));
    if (order) {
      const target = await getTarget();
      if (!target) {
        // Offline. The order survives and is tried again next cycle.
        continue;
      }
      try {
        await target.deleteTask({ listId, uid: rt.uid, etag: rt.etag, href: rt.href });
        await cache.deleteTaskState(account.id, listId, rt.uid);
        opts.onDeletionResolved?.(order, "done");
        result.deletedRemote++;
        // The provider copy is gone; tell the other devices that this was a
        // confirmed deletion, so they drop their note instead of orphaning it.
        if (opts.deletionJournal) {
          try {
            await opts.deletionJournal.recordTask(taskId(rt.uid));
          } catch (e) {
            console.warn("[taskSync] recording the task deletion in the journal failed", e);
          }
        }
      } catch (e) {
        if (e instanceof PimConflictError) {
          // Somebody changed the task at the provider while the window ran.
          // Deleting a foreign change without saying so is exactly the thing
          // the conflict path exists to prevent — so it is reported and the
          // order is dropped rather than retried forever against a note the
          // user has already removed.
          opts.onDeletionResolved?.(order, "conflict");
          result.errors.push(`${account.label}/${listId}: ${rt.title || rt.uid} — remote changed, not deleted`);
        } else {
          opts.onDeletionResolved?.(order, "retry");
          result.errors.push(`${account.label}/${listId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      continue;
    }

    if (!st) {
      // No state row. Before importing: does a note already SAY it is this
      // task? A reconnect, a new device and a rebuilt index all arrive here
      // with the notes present and the state gone — importing then is what
      // produced the copies.
      const adopted = adoptAnchoredNote(opts, account, listId, rt, result);
      if (adopted) {
        await cache.upsertTaskState({
          accountId: account.id,
          listId,
          uid: rt.uid,
          notePath: adopted,
          remoteEtag: rt.etag ?? null,
          // The remote state is the agreed base: the note was never compared
          // against this task before, and claiming an older base would push
          // changes nobody made.
          baseFields: remoteFields,
        });
        result.adoptedNotes.push(adopted);
        continue;
      }
      if (opts.mayCreateNotes === false) {
        // The vault is still filling up — its note may be seconds away.
        result.deferredCreates++;
        continue;
      }
      const notePath = await createTaskNote(opts, db, account, listId, rt);
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
      notePath = findNoteByAnchor(opts, account, listId, rt);
      if (!notePath) {
        if (!opts.anchorsByUid) {
          // Without the anchor index "no note found" means "not looked", not
          // "deleted". A tombstone says never import this again — that is not
          // a decision to take on missing information.
          continue;
        }
        if ((opts.deletionsInFlight ?? []).some((d) => anchorMatchesTask(d, taskId(rt.uid)))) {
          // Deleted seconds ago and still inside the undo window. A tombstone
          // here would survive the undo and leave the restored note orphaned —
          // in the vault, ignored by every later cycle.
          continue;
        }
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
      const updated = upgradeAnchorIfStale(applyFieldsToNote(content, merged, localFields, db), account, listId, rt);
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

  // Remote deletions: drop the state, keep the note (it becomes a normal note) —
  // UNLESS the journal says a person deleted this task on another device and
  // the note here carries no unsynced edits. Then the note follows (P1): a
  // deletion someone confirmed must not survive as an orphan elsewhere.
  for (const st of states) {
    if (remoteUids.has(st.uid)) continue;
    await cache.deleteTaskState(account.id, listId, st.uid);
    if (!opts.deletionJournal || !opts.adapter.deleteFile || st.notePath === null) continue;
    if (!opts.deletionJournal.findTask(taskId(st.uid))) continue;
    if ((opts.deletionsInFlight ?? []).some((d) => anchorMatchesTask(d, taskId(st.uid)))) continue;
    try {
      if (!(await adapter.exists(st.notePath))) continue;
      const content = await adapter.readTextFile(st.notePath);
      const base = st.baseFields;
      if (!base) continue;
      const local = readNoteFields(content, db, base.completed);
      const unchanged = local.title === base.title && local.due === base.due && local.completed === base.completed;
      if (!unchanged) continue;
      await opts.adapter.deleteFile(st.notePath);
      result.deletedNotes.push(st.notePath);
    } catch (e) {
      result.errors.push(`${account.label}/${listId}: ${e instanceof Error ? e.message : String(e)}`);
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

async function createTaskNote(opts: TaskSyncOptions, db: DbShape, account: PimAccountRow, listId: string, task: PimTask): Promise<string | null> {
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
    // setFrontmatterPath, not upsertFrontmatterKeys: the latter replaces the
    // whole `plainva` map, so a template that gives its tasks an icon would
    // lose it here. Same anchor builder the phone uses — one shape, one writer.
    content = setFrontmatterPath(content, ["plainva", "pim"], buildTaskAnchor({
      uid: task.uid,
      listId,
      accountId: account.id,
      provider: account.provider,
      identity: taskAnchorIdentity(account),
    }));
  } catch {
    /* anchor best-effort — without it the note simply re-imports on rename */
  }
  if (opts.generatedBy) {
    try {
      // OKF 0.2 provenance: the mirrored task is a machine-written note and
      // says so. Best-effort like the anchor — a stamp never blocks a note.
      content = setFrontmatterPath(content, ["generated"], generatedStamp(opts.generatedBy));
    } catch {
      /* stamp best-effort */
    }
  }
  try {
    if (db.folder) await adapter.createDir(db.folder).catch(() => undefined);
    await adapter.writeTextFile(notePath, content);
    return notePath;
  } catch {
    return null;
  }
}

/**
 * Every indexed note that claims this task, best candidate first.
 *
 * Reads the anchor index rather than the vault. The old scan opened EVERY note
 * from disk, once per task — on a fresh device, where adoption matters most,
 * that is one pass over the whole vault per remote task.
 */
function anchoredCandidates(
  opts: TaskSyncOptions,
  account: PimAccountRow,
  listId: string,
  task: PimTask
): TaskAnchorRecord[] {
  const claims = opts.anchorsByUid?.get(task.uid);
  if (!claims || claims.length === 0) return [];
  const identity = taskAnchorIdentity(account);
  return claims.filter((c) =>
    anchorMatchesTask(c, {
      uid: task.uid,
      list: listId,
      ...(account.provider ? { provider: account.provider } : {}),
      ...(identity ? { identity } : {}),
    })
  );
}

/** The note to take over for this task, or null. Counts the runners-up: they
 *  stay exactly as they are, and their number is what tells the maintainer how
 *  much manual tidying is left. */
function adoptAnchoredNote(
  opts: TaskSyncOptions,
  account: PimAccountRow,
  listId: string,
  task: PimTask,
  result: TaskSyncResult
): string | null {
  const candidates = anchoredCandidates(opts, account, listId, task);
  const chosen = chooseAnchorToAdopt(candidates, task.title || "");
  if (!chosen) return null;
  if (candidates.length > 1) result.duplicateAnchors += candidates.length - 1;
  return chosen.path;
}

/**
 * Brings an old anchor up to the stable shape — but ONLY inside a write that
 * was happening anyway (decision E3).
 *
 * Rewriting every anchored note in the vault would be a single change touching
 * hundreds of files: a sync event on every other device, and every one of them
 * would see it as a foreign edit. So the upgrade rides along with an edit the
 * reconciler is already making, and otherwise waits. Notes that are never
 * touched keep their old anchor, which stays readable.
 */
function upgradeAnchorIfStale(content: string, account: PimAccountRow, listId: string, task: PimTask): string {
  if (!account.provider) return content;
  const current = readFrontmatterPath(content, ["plainva", "pim", "provider"]);
  if (typeof current === "string" && current) return content;
  try {
    return setFrontmatterPath(content, ["plainva", "pim"], buildTaskAnchor({
      uid: task.uid,
      listId,
      accountId: account.id,
      provider: account.provider,
      identity: taskAnchorIdentity(account),
    }));
  } catch {
    return content; // never let a cosmetic upgrade cost the actual edit
  }
}

/** Where an anchored note moved to, for the case that its known path is gone.
 *  Same index, so a rename inside the vault costs no file reads either. */
function findNoteByAnchor(opts: TaskSyncOptions, account: PimAccountRow, listId: string, task: PimTask): string | null {
  return chooseAnchorToAdopt(anchoredCandidates(opts, account, listId, task), task.title || "")?.path ?? null;
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
