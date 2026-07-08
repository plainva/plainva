import {
  parseMarkdownAst,
  serializeMarkdownAst,
  renameVaultLink,
  renameFrontmatterWikiLinks,
  type FrontmatterLinkRename,
  type VaultQueryService,
} from "@plainva/core";

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
}

export async function renameFileWithLinkUpdates(opts: {
  adapter: RenameAdapter;
  queryService: VaultQueryService;
  oldPath: string;
  newPath: string;
}): Promise<RenameResult> {
  const { adapter, queryService, oldPath, newPath } = opts;

  // Collect referencing links BEFORE the rename — the index still points at
  // oldPath. A failure here must not block the rename itself, but it MUST be
  // reported: renaming without link updates silently breaks vault-wide links.
  let backlinks: { source_path: string; target_path: string; property_key?: string | null }[] = [];
  let allPaths: string[] = [];
  let linkUpdateFailed = false;
  try {
    backlinks = await queryService.getBacklinks(oldPath);
    const rows = await queryService.db.query<{ path: string }>(`SELECT path FROM files`);
    allPaths = rows.map((r) => r.path);
  } catch (e) {
    console.warn("[renameNote] collecting backlinks failed — renaming without link updates", e);
    linkUpdateFailed = true;
  }

  await adapter.renameItem(oldPath, newPath);

  if (backlinks.length === 0) return { renamedLinks: 0, changedFiles: 0, linkUpdateFailed };

  const newBase = newPath.split(/[/\\]/).pop()!.replace(/\.md$/i, "");
  const newWikiQualified = newPath.replace(/\.md$/i, "");
  // Bare wikilinks resolve by basename vault-wide: qualify when the new
  // basename is not unique (e.g. many index.md files).
  const baseCollision = allPaths.some(
    (p) =>
      p !== oldPath &&
      p !== newPath &&
      p.split(/[/\\]/).pop()?.toLowerCase() === `${newBase.toLowerCase()}.md`
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

  let renamedLinks = 0;
  let changedFiles = 0;
  for (const [source, entry] of bySource) {
    try {
      let text = await adapter.readTextFile(source);

      let bodyCount = 0;
      if (entry.bodyRaws.size > 0) {
        // preserveObsidianSyntax keeps wikilinks/embeds as retargetable nodes
        // and guarantees they serialize back byte-identically.
        const ast = parseMarkdownAst(text, { preserveObsidianSyntax: true });
        for (const raw of entry.bodyRaws) {
          bodyCount += renameVaultLink(ast, raw, newTargetFor(raw));
        }
        if (bodyCount > 0) text = serializeMarkdownAst(ast);
      }

      let fmCount = 0;
      if (entry.fmRenames.size > 0) {
        try {
          const fmRenameList: FrontmatterLinkRename[] = [];
          for (const [key, raws] of entry.fmRenames) {
            for (const raw of raws) fmRenameList.push({ key, oldTarget: raw, newTarget: newTargetFor(raw) });
          }
          const res = renameFrontmatterWikiLinks(text, fmRenameList);
          text = res.content;
          fmCount = res.renamed;
        } catch (e) {
          // Never lose the body-side fix over unparseable frontmatter.
          console.warn(`[renameNote] frontmatter link update in ${source} failed`, e);
        }
      }

      if (bodyCount + fmCount > 0) {
        await adapter.writeTextFile(source, text);
        renamedLinks += bodyCount + fmCount;
        changedFiles++;
      }
    } catch (e) {
      console.warn(`[renameNote] updating links in ${source} failed`, e);
      linkUpdateFailed = true;
    }
  }

  return { renamedLinks, changedFiles, linkUpdateFailed };
}
