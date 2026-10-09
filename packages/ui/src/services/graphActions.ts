import { flushPendingSave } from "../platform/services";
import { editInShape, frontmatterSpan, nextWhere, resolveLinkTarget, wikiTargetForPath, wordBoundedPattern, type IVaultAdapter, type VaultQueryService } from "@plainva/core";
import { buildNewNoteContent } from "../lib/newNoteContent";

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

  await flushPendingSave(sourcePath);
  const current = await adapter.readTextFile(sourcePath);
  // The link and the empty line in front of it end the way the note's lines
  // end (`editInShape`): they were written with `\n` into every note, and one
  // that lies there with `\r\n` got two lines of the other kind per link.
  await adapter.writeTextFile(sourcePath, editInShape(current, (text) => {
    const needsBlankLine = text.length > 0 && !text.endsWith("\n\n");
    const separator = text.length === 0 ? "" : text.endsWith("\n") ? (needsBlankLine ? "\n" : "") : "\n\n";
    return `${text}${separator}${link}\n`;
  }));
  notifyOpenEditor(sourcePath);
  return link;
}

/**
 * `text.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(\|([^\]]*))?\]\]/g, …)` in one pass
 * (plan Befunde 24.09., E6); `replace` receives the whole link, group 1 and
 * group 4 (undefined without a `|`). The pattern looked for its closing
 * brackets again from every `[[`, quadratic on a long run of `[`. Each part
 * ends at the first character it may not hold, so no start is read twice.
 */
function replaceWikiLinks(text: string, replace: (full: string, target: string, alias: string | undefined) => string): string {
  const n = text.length;
  const targetEnd = nextWhere(n, (i) => text[i] === "]" || text[i] === "|" || text[i] === "#");
  const anchorEnd = nextWhere(n, (i) => text[i] === "]" || text[i] === "|");
  const aliasEnd = nextWhere(n, (i) => text[i] === "]");
  const pieces: string[] = [];
  let cursor = 0;
  for (let at = text.indexOf("[["); at >= 0; ) {
    const from = at + 2;
    const target = targetEnd(from);
    let end = target;
    if (text[end] === "#") end = anchorEnd(end + 1);
    let alias: string | undefined;
    if (text[end] === "|") {
      const stop = aliasEnd(end + 1);
      alias = text.slice(end + 1, stop);
      end = stop;
    }
    if (target > from && text[end] === "]" && text[end + 1] === "]") {
      pieces.push(text.slice(cursor, at), replace(text.slice(at, end + 2), text.slice(from, target), alias));
      cursor = end + 2;
      at = text.indexOf("[[", cursor);
    } else at = text.indexOf("[[", at + 1);
  }
  pieces.push(text.slice(cursor));
  return pieces.join("");
}

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
  await flushPendingSave(sourcePath);
  const current = await adapter.readTextFile(sourcePath);
  let removed = 0;
  const next = replaceWikiLinks(current, (full, target, alias) => {
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
  // An unterminated block is no block — everything is body then.
  return frontmatterSpan(content)?.end ?? 0;
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
    // A word of its own (inside Japanese or Chinese text anywhere in a run),
    // never the inside of brackets.
    const re = new RegExp(`(?<!\\[)${wordBoundedPattern(term)}(?!\\])`, "giu");
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

  await flushPendingSave(sourcePath);
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
