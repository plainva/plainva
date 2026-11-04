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
  resolveLinkRow,
  buildLinkTargetIndex,
  VaultFileExistsError,
  type TextUpdateFiles,
  type FrontmatterLinkRename,
  type IndexCandidate,
  type LinkRecord,
  type VaultQueryService,
  type WikilinkConversionResult,
} from "@plainva/core";
import { backupIndexFile, generateIndexForFolder, listMarkdownPaths } from "./indexMdGenerate";
import { applyLinkUpdates, pathFromFolder, planLinkUpdates, renameFileWithLinkUpdates, type LinkUpdatePlan, type RenameAdapter } from "./renameNote";


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
  /**
   * What the shell's own rename does once a note has moved — its bookmarks,
   * its open tabs, its drafts — run as soon as the note is at its new path
   * (Sammelplan § 3.135 Nr. 1). An adoption moved the note past all of it: a
   * bookmark on the overview pointed at the old path afterwards. Required, so
   * no shell can adopt without it.
   */
  afterMove: (from: string, to: string) => Promise<void>;
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
  await opts.afterMove(candidatePath, indexPath);

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
 * could not convert, the wikilinks it did not convert because they stand in a
 * link's label, and the links to a section of the note itself, which lead
 * where they led (counted on their own, Sammelplan § 3.135 Nr. 2: they read
 * as "unresolvable"). `pinned` is the number of links to other overviews
 * written with their folder on the way (`planOverviewLinkPins`).
 */
export function adoptionSummary(t: TFunction, file: string, result: AdoptionResult, pinned = 0): string {
  const extras: string[] = [];
  if (result.renamedLinks > 0) extras.push(t("indexMd.resultLinks", { links: result.renamedLinks, files: result.changedFiles }));
  if (pinned > 0) extras.push(t("indexMd.resultPinned", { links: pinned }));
  const left = result.preparation;
  if (left && (left.embeds > 0 || left.unresolved > 0)) extras.push(t("indexMd.resultPrepLeftovers", { embeds: left.embeds, unresolved: left.unresolved }));
  if (left && left.inLabels > 0) extras.push(t("indexMd.resultPrepInLabels", { links: left.inLabels }));
  if (left && left.sectionLinks > 0) extras.push(t("indexMd.resultPrepSectionLinks", { links: left.sectionLinks }));
  return `${t("indexMd.resultAdopted", { file })}${extras.length ? ` (${extras.join("; ")})` : ""}`;
}

/**
 * Where an overview lands: a note adopted as the folder's `index.md`
 * (`candidatePath` moves to `indexPath`), or a listing generated there
 * (no `candidatePath`: a new file at `indexPath`, where none is yet).
 */
export interface OverviewPlacement {
  indexPath: string;
  candidatePath?: string;
}

/**
 * The overviews a generation writes — "Create overview" for one folder, or
 * every folder without one at once —, as the placements `planOverviewLinkPins`
 * reads (P21): a generated `index.md` takes a bare link over like an adopted one.
 */
export function newOverviewPlacements(folders: readonly string[]): OverviewPlacement[] {
  return folders.map((folder) => ({ indexPath: folder ? `${folder}/index.md` : "index.md" }));
}

/** The links to other overviews an adoption would take over, and the way each keeps its own. */
export interface OverviewLinkPins {
  /** The rewrites, as a rename's plan: each link written with the folder of the overview it leads to. */
  plan: LinkUpdatePlan;
  /** How many links that is — what the offer counts. */
  links: number;
  /** Some links could not be read or cannot be written so that they keep leading there. */
  failed: boolean;
}

/**
 * The links an adoption would let tip over to the new overview, and how each
 * keeps leading where it leads (Sammelplan § 3.135 Nr. 6).
 *
 * `index.md` is the name of every folder's overview. A link that names one
 * only by that name — `[[index]]`, `[[index#Part]]`, `[x](index.md)` — leads
 * wherever the link rule finds an `index.md` first: the vault's own (step 2),
 * the one in the linking note's folder, the shortest path. Since 13b a rename
 * writes a link to a folder's overview with its folder; links written before,
 * or by Obsidian, still name it bare and tip over as soon as an adoption puts
 * a new `index.md` where the rule looks first — an adoption at the vault's
 * root takes them all.
 *
 * Read against the index before anything is written: where every link that
 * names an `index.md` leads now, and where it leads once the adopted notes are
 * at their new paths. A link that changes its way — and leads to another file
 * than the adopted note, whose links the rename itself follows — is written
 * with the folder of the overview it leads to now (`[[Projects/index]]`, for a
 * Markdown link the path from its note's folder), so the rule reads it back
 * there. A link no such name brings back is left and counted in `failed`, as
 * is a name a wiki link cannot carry (`applyLinkUpdates` says so).
 *
 * A generated overview (a placement without `candidatePath`, P21) is a new
 * file at its path and takes such links over the same way; one run's
 * placements — adopted and generated, in every folder of the run — are read
 * together, since a link may be taken over by any of them. An overview that is
 * there already (in any spelling: the file system does not tell them apart)
 * is regenerated in place and takes nothing over.
 *
 * The plan is applied BEFORE the adoptions and generations
 * (`pinOverviewLinks`): a link written with its folder leads there whatever
 * else the run changes, so a pinned link is right even where an adoption is
 * refused afterwards.
 */
