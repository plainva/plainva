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

/**
 * A LIKE pattern that finds `text` anywhere in a column, however its letters
 * are cased and composed — a pre-filter for rows that are then compared in
 * JavaScript, where names are folded as people read them (`LinkResolver.ts`).
 *
 * LIKE folds A to Z only and compares bytes otherwise, so `Käse`, `KÄSE` and a
 * decomposed `Käse` (macOS) are three texts to it. Every letter beyond ASCII
 * that has a second case or a decomposed form therefore becomes a `%`: the
 * pattern finds MORE than the text, never less. Characters without either — a
 * Chinese or Japanese name, punctuation — stay literal, so such a name does
 * not turn into "every row". Always pair it with `ESCAPE '\'`.
 */
export function likeContainsAnySpelling(text: string): string {
  let pattern = "%";
  let open = true; // the pattern ends in a wildcard
  for (const ch of text.normalize("NFC")) {
    const plain = ch.codePointAt(0)! < 128 || (ch.toLowerCase() === ch && ch.toUpperCase() === ch && ch.normalize("NFD") === ch);
    if (!plain) {
      if (!open) pattern += "%";
      open = true;
      continue;
    }
    pattern += ch === "\\" || ch === "%" || ch === "_" ? `\\${ch}` : ch;
    open = false;
  }
  return open ? pattern : `${pattern}%`;
}
