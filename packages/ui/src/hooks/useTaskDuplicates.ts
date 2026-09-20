import { useEffect, useMemo, useState } from "react";
import type { TaskAnchorRecord } from "@plainva/core";
import type { TaskCompletionModel } from "../lib/taskDatabase";
import { readSeenTaskDuplicates, writeSeenTaskDuplicates } from "../lib/taskDuplicatesSeen";
import {
  findDuplicateTaskNotes, removableTaskCopies, removeTaskCopies, summarizeDuplicateTasks,
  type FindTaskDuplicatesOptions, type TaskDuplicateGroup,
} from "../pim/taskDuplicates";

/**
 * State of "tasks that exist more than once" for a tasks view (finding
 * 2026-09-20). Both shells drive their notice and their review from this one
 * hook — the desktop in a Modal, the phone in a sheet; WHEN the notice shows,
 * what may go and what "put away" means must not differ between them.
 *
 * The notice costs one index query per refresh and reads no file. The verdicts
 * need the files: they are worked out when somebody opens the review, and once
 * more right before anything is removed (`removeTaskCopies`).
 */
export interface TaskDuplicatesDeps {
  /** Identity the put-away notice is remembered under (as in useTaskViewState). */
  vault: string | null;
  /** Date column and completion model of the task database; null = no database. */
  db: { dueKey: string | null; completion: TaskCompletionModel | null } | null;
  /** Anything that means "the index may have changed". */
  reloadKey: unknown;
  /** The vault's query service. Must be stable across renders. */
  queryService: { getTaskAnchors(): Promise<Map<string, TaskAnchorRecord[]>> } | null;
  /** `PimCacheRepository.listBoundTaskNotes()`; resolves empty without a PIM runtime. */
  listBoundTaskNotes: () => Promise<Array<{ listId: string; uid: string; notePath: string }>>;
  readTextFile: (path: string) => Promise<string>;
  /**
   * The shell's plain, confirmed note delete (snapshot, index, sync queue). NOT
   * the task-deletion path that makes the provider's task follow.
   */
  deleteNote: (path: string) => Promise<void>;
  onRemoved?: (removed: string[]) => void | Promise<void>;
  onError: (error: unknown) => void;
}

export interface TaskDuplicatesState {
  /** Tasks claimed by more than one note. */
  count: number;
  /** Show the notice: there are duplicates and this set has not been put away. */
  visible: boolean;
  /** The open review, or null. */
  groups: TaskDuplicateGroup[] | null;
  /** Copies the open review would remove. */
  removable: number;
  busy: boolean;
  review(): Promise<void>;
  close(): void;
  /** Removes the removable copies; resolves with how many went. */
  remove(): Promise<number>;
  /** "I have looked, they stay" — until the set of duplicates changes. */
  putAway(): void;
}

export function useTaskDuplicates(deps: TaskDuplicatesDeps): TaskDuplicatesState {
  const { vault, db, reloadKey, queryService } = deps;
  // The summary remembers which query service it came from: another vault's
  // numbers never show, and no effect has to reset anything.
  const [loaded, setLoaded] = useState<{ source: unknown; count: number; signature: string } | null>(null);
  const [putAwayNow, setPutAwayNow] = useState<{ vault: string | null; signature: string } | null>(null);
  const [groups, setGroups] = useState<TaskDuplicateGroup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const stored = useMemo(() => readSeenTaskDuplicates(vault), [vault]);
  const seen = putAwayNow && putAwayNow.vault === vault ? putAwayNow.signature : stored;
  const summary = db && loaded && loaded.source === queryService ? loaded : { count: 0, signature: "" };

  useEffect(() => {
    if (!queryService || !db) return;
    let alive = true;
    queryService
      .getTaskAnchors()
      .then((anchors) => {
        if (alive) setLoaded({ source: queryService, ...summarizeDuplicateTasks(anchors) });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [queryService, db, reloadKey]);

  const options = async (): Promise<FindTaskDuplicatesOptions | null> => {
    if (!queryService || !db) return null;
    const [anchorsByUid, bound] = await Promise.all([queryService.getTaskAnchors(), deps.listBoundTaskNotes()]);
    const boundByTask = new Map(bound.map((b) => [JSON.stringify([b.listId, b.uid]), b.notePath]));
    return {
      anchorsByUid,
      boundPath: (list, uid) => boundByTask.get(JSON.stringify([list, uid])) ?? null,
      readTextFile: deps.readTextFile,
      db,
    };
  };

  const review = async () => {
    setBusy(true);
    try {
      const opts = await options();
      setGroups(opts ? await findDuplicateTaskNotes(opts) : []);
    } catch (e) {
      deps.onError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<number> => {
    if (!groups) return 0;
    setBusy(true);
    try {
      const opts = await options();
      if (!opts) return 0;
      const { removed } = await removeTaskCopies(groups, opts, deps.deleteNote);
      setGroups(null);
      if (removed.length > 0) await deps.onRemoved?.(removed);
      return removed.length;
    } catch (e) {
      deps.onError(e);
      return 0;
    } finally {
      setBusy(false);
    }
  };

  const putAway = () => {
    writeSeenTaskDuplicates(vault, summary.signature);
    setPutAwayNow({ vault, signature: summary.signature });
    setGroups(null);
  };

  return {
    count: summary.count,
    visible: summary.count > 0 && summary.signature !== seen,
    groups,
    removable: groups ? removableTaskCopies(groups).length : 0,
    busy,
    review,
    close: () => setGroups(null),
    remove,
    putAway,
  };
}
