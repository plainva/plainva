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
import { noteSaver, vaultOps, type MobileVault } from "./vaultService";
import { collectTaskAnchors, requestTaskDeletion } from "@plainva/ui";
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
    // Rows travel WHOLE (same as the desktop deps): membership reads path and
    // title, the entry inspector reads the column values.
    queryDatabaseFiles: (config) => qs.queryDatabaseFiles(config),
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

  // S2: a cascade rewrites SURVIVING notes (the reference cleanup below), and
  // any of them may be open with pending keystrokes. A save settling afterwards
  // overwrites the cleanup and brings the link to the deleted note back. The
  // paths are only known per reference, so the whole queue lands here — with
  // nothing pending this is free.
  await noteSaver.flushAll();

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

  // 2b. A note that mirrors a provider task takes the task with it — but only
  //     when the reader CONFIRMED it here. A merely missing file still deletes
  //     nothing: too many innocent causes (a half-finished sync, a rebuilt
  //     index, a folder that has not arrived yet).
  //
  //     The anchor and the body are readable only WHILE the file exists, so
  //     they are read now — the body is what makes "undo" hand back the work
  //     rather than an empty file.
  const anchored = collectTaskAnchors(
    (
      await Promise.all(
        paths
          .filter((p) => p.toLowerCase().endsWith(".md"))
          .map(async (p) => {
            try {
              return { path: p, content: await v.files.readTextFile(p) };
            } catch {
              // Unreadable — it cannot be a task we could delete remotely either.
              return null;
            }
          })
      )
    ).filter((n): n is { path: string; content: string } => n !== null)
  );

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

  // 3b. Only what really went away starts the window.
  if (deleted.length > 0) {
    const gone = new Set(deleted);
    requestTaskDeletion(anchored.filter((a) => gone.has(a.path)));
  }
  return { deleted, errors };
}
