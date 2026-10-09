import { ensureMapContents, joinDocument, splitDocument } from "./frontmatter-block.js";

/**
 * Updates the frontmatter YAML block in a markdown string, preserving
 * the exact byte-for-byte contents of the markdown body and attempting
 * to preserve YAML comments and formatting.
 *
 * If frontmatter does not exist, it will be injected at the top. A block the
 * update leaves without entries is removed, and a note that has no entries
 * and gets none comes back untouched (`frontmatter-block.ts`).
 *
 * Throws FrontmatterSurgicalError for a block that is not a parseable YAML
 * map: the note is left alone rather than rewritten around it.
 */
export function updateFrontmatterString(content: string, newProps: Record<string, any>): string {
  const split = splitDocument(content);
  const map = ensureMapContents(split.doc);

  // 1. Delete keys that are not in newProps
  const existingKeys = map.items.map(item => (item.key as any)?.value);
  for (const key of existingKeys) {
    if (typeof key === "string" && !(key in newProps)) {
      split.doc.delete(key);
    }
  }

  // 2. Add or update keys from newProps
  for (const [key, value] of Object.entries(newProps)) {
    split.doc.set(key, value);
  }

  return joinDocument(split);
}
