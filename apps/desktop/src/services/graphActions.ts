import { resolveLinkTarget, wikiTargetForPath, type IVaultAdapter, type VaultQueryService } from "@plainva/core";
import { requestSaveFlush } from "./saveFlush";
import { buildNewNoteContent } from "./newNote";

/**
 * Write actions shared by the graph views (accept a suggestion, connect-drag).
 * Every write goes through the FULL adapter chain (backup + sync queue) and is
 * preceded by the save-flush handshake so a pending editor save can never
 * overwrite the change one second later.
 */

/**
 * Appends a wiki link to `sourcePath` pointing at `targetPath` (bare basename
 * when unique, else path-qualified — identical to Plainva's own link writing).
 * Returns the written link text.
 */
export async function appendWikiLink(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  sourcePath: string,
  targetPath: string
): Promise<string> {
  const notes = await queryService.listNotes();
  const allPaths = notes.map((n) => n.path);
  const target = wikiTargetForPath(targetPath, allPaths);
  const link = `[[${target}]]`;

  await requestSaveFlush(sourcePath);
  const current = await adapter.readTextFile(sourcePath);
  const needsBlankLine = current.length > 0 && !current.endsWith("\n\n") ;
  const separator = current.length === 0 ? "" : current.endsWith("\n") ? (needsBlankLine ? "\n" : "") : "\n\n";
  await adapter.writeTextFile(sourcePath, `${current}${separator}${link}\n`);
  return link;
}

const WIKI_LINK_RE = /\[\[([^\]|#]+)(#[^\]|]*)?(\|([^\]]*))?\]\]/g;

/**
 * Removes every body wiki link in `sourcePath` that RESOLVES to `targetPath`
 * (identical resolver as the graph/backlinks). Each removed link is replaced
 * by its display text (alias, else the written target) — Obsidian's unlink
 * semantics. Returns the number of removed links; 0 = nothing written.
 */
export async function removeLinksTo(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  sourcePath: string,
  targetPath: string
): Promise<number> {
  const notes = await queryService.listNotes();
  const allPaths = notes.map((n) => n.path);
  await requestSaveFlush(sourcePath);
  const current = await adapter.readTextFile(sourcePath);
  let removed = 0;
  const next = current.replace(WIKI_LINK_RE, (full, target: string, _anchor, _aliasGroup, alias?: string) => {
    const resolved = resolveLinkTarget(sourcePath, target.trim(), allPaths);
    if (resolved !== targetPath) return full;
    removed++;
    return alias ?? target.trim();
  });
  if (removed > 0) await adapter.writeTextFile(sourcePath, next);
  return removed;
}

/**
 * Creates a new OKF-conformant note in `folder` and links it from
 * `sourcePath`. Returns the new note's vault path (collision-numbered).
 */
export async function createConnectedNote(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  opts: { folder: string; title: string; sourcePath?: string; noteType: string }
): Promise<string> {
  const base = opts.title.trim().replace(/[\\/:*?"<>|]/g, "-");
  let path = opts.folder ? `${opts.folder}/${base}.md` : `${base}.md`;
  let counter = 2;
  while (await adapter.exists(path)) {
    path = opts.folder ? `${opts.folder}/${base} ${counter}.md` : `${base} ${counter}.md`;
    counter++;
  }
  await adapter.writeTextFile(path, buildNewNoteContent(opts.noteType, base));
  // Broken-link repairs create the missing target only — the link exists.
  if (opts.sourcePath) await appendWikiLink(adapter, queryService, opts.sourcePath, path);
  return path;
}

/**
 * Turns the first UNLINKED word-boundary occurrence of `term` in `sourcePath`
 * into a wiki link onto `targetPath` (cleanup action "link this mention").
 * The occurrence is re-verified against the live file content — a stale scan
 * result writes nothing and returns false.
 */
export async function applyMentionLink(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  sourcePath: string,
  targetPath: string,
  term: string
): Promise<boolean> {
  const notes = await queryService.listNotes();
  const allPaths = notes.map((n) => n.path);
  const target = wikiTargetForPath(targetPath, allPaths);

  await requestSaveFlush(sourcePath);
  const content = await adapter.readTextFile(sourcePath);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = new RegExp(`(?<![\\p{L}\\p{N}\\[])${escaped}(?![\\p{L}\\p{N}\\]])`, "giu");

  for (const match of content.matchAll(boundary)) {
    const idx = match.index ?? 0;
    // Skip occurrences already inside a wiki link: an unclosed "[[" before it.
    const before = content.substring(0, idx);
    const open = before.lastIndexOf("[[");
    if (open !== -1 && before.indexOf("]]", open) === -1) continue;
    const found = match[0];
    const link = found === target ? `[[${found}]]` : `[[${target}|${found}]]`;
    const next = content.substring(0, idx) + link + content.substring(idx + found.length);
    await adapter.writeTextFile(sourcePath, next);
    return true;
  }
  return false;
}
