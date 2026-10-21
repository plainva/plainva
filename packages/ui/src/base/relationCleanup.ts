import {
  readFrontmatterPath,
  upsertFrontmatterKeys,
  deleteFrontmatterPath,
  noteLinkResolver,
  updateVaultText,
  type LinkTargetRow,
  type TextUpdateFiles,
} from "@plainva/core";

/**
 * Shared "clean up references" step of the cascade deletion (desktop wraps it
 * in services/relations.ts, mobile calls it directly): removes every value of
 * `propertyKey` in `notePath` that RESOLVES to `targetNotePath` — robust
 * against bare vs qualified raw forms, aliases and anchors. Deletes the key
 * when the value empties; list values stay lists otherwise. Body links are
 * never touched (they simply become unresolved links, Obsidian parity).
 */

/** The note's files — a vault's chain, or a storage with nothing above it (`updateVaultText`) — and the link rule's corpus. */
export interface RelationCleanupDeps extends TextUpdateFiles {
  /** The link rule's corpus (`VaultQueryService.linkTargets`): every file a link can lead to. */
  listLinkTargets(): Promise<readonly LinkTargetRow[]>;
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

function currentValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

export async function removeRelationLinksToNoteShared(
  deps: RelationCleanupDeps,
  opts: { notePath: string; propertyKey: string; targetNotePath: string }
): Promise<{ changed: boolean; removed: number }> {
  const { notePath, propertyKey, targetNotePath } = opts;
  // What a link leads to is asked first: the change itself runs on the note's text alone.
  const linkedNote = noteLinkResolver(await deps.listLinkTargets());
  const resolvesToTarget = (value: unknown): boolean => {
    const base = linkBaseOf(value);
    return base != null && linkedNote(notePath, base) === targetNotePath;
  };

  // What the note holds is read with the reader of the writers below (finding
  // 2026-10-12). The reader of the index stood here: its schema rejects a
  // proper YAML map with a value it does not take — an empty `tags:` —, such
  // a note came back as holding no property at all, and a link to a note that
  // was being deleted stayed in it without a word.
  const cleaned = (content: string): { removed: number; next: string | null } => {
    const stored = readFrontmatterPath(content, [propertyKey]);
    const values = currentValues(stored);
    const kept = values.filter((v) => !resolvesToTarget(v));
    const removed = values.length - kept.length;
    if (removed === 0) return { removed, next: null };
    return {
      removed,
      next: kept.length === 0
        ? deleteFrontmatterPath(content, [propertyKey])
        : upsertFrontmatterKeys(content, {
            [propertyKey]: Array.isArray(stored) ? kept : kept[0],
          }),
    };
  };
  // Counted on the note as it was changed; where it has an open conflict, the
  // user's own version is cleaned the same way and counts for itself.
  const update = await updateVaultText(deps, notePath, (content) => cleaned(content).next);
  const removed = cleaned(update.before).removed;
  return { changed: removed > 0, removed };
}
