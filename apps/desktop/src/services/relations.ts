import {
  readFrontmatterPath,
  upsertFrontmatterKeys,
  noteLinkResolver,
  updateVaultText,
  wikiTargetForPath,
  type TextUpdateFiles,
  type VaultQueryService,
} from "@plainva/core";
import { removeRelationLinksToNoteShared } from "@plainva/ui";

/**
 * Owning-side relation writes (Gesamtplan Base-Relationen, P6): add/remove a
 * wiki link in a note's relation property, surgically (untouched frontmatter
 * keys keep their formatting, the body stays byte-identical). Matching is
 * resolution-based so bare, qualified, aliased and anchored raw forms of the
 * same target all count as "linked".
 *
 * Caller contract: after a successful write, trigger `indexer.indexFile(...)`
 * for the touched note (the Editor save pattern) so reverse lookups refresh.
 */

/**
 * The note's files: the vault's chain, or a storage with nothing above it. A
 * note is read, changed and written in one step (`updateVaultText`).
 */
export type RelationWriteAdapter = TextUpdateFiles;

const WIKILINK_VALUE_RE = /^\s*\[\[([^[\]]+)\]\]\s*$/;

/** Anchor-/alias-free base of a whole-value wiki link, or null for non-links. */
function linkBaseOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = WIKILINK_VALUE_RE.exec(value);
  if (!m) return null;
  let inner = m[1];
  const pipe = inner.indexOf("|");
  if (pipe !== -1) inner = inner.slice(0, pipe);
  const anchor = inner.search(/[#^]/);
  if (anchor !== -1) inner = inner.slice(0, anchor);
  const base = inner.trim();
  return base || null;
}

/**
 * What the note holds under `key`, as a list — read with the reader of the
 * writer that will set the key (finding 2026-10-12).
 *
 * The values used to come from the reader of the index, whose schema rejects a
 * proper YAML map with a value it does not take (an empty `tags:`, a year
 * among the tags). "Could not be read" passed for "holds no link", and adding
 * ONE link replaced the list the note carried. A block the writer itself
 * cannot read answers no values here, and the write then refuses the note.
 */
function currentValues(content: string, key: string): unknown[] {
  const value = readFrontmatterPath(content, [key]);
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

async function linkRule(queryService: VaultQueryService): Promise<{ allFilePaths: string[]; linkedNote: LinkedNote }> {
  // The link rule's corpus: what a stored value leads to is asked of every
  // file, what a new link is called of the notes alone.
  const files = await queryService.linkTargets();
  const allFilePaths = files.filter((f) => f.mode !== "attachment").map((f) => f.path);
  return { allFilePaths, linkedNote: noteLinkResolver(files) };
}

type LinkedNote = ReturnType<typeof noteLinkResolver>;

function resolvesToTarget(value: unknown, notePath: string, targetNotePath: string, linkedNote: LinkedNote): boolean {
  const base = linkBaseOf(value);
  return base != null && linkedNote(notePath, base) === targetNotePath;
}

/**
 * Adds a wiki link to `propertyKey` in `notePath`'s frontmatter. `limit: "one"`
 * REPLACES the value with a scalar link (Notion "steal" semantics); otherwise
 * the link is appended to a list (scalar legacy values are promoted to lists).
 * No-op when a stored link already resolves to `targetNotePath`. The link text
 * is collision-safe via wikiTargetForPath.
 */
export async function addRelationLink(opts: {
  adapter: RelationWriteAdapter;
  queryService: VaultQueryService;
  notePath: string;
  propertyKey: string;
  targetNotePath: string;
  limit?: "one";
}): Promise<{ changed: boolean }> {
  const { adapter, queryService, notePath, propertyKey, targetNotePath, limit } = opts;
  // What a link leads to and what a new one is called is asked first: the
  // change itself runs on the note's text alone, as it lies there when it is
  // written.
  const { allFilePaths, linkedNote } = await linkRule(queryService);
  const linkText = `[[${wikiTargetForPath(targetNotePath, allFilePaths)}]]`;

  const linked = (content: string): string | null => {
    const values = currentValues(content, propertyKey);
    if (limit === "one") {
      const already =
        values.length === 1 && resolvesToTarget(values[0], notePath, targetNotePath, linkedNote);
      return already ? null : upsertFrontmatterKeys(content, { [propertyKey]: linkText });
    }
    if (values.some((v) => resolvesToTarget(v, notePath, targetNotePath, linkedNote))) return null;
    return upsertFrontmatterKeys(content, { [propertyKey]: [...values, linkText] });
  };
  const update = await updateVaultText(adapter, notePath, linked);
  return { changed: linked(update.before) !== null };
}

/**
 * Removes every link in `propertyKey` that RESOLVES to `targetNotePath`
 * (robust against bare vs qualified raw forms, aliases, anchors). Deletes the
 * key when the value empties; list values stay lists otherwise. The actual
 * transformation lives in the shared relationCleanup kernel (`@plainva/ui`) so
 * the mobile cascade deletion runs the identical cleanup.
 */
export async function removeRelationLinksToNote(opts: {
  adapter: RelationWriteAdapter;
  queryService: VaultQueryService;
  notePath: string;
  propertyKey: string;
  targetNotePath: string;
}): Promise<{ changed: boolean; removed: number }> {
  const { adapter, queryService, notePath, propertyKey, targetNotePath } = opts;
  return removeRelationLinksToNoteShared(
    {
      readTextFile: (p) => adapter.readTextFile(p),
      writeTextFile: (p, c) => adapter.writeTextFile(p, c),
      updateTextFile: (p, change) => updateVaultText(adapter, p, change),
      listLinkTargets: () => queryService.linkTargets(),
    },
    { notePath, propertyKey, targetNotePath }
  );
}
