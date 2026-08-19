import {
  resolveLinkTarget,
  type IVaultAdapter,
  type VaultIndexer,
  type VaultQueryService,
} from "@plainva/core";
import {
  buildDeletionPlan,
  cleanupRefsFor,
  listTemplates,
  removeTemplateForAssignment,
  selectedPaths,
  type CascadeSelection,
  type DeletionPlan,
  parseBaseConfig,
  type DeletionPlanDeps,
} from "@plainva/ui";
import { taskDatabaseKey } from "../contexts/VaultContext";
import { getSettingsStore } from "./settingsStore";
import { getTaskDatabasePath } from "./taskDatabase";
import { readProviderTaskAnchor, type ProviderTaskAnchor } from "@plainva/ui";
import { requestTaskDeletion } from "./pim/taskDeletion";
import { getTemplateFolder } from "./newItemFlow";
import { removeRelationLinksToNote } from "./relations";
import { loadAnchoredNotes } from "./pim/entryEventSync";
import { requestSaveFlush } from "./saveFlush";

/**
 * Desktop side of the cascade deletion (plan Kaskadenloeschung): plan deps on
 * the live index, the request store the App-level host listens to (every
 * delete entry point calls requestCascadeDelete and the host owns the shared
 * confirm → dialog → execute pipeline), and the executor that performs
 * cleanup writes, the deletions and the silent `.base` tidy-ups.
 */

export function buildDesktopPlanDeps(adapter: IVaultAdapter, queryService: VaultQueryService): DeletionPlanDeps {
  // One resolver corpus per plan build — getOutgoingRelationTargets runs per
  // cascade candidate and must not re-list the vault every time.
  let corpus: Promise<string[]> | null = null;
  const allPaths = () => {
    corpus ??= queryService.db
      .query<{ path: string }>(`SELECT path FROM files WHERE mode != 'attachment'`)
      .then((rows) => rows.map((r) => r.path));
    return corpus;
  };
  return {
    getIncomingRelationRefs: (targets) => queryService.getIncomingRelationRefs(targets),
    async getOutgoingRelationTargets(sourcePath, propertyKey) {
      const [props, paths] = await Promise.all([queryService.getFileProperties(sourcePath), allPaths()]);
      const raw = props[propertyKey];
      const values = Array.isArray(raw) ? raw.map(String) : raw != null && raw !== "" ? [String(raw)] : [];
      const out: string[] = [];
      for (const value of values) {
        const m = value.match(/\[\[([^\]|#]+)/);
        const targetText = (m ? m[1] : value).trim();
        if (!targetText) continue;
        const resolved = resolveLinkTarget(sourcePath, targetText, paths);
        if (resolved) out.push(resolved);
      }
      return out;
    },
    // Rows travel WHOLE: membership reads path/title, the entry inspector reads
    // the column values. Normalizing here once cost the inspector every value
    // it needs, without any error to show for it.
    queryDatabaseFiles: (config) => queryService.queryDatabaseFiles(config),
    listBaseFilePaths: () => queryService.listBaseFilePaths(),
    readTextFile: (path) => adapter.readTextFile(path),
  };
}

export async function buildDesktopDeletionPlan(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  paths: string[]
): Promise<DeletionPlan> {
  const plan = await buildDeletionPlan(buildDesktopPlanDeps(adapter, queryService), paths);
  // Which of the planned notes are scheduled — read from the INDEX, so opening
  // the dialog costs one query and no file reads.
  try {
    const anchored = await loadAnchoredNotes(queryService.db);
    if (anchored.size > 0) {
      const planned = new Set<string>(plan.primary.map((p) => p.path));
      for (const g of plan.groups) for (const it of g.items) planned.add(it.path);
      const linked = [...anchored.keys()].filter((p) => planned.has(p));
      if (linked.length > 0) plan.linkedEventPaths = linked;
    }
  } catch {
    /* no index answer: the dialog simply says nothing about appointments */
  }
  return plan;
}

// ── Request store (the App-level CascadeDeleteHost subscribes) ──────────────

export interface CascadeDeleteRequest {
  paths: string[];
}

interface PendingRequest {
  request: CascadeDeleteRequest;
  resolve: (deleted: boolean) => void;
}

let pending: PendingRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of [...listeners]) l();
}

export const cascadeDeleteStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): CascadeDeleteRequest | null {
    return pending?.request ?? null;
  },
  /** Host only: settle the pending request (true = something was deleted). */
  settle(deleted: boolean) {
    const p = pending;
    pending = null;
    p?.resolve(deleted);
    emit();
  },
};

/**
 * Entry point for every delete site (tree, editor ⋮, pinboard, graph…). The
 * host runs the whole flow — plan, confirmation (slim or cascade dialog),
 * execution, reindex, tab/bookmark cleanup — and resolves with whether
 * anything was deleted. Only one request runs at a time.
 */
export function requestCascadeDelete(request: CascadeDeleteRequest): Promise<boolean> {
  if (pending) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    pending = { request, resolve };
    emit();
  });
}

// ── Execution ────────────────────────────────────────────────────────────────

export interface CascadeExecuteResult {
  deleted: string[];
  errors: string[];
  /** Surviving notes whose relation values were cleaned (need a reindex). */
  cleanedSources: string[];
  /**
   * Storage folders of deleted databases that are now EMPTY. The host offers to
   * remove them (issue #34) — a database creates its folder, so leaving it
   * behind is the leftover the reporter kept running into.
   */
  emptiedFolders: string[];
}

