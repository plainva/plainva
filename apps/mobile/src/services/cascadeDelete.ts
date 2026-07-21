import { resolveLinkTarget } from "@plainva/core";
import {
  buildDeletionPlan,
  cleanupRefsFor,
  removeRelationLinksToNoteShared,
  selectedPaths,
  type CascadeSelection,
  type DeletionPlan,
  type DeletionPlanDeps,
} from "@plainva/ui";
import { vaultOps, type MobileVault } from "./vaultService";
import { notifyUserInitiatedDeletion } from "./syncService";

/**
 * Mobile side of the cascade deletion (plan Kaskadenloeschung): the shared
 * plan kernel on the vault's query service, and the executor — reference
 * cleanup through the sync chain, then per-path deletion via vaultOps.remove
 * (index + bookmark cleanup included). Silent `.base` tidy-ups (default task
 * database, templateFor) are desktop concerns and deliberately absent here.
 */

export function buildMobilePlanDeps(v: MobileVault): DeletionPlanDeps | null {
  const qs = v.queryService;
  if (!qs) return null;
  let corpus: Promise<string[]> | null = null;
  const allPaths = () => {
    corpus ??= qs.db
      .query<{ path: string }>(`SELECT path FROM files WHERE mode != 'attachment'`)
      .then((rows) => rows.map((r) => r.path));
    return corpus;
  };
  return {
    getIncomingRelationRefs: (targets) => qs.getIncomingRelationRefs(targets),
    async getOutgoingRelationTargets(sourcePath, propertyKey) {
      const [props, paths] = await Promise.all([qs.getFileProperties(sourcePath), allPaths()]);
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
    // kernel's {path,title} contract (same as the desktop deps).
    queryDatabaseFiles: async (config) =>
      (await qs.queryDatabaseFiles(config)).map((r: any) => ({
        path: String(r["file.path"] ?? r.path ?? ""),
        title: (r["file.name"] ?? r.title ?? null) as string | null,
      })),
    listBaseFilePaths: () => qs.listBaseFilePaths(),
    readTextFile: (path) => v.files.readTextFile(path),
  };
}

export async function buildMobileDeletionPlan(v: MobileVault, paths: string[]): Promise<DeletionPlan | null> {
  const deps = buildMobilePlanDeps(v);
  if (!deps) return null;
  return buildDeletionPlan(deps, paths);
}

export async function executeMobileCascade(
  v: MobileVault,
  plan: DeletionPlan,
  selection: CascadeSelection
): Promise<{ deleted: string[]; errors: number }> {
  const paths = selectedPaths(plan, selection);
  const pathSet = new Set(paths);
  let errors = 0;

  // 1. Reference cleanup first (targets still resolve while they exist).
  if (selection.cleanupRefs && v.queryService) {
    const qs = v.queryService;
    const cleanupDeps = {
      readTextFile: (p: string) => v.files.readTextFile(p),
      writeTextFile: (p: string, c: string) => v.files.writeTextFile(p, c),
      listNotePaths: async () =>
        (await qs.db.query<{ path: string }>(`SELECT path FROM files WHERE mode != 'attachment'`)).map(
          (r) => r.path
        ),
    };
    for (const ref of cleanupRefsFor(plan, pathSet)) {
      try {
        const res = await removeRelationLinksToNoteShared(cleanupDeps, {
          notePath: ref.source,
          propertyKey: ref.propertyKey,
          targetNotePath: ref.target,
        });
        if (res.changed && v.indexer) await v.indexer.indexPath(ref.source).catch(() => {});
      } catch (e) {
        console.error("mobile cascade cleanup failed", ref, e);
        errors++;
      }
    }
  }

  // 2. User-confirmed paths must not trip the sync mass-deletion guard.
  notifyUserInitiatedDeletion(paths);

  // 3. Delete through the established mobile path (sync chain + index +
  //    bookmark cleanup per file).
  const deleted: string[] = [];
  for (const p of paths) {
    try {
      await vaultOps.remove(v, p);
      deleted.push(p);
    } catch (e) {
      console.error("mobile cascade delete failed", p, e);
      errors++;
    }
  }
  return { deleted, errors };
}
