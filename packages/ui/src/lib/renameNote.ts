import {
  parseMarkdownAst,
  serializeMarkdownAst,
  renameVaultLink,
  renameFrontmatterWikiLinks,
  type FrontmatterLinkRename,
  type VaultQueryService,
} from "@plainva/core";
import { sweepPinboardRefs } from "../base/pinboardSweep";

/**
 * Rename a note and retarget every vault link that pointed at it (wikilinks,
 * embeds, markdown links; anchors preserved) — the Alpha-roadmap feature
 * "Umbenennen mit vault-weitem Link-Update", pulled forward for the index.md
 * adoption flow (Gesamtplan OKF/Icons/Header, W5).
 *
 * Assumes a same-directory rename (both call sites — file-tree rename and
 * index.md adoption — only change the file name, never the folder), so a raw
 * target keeps its qualification style: path-qualified raws stay qualified,
 * bare raws stay bare unless the new basename collides with another file in
 * the vault — then they become path-qualified to stay unambiguous (relevant
 * once several `index.md` files exist).
 *
 * Two halves, so a batch can keep what a rename WILL do in a journal and do it
 * again after an interruption (plan Befunde 2026-09-24, E12): `planLinkUpdates`
 * reads the index while it still points at the old name, `applyLinkUpdates`
 * rewrites the referencing files — idempotently, because a link that already
 * points at the new name is not found again.
 */

export interface RenameAdapter {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  renameItem(oldPath: string, newPath: string): Promise<void>;
}

export interface RenameResult {
  renamedLinks: number;
  changedFiles: number;
  /**
   * True when collecting backlinks or rewriting a referencing file failed —
   * the rename itself succeeded, but some links may now point at the old
   * name. Callers surface this as a warning instead of staying silent.
   */
  linkUpdateFailed: boolean;
  /**
   * Paths of the referencing files whose links were rewritten. The caller
   * re-indexes exactly these (plus the renamed file) instead of scanning the
   * whole vault, so the sidebar reflects the rename immediately (Issue #9).
   */
  changedPaths: string[];
}

/** What planning needs from the index. */
export type LinkUpdateQuery = Pick<VaultQueryService, "getBacklinks" | "db">;

/**
 * The link rewrites one rename implies — plain data (a journal can hold it).
 * Per referencing file: the raw body targets with their new target, and the
 * frontmatter relation links by key.
 */
export interface LinkUpdatePlan {
  oldPath: string;
  newPath: string;
  sources: Array<{
    path: string;
    body: Array<{ raw: string; target: string }>;
    frontmatter: FrontmatterLinkRename[];
  }>;
}

/**
 * Collect referencing links BEFORE the rename — the index still points at
 * oldPath. A failure here must not block the rename itself, but it MUST be
 * reported (`failed`): renaming without link updates silently breaks
 * vault-wide links.
 */
export async function planLinkUpdates(
  queryService: LinkUpdateQuery,
  oldPath: string,
  newPath: string
): Promise<{ plan: LinkUpdatePlan; failed: boolean }> {
  let backlinks: { source_path: string; target_path: string; property_key?: string | null }[] = [];
  let allPaths: string[] = [];
  let failed = false;
  try {
    backlinks = await queryService.getBacklinks(oldPath);
    const rows = await queryService.db.query<{ path: string }>(`SELECT path FROM files`);
    allPaths = rows.map((r) => r.path);
  } catch (e) {
    console.warn("[renameNote] collecting backlinks failed — renaming without link updates", e);
    failed = true;
  }
  const plan: LinkUpdatePlan = { oldPath, newPath, sources: [] };
  if (backlinks.length === 0) return { plan, failed };

  const newBasename = newPath.split(/[/\\]/).pop()!;
  const isNote = newBasename.toLowerCase().endsWith(".md");
  const newBase = newBasename.replace(/\.md$/i, "");
  const newWikiQualified = newPath.replace(/\.md$/i, "");
  // Bare wikilinks resolve by basename vault-wide: qualify when the new
  // basename is not unique (e.g. many index.md files). Non-.md renames keep
  // their extension in the link text (`[[Tasks.base]]`), so their collision
  // check compares the full basename instead of the `.md`-appended stem.
  const collisionKey = isNote ? `${newBase.toLowerCase()}.md` : newBasename.toLowerCase();
  const baseCollision = allPaths.some(
    (p) =>
      p !== oldPath &&
      p !== newPath &&
      p.split(/[/\\]/).pop()?.toLowerCase() === collisionKey
  );

  const newTargetFor = (raw: string): string => {
    if (raw.toLowerCase().endsWith(".md")) {
      // Markdown-style link: keep the extension; same-directory rename keeps
      // relative references valid via the plain new file name.
      return raw.includes("/") ? newPath : `${newBase}.md`;
    }
    if (raw.includes("/")) return newWikiQualified;
    return baseCollision ? newWikiQualified : newBase;
  };

  // Group raw targets per source file, split into body links and frontmatter
  // relation links (links.property_key names the affected key). The renamed
  // file's own links keep working (self-references resolve within the new file).
  const bySource = new Map<string, { bodyRaws: Set<string>; fmRenames: Map<string, Set<string>> }>();
  for (const link of backlinks) {
    const source = link.source_path === oldPath ? newPath : link.source_path;
    if (!bySource.has(source)) bySource.set(source, { bodyRaws: new Set(), fmRenames: new Map() });
    const entry = bySource.get(source)!;
    if (link.property_key) {
      if (!entry.fmRenames.has(link.property_key)) entry.fmRenames.set(link.property_key, new Set());
      entry.fmRenames.get(link.property_key)!.add(link.target_path);
    } else {
      entry.bodyRaws.add(link.target_path);
    }
  }
  for (const [path, entry] of bySource) {
    const frontmatter: FrontmatterLinkRename[] = [];
    for (const [key, raws] of entry.fmRenames) {
      for (const raw of raws) frontmatter.push({ key, oldTarget: raw, newTarget: newTargetFor(raw) });
    }
    plan.sources.push({ path, body: [...entry.bodyRaws].map((raw) => ({ raw, target: newTargetFor(raw) })), frontmatter });
  }
  return { plan, failed };
}

