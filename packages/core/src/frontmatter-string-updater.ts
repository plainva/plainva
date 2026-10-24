import { splitDocument } from "./frontmatter-block.js";
import { dataOf, dataOfBlock, removeEntry, renameEntryKey, sameData, setEntry } from "./frontmatter-entry.js";
import type { MarkdownAst } from "./markdown-ast.js";
import { extractFrontmatter } from "./metadata-extractor.js";

const has = (data: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(data, key);

/**
 * Makes a note's properties the set it is handed — by writing the DIFFERENCE,
 * entry by entry, where each stands (`frontmatter-entry.ts`).
 *
 * The callers of this function work on the whole set: the properties panel
 * and a database cell read a note's properties, change one and hand all of
 * them back. Until 2026-10-12 every key of the set was then written anew, and
 * the whole block with them, through the YAML library — in its form, and from
 * the values as they had been READ: `plz: 01067` came back as `1067`,
 * `tags: a, b` as a list, a bracket list as a block list without the comment
 * behind it, `2024: goals` with a second entry `"2024": goals` beside it
 * (finding 2026-10-11).
 *
 * Now an entry is written only where the set says something else than the
 * note does:
 *
 *  - A key whose handed value is what the note says stays as it is, byte for
 *    byte. "What the note says" is what the YAML says, and also what the
 *    index's reader hands out for it — the set comes from that reader, which
 *    reads `tags: a, b` as two tags; handed back unchanged, the text stays the
 *    text it is.
 *  - A key the set gives another value is changed where it stands.
 *  - A key the set no longer names loses its lines.
 *  - A key that is new gets a line behind the last entry.
 *  - One key gone and one key new with the same value is the same entry under
 *    another name: its key is renamed, and it stays where it is.
 *
 * A block that loses its last entry is removed, a note without a block gets
 * one, and a set that changes nothing gives the note back untouched
 * (`frontmatter-block.ts`).
 *
 * Throws FrontmatterSurgicalError for a block that is not a parseable YAML
 * map: the note is left alone rather than rewritten around it.
 */
export function updateFrontmatterString(content: string, newProps: Record<string, any>): string {
  const split = splitDocument(content);
  /** What the YAML says, by the names the index gives the keys. */
  const said = dataOfBlock(split.doc);
  /** What the index's reader hands out for the same block; where it refuses the block, what the YAML says. */
  const read = split.span ? readerData(split.span.yaml) ?? said : said;
  /**
   * Whether the note says `value` under `key` already — by its YAML or as the
   * reader reads it, and the value as it was handed or as it would be written
   * (a date the reader read from `!!timestamp` is that date, not its text).
   */
  const says = (key: string, value: unknown): boolean => {
    if (!has(said, key)) return false;
    const data = dataOf(value);
    const same = (held: unknown): boolean => sameData(value, held) || sameData(data, held);
    return same(said[key]) || (has(read, key) && same(read[key]));
  };

  // A key the set no longer names goes — where the reader hands it out. One it
  // does not hand out (`__proto__`) was never offered to whoever made the set,
  // so its absence from the set says nothing.
  const gone = Object.keys(said).filter((key) => has(read, key) && !has(newProps, key));
  const fresh = Object.keys(newProps).filter((key) => !has(said, key));
  let next = content;
  if (gone.length === 1 && fresh.length === 1 && says(gone[0], newProps[fresh[0]])) {
    next = renameEntryKey(next, gone[0], fresh[0]);
  } else {
    for (const key of gone) next = removeEntry(next, [key]);
  }
  for (const [key, value] of Object.entries(newProps)) {
    // A renamed entry comes by here as well: where its YAML says the handed
    // value already, nothing is written; where only the reader read it so —
    // a text under `tags`, which is no list under another name — it is.
    if (!says(key, value)) next = setEntry(next, [key], value);
  }
  return next;
}

/** A block's properties as the index's reader reads them (`extractFrontmatter`), or null where it refuses the block. */
function readerData(yaml: string): Record<string, unknown> | null {
  const read = extractFrontmatter({ type: "root", children: [{ type: "yaml", value: yaml }] } as MarkdownAst);
  return read.success && read.data ? (read.data as Record<string, unknown>) : null;
}
