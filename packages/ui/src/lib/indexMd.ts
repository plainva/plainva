import {
  findIndexCandidates,
  convertWikilinksToMarkdownLinks,
  isPlainvaManagedIndex,
  isReservedOkfName,
  parseMarkdownAst,
  serializeMarkdownAst,
  type IndexCandidate,
  type VaultQueryService,
  type WikilinkConversionResult,
} from "@plainva/core";
import { backupIndexFile, generateIndexForFolder, listMarkdownPaths } from "./indexMdGenerate";
import { renameFileWithLinkUpdates, type RenameAdapter } from "./renameNote";

// Generation moved into @plainva/ui (2026-08-20) so the phone shares it;
// re-exported so every existing import path keeps working and the unchanged
// tests next to this file stay the proof that behaviour did not change.
export { generateIndexForFolder };

/**
 * Orchestration for OKF index.md files, shared by both shells (lifted from the
 * desktop 2026-08-21 for P6 — it was adapter-neutral all along, so the phone
 * gets the same rules rather than a second set. The desktop's unchanged tests
 * next to its stub are the proof that lifting changed no behaviour).
 *
 * Originally: desktop orchestration for OKF index.md files (Gesamtplan W7): folder
 * overview for the manager modal, spec-shaped generation, and the user-driven
 * adoption of an existing overview note (rename via W5, optional preparation).
 */

export interface IndexMdAdapter extends RenameAdapter {
  createDir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

const FM_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

export interface FolderIndexInfo {
  /** "" for the vault root. */
  folder: string;
  fileCount: number;
  hasIndex: boolean;
  /** index.md exists but carries frontmatter — a reserved-name violation. */
  indexIsConcept: boolean;
  candidates: IndexCandidate[];
}

/** Folders that have no index.md yet — the "create in all folders without one"
 *  bulk action (WP4). Pure so the modal and its test share the selection. */
export function foldersMissingIndex(infos: Pick<FolderIndexInfo, "folder" | "hasIndex">[]): string[] {
  return infos.filter((i) => !i.hasIndex).map((i) => i.folder);
}

/**
 * What a folder's overview is: absent, Plainva's, or the user's own.
 *
 * One question with one answer, because three surfaces ask it and they must
 * not disagree — the folder sheet (which action to offer, or none), the
 * overviews list, and the read-only banner on an open index.md. "manual" is
 * the case that matters: a note the user wrote at that path is theirs, so
 * nothing offers to overwrite it in passing. Adopting it is a named decision
 * in the list, never a side effect of a tap.
 */
export type FolderIndexState = "missing" | "managed" | "manual";

export async function folderIndexState(
  adapter: Pick<IndexMdAdapter, "readTextFile">,
  folder: string,
): Promise<FolderIndexState> {
  const path = folder ? `${folder}/index.md` : "index.md";
  let content: string;
  try {
    content = await adapter.readTextFile(path);
  } catch {
    return "missing";
  }
  return isPlainvaManagedIndex(content) ? "managed" : "manual";
}

function folderOfPath(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/** Groups the vault's markdown files by folder and ranks index.md candidates. */
export async function collectFolderIndexInfos(opts: {
  queryService: VaultQueryService;
  adapter: Pick<IndexMdAdapter, "readTextFile">;
}): Promise<FolderIndexInfo[]> {
  const paths = await listMarkdownPaths(opts.queryService);
  const byFolder = new Map<string, string[]>();
  for (const path of paths) {
    const folder = folderOfPath(path);
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder)!.push(path.split("/").pop()!);
  }
  // Every ancestor folder appears too (a folder holding only subfolders can
  // still get a generated listing).
  for (const folder of [...byFolder.keys()]) {
    let current = folder;
    while (current.includes("/")) {
      current = current.slice(0, current.lastIndexOf("/"));
      if (!byFolder.has(current)) byFolder.set(current, []);
    }
    if (folder !== "" && !byFolder.has("")) byFolder.set("", []);
  }

  const infos: FolderIndexInfo[] = [];
  for (const [folder, names] of byFolder) {
    const hasIndex = names.some((n) => n.toLowerCase() === "index.md");
    let indexIsConcept = false;
    if (hasIndex) {
      try {
        const content = await opts.adapter.readTextFile(folder ? `${folder}/index.md` : "index.md");
        indexIsConcept = FM_RE.test(content) && folder !== "";
        if (folder === "" && FM_RE.test(content)) {
          // Root may carry exactly okf_version; anything else is a violation.
          const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
          indexIsConcept = !/^\s*okf_version\s*:/.test(block) || block.trim().split(/\r?\n/).length > 1;
        }
      } catch {
        /* unreadable — leave flags conservative */
      }
    }
    infos.push({
      folder,
      fileCount: names.filter((n) => !isReservedOkfName(n)).length,
      hasIndex,
      indexIsConcept,
      candidates: findIndexCandidates(folder, names),
    });
  }

  return infos.sort((a, b) => (a.folder === "" ? -1 : b.folder === "" ? 1 : a.folder.localeCompare(b.folder)));
}

export interface AdoptionResult {
  indexPath: string;
  renamedLinks: number;
  changedFiles: number;
  preparation?: WikilinkConversionResult;
}

/**
 * Adopts an existing overview note as the folder's index.md — always
 * user-driven. Optional preparation makes it spec-shaped: frontmatter removed
 * (backup first), this file's wikilinks converted to relative markdown links
 * (embeds/unresolved stay and are reported). The rename retargets all links
 * pointing at the old name (W5).
 */
export async function adoptFileAsIndex(opts: {
  adapter: IndexMdAdapter;
  queryService: VaultQueryService;
  candidatePath: string;
  folder: string;
  prepare: boolean;
}): Promise<AdoptionResult> {
  const { adapter, queryService, candidatePath, folder, prepare } = opts;

  let preparation: WikilinkConversionResult | undefined;
  if (prepare) {
    const content = await adapter.readTextFile(candidatePath);
    await backupIndexFile(adapter, candidatePath, content);
    const body = content.replace(FM_RE, "");
    const ast = parseMarkdownAst(body, { preserveObsidianSyntax: true });
    const allFilePaths = await listMarkdownPaths(queryService);
    preparation = convertWikilinksToMarkdownLinks(ast, { sourcePath: candidatePath, allFilePaths });
    await adapter.writeTextFile(candidatePath, serializeMarkdownAst(ast));
  }

  const indexPath = folder ? `${folder}/index.md` : "index.md";
  const renamed = await renameFileWithLinkUpdates({
    adapter,
    queryService,
    oldPath: candidatePath,
    newPath: indexPath,
  });

  return { indexPath, renamedLinks: renamed.renamedLinks, changedFiles: renamed.changedFiles, preparation };
}