/** Rewrites the referencing files of a plan. Safe to run twice. */
export async function applyLinkUpdates(
  adapter: Pick<RenameAdapter, "readTextFile" | "writeTextFile">,
  plan: LinkUpdatePlan
): Promise<{ renamedLinks: number; changedFiles: number; changedPaths: string[]; failed: boolean }> {
  let renamedLinks = 0;
  let changedFiles = 0;
  let failed = false;
  const changedPaths: string[] = [];
  for (const source of plan.sources) {
    try {
      let text = await adapter.readTextFile(source.path);

      let bodyCount = 0;
      if (source.body.length > 0) {
        // preserveObsidianSyntax keeps wikilinks/embeds as retargetable nodes
        // and guarantees they serialize back byte-identically.
        const ast = parseMarkdownAst(text, { preserveObsidianSyntax: true });
        for (const { raw, target } of source.body) bodyCount += renameVaultLink(ast, raw, target);
        if (bodyCount > 0) text = serializeMarkdownAst(ast);
      }

      let fmCount = 0;
      if (source.frontmatter.length > 0) {
        try {
          const res = renameFrontmatterWikiLinks(text, source.frontmatter);
          text = res.content;
          fmCount = res.renamed;
        } catch (e) {
          // Never lose the body-side fix over unparseable frontmatter.
          console.warn(`[renameNote] frontmatter link update in ${source.path} failed`, e);
        }
      }

      if (bodyCount + fmCount > 0) {
        await adapter.writeTextFile(source.path, text);
        renamedLinks += bodyCount + fmCount;
        changedFiles++;
        changedPaths.push(source.path);
      }
    } catch (e) {
      console.warn(`[renameNote] updating links in ${source.path} failed`, e);
      failed = true;
    }
  }
  return { renamedLinks, changedFiles, changedPaths, failed };
}

export async function renameFileWithLinkUpdates(opts: {
  adapter: RenameAdapter;
  queryService: VaultQueryService;
  oldPath: string;
  newPath: string;
}): Promise<RenameResult> {
  const { adapter, queryService, oldPath, newPath } = opts;

  const { plan, failed: planFailed } = await planLinkUpdates(queryService, oldPath, newPath);

  await adapter.renameItem(oldPath, newPath);

  // Pinboard arrangements carry vault-relative PATHS (plan Pinboard P5):
  // retarget them in every affected `.base` so the card keeps its position and
  // pin. Shared here so desktop and mobile renames sweep alike (the
  // templateFor lesson); failures never block the rename.
  let sweptBases: string[] = [];
  try {
    sweptBases = await sweepPinboardRefs({ adapter, queryService }, [{ from: oldPath, to: newPath }]);
  } catch (e) {
    console.warn("[renameNote] pinboard sweep failed", e);
  }

  if (plan.sources.length === 0) return { renamedLinks: 0, changedFiles: 0, linkUpdateFailed: planFailed, changedPaths: sweptBases };

  const applied = await applyLinkUpdates(adapter, plan);
  const changedPaths = [...applied.changedPaths];
  for (const p of sweptBases) if (!changedPaths.includes(p)) changedPaths.push(p);
  return {
    renamedLinks: applied.renamedLinks,
    changedFiles: applied.changedFiles,
    linkUpdateFailed: planFailed || applied.failed,
    changedPaths,
  };
}
