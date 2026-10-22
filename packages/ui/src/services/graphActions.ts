import { flushPendingSave } from "../platform/services";
import {
  buildLinkTargetIndex,
  editInShape,
  frontmatterSpan,
  linkTargetName,
  plainWikiLinkInner,
  resolveLinkRow,
  rewriteNoteLinks,
  updateVaultText,
  wikiLinkParts,
  wikiTargetForPath,
  wordBoundedPattern,
  type IVaultAdapter,
  type NoteLink,
  type VaultQueryService,
} from "@plainva/core";
import { buildNewNoteContent } from "../lib/newNoteContent";
import { parseWikiImageTarget } from "../lib/imageTarget";
import { markdownLinkNotePlace } from "../lib/linkOpen";
import { wikiTargetToPath } from "../lib/wikiResolver";

/**
 * Write actions shared by the graph views (accept a suggestion, connect-drag).
 * Every write goes through the FULL adapter chain (backup + sync queue) and is
 * preceded by the save-flush handshake so a pending editor save can never
 * overwrite the change one second later. A change to a note that exists goes
 * into the note as it lies there at that moment (`updateVaultText`).
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
  // The link and the empty line in front of it end the way the note's lines
  // end (`editInShape`): they were written with `\n` into every note, and one
  // that lies there with `\r\n` got two lines of the other kind per link.
  await updateVaultText(adapter, sourcePath, (current) => editInShape(current, (text) => {
    const needsBlankLine = text.length > 0 && !text.endsWith("\n\n");
    const separator = text.length === 0 ? "" : text.endsWith("\n") ? (needsBlankLine ? "\n" : "") : "\n\n";
    return `${text}${separator}${link}\n`;
  }));
  notifyOpenEditor(sourcePath);
  return link;
}

/**
 * Removes every link in the TEXT of `sourcePath` that leads to `targetPath` —
 * a wiki link, an embed, a Markdown link, each resolved the way the graph and
 * the backlinks resolve it (`resolveLinkRow`). Each removed link is replaced
 * by its display text (a wiki link's alias, a Markdown link's label, else the
 * written target) — Obsidian's unlink semantics. A relation in the properties
 * is no text link and stays: an edge drawn from one has "remove relation".
 * Returns the number of removed links; 0 = nothing written.
 */
export async function removeLinksTo(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  sourcePath: string,
  targetPath: string
): Promise<number> {
  const corpus = buildLinkTargetIndex(await queryService.linkTargets());
  await flushPendingSave(sourcePath);
  const unlinked = (current: string): { removed: number; next: string } => {
    let next = current;
    let removed = 0;
    // A link in the label of another (`[see [[T]]](T.md)`) is left while the
    // one around it is replaced by its label; the next pass finds it there
    // (review 2026-10-22: it stayed, and the edge with it).
    for (let pass = 0; pass < 4; pass++) {
      const text = next;
      // No `]]` and no `](`: no link stands in this note, and a long run of
      // openers is not handed to the parser at all (plan Befunde 24.09., E6).
      if (!text.includes("]]") && !text.includes("](")) break;
      // The links of the note's TEXT, where the parser reads them — the links
      // the graph draws its edges from (`rewriteNoteLinks` reads the tree the
      // index reads). A scan of the whole file stood here until 2026-10-22: it
      // replaced a relation in the properties (`project: "[[Target]]"` became
      // `"Target"`), a `[[Target]]` inside code, left the `!` of an embed
      // standing, and knew no Markdown link at all, so "remove text links" at
      // an edge drawn from one removed nothing (findings 2026-10-11 and
      // 2026-10-12).
      const result = rewriteNoteLinks(text, (link) => {
        if (resolveLinkRow(sourcePath, link.target, link.type, corpus) !== targetPath) return null;
        return { replacement: linkDisplayText(text, link) };
      });
      if (result.rewritten === 0) break;
      removed += result.rewritten;
      next = result.content;
    }
    return { removed, next };
  };
  const written = await updateVaultText(adapter, sourcePath, (current) => {
    const result = unlinked(current);
    return result.removed > 0 ? result.next : null;
  });
  // Counted in the note as it was changed — not in the version of an open
  // conflict, which took the same change.
  return unlinked(written.before).removed;
}

/**
 * What stays of a link once it is removed — Obsidian's unlink: the text a
 * reader saw. A wiki link's alias, else the name it was written with; a
 * Markdown link's label, else its target; an embed's alt text, else its name.
 */
