import type { Text } from "@codemirror/state";

/**
 * The properties block of a note as the editor holds it: lines, not a string.
 *
 * What a properties block is has one definition, `frontmatterSpan` in
 * `packages/core/src/frontmatter-block.ts`; it follows the Markdown parser that
 * fills the index and the properties panel. The editor cannot ask it: it would
 * have to turn the document into a string on every transaction. So this is the
 * same rule, read on the editor's lines —
 *
 *  - the block opens on the first line, and that line is a fence;
 *  - it closes on the next line that is a fence, which may be the very next one;
 *  - a fence is `---` with nothing behind it but blanks;
 *  - without a closing fence there is no block.
 *
 * `editorFrontmatter.test.ts` holds the two together on the table of forms the
 * definition is held against the parser with.
 *
 * Everything in the editor that has to know where the block is asks here
 * (finding 2026-10-09). Before, five places in this folder scanned the lines
 * for themselves, and each wanted a line that is exactly `---`. A fence with
 * blanks behind it was a block for the index, the properties panel and every
 * writer, and text for the editor: the panel showed properties for lines that
 * stood in the note as a rule and a heading, open to typing.
 *
 * A byte order mark. An editor holds a note without its mark: the mark is part
 * of the file's shape, taken off when the file is opened and put back when it
 * is saved (`openEditorText` in `lib/textFileShape.ts`). So a document does
 * not normally start with one. Where one does — text that was pasted or set
 * from elsewhere —, the answer is still the definition's: the block behind
 * the mark is the block, and the mark counts to its range, hidden with it and
 * protected with it. The editor has no second opinion on where a block is.
 *
 * A line break is whatever the editor split the text at. A note read with
 * `\r\n` arrives here as lines, and the answer is the one the definition gives
 * for the text the editor writes back.
 */

/** Where the properties block of an editor document is. */
export interface FrontmatterLines {
  /** The number of the line that closes the block; line 1 opens it. */
  closeLine: number;
  /** Where the closing line ends, in front of its line break. */
  closeTo: number;
  /** Where the note's text begins, behind that line break: `FrontmatterSpan.end` for the same text. */
  end: number;
}

const BYTE_ORDER_MARK = 0xfeff;
const SPACE = 0x20;
const TAB = 0x09;

/** Whether a line is a fence from `at` on: `---` and nothing but blanks behind it. */
function isFence(line: string, at: number): boolean {
  if (!line.startsWith("---", at)) return false;
  for (let i = at + 3; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code !== SPACE && code !== TAB) return false;
  }
  return true;
}

/** The number of the line that closes the block, or 0. One pass, and it ends at the closing line. */
function closeLineOf(doc: Text): number {
  if (doc.lines < 2) return 0;
  const lines = doc.iterLines();
  const first = lines.next().value;
  if (!isFence(first, first.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0)) return 0;
  for (let number = 2; !lines.next().done; number++) {
    if (isFence(lines.value, 0)) return number;
  }
  return 0;
}

/**
 * The answers so far, by document. A document never changes — an edit makes a
 * new one —, so each is read once, however many parts of the editor ask: the
 * transaction filter asks on every transaction, also on one that only moves the
 * caret.
 *
 * What a read costs: nothing to speak of for a note that does not open with a
 * fence (the first line decides), and the length of the block for one that
 * does. Only a note that opens with `---` and never closes is read to its end,
 * once per edit: about 0.2 ms for 10 000 lines and 2 to 3 ms for 100 000
 * (measured 2026-10-09 on a busy machine; one cursor over the lines instead of
 * `doc.line(i)` for each). The scans this replaces took 0.6 to 0.9 ms and 10 to
 * 12 ms each on the same notes, and four of them ran per keystroke in live
 * mode, five with spell checking on, two for a caret move.
 */
const known = new WeakMap<Text, FrontmatterLines | null>();

/** Where the properties block of this document is, or null where it has none. */
export function frontmatterLines(doc: Text): FrontmatterLines | null {
  let block = known.get(doc);
  if (block === undefined) {
    const closeLine = closeLineOf(doc);
    if (closeLine === 0) {
      block = null;
    } else {
      const closeTo = doc.line(closeLine).to;
      block = { closeLine, closeTo, end: Math.min(closeTo + 1, doc.length) };
    }
    known.set(doc, block);
  }
  return block;
}

/** The YAML between the two fences, without the line break that ends it; "" for a block without a line. */
export function frontmatterYamlOf(doc: Text, block: FrontmatterLines): string {
  if (block.closeLine === 2) return "";
  return doc.sliceString(doc.line(2).from, doc.line(block.closeLine - 1).to);
}
