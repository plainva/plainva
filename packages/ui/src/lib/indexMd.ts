import type { TFunction } from "i18next";
import {
  ConflictError,
  findIndexCandidates,
  convertWikilinksToMarkdownLinks,
  frontmatterSpan,
  isPlainvaManagedIndex,
  isReservedOkfName,
  noteWithoutProperties,
  replaceVaultText,
  VaultFileExistsError,
  type FrontmatterLinkRename,
  type IndexCandidate,
  type LinkRecord,
  type VaultQueryService,
  type WikilinkConversionResult,
} from "@plainva/core";
import { backupIndexFile, generateIndexForFolder, listMarkdownPaths } from "./indexMdGenerate";
import { applyLinkUpdates, planLinkUpdates, renameFileWithLinkUpdates, type LinkUpdatePlan, type RenameAdapter } from "./renameNote";

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
        // A block that declares nothing makes no concept document of the file.
        const block = frontmatterSpan(content)?.yaml.trim() ?? "";
        // Root may carry exactly okf_version; anything else is a violation.
        if (block) indexIsConcept = folder !== "" || !/^\s*okf_version\s*:/.test(block) || block.split(/\r?\n/).length > 1;
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
  /**
   * A link to the adopted note could not be checked or rewritten where it
   * stands, so it may still name the old file. Said by both shells, as after
   * any rename — an adoption used to pass it over.
   */
  linkUpdateFailed: boolean;
  preparation?: WikilinkConversionResult;
}

/**
 * The links that reach a note only by the `title` of its properties — the
 * last step of the link rule —, as a plan that lets them name the file the
 * note becomes.
 *
 * A rename leaves such links alone, because it leaves the title alone: they
 * keep leading there. Preparing an overview takes the properties block out,
 * and the title with it — `[[Projects Map]]` in another note led nowhere
 * afterwards (finding 2026-10-12). They are what the note's backlinks hold
 * beyond the links the rename itself plans to rewrite; read off that plan, so
 * the two can never both claim a link, nor both leave one. Afterwards such a
 * link names the file as the rename names a link that named it by its name:
 * by the overview's path, `[[Projects/index]]` — `[[index]]` for the vault's
 * own. No alias is put in for the title it used to show — a rename writes
 * none either.
 *
 * Has to be read while the index still holds the title: before the prepared
 * note is written.
 */
async function planLinksByTitle(queryService: VaultQueryService, oldPath: string, newPath: string): Promise<{ plan: LinkUpdatePlan; failed: boolean }> {
  const plan: LinkUpdatePlan = { oldPath, newPath, sources: [] };
  const byName = await planLinkUpdates(queryService, oldPath, newPath);
  if (byName.failed) return { plan, failed: true };
  let backlinks: LinkRecord[];
  try {
    backlinks = await queryService.getBacklinks(oldPath);
  } catch (e) {
    console.warn("[indexMd] collecting the links by title failed", e);
    return { plan, failed: true };
  }
  const landsAt = (source: string) => (source === oldPath ? newPath : source);
  const planned = new Map(byName.plan.sources.map((source) => [source.path, source]));
  const isPlanned = (link: LinkRecord): boolean => {
    const source = planned.get(landsAt(link.source_path));
    if (!source) return false;
    return link.property_key
      ? source.frontmatter.some((entry) => entry.key === link.property_key && entry.oldTarget === link.target_path)
      : source.body.some((entry) => entry.raw === link.target_path);
  };
  const byTitle = backlinks.filter((link) => !isPlanned(link));
  if (byTitle.length === 0) return { plan, failed: false };

  const target = byName.bareTarget;
  const sources = new Map<string, { body: Set<string>; frontmatter: Map<string, FrontmatterLinkRename> }>();
  for (const link of byTitle) {
    const path = landsAt(link.source_path);
    if (!sources.has(path)) sources.set(path, { body: new Set(), frontmatter: new Map() });
    const source = sources.get(path)!;
    if (link.property_key) source.frontmatter.set(`${link.property_key}\n${link.target_path}`, { key: link.property_key, oldTarget: link.target_path, newTarget: target });
    else source.body.add(link.target_path);
  }
  for (const [path, source] of sources) {
    plan.sources.push({ path, body: [...source.body].map((raw) => ({ raw, target })), frontmatter: [...source.frontmatter.values()] });
  }
  return { plan, failed: false };
}

