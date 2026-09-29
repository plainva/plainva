import { useEffect, useMemo, useState } from "react";
import type { TaskAnchorRecord } from "@plainva/core";
import {
  hasLegacyTaskNoteNames,
  planTaskNameCleanup,
  resumeTaskNameCleanup,
  runTaskNameCleanup,
  taskNameCleanupSignature,
  type TaskNameCleanupResult,
  type TaskNameCleanupRunner,
  type TaskNameRename,
} from "../pim/taskNameCleanup";
import { withTaskSyncPaused } from "../pim/taskSyncPause";
import { planLinkUpdates, type LinkUpdateQuery } from "../lib/renameNote";
import { readHiddenTaskNames, taskNameJournalStore, writeHiddenTaskNames } from "../lib/taskNameCleanupStore";
import { useStableHandler } from "../lib/useStableHandler";

/**
 * "Task notes that still carry an id in their name" for a tasks view (plan
 * Befunde 2026-09-24, E12). Both shells drive their notice from this one hook
 * — WHAT is offered, in which order, under which new name, and what "hide"
 * means must not differ between them. The shells hand in their ordinary rename
 * and the place the task reconciler keeps its note paths.
 *
 * Opening the view finishes an interrupted run first (the person already said
 * yes to it), then looks for what is left.
 */
export interface TaskNameCleanupDeps {
  /** Identity the hidden notice and the journal are kept under (as in useTaskViewState). */
  vault: string | null;
  /** Anything that means "the index may have changed". */
  reloadKey: unknown;
  /** The vault's query service. Must be stable across renders. */
  queryService:
    | (LinkUpdateQuery & {
        getTaskAnchors(): Promise<Map<string, TaskAnchorRecord[]>>;
        listNotes(): Promise<Array<{ path: string }>>;
      })
    | null;
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  renameNote: TaskNameCleanupRunner["renameNote"];
  moveTaskNotePath: TaskNameCleanupRunner["moveTaskNotePath"];
  reindex: TaskNameCleanupRunner["reindex"];
  /** After renames: refresh what the view shows. */
  onChanged?(): void;
  onError(error: unknown): void;
}

export interface TaskNameCleanupState {
  /** The renames on offer, in the order they would run. */
  items: TaskNameRename[];
  /** Links the renames would retarget, all together. */
  links: number;
  /** Show the notice: there is something to offer and it was not hidden. */
  visible: boolean;
  busy: boolean;
  /** Renames what is on offer; resolves with what happened. */
  clean(): Promise<TaskNameCleanupResult | null>;
  /** "Not now" — until the set of names changes. */
  hide(): void;
}

export function useTaskNameCleanup(deps: TaskNameCleanupDeps): TaskNameCleanupState {
  const { vault, reloadKey, queryService } = deps;
  const [loaded, setLoaded] = useState<{ source: unknown; items: TaskNameRename[] } | null>(null);
  const [hiddenNow, setHiddenNow] = useState<{ vault: string | null; signature: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const stored = useMemo(() => readHiddenTaskNames(vault), [vault]);
  const hidden = hiddenNow && hiddenNow.vault === vault ? hiddenNow.signature : stored;

  const runner = (): TaskNameCleanupRunner | null => {
    const d = deps;
    const query = d.queryService;
    if (!query || !d.vault) return null;
    return {
      exists: d.exists,
      readTextFile: d.readTextFile,
      writeTextFile: d.writeTextFile,
      journal: taskNameJournalStore(d.vault),
      planLinks: async (from, to) => (await planLinkUpdates(query, from, to)).plan,
      renameNote: d.renameNote,
      moveTaskNotePath: d.moveTaskNotePath,
      reindex: d.reindex,
    };
  };

  // Finish an interrupted run (the person already said yes to it), then look
  // for what is left. A stable handler reads the latest deps, so the effect
  // runs on what matters and not on every render's fresh callbacks.
  const scan = useStableHandler(async (): Promise<TaskNameRename[]> => {
    const run = runner();
    if (run && run.journal.read()) {
      const resumed = await withTaskSyncPaused(() => resumeTaskNameCleanup(run));
      if (resumed.renamed.length > 0) deps.onChanged?.();
    }
    const query = deps.queryService;
    if (!query) return [];
    // The view re-scans on every index change; without a name of the legacy
    // shape there is nothing to read and no note list to fetch.
    const anchorsByUid = await query.getTaskAnchors();
    if (!hasLegacyTaskNoteNames(anchorsByUid)) return [];
    const notes = await query.listNotes();
    return planTaskNameCleanup({
      anchorsByUid,
      readTextFile: deps.readTextFile,
      exists: deps.exists,
      knownPaths: notes.map((n) => n.path),
      countLinks: async (path) => (await query.getBacklinks(path)).length,
    });
  });
  const reportError = useStableHandler((e: unknown) => deps.onError(e));

  useEffect(() => {
    if (!queryService || !vault) return;
    let alive = true;
    scan().then(
      (items) => {
        if (alive) setLoaded({ source: queryService, items });
      },
      (e) => {
        if (alive) reportError(e);
      },
    );
    return () => {
      alive = false;
    };
  }, [queryService, vault, reloadKey, tick, scan, reportError]);

  const items = loaded && loaded.source === queryService ? loaded.items : [];
  const signature = taskNameCleanupSignature(items);

  const clean = async (): Promise<TaskNameCleanupResult | null> => {
    const run = runner();
    if (!run || items.length === 0) return null;
    setBusy(true);
    try {
      const result = await withTaskSyncPaused(() => runTaskNameCleanup(items, run));
      deps.onChanged?.();
      return result;
    } catch (e) {
      deps.onError(e);
      return null;
    } finally {
      setBusy(false);
      setTick((x) => x + 1);
    }
  };

  const hide = () => {
    writeHiddenTaskNames(vault, signature);
    setHiddenNow({ vault, signature });
  };

  return {
    items,
    links: items.reduce((n, i) => n + i.links, 0),
    visible: items.length > 0 && signature !== hidden,
    busy,
    clean,
    hide,
  };
}
