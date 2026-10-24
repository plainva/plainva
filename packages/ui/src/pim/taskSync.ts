import {
  frontmatterSpan,
  readFrontmatterPath,
  readTextShape,
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
  readTaskNoteIdentity,
  taskNoteMatches,
  availableTaskNotePath,
  trimEndChars,
  taskNoteKey,
  taskNoteStem,
  updateVaultText,
  type TaskNoteIdentity,
  type TextUpdateFiles,
} from "@plainva/core";
import { parseBaseConfig } from "../base/baseFormat";
import { resolveNewItemTarget } from "../base/baseRelations";
import { anchorMatchesTask, buildTaskAnchor, taskAnchorIdentity } from "./providerTask";
import { isFileNotFound } from "../lib/movedNote";
import { buildNewItemContent } from "../lib/newItemContent";
import { withVaultContext, type TemplateVault } from "../lib/templateContext";
import { generatedStamp } from "../lib/okfProvenance";
import { resolveTaskCompletionModel, classifyTaskCompletion, applyTaskCompletion, type TaskCompletionModel } from "../lib/taskDatabase";
import { findColumnKey } from "../lib/taskPromotion";
import { taskSyncPaused, trackTaskSync } from "./taskSyncPause";
import { TASK_NOTE_PROBLEM_PREFIX } from "./syncProblems";

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

/** The vault's files: its chain, or a storage with nothing above it (`updateVaultText`). */
export interface TaskSyncAdapter extends TextUpdateFiles {
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
  /** The vault, for `{{vault}}` and `{{daily±N}}` in the task database's template (Sammelplan § 3.97). */
  templateVault?: TemplateVault | null;
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
  /**
   * Provider changes that could not be carried into their notes (finding B2,
   * 19.10.): a tick at the provider for a database without a done column, a
   * due date for one without a date column, properties that could not be
   * written. They are NOT recorded as agreed - the next cycle tries again -
   * and each list with such a change says so on its `tasknotes:` row.
   */
  notApplied: number;
  /**
   * True when the reconcile did nothing because task notes are being renamed
   * in bulk (`withTaskSyncPaused`, E12). The runner asks to be called again
   * once the pause lifts (`afterTaskSyncResume`).
   */
  paused?: boolean;
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
  const stem = taskNoteStem(remoteTitle);
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
  if (taskSyncPaused()) {
    return { createdNotes: [], changedNotes: [], adoptedNotes: [], duplicateAnchors: 0, deferredCreates: 0, pushed: 0, conflicts: 0, deletedRemote: 0, deletedNotes: [], errors: [], notApplied: 0, paused: true };
  }
  return trackTaskSync(reconcileAll(opts));
}

