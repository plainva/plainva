import {
  foldPathForCollision,
  isOwnLegacyTaskNoteName,
  parseLegacyTaskNoteName,
  readTaskNoteIdentity,
  taskNoteKey,
  taskNotePath,
  type TaskAnchorRecord,
} from "@plainva/core";
import { applyLinkUpdates, type LinkUpdatePlan } from "../lib/renameNote";

/**
 * Task notes that still carry an id in their name (plan Befunde 2026-09-24,
 * E12).
 *
 * From 12.09. to 24.09. Plainva named a mirrored task "<title> — <16 hex>.md"
 * so two devices would pick the same path for it. Since E11 the name is the
 * title again ("Title", "Title 2"), and the notes named in those twelve days
 * are offered ONCE for a clean-up — never renamed on their own.
 *
 * What qualifies is narrow on purpose: the name must have the shape Plainva
 * gave it AND the digits must be the hash of the anchor in the very same file
 * (`isOwnLegacyTaskNoteName`). A note somebody named "Plan — 0123….md", or a
 * mirrored note whose name was copied from another, stays as it is.
 *
 * The rename itself is the shell's ordinary one (flush, move, links, bookmarks,
 * pinboards, index, open tabs), so it reaches the other devices as a move —
 * the file sync pushes a rename as a rename, and their pull recognises it
 * (SyncWorker, `onRemoteMoves`). Around it this module adds what a batch needs:
 *
 * - the task reconciler is held (`withTaskSyncPaused`, by the caller), and the
 *   stored note path follows in the same step, BEFORE the move — a reconcile
 *   after an interruption then finds the note under either name;
 * - a small journal names every planned rename with the links it will
 *   retarget, so an interrupted run is finished on the next start, and a
 *   second run finds nothing left to do.
 */

export interface TaskNameRename {
  from: string;
  to: string;
  /** Links onto the note that the rename retargets. */
  links: number;
}

export interface TaskNameCleanupScan {
  /** `VaultQueryService.getTaskAnchors()`: every note that carries a task anchor. */
  anchorsByUid: ReadonlyMap<string, readonly TaskAnchorRecord[]>;
  readTextFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  /** Every path the index knows — a name that differs only in case is taken. */
  knownPaths: Iterable<string>;
  /** Links onto a note (backlink rows). */
  countLinks(path: string): Promise<number>;
}

const MAX_NUMBER = 10_000;

/** Anchored notes whose name has the legacy shape — the only ones worth reading. */
function legacyShapedPaths(anchorsByUid: TaskNameCleanupScan["anchorsByUid"]): Set<string> {
  const shaped = new Set<string>();
  for (const records of anchorsByUid.values()) {
    for (const rec of records) if (parseLegacyTaskNoteName(rec.path)) shaped.add(rec.path);
  }
  return shaped;
}

/**
 * Cheap pre-check from the anchor index alone: could there be anything to
 * offer? A vault without such names — every vault once cleaned up — costs one
 * pass over the anchors and no file read.
 */
export function hasLegacyTaskNoteNames(anchorsByUid: TaskNameCleanupScan["anchorsByUid"]): boolean {
  return legacyShapedPaths(anchorsByUid).size > 0;
}

/**
 * The renames on offer, in one fixed order (the tasks' identities, as E11
 * numbers new notes), each with the first free "Title", "Title 2", … — free
 * meaning: nothing is there, no twin in another letter case, and no earlier
 * rename of this list takes it.
 */
export async function planTaskNameCleanup(scan: TaskNameCleanupScan): Promise<TaskNameRename[]> {
  const shaped = legacyShapedPaths(scan.anchorsByUid);
  const own: Array<{ from: string; key: string }> = [];
  for (const from of shaped) {
    let content: string;
    try {
      content = await scan.readTextFile(from);
    } catch {
      continue; // gone or unreadable: nothing to offer
    }
    if (!isOwnLegacyTaskNoteName(from, content)) continue;
    own.push({ from, key: taskNoteKey(readTaskNoteIdentity(content)!) });
  }
  own.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  const taken = new Set<string>();
  for (const path of scan.knownPaths) taken.add(foldPathForCollision(path));
  const out: TaskNameRename[] = [];
  for (const { from } of own) {
    const { folder, stem } = parseLegacyTaskNoteName(from)!;
    let to: string | null = null;
    for (let n = 1; n <= MAX_NUMBER && !to; n++) {
      const candidate = taskNotePath(folder, stem, n);
      if (taken.has(foldPathForCollision(candidate))) continue;
      if (await scan.exists(candidate)) continue;
      to = candidate;
    }
    if (!to) continue;
    taken.add(foldPathForCollision(to));
    let links = 0;
    try {
      links = await scan.countLinks(from);
    } catch {
      /* a count is information, never a reason to leave a note out */
    }
    out.push({ from, to, links });
  }
  return out;
}