/**
 * Adopts an existing overview note as the folder's index.md — always
 * user-driven. Optional preparation makes it spec-shaped: frontmatter removed
 * (backup first), this file's wikilinks converted to relative markdown links
 * (embeds/unresolved stay and are reported). The rename retargets all links
 * pointing at the old name (W5).
 *
 * Preparation changes those two things and nothing else (finding 2026-10-09):
 * the properties block goes by the rule every writer follows when a block
 * goes, each converted link is replaced where it stands, and the rest of the
 * note — list markers, emphasis, tables, blank lines, line ends, a byte order
 * mark — stays byte for byte. The note used to be written back from its
 * parsed tree, which reformatted all of it.
 *
 * And preparing breaks no link (finding 2026-10-12). The note is prepared for
 * the name it takes: a link of the note to itself is written to `./index.md`
 * when it is converted — the rename's plan is read from the index, which
 * still knows the note with its wikilinks, and could not follow a link that
 * had become a Markdown link in between. A link that reached the note by the
 * title of its properties is let name the file, because the title goes with
 * the block (`planLinksByTitle`); where no wiki link can carry that name
 * (`C# Notes/index`), it is left and said, like every link the rename cannot
 * rewrite. And the name has to be free before anything is written: a rename
 * refused afterwards left a note without its properties under its old name.
 * ADR 0003, addendum 2026-10-21.
 */
export async function adoptFileAsIndex(opts: {
  adapter: IndexMdAdapter;
  queryService: VaultQueryService;
  candidatePath: string;
  folder: string;
  prepare: boolean;
}): Promise<AdoptionResult> {
  const { adapter, queryService, candidatePath, folder, prepare } = opts;
  const indexPath = folder ? `${folder}/index.md` : "index.md";
  if (await adapter.exists(indexPath)) throw new VaultFileExistsError(indexPath);

  let preparation: WikilinkConversionResult | undefined;
  let byTitle: { plan: LinkUpdatePlan; failed: boolean } | undefined;
  if (prepare) {
    // A note with an open conflict is not moved, nor is one moved onto a path
    // that has one: the vault's chain refuses the rename below. Asked first —
    // prepared and then left under its old name, the note would be neither
    // what it was nor an overview.
    for (const path of [candidatePath, indexPath]) {
      const open = await adapter.getConflictSession?.(path);
      if (open) throw new ConflictError("Resolve the open conflict before moving or deleting this file or folder", open.workingCopyPath);
    }
    byTitle = await planLinksByTitle(queryService, candidatePath, indexPath);
    // A wiki link is resolved by the link rule over the whole vault, title
    // included — where it leads in the editor. It becomes a Markdown link only
    // where that is one of the notes a listing may point at; resolving over
    // those notes alone made a link lead to ANOTHER note of the same name
    // whenever the one it means is not among them.
    const only = new Set(await listMarkdownPaths(queryService));
    const allFilePaths = await queryService.linkTargets();
    // The backup holds exactly the text that is replaced: the note is written
    // only if it still is the text that was backed up and prepared, and
    // prepared anew where it changed meanwhile (`replaceVaultText`). A note
    // without a block and without a link to convert is as it has to be:
    // nothing is written.
    await replaceVaultText(adapter, candidatePath, async (content) => {
      await backupIndexFile(adapter, candidatePath, content);
      const prepared = convertWikilinksToMarkdownLinks(noteWithoutProperties(content), { sourcePath: candidatePath, becomes: indexPath, allFilePaths, only });
      preparation = prepared.result;
      return prepared.content;
    });
  }

  const renamed = await renameFileWithLinkUpdates({
    adapter,
    queryService,
    oldPath: candidatePath,
    newPath: indexPath,
  });

  let { renamedLinks, changedFiles, linkUpdateFailed } = renamed;
  if (byTitle) {
    const titled = byTitle.plan.sources.length > 0 ? await applyLinkUpdates(adapter, byTitle.plan) : null;
    if (titled) {
      renamedLinks += titled.renamedLinks;
      changedFiles += titled.changedPaths.filter((path) => !renamed.changedPaths.includes(path)).length;
    }
    linkUpdateFailed = linkUpdateFailed || byTitle.failed || (titled?.failed ?? false);
  }

  return { indexPath, renamedLinks, changedFiles, linkUpdateFailed, preparation };
}

/**
 * What an adoption did, in the one line both shells show: the desktop's
 * dialog in its list of results, the phone in its notice. The numbers a
 * preparation leaves behind are part of it — the embeds and the wikilinks it
 * could not convert, and the wikilinks it did not convert because they stand
 * in a link's label.
 */
export function adoptionSummary(t: TFunction, file: string, result: AdoptionResult): string {
  const extras: string[] = [];
  if (result.renamedLinks > 0) extras.push(t("indexMd.resultLinks", { links: result.renamedLinks, files: result.changedFiles }));
  const left = result.preparation;
  if (left && (left.embeds > 0 || left.unresolved > 0)) extras.push(t("indexMd.resultPrepLeftovers", { embeds: left.embeds, unresolved: left.unresolved }));
  if (left && left.inLabels > 0) extras.push(t("indexMd.resultPrepInLabels", { links: left.inLabels }));
  return `${t("indexMd.resultAdopted", { file })}${extras.length ? ` (${extras.join("; ")})` : ""}`;
}