async function reconcileAll(opts: TaskSyncOptions): Promise<TaskSyncResult> {
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
    notApplied: 0,
  };
  if (!opts.taskDbPath) return result;

  const db = await readDbShape(opts);
  if (!db) return result;

  const creates: PendingCreate[] = [];
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
      const notApplied: NotAppliedReason[] = [];
      let finished = false;
      try {
        await reconcileList(opts, db, account, list.id, getTarget, result, (task) => creates.push({ account, listId: list.id, listName: list.name, task }), notApplied);
        finished = true;
      } catch (e) {
        result.errors.push(`${account.label}/${list.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      result.notApplied += notApplied.length;
      // A reconcile that stopped part-way has not looked at every task: it
      // may add a reason, never clear one.
      if (finished || notApplied.length > 0) await reportNotApplied(opts.cache, account.id, list.id, notApplied);
    }
  }
  await createPendingNotes(opts, db, creates, result);
  return result;
}

/** A task this run imports as a new note — created after every list has been read. */
interface PendingCreate {
  account: PimAccountRow;
  listId: string;
  listName: string;
  task: PimTask;
}

/**
 * Creates the notes of every newly seen task in ONE fixed order: by the task's
 * identity (decision E11). The name is the title, and two tasks of one title
 * become "Title" and "Title 2" — so the order decides who gets which number.
 * Provider order, list order and account order differ between devices; the
 * identity does not. Two devices that import the same tasks into the same
 * vault therefore give every task the same name, and neither sync sees two
 * different tasks at one path.
 */
async function createPendingNotes(opts: TaskSyncOptions, db: DbShape, creates: PendingCreate[], result: TaskSyncResult): Promise<void> {
  const keyed = creates.map((c) => ({ ...c, key: taskNoteKey(taskIdentityOf(c.account, c.listId, c.task.uid)) }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const known = new Set(opts.allNotePaths);
  for (const { account, listId, listName, task } of keyed) {
    try {
      const notePath = await createTaskNote(opts, db, account, listId, task, known);
      if (!notePath) continue;
      known.add(notePath);
      result.createdNotes.push(notePath);
      // The file may be one an interrupted run left behind: whether it holds
      // the date is read from it, not assumed (B2).
      const createdDue = db.dueKey ? await opts.adapter.readTextFile(notePath).then((text) => readNoteFields(text, db).due, () => null) : null;
      await opts.cache.upsertTaskState({
        accountId: account.id,
        listId,
        uid: task.uid,
        notePath,
        remoteEtag: task.etag ?? null,
        // A note created without a date column cannot hold the due date (B2).
        baseFields: { ...fieldsOfTask(task), ...(db.dueKey && (createdDue !== null || task.due == null) ? { dueHeldIn: db.dueKey } : {}) },
      });
    } catch (e) {
      result.errors.push(`${account.label}/${listName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** The identity a task's anchor carries — what names and sorting go by. */
function taskIdentityOf(account: PimAccountRow, listId: string, uid: string): TaskNoteIdentity {
  const identity = taskAnchorIdentity(account);
  return {
    uid,
    list: listId,
    ...(account.provider ? { provider: account.provider } : {}),
    ...(identity ? { identity } : {}),
  };
}

async function reconcileList(
  opts: TaskSyncOptions,
  db: DbShape,
  account: PimAccountRow,
  listId: string,
  getTarget: () => Promise<IPimTarget | null>,
  result: TaskSyncResult,
  /** Queues a task for import; the notes are created after all lists, in a fixed order. */
  queueCreate: (task: PimTask) => void,
  /** Collects why a provider change did not reach its note (see `notApplied`). */
  notApplied: NotAppliedReason[] = []
): Promise<void> {
  const { adapter, cache } = opts;
  const remoteTasks = await cache.listTasks(account.id, listId);
  const states = await cache.getTaskStates(account.id, listId);
  const stateByUid = new Map(states.map((s) => [s.uid, s]));
  const remoteUids = new Set(remoteTasks.map((t) => t.uid));

  // The tasks this list already mirrors, by title: what a finished occurrence
  // a provider split off under a new id is recognised against (see
  // `isSplitOffOccurrence`). Read from the state as it was when the reconcile
  // began - a row updated further down still names the occurrence it agreed on.
  const trackedByTitle = new Map<string, Array<{ remote: PimTask; base: PimTaskFields }>>();
  for (const t of remoteTasks) {
    const s = stateByUid.get(t.uid);
    if (!s || s.notePath === null || !s.baseFields || !t.title) continue;
    const list = trackedByTitle.get(t.title) ?? [];
    list.push({ remote: t, base: s.baseFields });
    trackedByTitle.set(t.title, list);
  }

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
      const adopted = await adoptAnchoredNote(opts, account, listId, rt, result);
      if (adopted) {
        // A note that carries no due date at all says nothing about it; one
        // that carries its own keeps speaking for it, as before.
        const adoptedDue = db.dueKey ? await adapter.readTextFile(adopted).then((text) => readNoteFields(text, db).due, () => null) : null;
        await cache.upsertTaskState({
          accountId: account.id,
          listId,
          uid: rt.uid,
          notePath: adopted,
          remoteEtag: rt.etag ?? null,
          // The remote state is the agreed base: the note was never compared
          // against this task before, and claiming an older base would push
          // changes nobody made. A note without a due date is given the
          // provider's by the next cycle rather than read as cleared (B2).
          baseFields: { ...remoteFields, ...(db.dueKey && (adoptedDue !== null || remoteFields.due === null) ? { dueHeldIn: db.dueKey } : {}) },
        });
        result.adoptedNotes.push(adopted);
        continue;
      }
      if ((trackedByTitle.get(rt.title) ?? []).some((t) => isSplitOffOccurrence(rt, t.remote, t.base))) {
        // The finished occurrence of a task this list already mirrors, split
        // off under an id of its own (finding 2026-10-24: Apple Reminders).
        // Its note would be a second, done copy of the same task ("Probe 2").
        // A tombstone keeps it out for good; the provider copy is untouched.
        await cache.upsertTaskState({ accountId: account.id, listId, uid: rt.uid, notePath: null, remoteEtag: rt.etag ?? null, baseFields: remoteFields });
        continue;
      }
      if (opts.mayCreateNotes === false) {
        // The vault is still filling up — its note may be seconds away.
        result.deferredCreates++;
        continue;
      }
      queueCreate(rt);
      continue;
    }
    if (st.notePath === null) continue; // tombstone: never re-import

    // Locate the note — the anchor survives renames/moves inside the vault.
    let notePath: string | null = st.notePath;
    if (!(await adapter.exists(notePath))) {
      notePath = await findNoteByAnchor(opts, account, listId, rt);
      if (!notePath) {
        if (!opts.anchorsByUid) {
          // Without the anchor index "no note found" means "not looked", not
          // "deleted". A tombstone says never import this again — that is not
          // a decision to take on missing information.
          continue;
        }
        if (anchoredCandidates(opts, account, listId, rt).length > 0) {
          // The index still names a note for this task that is not there: it
          // lags behind a MOVE — a rename arriving from another device (E12),
          // or one made here and not yet indexed. A lagging index can no more
          // authorize a tombstone than an adoption; the next cycle, with the
          // index caught up, finds the note under its new name.
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
    // A path can now contain a different task after file sync. The cached path
    // and even the anchor index are hints; only the bytes authorize a write.
    if (!taskNoteMatches(readTaskNoteIdentity(content), taskId(rt.uid))) {
      const rebound = await findNoteByAnchor(opts, account, listId, rt);
      if (rebound && rebound !== notePath) await cache.upsertTaskState({ ...st, notePath: rebound });
      continue;
    }
    const base = st.baseFields ?? remoteFields;
    // Data safety: when the note's status is empty or an UNRECOGNIZED value we
    // must not read it as an intentional "open" — that would let a garbled /
    // stale / foreign-database status un-complete the remote task (the "all
    // tasks undone at Google" failure). In that case completion follows the
    // base, so no spurious flip is ever pushed.
    // The note does not speak for the due date while the database has no date
    // column, or while it carries no due property and the date was agreed
    // without the note holding it in this column (`dueHeldIn`, B2).
    const readLocal = (text: string): PimTaskFields => {
      const fields = readNoteFields(text, db, base.completed);
      return dueSilent(fields, base, db) ? { ...fields, due: base.due } : fields;
    };
    // Such a note is given the agreed date first (an empty date is nothing to write).
    const needsDueWriteIn = (text: string): boolean => !!db.dueKey && base.due !== null && dueSilent(readNoteFields(text, db), base, db);
    const needsDueWrite = needsDueWriteIn(content);
    const localFields = readLocal(content);
    const remoteChanged = st.remoteEtag != null ? st.remoteEtag !== (rt.etag ?? null) : !fieldsEqual(remoteFields, base);
    const localChanged = !fieldsEqual(localFields, base);

    if (!remoteChanged && !localChanged && !needsDueWrite) {
      // A row from before `dueHeldIn`, or from before the column changed,
      // whose note holds the agreed date is marked once, on first sight: a
      // date cleared later is then read as cleared.
      const noteDue = db.dueKey && base.dueHeldIn !== db.dueKey ? readNoteFields(content, db).due : null;
      const holds = noteDue !== null && dueEqual(noteDue, base.due);
      if (notePath !== st.notePath || holds) {
        await cache.upsertTaskState({ ...st, notePath, ...(holds && db.dueKey ? { baseFields: { ...base, dueHeldIn: db.dueKey } } : {}) });
      }
      continue;
    }

    // Field-wise three-way merge, local wins on a per-field tie.
    const mergeFields = (local: PimTaskFields): PimTaskFields => {
      const changed = !fieldsEqual(local, base);
      return {
        title: changed && local.title !== base.title ? local.title : remoteFields.title,
        due: changed && !dueEqual(local.due, base.due) ? local.due : remoteFields.due,
        completed: changed && local.completed !== base.completed ? local.completed : remoteFields.completed,
      };
    };
    const merged = mergeFields(localFields);

    // Apply to the note when it differs from the local state.
    if (!fieldsEqual(merged, localFields) || needsDueWrite) {
      // What the merge writes, as a function of the text it goes into
      // (`updateVaultText`): the note as it lies there at that moment, and —
      // where the note has an open conflict — the person's own version, which
      // takes the same change merged with what it says itself. A text that is
      // no longer this task is left alone: only the bytes authorize a write.
      const mergedInto = (text: string): string | null => {
        if (text !== content && !taskNoteMatches(readTaskNoteIdentity(text), taskId(rt.uid))) return null;
        const own = text === content ? localFields : readLocal(text);
        const fields = text === content ? merged : mergeFields(own);
        const writeDue = text === content ? needsDueWrite : needsDueWriteIn(text);
        if (fieldsEqual(fields, own) && !writeDue) return null;
        // A note without its date yet gets it, whatever it was assumed to say.
        const current = writeDue ? { ...own, due: fields.due === null ? null : "" } : own;
        let updated = upgradeAnchorIfStale(applyFieldsToNote(text, fields, current, db), account, listId, rt);
        // The provider repeats this task (finding 2026-09-20): done at the last
        // agreement, open again under the SAME id with a later due date — and
        // nobody reopened it here. The note says so from now on, because "I
        // ticked this yesterday and it is open again" otherwise reads as a sync
        // fault. Rides along with the write that reopens the note; never a
        // write of its own.
        // A provider that says the task repeats (the phone's reminders) needs
        // no done state in between: ticked over there, the same id simply
        // moves on to its next date while the note is still open.
        if (providerReopened(base, { ...remoteFields, recurring: rt.recurring }) && own.completed === base.completed) updated = markRecurringAtProvider(updated);
        return updated;
      };
      try {
        const written = await updateVaultText(adapter, notePath, mergedInto);
        if (written.changed) result.changedNotes.push(notePath);
        // Edited since it was read: the note is merged as it lies there, and
        // the state and the push follow from the next cycle's read of it.
        if (written.before !== content) continue;
        content = written.text;
      } catch (e) {
        // Moved or deleted since it was read: nothing to report, the next
        // cycle finds the note where it is now (or tombstones it).
        if (!isFileNotFound(e)) result.errors.push(`${notePath}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }

    // Did every field that had to change reach the note? A value the note
    // cannot hold - a tick for a database without a done column, a date for
    // one without a date column, a property block that could not be written -
    // used to be recorded as agreed all the same: the tick was gone for good,
    // and nothing anywhere said so (finding B2, 19.10.). Such a field keeps its
    // old base and the remote etag is forgotten, so the next cycle tries again;
    // the list reports it until the database can take it.
    // A date that had to be written in counts as a change to check, too.
    const missing = missingFields(content, merged, needsDueWrite ? { ...localFields, due: null } : localFields, db);
    for (const field of missing) notApplied.push(notAppliedReason(field, db));

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
        if (!await fileStillEquals(adapter, notePath, content)) continue;
        const res = await target.updateTask(
          { listId, uid: rt.uid, etag: rt.etag, href: rt.href },
          { title: merged.title, due: merged.due ?? undefined, completed: merged.completed }
        );
        newEtag = res.etag ?? null;
        // The provider changed the task in the very write (finding 2026-10-24:
        // EventKit moves a completed recurring reminder on to its next
        // occurrence inside the save). Its etag then stands for a state this
        // reconcile never saw; recorded as agreed, the next pull would carry
        // the same etag and the change would never reach the note. Without the
        // etag the next cycle compares the fields and merges.
        if (res.task && !fieldsEqual(fieldsOfTask(res.task), merged)) newEtag = null;
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

    // A field held back keeps the old base, so the provider's value is tried
    // again every cycle - a write that changes nothing and one state row. A
    // later local edit back TO that old base reads as "unchanged" and yields
    // to the provider's value; it is the value the provider already holds
    // that would be lost, never one the person made since.
    const agreed: PimTaskFields = { ...merged };
    for (const field of missing) (agreed as Record<keyof PimTaskFields, unknown>)[field] = base[field];
    // Whether the note now holds the agreed due date; until it does, a missing
    // due property is not read as a cleared one.
    if (db.dueKey && dueEqual(readNoteFields(content, db).due, agreed.due)) agreed.dueHeldIn = db.dueKey;
    await cache.upsertTaskState({ accountId: account.id, listId, uid: rt.uid, notePath, remoteEtag: missing.length > 0 ? null : newEtag, baseFields: agreed });
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
      if (!taskNoteMatches(readTaskNoteIdentity(content), taskId(st.uid))) continue;
      const base = st.baseFields;
      if (!base) continue;
      const read = readNoteFields(content, db, base.completed);
      const local = dueSilent(read, base, db) ? { ...read, due: base.due } : read;
      const unchanged = local.title === base.title && dueEqual(local.due, base.due) && local.completed === base.completed;
      if (!unchanged) continue;
      if (!await fileStillEquals(adapter, st.notePath, content)) continue;
      await opts.adapter.deleteFile(st.notePath);
      result.deletedNotes.push(st.notePath);
    } catch (e) {
      result.errors.push(`${account.label}/${listId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

// ---- changes that did not reach the note ------------------------------------

/** Why a provider change did not reach its note - the codes the task views translate. */
export type NotAppliedReason = "no-done-column" | "no-due-column" | "not-written";

/**
 * The fields of `merged` that differ from what the note said before and that
 * the note does not say now. The title is left out when the provider's is
 * empty: an empty title is never written over a note's heading.
 */
function missingFields(text: string, merged: PimTaskFields, before: PimTaskFields, db: Pick<DbShape, "dueKey" | "completion">): Array<keyof PimTaskFields> {
  // Read with the OPPOSITE of the wanted value as the fallback: a note that
  // does not clearly say "done" (or "open") has not taken the change.
  const now = readNoteFields(text, db, !merged.completed);
  const out: Array<keyof PimTaskFields> = [];
  if (merged.title && merged.title !== before.title && now.title !== merged.title) out.push("title");
  if (!dueEqual(merged.due, before.due) && (!db.dueKey || !dueEqual(now.due, merged.due))) out.push("due");
  if (merged.completed !== before.completed && (!db.completion || now.completed !== merged.completed)) out.push("completed");
  return out;
}

function notAppliedReason(field: keyof PimTaskFields, db: Pick<DbShape, "dueKey" | "completion">): NotAppliedReason {
  if (field === "completed" && !db.completion) return "no-done-column";
  if (field === "due" && !db.dueKey) return "no-due-column";
  return "not-written";
}

/** One row per list: set while changes wait, cleared once they all went through. */
async function reportNotApplied(cache: PimCacheRepository, accountId: string, listId: string, reasons: readonly NotAppliedReason[]): Promise<void> {
  const scope = `tasknotes:${listId}`;
  try {
    if (reasons.length > 0) {
      // The most telling reason first: a missing column is the person's to fix.
      const reason = (["no-done-column", "no-due-column", "not-written"] as const).find((r) => reasons.includes(r))!;
      await cache.recordScopeFailure(accountId, scope, { lastError: `${TASK_NOTE_PROBLEM_PREFIX}${reason}` });
      return;
    }
    // Only a row that says something is cleared: a write every cycle for
    // every list would be a write for nothing.
    if ((await cache.getScopeState(accountId, scope))?.lastError) await cache.setScopeState(accountId, scope, { lastError: null });
  } catch {
    /* a report must never cost the reconcile */
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
    folder: trimEndChars(target.folder, "/"),
    inheritTags: target.inheritTags ?? [],
    templatePath: typeof config.newItemTemplate === "string" ? config.newItemTemplate : null,
    dueKey,
    completion: resolveTaskCompletionModel(config),
  };
}

async function createTaskNote(opts: TaskSyncOptions, db: DbShape, account: PimAccountRow, listId: string, task: PimTask, known: Iterable<string>): Promise<string | null> {
  const { adapter } = opts;
  const anchor = buildTaskAnchor({ uid: task.uid, listId, accountId: account.id, provider: account.provider, identity: taskAnchorIdentity(account) });
  // The title alone (E11). Whether "Title" is free is decided by the anchor in
  // the file there, not by the name: this task's own note is reused, anything
  // else moves this one on to "Title 2".
  const notePath = await availableTaskNotePath(adapter, db.folder, task.title, anchor, { known });
  // An earlier interrupted run may have written the file before its state row.
  // Reuse it without overwriting independent edits with provider contents.
  if (await adapter.exists(notePath)) return notePath;

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
  const title = task.title || "Task";
  const templateContext = await withVaultContext({ title, now: new Date(), folder: notePath.split("/").slice(0, -1).join("/") }, opts.templateVault ?? null);
  let content = buildNewItemContent({ templateText, noteType: opts.noteType, title, inheritTags: db.inheritTags, prefills, templateContext });
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
    return null; // An unanchored mirror cannot be reconciled safely.
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
    if (await adapter.exists(notePath)) return null;
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
async function adoptAnchoredNote(
  opts: TaskSyncOptions,
  account: PimAccountRow,
  listId: string,
  task: PimTask,
  result: TaskSyncResult
): Promise<string | null> {
  const candidates = await liveAnchoredCandidates(opts, account, listId, task);
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
/**
 * A recurring provider task coming round again: completed when both sides last
 * agreed, open now, and due LATER than before. The later date is what tells a
 * repetition from somebody simply un-ticking the task at the provider.
 *
 * A provider that SAYS the task repeats (`recurring`, the phone's reminders)
 * needs no done state at the last agreement: ticked there, the same id moves on
 * to its next date in one step, and the note never saw it done.
 */
export function providerReopened(base: PimTaskFields, remote: PimTaskFields & { recurring?: boolean }): boolean {
  if (remote.completed || !base.due || !remote.due || remote.due.slice(0, 10) <= base.due.slice(0, 10)) return false;
  return base.completed || remote.recurring === true;
}

/**
 * The finished occurrence of a repeating task that a provider split off under
 * an id of its own (finding 2026-10-24). Apple Reminders does this: completing
 * a recurring reminder keeps its identifier - moved on to the next date and
 * open - and files the finished occurrence as a NEW, completed reminder with
 * the old date. Imported, that copy became a second, done note of the same
 * task.
 *
 * Narrow on purpose, and provider-neutral: a completed task seen for the first
 * time, with the title of a task this list already mirrors (`sibling`, with
 * the base `siblingBase` last agreed for it), whose date the sibling has moved
 * past, and which is the very occurrence last agreed on - or, where the
 * provider says the sibling repeats, any occurrence between that one and the
 * current date (ticked twice between two cycles). A finished task of the same
 * title from before the last agreement, or one beside a series that has not
 * moved on, is still imported as before.
 */
export function isSplitOffOccurrence(copy: PimTask, sibling: PimTask, siblingBase: PimTaskFields): boolean {
  if (!copy.completed || copy.uid === sibling.uid || !copy.title || copy.title !== sibling.title) return false;
  if (!copy.due || !sibling.due || !siblingBase.due) return false;
  const day = (d: string) => d.slice(0, 10);
  // The series has moved past this occurrence.
  if (day(sibling.due) <= day(copy.due)) return false;
  if (dueEqual(copy.due, siblingBase.due)) return true;
  return sibling.recurring === true && day(copy.due) >= day(siblingBase.due);
}

function markRecurringAtProvider(content: string): string {
  if (readFrontmatterPath(content, ["plainva", "pim", "recurring"]) === true) return content;
  try {
    return setFrontmatterPath(content, ["plainva", "pim", "recurring"], true);
  } catch {
    return content; // a label must never cost the actual edit
  }
}

function upgradeAnchorIfStale(content: string, account: PimAccountRow, listId: string, task: PimTask): string {
  if (!account.provider) return content;
  const current = readFrontmatterPath(content, ["plainva", "pim", "provider"]);
  if (typeof current === "string" && current) return content;
  try {
    const recurring = readFrontmatterPath(content, ["plainva", "pim", "recurring"]) === true;
    return setFrontmatterPath(content, ["plainva", "pim"], {
      ...buildTaskAnchor({
        uid: task.uid,
        listId,
        accountId: account.id,
        provider: account.provider,
        identity: taskAnchorIdentity(account),
      }),
      ...(recurring ? { recurring: true } : {}),
    });
  } catch {
    return content; // never let a cosmetic upgrade cost the actual edit
  }
}

/** Where an anchored note moved to, for the case that its known path is gone.
 *  Same index, so a rename inside the vault costs no file reads either. */
async function findNoteByAnchor(opts: TaskSyncOptions, account: PimAccountRow, listId: string, task: PimTask): Promise<string | null> {
  return chooseAnchorToAdopt(await liveAnchoredCandidates(opts, account, listId, task), task.title || "")?.path ?? null;
}

async function liveAnchoredCandidates(opts: TaskSyncOptions, account: PimAccountRow, listId: string, task: PimTask): Promise<TaskAnchorRecord[]> {
  const expected = { uid: task.uid, list: listId, provider: account.provider, identity: taskAnchorIdentity(account) };
  const matches: TaskAnchorRecord[] = [];
  for (const candidate of anchoredCandidates(opts, account, listId, task)) {
    try {
      if (taskNoteMatches(readTaskNoteIdentity(await opts.adapter.readTextFile(candidate.path)), expected)) matches.push(candidate);
    } catch { /* A stale index cannot authorize adoption or deletion. */ }
  }
  return matches;
}

async function fileStillEquals(adapter: TaskSyncAdapter, path: string, content: string): Promise<boolean> {
  try { return await adapter.readTextFile(path) === content; } catch { return false; }
}

// ---- field mapping ---------------------------------------------------------

export function fieldsOfTask(t: PimTask): PimTaskFields {
  return { title: t.title, due: t.due ?? null, completed: t.completed };
}

export function fieldsEqual(a: PimTaskFields, b: PimTaskFields): boolean {
  return a.title === b.title && dueEqual(a.due, b.due) && a.completed === b.completed;
}

/** A due value as the note says it: the day, and the time where it has one. */
function dueOf(raw: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(raw);
  if (!m) return raw.slice(0, 10);
  return m[2] ? `${m[1]}T${m[2]}` : m[1]!;
}

/**
 * Whether a note says nothing about its due date (B2): the database has no
 * date column, or the note carries no due property while the agreed date was
 * not held by it in this column (`dueHeldIn`). A note that carries a date
 * always speaks.
 */
function dueSilent(note: PimTaskFields, base: PimTaskFields, db: Pick<DbShape, "dueKey">): boolean {
  return !db.dueKey || (note.due === null && base.dueHeldIn !== db.dueKey);
}

/**
 * Two due values mean the same (B2): by the minute where both carry a time,
 * by the day where one does not. Google, Microsoft and CalDAV keep days, a
 * note may keep a time; the phone's reminders keep a time. Compared by the
 * day alone, a reminder's time was taken for a change of the note's and sent
 * back without it - the time was lost at the provider.
 */
export function dueEqual(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.length > 10 && b.length > 10 ? a === b : a.slice(0, 10) === b.slice(0, 10);
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
  const due = dueRaw != null && String(dueRaw).trim() ? dueOf(String(dueRaw).trim()) : null;
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
    // A day-only value of the same day leaves a time the note carries alone:
    // a time the person put in survives a provider that knows days only.
    // Anything else is written as it is, a provider's time included.
    const keepsNoteTime = !!merged.due && !!current.due && merged.due.length === 10 && current.due.length > 10 && current.due.startsWith(merged.due);
    if (db.dueKey && merged.due !== current.due && !keepsNoteTime) {
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

/**
 * Where the note's text begins: behind its properties, or — in a note without
 * any — behind a byte order mark. The mark is no part of the first line: read
 * as one, it hid a heading on that line from both functions below, and a
 * title from the provider was written as a second heading above it.
 */
function textStartOf(content: string): number {
  return frontmatterSpan(content)?.end ?? (content.charCodeAt(0) === 0xfeff ? 1 : 0);
}

function firstH1(content: string): string | null {
  const body = content.slice(textStartOf(content));
  const m = body.match(/^#[ \t]+(\S[^\r\n]*)/m);
  return m ? m[1].trim() : null;
}

function replaceFirstH1(content: string, title: string): string {
  const at = textStartOf(content);
  const head = content.slice(0, at);
  const body = content.slice(at);
  if (/^#[ \t]+\S[^\r\n]*/m.test(body)) {
    return head + body.replace(/^#[ \t]+\S[^\r\n]*/m, `# ${title}`);
  }
  // A heading that has to be added ends the way the note's lines end.
  return head + `# ${title}${readTextShape(content).shape.eol}` + body;
}