/** The identity of an offer: what "hidden" is remembered against. */
export function taskNameCleanupSignature(items: readonly TaskNameRename[]): string {
  if (items.length === 0) return "";
  const text = items.map((i) => i.from).sort().join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${items.length}:${(h >>> 0).toString(16).padStart(8, "0")}`;
}

// ---- running it ------------------------------------------------------------

export interface TaskNameCleanupJournalStore {
  read(): string | null;
  /** null removes the journal. */
  write(text: string | null): void;
}

export interface TaskNameCleanupRunner {
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  journal: TaskNameCleanupJournalStore;
  /** What the rename will do to links (`planLinkUpdates`); null without an index. */
  planLinks(from: string, to: string): Promise<LinkUpdatePlan | null>;
  /**
   * The shell's ordinary rename of ONE note: flush a pending save, move, retarget
   * links, bookmarks and pinboards, update the index, let open tabs follow.
   */
  renameNote(from: string, to: string): Promise<{ newPath: string; linkUpdateFailed: boolean }>;
  /** `pim_task_state.note_path` follows (`PimCacheRepository.moveTaskNotePath`); a no-op without PIM. */
  moveTaskNotePath(from: string, to: string): Promise<void>;
  /**
   * After a resumed rename: bring the index up to date. `moved` is a rename
   * the app made — the index follows it, it does not report the old name as
   * deleted (that queued a remote DELETE, issue 113); `added` are the notes
   * whose links were rewritten.
   */
  reindex(moved: Array<{ from: string; to: string }>, added: string[]): Promise<void>;
}

export interface TaskNameCleanupResult {
  renamed: Array<{ from: string; to: string }>;
  /** Left alone: the note changed, the name is taken now, or it is gone. */
  skipped: string[];
  linkUpdateFailed: boolean;
}

interface JournalItem {
  from: string;
  to: string;
  done: boolean;
  links: LinkUpdatePlan | null;
}

interface Journal {
  format: "plainva-task-names";
  version: 1;
  items: JournalItem[];
}

/**
 * One run or resume at a time: a view that re-scans while a run is under way
 * (every renamed note changes the index) must not start a second one on the
 * same journal.
 */
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

function readJournal(store: TaskNameCleanupJournalStore): Journal | null {
  let text: string | null;
  try {
    text = store.read();
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<Journal>;
    if (parsed.format !== "plainva-task-names" || !Array.isArray(parsed.items)) return null;
    const items = parsed.items.filter(
      (i): i is JournalItem => !!i && typeof i.from === "string" && typeof i.to === "string" && typeof i.done === "boolean",
    );
    return { format: "plainva-task-names", version: 1, items };
  } catch {
    return null;
  }
}

function writeJournal(store: TaskNameCleanupJournalStore, journal: Journal | null): void {
  store.write(journal && journal.items.some((i) => !i.done) ? JSON.stringify(journal) : null);
}

async function renameOne(item: JournalItem, run: TaskNameCleanupRunner, result: TaskNameCleanupResult): Promise<void> {
  // The list may be minutes old: only a note that is still ours, and a name
  // that is still free, are touched.
  if (!(await run.exists(item.from)) || (await run.exists(item.to))) {
    result.skipped.push(item.from);
    return;
  }
  let content: string;
  try {
    content = await run.readTextFile(item.from);
  } catch {
    result.skipped.push(item.from);
    return;
  }
  if (!isOwnLegacyTaskNoteName(item.from, content)) {
    result.skipped.push(item.from);
    return;
  }
  // The stored path first: a reconcile after an interruption then finds the
  // note under the new name, or under the old one through its anchor.
  await run.moveTaskNotePath(item.from, item.to);
  try {
    const outcome = await run.renameNote(item.from, item.to);
    if (outcome.linkUpdateFailed) result.linkUpdateFailed = true;
    if (outcome.newPath !== item.to) await run.moveTaskNotePath(item.to, outcome.newPath);
    result.renamed.push({ from: item.from, to: outcome.newPath });
  } catch (e) {
    // Still at the old name: the stored path goes back with it. Already moved:
    // it stays on the new name, and the journal finishes the rest next time.
    if (await run.exists(item.from)) await run.moveTaskNotePath(item.to, item.from).catch(() => undefined);
    throw e;
  }
}

/**
 * Finishes a run that was interrupted (app closed, crash). Every journaled
 * rename ends in one of three states, and each is answered from the files:
 *
 * - the note is still at its old name, the new one free: renamed now;
 * - the note is at its new name, the old one gone: the move happened — the
 *   links it planned are retargeted (a link already done is not found
 *   again), the stored path follows, the index catches up;
 * - both or neither: somebody else acted in between; nothing is guessed.
 */
export function resumeTaskNameCleanup(run: TaskNameCleanupRunner): Promise<TaskNameCleanupResult> {
  return exclusive(() => resumeJournal(run));
}

async function resumeJournal(run: TaskNameCleanupRunner): Promise<TaskNameCleanupResult> {
  const result: TaskNameCleanupResult = { renamed: [], skipped: [], linkUpdateFailed: false };
  const journal = readJournal(run.journal);
  if (!journal) return result;
  for (const item of journal.items) {
    if (item.done) continue;
    const fromThere = await run.exists(item.from);
    const toThere = await run.exists(item.to);
    if (fromThere && !toThere) {
      try {
        await renameOne(item, run, result);
      } catch (e) {
        console.warn(`[taskNameCleanup] resuming ${item.from} failed`, e);
        result.skipped.push(item.from);
      }
    } else if (!fromThere && toThere) {
      let anchored = false;
      try {
        anchored = !!readTaskNoteIdentity(await run.readTextFile(item.to));
      } catch {
        /* unreadable: leave it */
      }
      if (anchored) {
        let changed: string[] = [];
        if (item.links) {
          const applied = await applyLinkUpdates(run, item.links);
          changed = applied.changedPaths;
          if (applied.failed) result.linkUpdateFailed = true;
        }
        await run.moveTaskNotePath(item.from, item.to);
        await run.reindex([{ from: item.from, to: item.to }], changed);
        result.renamed.push({ from: item.from, to: item.to });
      } else {
        result.skipped.push(item.from);
      }
    } else {
      result.skipped.push(item.from);
    }
    item.done = true;
    writeJournal(run.journal, journal);
  }
  writeJournal(run.journal, null);
  return result;
}

/**
 * Renames the notes a person confirmed. The caller holds the task reconciler
 * (`withTaskSyncPaused`) for the whole call. A leftover journal is finished
 * first; then the new one is written BEFORE the first file moves.
 */
export function runTaskNameCleanup(items: readonly TaskNameRename[], run: TaskNameCleanupRunner): Promise<TaskNameCleanupResult> {
  return exclusive(() => runConfirmed(items, run));
}

async function runConfirmed(items: readonly TaskNameRename[], run: TaskNameCleanupRunner): Promise<TaskNameCleanupResult> {
  const result = await resumeJournal(run);
  const journal: Journal = { format: "plainva-task-names", version: 1, items: [] };
  for (const item of items) {
    let links: LinkUpdatePlan | null;
    try {
      links = await run.planLinks(item.from, item.to);
    } catch {
      links = null; // the rename still retargets links; only a resume would lack the plan
    }
    journal.items.push({ from: item.from, to: item.to, done: false, links });
  }
  writeJournal(run.journal, journal);
  for (const item of journal.items) {
    try {
      await renameOne(item, run, result);
      item.done = true;
    } catch (e) {
      // Not marked done: the next start looks at it once more (resume).
      console.warn(`[taskNameCleanup] renaming ${item.from} failed`, e);
      result.skipped.push(item.from);
    }
    writeJournal(run.journal, journal);
  }
  return result;
}
