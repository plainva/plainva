import {
  buildLinkTargetIndex,
  explicitLinkPath,
  resolveLinkRow,
  rewriteNoteLinks,
  renameFrontmatterWikiLinks,
  updateVaultText,
  type FrontmatterLinkRename,
  type TextUpdateFiles,
  type VaultQueryService,
} from "@plainva/core";
import { sweepPinboardRefs } from "../base/pinboardSweep";

/**
 * Rename a note and retarget every vault link that pointed at it (wikilinks,
 * embeds, markdown links; anchors preserved) — the Alpha-roadmap feature
 * "Umbenennen mit vault-weitem Link-Update", pulled forward for the index.md
 * adoption flow (Gesamtplan OKF/Icons/Header, W5).
 *
 * A note that links to the renamed one changes in the part of each link that
 * names the file, and in nothing else — byte for byte (finding 2026-10-09).
 * The links are rewritten where they stand (`rewriteNoteLinks`, and
 * `renameFrontmatterWikiLinks` for a link in the properties); the note is
 * never written back from a parsed tree, which reformatted all of it.
 *
 * A link is rewritten when it LEADS to the renamed file — by the rule of the
 * way it is written (finding 2026-10-12). A wiki link and a Markdown link of
 * one text may lead to two files: `[[Letter.md]]` in `Projects/Plan.md` is the
 * note at the vault's root, `[x](Letter.md)` the one beside the plan. Until
 * then the backlinks resolved both by the wiki rule and the rewrite changed
 * every link of that text: renaming the note at the root rewrote the entry of
 * a listing that named the note beside it, and renaming THAT note left the
 * entry standing.
 *
 * Assumes a same-directory rename (both call sites — file-tree rename and
 * index.md adoption — only change the file name, never the folder), so a raw
 * target keeps its qualification style: path-qualified raws stay qualified,
 * bare raws stay bare unless the new basename collides with another file in
 * the vault — then they become path-qualified to stay unambiguous — or the new
 * name is a folder's `index.md`, which every folder may hold.
 *
 * Two halves, so a batch can keep what a rename WILL do in a journal and do it
 * again after an interruption (plan Befunde 2026-09-24, E12): `planLinkUpdates`
 * reads the index while it still points at the old name, `applyLinkUpdates`
 * rewrites the referencing files — idempotently, because a link that already
 * points at the new name is not found again.
 */

/**
 * The files a rename works on: a vault's chain, or a storage with nothing
 * above it. Each referencing note is read, changed and written in one step
 * (`updateVaultText`).
 */
