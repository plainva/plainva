import {
  parseMarkdownAst,
  extractFrontmatter,
  upsertFrontmatterKeys,
  deleteFrontmatterPath,
  resolveLinkTarget,
} from "@plainva/core";

/**
 * Shared "clean up references" step of the cascade deletion (desktop wraps it
 * in services/relations.ts, mobile calls it directly): removes every value of
 * `propertyKey` in `notePath` that RESOLVES to `targetNotePath` — robust
 * against bare vs qualified raw forms, aliases and anchors. Deletes the key
 * when the value empties; list values stay lists otherwise. Body links are
 * never touched (they simply become unresolved links, Obsidian parity).
 */

export interface RelationCleanupDeps {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  /** Resolver corpus: every non-attachment file path in the vault. */
  listNotePaths(): Promise<string[]>;
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

export async function removeRelationLinksToNoteShared(
  deps: RelationCleanupDeps,
  opts: { notePath: string; propertyKey: string; targetNotePath: string }
): Promise<{ changed: boolean; removed: number }> {
  const { notePath, propertyKey, targetNotePath } = opts;
  const [content, allFilePaths] = await Promise.all([deps.readTextFile(notePath), deps.listNotePaths()]);
  const fm = extractFrontmatter(parseMarkdownAst(content));
  const props: Record<string, unknown> = fm.success && fm.data ? (fm.data as Record<string, unknown>) : {};
  if (!(propertyKey in props)) return { changed: false, removed: 0 };

  const resolvesToTarget = (value: unknown): boolean => {
    const base = linkBaseOf(value);
    return base != null && resolveLinkTarget(notePath, base, allFilePaths) === targetNotePath;
  };

  const values = currentValues(props, propertyKey);
  const kept = values.filter((v) => !resolvesToTarget(v));
  const removed = values.length - kept.length;
  if (removed === 0) return { changed: false, removed: 0 };

  const next =
    kept.length === 0
      ? deleteFrontmatterPath(content, [propertyKey])
      : upsertFrontmatterKeys(content, {
          [propertyKey]: Array.isArray(props[propertyKey]) ? kept : kept[0],
        });
  await deps.writeTextFile(notePath, next);
  return { changed: true, removed };
}
