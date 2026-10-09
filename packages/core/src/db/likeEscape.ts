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
 * LIKE patterns that match exactly `text`, however its letters are cased and
 * composed — a pre-filter for rows that are then compared in JavaScript, where
 * names are folded as people read them (`LinkResolver.ts`). The patterns carry
 * no wildcard for "anything": the caller puts `%` where more may stand
 * (`'%/' || pattern` for "ends a path"). Always pair them with `ESCAPE '\'`.
 *
 * LIKE folds A to Z only and compares code points otherwise, so `Käse`, `KÄSE`
 * and a decomposed `Käse` (macOS) are three texts to it:
 *
 * - A letter beyond ASCII that has a second case becomes `_`, one character of
 *   any kind. The pattern keeps the LENGTH of the name, which is what keeps it
 *   selective for a name written entirely in such letters: `Заметки` asks for
 *   seven characters, not for every row (a `%` per letter did, and loaded the
 *   whole link table on every note of a Cyrillic or Greek vault).
 * - Composition is answered by spelling the text out each way: as written,
 *   composed and decomposed — up to three patterns, one for most names. A
 *   Korean syllable or an accent has no case and stays literal in each.
 *
 * What the patterns find is more than the text, never less — but for a text
 * that mixes a composed and a decomposed letter in one name, which no keyboard
 * and no file system writes.
 */
export function likeAnySpelling(text: string): string[] {
  const pattern = (form: string): string => {
    let out = "";
    for (const ch of form) {
      if (ch.codePointAt(0)! < 128) out += ch === "\\" || ch === "%" || ch === "_" ? `\\${ch}` : ch;
      else out += ch.toLowerCase() === ch && ch.toUpperCase() === ch ? ch : "_";
    }
    return out;
  };
  return [...new Set([pattern(text), pattern(text.normalize("NFC")), pattern(text.normalize("NFD"))])];
}
