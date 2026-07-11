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
 * Notify any open editor of `path` so it adopts the just-written change live
 * (minimal in-place range edit — no reload, no conflict). Without this, the
 * ConflictAwareVaultAdapter advances local_sha256 on the write, so the indexer
 * never reports an external change and the open buffer keeps the stale text
 * until the note is reopened. Mirrors OkfConversionModal / FileTree / App.tsx.
 */
function notifyOpenEditor(path: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path } }));
  }
}

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
  notifyOpenEditor(sourcePath);
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

export interface InlineOccurrence {
  /** Index into the FULL content string (frontmatter included). */
  index: number;
  /** The actual matched text, in the document's original casing. */
  matched: string;
}

/**
 * Character offset where the note BODY begins: right after a leading YAML
 * frontmatter block (`---` … `---`), or 0 when there is none. Used to keep the
 * mention scan out of the frontmatter — a title/alias that only appears as a
 * YAML value must never be turned into a wiki link (it would corrupt the YAML).
 */
export function frontmatterBodyOffset(content: string): number {
  const open = /^---\r?\n/.exec(content);
  if (!open) return 0;
  // Closing fence: a line that is exactly `---` (optional trailing spaces).
  const close = /\r?\n---[ \t]*(\r?\n|$)/.exec(content.slice(open[0].length));
  if (!close) return 0; // unterminated block — treat everything as body.
  return open[0].length + close.index + close[0].length;
}

/**
 * Finds the first UNLINKED, word-boundary occurrence of any of `terms` in the
 * note BODY of `content`. Occurrences inside an existing `[[wiki link]]` and
 * inside the YAML frontmatter are skipped. Matching is case-insensitive; the
 * returned `matched` keeps the document's casing. Longer terms are tried first
 * so that, at the same position, the more specific phrase wins; across terms
 * the earliest occurrence is returned.
 */
export function findFirstUnlinkedOccurrence(content: string, terms: string[]): InlineOccurrence | null {
  const bodyStart = frontmatterBodyOffset(content);
  const cleaned = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  let best: InlineOccurrence | null = null;
  for (const term of cleaned) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\p{L}\\p{N}\\[])${escaped}(?![\\p{L}\\p{N}\\]])`, "giu");
    re.lastIndex = bodyStart;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const idx = m.index;
      // Skip occurrences already inside a wiki link: an unclosed "[[" before it.
      const before = content.substring(0, idx);
      const open = before.lastIndexOf("[[");
      if (open !== -1 && before.indexOf("]]", open) === -1) continue;
      if (!best || idx < best.index) best = { index: idx, matched: m[0] };
      break; // earliest valid occurrence of THIS term found
    }
  }
  return best;
}

/**
 * Links the first unlinked body occurrence of any `terms` in `sourcePath` onto
 * `targetPath`, using `[[target]]` when the visible text equals the wiki target
 * and `[[target|visibleText]]` otherwise (the aliased-link principle). The
 * occurrence is re-verified against the live file — a stale preview writes
 * nothing and returns null. Returns the written occurrence for UI feedback.
 */
export async function applyInlineLink(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  sourcePath: string,
  targetPath: string,
  terms: string[]
): Promise<{ matched: string; link: string } | null> {
  const notes = await queryService.listNotes();
  const allPaths = notes.map((n) => n.path);
  const target = wikiTargetForPath(targetPath, allPaths);

  await requestSaveFlush(sourcePath);
  const content = await adapter.readTextFile(sourcePath);
  const occ = findFirstUnlinkedOccurrence(content, terms);
  if (!occ) return null;
  const link = occ.matched === target ? `[[${occ.matched}]]` : `[[${target}|${occ.matched}]]`;
  const next = content.substring(0, occ.index) + link + content.substring(occ.index + occ.matched.length);
  await adapter.writeTextFile(sourcePath, next);
  notifyOpenEditor(sourcePath);
  return { matched: occ.matched, link };
}

/**
 * Turns the first UNLINKED word-boundary occurrence of `term` in `sourcePath`
 * into a wiki link onto `targetPath` (cleanup action "link this mention").
 * Thin boolean wrapper over {@link applyInlineLink}; a stale scan writes
 * nothing and returns false.
 */
export async function applyMentionLink(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  sourcePath: string,
  targetPath: string,
  term: string
): Promise<boolean> {
  return (await applyInlineLink(adapter, queryService, sourcePath, targetPath, [term])) !== null;
}