function linkDisplayText(content: string, link: NoteLink): string {
  if (link.type === "markdown-link") {
    // `[label](destination)`: the label ends where the destination's bracket opens.
    const close = content.lastIndexOf("](", link.targetStart);
    const label = close > link.start ? content.slice(link.start + 1, close) : "";
    return label.trim() ? label : link.target;
  }
  // In a table cell the bar of a wiki link is written `\|`: the parts are read
  // with it in mind, and a bar in the text that stays is written so again
  // (review 2026-10-22: `[[photo.png\|300]]` left `photo.png\`, and in a
  // compact row the leftover `\|` took a column away).
  const inCell = (text: string): string => (link.inTable ? text.split("|").join("\\|") : text);
  if (link.type === "embed") {
    // `![[photo.png|300]]`: behind the bar stands a size, no text a reader saw
    // (review 2026-10-22: the embed became "300").
    const embed = parseWikiImageTarget(plainWikiLinkInner(link.inner));
    return inCell(embed.alt ?? linkTargetName(embed.target));
  }
  const parts = wikiLinkParts(link.inner);
  return inCell(parts.alias?.trim() || parts.target);
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
  // A broken link may name a folder that is not there yet (`[[Ablage/Neu]]`).
  if (opts.folder && !(await adapter.exists(opts.folder))) await adapter.createDir(opts.folder);
  await adapter.writeTextFile(path, buildNewNoteContent(opts.noteType, base));
  // Broken-link repairs create the missing target only — the link exists.
  if (opts.sourcePath) await appendWikiLink(adapter, queryService, opts.sourcePath, path);
  return path;
}

/** A broken link as the graph lists it (`BrokenLinkInfo`); a caller that knows only the text is a wiki link's. */
export interface BrokenLinkToCreate {
  sourcePath: string;
  targetRaw: string;
  /** The target without its anchor (`links.target_path`); read from `targetRaw` where absent. */
  target?: string;
  /** How the link is written; a wiki link where absent. */
  kind?: "wikilink" | "embed" | "markdown-link";
}

/**
 * Where the note a broken link names will lie — the place the link's rule
 * looks FIRST, so the link is no longer broken once the note is there.
 *
 * A wiki link: where a click on it creates the note (`wikiTargetToPath`) —
 * beside the linking note for a bare name, at the path for a target that
 * names one (`[[Ablage/Neu]]`, `[[../Neu]]`).
 *
 * A Markdown link is read from the linking note's folder: `[x](Ablage/Neu.md)`
 * in `Projekte/Plan.md` names `Projekte/Ablage/Neu.md`. The wiki link's place
 * (`Ablage/Neu.md` from the root) stood here until 2026-10-22; the reading
 * view and the editor then went on saying "not found". And a Markdown link
 * may name a file that is no note — a picture, a PDF, a folder: there is no
 * note to create for it (`img/shot.png.md` was).
 *
 * Null where the target names no place for a note.
 */
export function brokenLinkNotePath(link: BrokenLinkToCreate): { path: string; title: string } | null {
  if (link.kind !== "markdown-link") {
    const { path, title } = wikiTargetToPath(link.target ?? link.targetRaw, link.sourcePath);
    return path && title ? { path, title } : null;
  }
  // The place a click on the link creates the note (`linkOpen.ts`).
  return markdownLinkNotePlace(link.sourcePath, link.target ?? link.targetRaw);
}

/**
 * A broken link as a list names it: in the way it is written. Both clean-up
 * views showed every broken link as `[[target]]`, a Markdown link too.
 */
export function brokenLinkLabel(link: BrokenLinkToCreate): string {
  if (link.kind === "markdown-link") return `[…](${link.targetRaw})`;
  return `${link.kind === "embed" ? "!" : ""}[[${link.targetRaw}]]`;
}

/**
 * Creates the note a broken link names, where the link will find it
 * (`brokenLinkNotePath`). The clean-up views of both shells ask this. Returns
 * the new note's path, or null where the target names no place for a note.
 */
export async function createBrokenLinkTarget(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  link: BrokenLinkToCreate,
  noteType: string
): Promise<string | null> {
  const place = brokenLinkNotePath(link);
  if (!place) return null;
  const folder = place.path.includes("/") ? place.path.slice(0, place.path.lastIndexOf("/")) : "";
  return createConnectedNote(adapter, queryService, { folder, title: place.title, noteType });
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
  const linked = (content: string): { matched: string; link: string; next: string } | null => {
    const occ = findFirstUnlinkedOccurrence(content, terms);
    if (!occ) return null;
    const link = occ.matched === target ? `[[${occ.matched}]]` : `[[${target}|${occ.matched}]]`;
    return { matched: occ.matched, link, next: content.substring(0, occ.index) + link + content.substring(occ.index + occ.matched.length) };
  };
  const written = await updateVaultText(adapter, sourcePath, (content) => linked(content)?.next ?? null);
  // What was linked in the note as it was changed; a note that no longer
  // carries the mention answers null.
  const done = linked(written.before);
  if (!done) return null;
  notifyOpenEditor(sourcePath);
  return { matched: done.matched, link: done.link };
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
