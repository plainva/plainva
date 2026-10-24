import type { IDatabaseAdapter } from "./IDatabaseAdapter.js";
import { runStatementsAtomic } from "./batch.js";

/**
 * Index format 6: the notes whose wiki links are read differently now are read
 * once more (finding 2026-10-11).
 *
 * Up to format 5 a wiki link was looked for in the text the Markdown parser
 * had finished — in the value of each text node. Since format 6 the tokenizer
 * reads it, where it reads a code span (`wikiLinkSyntax.ts`), and what stands
 * between the brackets is taken as it is written. The link rows of a note are
 * written when its file changes, so a note that has not changed since would
 * keep the rows of the old reading: no row for `[[_private_]]`, a row for
 * "Tom & Jerry" where the line says `[[Tom &amp; Jerry]]`, a row for a link
 * behind an escaped bracket.
 *
 * Reading every note again would settle it and costs minutes on a large vault
 * (`docs/engineering/Performance_Large_Vault_2026-09-14.md`). Most notes read
 * the same under both readings — a link whose name is plain text between two
 * pairs of brackets is the same link —, so only those that may not are handed
 * to the next full scan: their `mtime_local` is reset, which is how a scan
 * knows a file it has to read (the way formats 2 to 4 did for every note).
 * Nothing is read from disk here; the text is the one the index holds for
 * search. `sync_state` stays untouched: reading an unchanged file again is
 * hash-equal and fires no sync callback.
 */

