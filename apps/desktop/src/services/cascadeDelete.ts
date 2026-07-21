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
  type DeletionPlanDeps,
} from "@plainva/ui";
import { taskDatabaseKey } from "../contexts/VaultContext";
import { getSettingsStore } from "./settingsStore";
import { getTaskDatabasePath } from "./taskDatabase";
import { getTemplateFolder } from "./newItemFlow";
import { removeRelationLinksToNote } from "./relations";
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
    // queryDatabaseFiles rows carry base-view field names — normalize to the
    // kernel's {path,title} contract here (mobile does the same).
    queryDatabaseFiles: async (config) =>
      (await queryService.queryDatabaseFiles(config)).map((r: any) => ({
        path: String(r["file.path"] ?? r.path ?? ""),
        title: (r["file.name"] ?? r.title ?? null) as string | null,
      })),
    listBaseFilePaths: () => queryService.listBaseFilePaths(),
    readTextFile: (path) => adapter.readTextFile(path),
  };
}

export async function buildDesktopDeletionPlan(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  paths: string[]
): Promise<DeletionPlan> {
  return buildDeletionPlan(buildDesktopPlanDeps(adapter, queryService), paths);
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

  // 2. The user confirmed exactly these paths — the sync mass-deletion guard
  //    must not hold (or resurrect) them on the next cycle.
  opts.syncWorker?.noteUserInitiatedDeletion(paths);

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
  }

  return { deleted, errors, cleanedSources };
}

function normSlash(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}