export async function executeDeletionPlan(opts: {
  adapter: IVaultAdapter;
  queryService: VaultQueryService;
  indexer: VaultIndexer | null;
  syncWorker: { noteUserInitiatedDeletion(paths: string[]): void } | null;
  vaultPath: string | null;
  plan: DeletionPlan;
  selection: CascadeSelection;
  onProgress?: (done: number, total: number) => void;
}): Promise<CascadeExecuteResult> {
  const { adapter, queryService, plan, selection } = opts;
  const paths = selectedPaths(plan, selection);
  const pathSet = new Set(paths);
  const cleanup = selection.cleanupRefs ? cleanupRefsFor(plan, pathSet) : [];
  const total = cleanup.length + paths.length;
  let done = 0;
  const step = () => opts.onProgress?.(++done, total);

  const errors: string[] = [];
  const cleanedSources: string[] = [];
  const emptiedFolders: string[] = [];

  // 1. Reference cleanup FIRST (surviving notes lose their links onto the
  //    doomed targets while those still resolve).
  for (const ref of cleanup) {
    try {
      await requestSaveFlush(ref.source);
      const res = await removeRelationLinksToNote({
        adapter,
        queryService,
        notePath: ref.source,
        propertyKey: ref.propertyKey,
        targetNotePath: ref.target,
      });
      if (res.changed && !cleanedSources.includes(ref.source)) cleanedSources.push(ref.source);
    } catch (e) {
      console.error("cascade cleanup failed", ref, e);
      errors.push(ref.source.split(/[/\\]/).pop() ?? ref.source);
    }
    step();
  }

  // 1b. A database's storage folder is only readable while the `.base` still
  //     exists — remember it now, probe for emptiness after the deletes.
  const storageFolders = new Map<string, string>();
  for (const basePath of plan.affectedBases) {
    if (!pathSet.has(basePath)) continue;
    try {
      const config: any = parseBaseConfig(await adapter.readTextFile(basePath));
      const folder = config?.newItemFolder ? normSlash(String(config.newItemFolder)).replace(/\/+$/, "") : "";
      if (folder) storageFolders.set(basePath, folder);
    } catch {
      /* unreadable base — nothing to offer */
    }
  }

  // 2. The user confirmed exactly these paths — the sync mass-deletion guard
  //    must not hold (or resurrect) them on the next cycle.
  opts.syncWorker?.noteUserInitiatedDeletion(paths);

  // 2b. A note that is a provider task takes its task with it (E4b). Its
  //     anchor and body are only readable WHILE the file exists, so they are
  //     read here — and the body is what makes "undo" give back the work
  //     rather than an empty file.
  const anchored: Array<{ path: string; content: string; anchor: ProviderTaskAnchor }> = [];
  for (const p of paths) {
    if (!p.toLowerCase().endsWith(".md")) continue;
    try {
      const content = await adapter.readTextFile(p);
      const anchor = readProviderTaskAnchor(content);
      if (anchor) anchored.push({ path: p, content, anchor });
    } catch {
      /* unreadable — it cannot be a task we can delete remotely either */
    }
  }

  // 3. Delete sequentially (every delete snapshots via the backup chain).
  const deleted: string[] = [];
  for (const p of paths) {
    try {
      await adapter.deleteItem(p, true);
      deleted.push(p);
    } catch (e) {
      console.error("cascade delete failed", p, e);
      errors.push(p.split(/[/\\]/).pop() ?? p);
    }
    step();
  }

  // 3b. Only what really went away starts the window.
  if (deleted.length > 0) {
    const gone = new Set(deleted);
    requestTaskDeletion(anchored.filter((a) => gone.has(a.path)));
  }

  // 4. Silent tidy-ups for deleted bases (today NOTHING cleans these up):
  //    the default-task-database setting and template assignments would
  //    otherwise dangle — templateFor would even re-match a later base of the
  //    same name.
  for (const basePath of plan.affectedBases) {
    if (!deleted.includes(basePath)) continue;
    if (opts.vaultPath) {
      try {
        const configured = await getTaskDatabasePath(opts.vaultPath);
        if (configured && normSlash(configured) === normSlash(basePath)) {
          const store = await getSettingsStore();
          await store.delete(taskDatabaseKey(opts.vaultPath));
          await store.save();
        }
      } catch (e) {
        console.error("cascade task-db reset failed", e);
      }
      try {
        const folder = await getTemplateFolder(opts.vaultPath);
        for (const tpl of await listTemplates(adapter, folder)) {
          const content = await adapter.readTextFile(tpl.path);
          const res = removeTemplateForAssignment(content, basePath);
          if (res.changed) await adapter.writeTextFile(tpl.path, res.content);
        }
      } catch (e) {
        console.error("cascade templateFor sweep failed", e);
      }
    }
    // The database's storage folder was created WITH the database and is left
    // behind empty when it goes (issue #34: "folders not deleting"). Collect it
    // for the host to offer — never delete silently, and never when anything
    // survives inside.
    try {
      const folder = storageFolders.get(basePath);
      if (folder && !emptiedFolders.includes(folder)) {
        const rest = await adapter.listDir(folder).catch(() => null);
        if (rest && rest.length === 0) emptiedFolders.push(folder);
      }
    } catch (e) {
      console.error("cascade empty-folder probe failed", e);
    }
  }

  return { deleted, errors, cleanedSources, emptiedFolders };
}

function normSlash(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}
