/**
 * Escapes SQL LIKE wildcards (and the escape char itself) so a path prefix
 * matches literally. Always pair it with `ESCAPE '\'` in the statement.
 *
 * Lives here rather than next to its first caller because both the indexer and
 * the sync queue need it, and the indexer drags the whole markdown parser into
 * any module graph that imports it.
 */
export function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, "\\$&");
}
