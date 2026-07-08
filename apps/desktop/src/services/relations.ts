import {
  parseMarkdownAst,
  extractFrontmatter,
  upsertFrontmatterKeys,
  deleteFrontmatterPath,
  resolveLinkTarget,
  wikiTargetForPath,
  type VaultQueryService,
} from "@plainva/core";

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

export interface RelationWriteAdapter {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
}

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

function currentValues(props: Record<string, unknown>, key: string): unknown[] {
  const value = props[key];
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

async function loadNote(
  adapter: RelationWriteAdapter,
  queryService: VaultQueryService,
  notePath: string
): Promise<{ content: string; props: Record<string, unknown>; allFilePaths: string[] }> {
  const [content, pathRows] = await Promise.all([
    adapter.readTextFile(notePath),
    queryService.db.query<{ path: string }>(`SELECT path FROM files WHERE mode != 'attachment'`),
  ]);
  const fm = extractFrontmatter(parseMarkdownAst(content));
  const props: Record<string, unknown> = fm.success && fm.data ? (fm.data as Record<string, unknown>) : {};
  return { content, props, allFilePaths: pathRows.map((r) => r.path) };
}

function resolvesToTarget(value: unknown, notePath: string, targetNotePath: string, allFilePaths: string[]): boolean {
  const base = linkBaseOf(value);
  return base != null && resolveLinkTarget(notePath, base, allFilePaths) === targetNotePath;
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
  const { content, props, allFilePaths } = await loadNote(adapter, queryService, notePath);
  const values = currentValues(props, propertyKey);

  const linkText = `[[${wikiTargetForPath(targetNotePath, allFilePaths)}]]`;

  if (limit === "one") {
    const already =
      values.length === 1 && resolvesToTarget(values[0], notePath, targetNotePath, allFilePaths);
    if (already) return { changed: false };
    await adapter.writeTextFile(notePath, upsertFrontmatterKeys(content, { [propertyKey]: linkText }));
    return { changed: true };
  }

  if (values.some((v) => resolvesToTarget(v, notePath, targetNotePath, allFilePaths))) {
    return { changed: false };
  }
  await adapter.writeTextFile(
    notePath,
    upsertFrontmatterKeys(content, { [propertyKey]: [...values, linkText] })
  );
  return { changed: true };
}

/**
 * Removes every link in `propertyKey` that RESOLVES to `targetNotePath`
 * (robust against bare vs qualified raw forms, aliases, anchors). Deletes the
 * key when the value empties; list values stay lists otherwise.
 */
export async function removeRelationLinksToNote(opts: {
  adapter: RelationWriteAdapter;
  queryService: VaultQueryService;
  notePath: string;
  propertyKey: string;
  targetNotePath: string;
}): Promise<{ changed: boolean; removed: number }> {
  const { adapter, queryService, notePath, propertyKey, targetNotePath } = opts;
  const { content, props, allFilePaths } = await loadNote(adapter, queryService, notePath);
  if (!(propertyKey in props)) return { changed: false, removed: 0 };

  const values = currentValues(props, propertyKey);
  const kept = values.filter((v) => !resolvesToTarget(v, notePath, targetNotePath, allFilePaths));
  const removed = values.length - kept.length;
  if (removed === 0) return { changed: false, removed: 0 };

  const next =
    kept.length === 0
      ? deleteFrontmatterPath(content, [propertyKey])
      : upsertFrontmatterKeys(content, {
          [propertyKey]: Array.isArray(props[propertyKey]) ? kept : kept[0],
        });
  await adapter.writeTextFile(notePath, next);
  return { changed: true, removed };
}