export async function planOverviewLinkPins(
  queryService: Pick<VaultQueryService, "linkTargets" | "linksNamingFile">,
  placements: readonly OverviewPlacement[],
): Promise<OverviewLinkPins> {
  const plan: LinkUpdatePlan = { oldPath: "", newPath: "", sources: [] };
  if (placements.length === 0) return { plan, links: 0, failed: false };
  let files: Awaited<ReturnType<VaultQueryService["linkTargets"]>>;
  let rows: LinkRecord[];
  try {
    files = await queryService.linkTargets();
    rows = await queryService.linksNamingFile("index.md");
  } catch (e) {
    console.warn("[indexMd] reading the links to the overviews failed", e);
    return { plan, links: 0, failed: true };
  }
  const moved = new Map(placements.flatMap((p) => (p.candidatePath ? [[p.candidatePath, p.indexPath] as const] : [])));
  const landsAt = (path: string) => moved.get(path) ?? path;
  const before = buildLinkTargetIndex(files);
  const afterFiles: { path: string; title: string | null; mode?: string | null }[] = files.map((file) => (moved.has(file.path) ? { ...file, path: moved.get(file.path)! } : file));
  const present = new Set(afterFiles.map((file) => file.path.normalize("NFC").toLowerCase()));
  for (const placement of placements) {
    const key = placement.indexPath.normalize("NFC").toLowerCase();
    if (placement.candidatePath || present.has(key)) continue;
    present.add(key);
    afterFiles.push({ path: placement.indexPath, title: null, mode: null });
  }
  const after = buildLinkTargetIndex(afterFiles);

  const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const bySource = new Map<string, { body: Map<string, { raw: string; target: string; kind: "wiki" | "markdown" }>; frontmatter: Map<string, FrontmatterLinkRename> }>();
  let links = 0;
  let failed = false;
  for (const row of rows) {
    const linkType = row.property_key ? null : row.link_type;
    const was = resolveLinkRow(row.source_path, row.target_path, linkType, before);
    // Nowhere before, or the adopted note itself: the rename follows that one.
    if (was === null || moved.has(was)) continue;
    const from = landsAt(row.source_path);
    if (resolveLinkRow(from, row.target_path, linkType, after) === was) continue;
    const markdown = linkType === "markdown-link";
    const target = markdown ? pathFromFolder(folderOf(from), was) : /\.md$/i.test(row.target_path) ? was : was.replace(/\.md$/i, "");
    if (resolveLinkRow(from, target, linkType, after) !== was) {
      failed = true;
      continue;
    }
    if (!bySource.has(row.source_path)) bySource.set(row.source_path, { body: new Map(), frontmatter: new Map() });
    const source = bySource.get(row.source_path)!;
    if (row.property_key) source.frontmatter.set(`${row.property_key}\n${row.target_path}`, { key: row.property_key, oldTarget: row.target_path, newTarget: target });
    else source.body.set(`${markdown ? "markdown" : "wiki"}\n${row.target_path}`, { raw: row.target_path, target, kind: markdown ? "markdown" : "wiki" });
    links++;
  }
  for (const [path, source] of bySource) plan.sources.push({ path, body: [...source.body.values()], frontmatter: [...source.frontmatter.values()] });
  return { plan, links, failed };
}

/**
 * Writes the links of `planOverviewLinkPins` with their folder — before the
 * adoptions, while every source is still at the path the plan names. What
 * the shells report: how many links, which notes changed (an open editor of
 * one is told), and whether a link was left as it was.
 */
export async function pinOverviewLinks(
  adapter: TextUpdateFiles,
  pins: OverviewLinkPins,
): Promise<{ pinned: number; changedPaths: string[]; failed: boolean }> {
  if (pins.plan.sources.length === 0) return { pinned: 0, changedPaths: [], failed: pins.failed };
  const applied = await applyLinkUpdates(adapter, pins.plan);
  return { pinned: applied.renamedLinks, changedPaths: applied.changedPaths, failed: pins.failed || applied.failed };
}

/**
 * The offer before overviews are generated (P21, maintainer 03.11.), as both
 * shells make it — "Create overview" for one folder, and generating in every
 * folder without one at once on the phone. The desktop's index.md manager asks
 * it in its own list (a checkbox beside the run) and calls the two steps itself.
 *
 * Counts the links the new overviews would take over (`planOverviewLinkPins`,
 * all placements together). Nothing to offer: nothing is asked. Otherwise
 * `ask` gets the count and answers whether to write them (`null`: the person
 * cancelled — then nothing is generated either). A yes writes them before any
 * overview exists, read again (the count may be older than the vault), and
 * tells `changed` each note it wrote, for an open editor of it.
 */
export async function pinLinksBeforeOverviews(opts: {
  queryService: Pick<VaultQueryService, "linkTargets" | "linksNamingFile">;
  adapter: TextUpdateFiles;
  placements: readonly OverviewPlacement[];
  ask: (links: number) => Promise<boolean | null>;
  changed: (path: string) => void;
}): Promise<{ pinned: number; failed: boolean } | null> {
  const offered = (await planOverviewLinkPins(opts.queryService, opts.placements)).links;
  if (offered === 0) return { pinned: 0, failed: false };
  const yes = await opts.ask(offered);
  if (yes === null) return null;
  if (!yes) return { pinned: 0, failed: false };
  const done = await pinOverviewLinks(opts.adapter, await planOverviewLinkPins(opts.queryService, opts.placements));
  for (const path of done.changedPaths) opts.changed(path);
  return { pinned: done.pinned, failed: done.failed };
}

/** A result line that also counts the links written with their folder on the way (`indexMd.resultPinned`). */
export function withPinnedLinks(t: TFunction, text: string, pinned: number): string {
  return pinned > 0 ? `${text} (${t("indexMd.resultPinned", { links: pinned })})` : text;
}