/** A bracket written with a backslash or as a character reference: `\[`, `&#91;`, `&rsqb;`. */
const SPELLED_OPEN = /\\\[|&(?:#0*91|#[xX]0*5[bB]|lsqb|lbrack);/g;
const SPELLED_CLOSE = /\\\]|&(?:#0*93|#[xX]0*5[dD]|rsqb|rbrack);/g;
/** The `!` of an embed written so, right in front of `[[`. */
const SPELLED_BANG = /(?:\\!|&(?:#0*33|#[xX]0*21|excl);)\[\[/;
const SPELLED = new RegExp(`${SPELLED_OPEN.source}|${SPELLED_CLOSE.source}|${SPELLED_BANG.source}`);

/** U+2028 and U+2029: the old scan stopped at them, Markdown reads on. Built here — the characters are not typed into this file. */
const LINE_SEPARATORS = String.fromCharCode(0x2028, 0x2029);

/**
 * What Markdown reads something into between two pairs of brackets:
 *
 *  - a backslash in front of ASCII punctuation — an escape; not `\|`, the bar
 *    of a table cell, which both readings take for the bar (`wikiLink.ts`) —,
 *    and a backslash at the end, in front of the closing bracket;
 *  - a character reference (`&amp;`, `&#38;`);
 *  - `*` and `~`, which mark emphasis and strike-through anywhere;
 *  - `_` at the edge of a word — inside a word it marks nothing;
 *  - a backtick, which may open a code span;
 *  - `<`, where a tag, a comment or an address in angle brackets can begin —
 *    `<1=@x>` is a mail address in angle brackets;
 *  - a bracket: the old reading paired a `[` the link now takes in with a
 *    `](…)` further on (`[[[Note]]](https://…)` was a Markdown link with a
 *    wiki link in its text), and an open label changes whether an address
 *    later in the paragraph is one;
 *  - an address (`www.`, `://`, a mail address), which is cut out of the text
 *    as a link.
 */
const READ_INTO = new RegExp(
  [
    "\\\\[!-/:-@\\[-`{}~]",
    "\\\\$",
    "&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});",
    "[*~`<\\[\\]]",
    "(?<![\\p{L}\\p{N}_])_|_(?![\\p{L}\\p{N}_])",
    "[wW][wW][wW]\\.|://",
    "[-.\\w+]@[-\\w]",
    `[${LINE_SEPARATORS}]`,
  ].join("|"),
  "u"
);

/**
 * Where the mark of an address begins: `<` (in angle brackets, with or
 * without `//`), `www.`, `://`. Glued to the front of a link, an address
 * takes the link into itself.
 */
const addressStartsAt = (line: string, at: number): boolean =>
  line[at] === "<" || line.startsWith("://", at) || ((line[at] === "w" || line[at] === "W") && line.slice(at, at + 4).toLowerCase() === "www.");

/** `[label]:` — a link or footnote definition makes `[[label]]` a reference in brackets for the old reading. */
const DEFINITION = /(?<!\])\]:/;

/** The indexer reads no link from a note with a line longer than this (`VaultIndexer`), in either reading. */
const LONGEST_INDEXED_LINE = 10_000;

/**
 * Whether the index rows of a note may differ between the reading up to
 * format 5 and the one since. True for every note they do differ for, and for
 * some they do not; false only where both readings list the same links.
 *
 * The readings agree on a link whose text between the brackets is plain: no
 * character Markdown reads something into, nothing glued to its end that
 * would make it a Markdown link (`[[1]](https://…)`), no address glued to its
 * front, no definition in the note it could be a reference to. And they agree
 * where no pair of brackets is spelled with a backslash or a character
 * reference. A note with a line the indexer does not read links from has no
 * rows in either reading.
 *
 * Linear in the length of the note: each line is read once, its links in
 * their order, and what stands glued in front of a link is followed as the
 * line is read.
 */
export function wikiLinkReadingMayDiffer(content: string): boolean {
  const linked = content.includes("[[");
  if (!linked && !SPELLED.test(content)) return false;
  if (content.split("\n").some((line) => line.length > LONGEST_INDEXED_LINE)) return false;
  if (linked && DEFINITION.test(content)) return true;
  for (const line of content.split(/\r\n|\n|\r/)) {
    if (SPELLED.test(line)) {
      if (SPELLED_BANG.test(line)) return true;
      // The line as its text reads, as far as its brackets go.
      const read = line.replace(SPELLED_OPEN, "[").replace(SPELLED_CLOSE, "]");
      const open = read.indexOf("[[");
      if (open >= 0 && read.indexOf("]]", open + 2) >= 0) return true;
    }
    // Where the last blank and the last mark of an address stand, up to `read`.
    let blank = -1;
    let address = -1;
    let read = 0;
    for (let open = line.indexOf("[["); open >= 0; ) {
      const close = line.indexOf("]]", open + 2);
      // No `]]` behind this one, so none behind any further right.
      if (close < 0) break;
      if (line[close + 2] === "(" || READ_INTO.test(line.slice(open + 2, close))) return true;
      for (; read < open; read++) {
        if (line[read] === " " || line[read] === "\t") blank = read;
        else if (addressStartsAt(line, read)) address = read;
      }
      // An address glued to the front of the link, without a blank between.
      if (address > blank) return true;
      open = line.indexOf("[[", close + 2);
    }
  }
  return false;
}

const rowValue = (row: unknown, key: string): unknown =>
  (row as Record<string, unknown> | null)?.[key] ?? (row as Record<string, unknown> | null)?.[key.toUpperCase()];

/**
 * Hands the notes described above to the next full scan, 200 at a time: SQL
 * picks the notes that hold a bracket or a character reference at all, the
 * function above decides. Every step can run again — a note that is marked
 * twice is read once.
 *
 * Returns how many notes were marked.
 */
export async function markNotesForWikiLinkReading(db: IDatabaseAdapter): Promise<number> {
  let marked = 0;
  let after = 0;
  for (;;) {
    const rows = await db.query(
      `SELECT rowid AS id, path, content FROM fts_notes
       WHERE rowid > ? AND (content GLOB '*[[]*' OR content GLOB '*&*;*')
       ORDER BY rowid LIMIT 200`,
      [after]
    );
    if (!rows.length) return marked;
    const updates: { sql: string; params: unknown[] }[] = [];
    for (const row of rows) {
      if (!wikiLinkReadingMayDiffer(String(rowValue(row, "content") ?? ""))) continue;
      updates.push({ sql: `UPDATE files SET mtime_local = 0 WHERE path = ?`, params: [rowValue(row, "path")] });
    }
    await runStatementsAtomic(db, updates);
    marked += updates.length;
    after = Number(rowValue(rows[rows.length - 1], "id"));
  }
}