export interface RenameAdapter extends TextUpdateFiles {
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
 *
 * `kind` says which links of that text are meant: wiki links and embeds, or
 * Markdown links. A plan written before 2026-10-22 carries none, and means
 * every link of the text.
 */
export interface LinkUpdatePlan {
  oldPath: string;
  newPath: string;
  sources: Array<{
    path: string;
    body: Array<{ raw: string; target: string; kind?: "wiki" | "markdown" }>;
    frontmatter: FrontmatterLinkRename[];
  }>;
}

/** The way a link row of the index is written, as a plan names it. */
const planKind = (linkType: string | null | undefined): "wiki" | "markdown" => (linkType === "markdown-link" ? "markdown" : "wiki");

/** A Markdown link's target that names a folder: it ends in `/`, `.` or `..`. */
function namesFolder(target: string): boolean {
  const trimmed = target.trim();
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return last === "" || last === "." || last === "..";
}

/** The folder a vault path lies in; "" for the vault's root. */
const folderOfPath = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** `toPath` as a path read from `fromFolder`: `Note.md`, `Sub/Note.md`, `../Other/Note.md`. */
function pathFromFolder(fromFolder: string, toPath: string): string {
  const from = fromFolder ? fromFolder.split("/") : [];
  const to = toPath.split("/");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return [...Array<string>(from.length - common).fill(".."), ...to.slice(common)].join("/");
}

/**
 * Collect referencing links BEFORE the rename — the index still points at
 * oldPath. A failure here must not block the rename itself, but it MUST be
 * reported (`failed`): renaming without link updates silently breaks
 * vault-wide links.
 *
 * `bareTarget` is what a wiki link that named the file by its bare name is to
 * name it by afterwards: `Atlas` for `Projects/Atlas.md`, `Projects/index`
 * for a folder's overview. Where a wiki link cannot carry that name
 * (`C# Notes/index`), the rewriter leaves the link and says so.
 */
export async function planLinkUpdates(
  queryService: LinkUpdateQuery,
  oldPath: string,
  newPath: string
): Promise<{ plan: LinkUpdatePlan; failed: boolean; bareTarget: string }> {
  let backlinks: { source_path: string; target_path: string; link_type?: string | null; property_key?: string | null }[] = [];
  let allPaths: string[] = [];
  let failed = false;
  try {
    backlinks = await queryService.getBacklinks(oldPath);
    // A file queued for deletion is no link target (`linkTargets` asks the same).
    const rows = await queryService.db.query<{ path: string }>(`SELECT path FROM files WHERE is_deleted IS NULL OR is_deleted = 0`);
    allPaths = rows.map((r) => r.path);
  } catch (e) {
    console.warn("[renameNote] collecting backlinks failed — renaming without link updates", e);
    failed = true;
  }
  const plan: LinkUpdatePlan = { oldPath, newPath, sources: [] };

  const newBasename = newPath.split(/[/\\]/).pop()!;
  const isNote = newBasename.toLowerCase().endsWith(".md");
  const newBase = newBasename.replace(/\.md$/i, "");
  const newWikiQualified = newPath.replace(/\.md$/i, "");
  // Bare wikilinks resolve by basename vault-wide: qualify when the new
  // basename is not unique (e.g. many index.md files). Non-.md renames keep
  // their extension in the link text (`[[Tasks.base]]`), so their collision
  // check compares the full basename instead of the `.md`-appended stem.
  // Names are compared as the link rule reads them: case and composition aside.
  const nameKey = (text: string) => text.normalize("NFC").toLowerCase();
  const collisionKey = nameKey(isNote ? `${newBase}.md` : newBasename);
  const baseCollision = allPaths.some(
    (p) =>
      p !== oldPath &&
      p !== newPath &&
      nameKey(p.split(/[/\\]/).pop() ?? "") === collisionKey
  );
  // `index.md` is the name every folder's overview has (OKF). A bare
  // `[[index]]` means whichever overview the rule finds first, and that
  // changes as soon as another folder gets one — Plainva writes them folder by
  // folder, in one run before the index knows them (finding 2026-10-21). A
  // link to a folder's overview names its folder, as ADR 0009 (point 6) says
  // of an adoption; the vault's own `index.md` is named by `index` alone.
  // Where a wiki link cannot carry the folder's name (`C# Notes`), no name
  // leads there for sure — not `index` either, which the index may not even
  // know to be taken yet: the link rewriter leaves such a link as it is and
  // says so (`wikiLinkCanName`).
  const overviewOfFolder = isNote && nameKey(newBase) === "index" && /[/\\]/.test(newPath);
  const bareTarget = baseCollision || overviewOfFolder ? newWikiQualified : newBase;

  // Only a link that names the FILE is rewritten. The backlinks also hold
  // links that reach the note by the `title` of its properties (the link
  // rule's last step): a rename leaves that title alone, so such a link keeps
  // leading there — and `[[Angebotsbrief]]` must not turn into the new file
  // name. A link names the file when the rule finds it without any title.
  // A Markdown link is asked the rule for Markdown links (ADR 0027, addendum
  // 2026-10-12): from its note's folder first.
  const byName = buildLinkTargetIndex([...new Set([...allPaths, oldPath])]);
  backlinks = backlinks.filter((link) => resolveLinkRow(link.source_path, link.target_path, link.property_key ? null : link.link_type, byName) === oldPath);
  if (backlinks.length === 0) return { plan, failed, bareTarget };
  // The vault as it will be, for the question a Markdown link's new target
  // has to answer: does it still lead to the renamed file?
  const afterRename = buildLinkTargetIndex([...new Set([...allPaths.filter((p) => p !== oldPath), newPath])]);

  /**
   * A Markdown link names a path, and a rename leaves the file in its folder:
   * only the name at the end of the path changes, however the link reached the
   * file — from its note's folder, from the root or by its name. The vault
   * path that stood here until 2026-10-22 turned `Ablage/Brief.md`, written
   * in `Projekte/Plan.md`, into `Projekte/Ablage/Neu.md`, which reads
   * `Projekte/Projekte/…` from the note. Where the new name leads elsewhere —
   * a file of that name lies nearer —, the path from the linking note's
   * folder is written: the rule reads that one first.
   */
  const newMarkdownTargetFor = (raw: string, source: string): string => {
    const place = raw.slice(0, raw.lastIndexOf("/") + 1);
    const renamed = place + (!isNote || raw.toLowerCase().endsWith(".md") ? newBasename : newBase);
    // `index.md` is the name of every folder's overview, and a bare one is read
    // from the linking note's folder first: it finds THAT folder's overview as
    // soon as there is one - also one written in the same run, which the index
    // does not know yet (review 2026-10-22). The path names this one for sure.
    const overview = isNote && nameKey(newBase) === "index" && !renamed.includes("/");
    if (!overview && resolveLinkRow(source, renamed, "markdown-link", afterRename) === newPath) return renamed;
    return pathFromFolder(folderOfPath(source), newPath);
  };

  const newTargetFor = (raw: string): string => {
    // An explicit path (`./Brief`, `../Ablage/Brief.md`, `/Projekte/Brief`)
    // names a place, and a rename leaves the file in its folder: only the name
    // at the end changes. Such links are found since the link rule reads them
    // (2026-10-09); the vault path the branches below write would make
    // `[x](./Brief.md)` in `Projekte/` read `Projekte/Projekte/…` on the desktop.
    if (explicitLinkPath("", raw) !== undefined) {
      const place = raw.slice(0, raw.lastIndexOf("/") + 1);
      return place + (!isNote || raw.toLowerCase().endsWith(".md") ? newBasename : newBase);
    }
    if (raw.toLowerCase().endsWith(".md")) {
      // Written with the extension — a Markdown link, or a wiki link written
      // so: it keeps it. A reader that takes a Markdown link from the note's
      // folder (GitHub, OKF) finds the file under the plain new name from its
      // own folder. Plainva's link rule reads a bare `index.md` as the vault's
      // own overview where there is one (finding 2026-10-21, not built here):
      // the plan knows a link by its target, not by its kind, and how a
      // Markdown link is read is decided with the rule for Markdown links.
      return raw.includes("/") ? newPath : `${newBase}.md`;
    }
    if (raw.includes("/")) return newWikiQualified;
    return bareTarget;
  };

  // Group raw targets per source file, split into body links and frontmatter
  // relation links (links.property_key names the affected key). The renamed
  // file's own links keep working (self-references resolve within the new file).
  const bySource = new Map<string, { body: Map<string, { raw: string; kind?: "wiki" | "markdown" }>; fmRenames: Map<string, Set<string>> }>();
  for (const link of backlinks) {
    // A row without its kind (a caller that does not read it) means every
    // link of that text, as a plan written before the kinds does.
    const kind = link.link_type ? planKind(link.link_type) : undefined;
    // A Markdown link to a FOLDER (`Ablage/`, `..`) reached the folder's
    // index.md, and names the folder: a rename of that note leaves it a
    // folder link (review 2026-10-22: `Ablage/` became a link to the file).
    if (!link.property_key && kind === "markdown" && namesFolder(link.target_path)) continue;
    const source = link.source_path === oldPath ? newPath : link.source_path;
    if (!bySource.has(source)) bySource.set(source, { body: new Map(), fmRenames: new Map() });
    const entry = bySource.get(source)!;
    if (link.property_key) {
      if (!entry.fmRenames.has(link.property_key)) entry.fmRenames.set(link.property_key, new Set());
      entry.fmRenames.get(link.property_key)!.add(link.target_path);
    } else {
      entry.body.set(`${kind ?? ""}\n${link.target_path}`, { raw: link.target_path, kind });
    }
  }
  for (const [path, entry] of bySource) {
    const frontmatter: FrontmatterLinkRename[] = [];
    for (const [key, raws] of entry.fmRenames) {
      for (const raw of raws) frontmatter.push({ key, oldTarget: raw, newTarget: newTargetFor(raw) });
    }
    const body = [...entry.body.values()].map(({ raw, kind }) => ({ raw, target: kind === "markdown" ? newMarkdownTargetFor(raw, path) : newTargetFor(raw), kind }));
    plan.sources.push({ path, body, frontmatter });
  }
  return { plan, failed, bareTarget };
}

/**
 * The links of a note a plan names, rewritten where they stand: each by the
 * way it is written, so a wiki link and a Markdown link of one text are two
 * entries. `unplaced` counts the links the plan names that could not be
 * rewritten — they still name the old file.
 */
function renamePlannedLinks(text: string, body: LinkUpdatePlan["sources"][number]["body"]): { content: string; renamed: number; unplaced: number } {
  const planned = new Map<string, string>();
  for (const { raw, target, kind } of body) planned.set(`${kind ?? ""}\n${raw}`, target);
  const newTarget = (link: { type: string; target: string }): string | undefined =>
    link.target === "" ? undefined : (planned.get(`${planKind(link.type)}\n${link.target}`) ?? planned.get(`\n${link.target}`));
  const result = rewriteNoteLinks(text, (link) => {
    const target = newTarget(link);
    return target === undefined ? null : { target };
  });
  return { content: result.content, renamed: result.rewritten, unplaced: result.unplaced.filter((link) => newTarget(link) !== undefined).length };
}

/**
 * Rewrites the referencing files of a plan. Safe to run twice.
 *
 * `failed` also says that a link was found and could not be rewritten where
 * it stands (a character reference inside it, a link folded over two lines of
 * a block scalar, a new name the link cannot carry — `wikiLinkCanName`): it
 * still names the old file, and nothing was guessed.
 */
export async function applyLinkUpdates(
  adapter: TextUpdateFiles,
  plan: LinkUpdatePlan
): Promise<{ renamedLinks: number; changedFiles: number; changedPaths: string[]; failed: boolean }> {
  let renamedLinks = 0;
  let changedFiles = 0;
  let failed = false;
  const changedPaths: string[] = [];
  for (const source of plan.sources) {
    const rewritten = (read: string): { renamed: number; left: number; next: string | null } => {
      let text = read;
      let left = 0;

      let bodyCount = 0;
      if (source.body.length > 0) {
        const res = renamePlannedLinks(text, source.body);
        text = res.content;
        bodyCount = res.renamed;
        left += res.unplaced;
      }

      let fmCount = 0;
      if (source.frontmatter.length > 0) {
        try {
          const res = renameFrontmatterWikiLinks(text, source.frontmatter);
          text = res.content;
          fmCount = res.renamed;
          left += res.skipped;
        } catch (e) {
          // Never lose the body-side fix over unparseable frontmatter.
          console.warn(`[renameNote] frontmatter link update in ${source.path} failed`, e);
        }
      }

      return { renamed: bodyCount + fmCount, left, next: bodyCount + fmCount > 0 ? text : null };
    };
    try {
      // Counted on the note as it was changed. Where the note has an open
      // conflict, the links in the user's own version are rewritten the same
      // way — the file they lead to has its new name whichever version is kept.
      const update = await updateVaultText(adapter, source.path, (read) => rewritten(read).next);
      const { renamed, left } = rewritten(update.before);
      if (renamed > 0) {
        renamedLinks += renamed;
        changedFiles++;
        changedPaths.push(source.path);
      }
      if (left > 0) {
        console.warn(`[renameNote] ${left} link(s) in ${source.path} could not be rewritten where they stand`);
        failed = true;
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
