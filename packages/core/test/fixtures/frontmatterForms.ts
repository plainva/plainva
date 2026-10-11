/**
 * The ways a note can open, as far as its properties block goes.
 *
 * One table for everything that reads the block: the definition
 * (`frontmatterSpan`) is held against the Markdown parser on it
 * (`frontmatter-block.test.ts`), and the editor's reading of its own lines is
 * held against the definition on it
 * (`apps/desktop/src/components/editorFrontmatter.test.ts`). A form added here
 * is asked of all three.
 */

/** Built from its code point: an escape in a source file is easily saved as the invisible character itself. */
const BOM = String.fromCharCode(0xfeff);

export const FRONTMATTER_FORMS: readonly string[] = [
  "---\na: 1\n---\nBody\n",
  "---\r\na: 1\r\nb: 2\r\n---\r\nBody\r\n",
  // `---` directly on `---`: a block without entries.
  "---\n---\n# Single\n",
  "---\r\n---\r\n# Single\r\n",
  "---\n---",
  "---\n---\n",
  "---\n\n---\n# Single\n",
  // A rule further down belongs to the text.
  "---\n---\n\ntext\n\n---\n\nmore\n",
  "---\n---\n---\ntext\n",
  "---\na: 1\n---\n\n---\n\nrule\n",
  "---\na: 1\n---",
  // Blanks behind a fence.
  "--- \na: 1\n---\nBody\n",
  "---\na: 1\n--- \nBody\n",
  "---\n---  \nBody\n",
  "---\t\n---\nBody\n",
  "--- \r\na: 1\r\n---\t\r\nBody\r\n",
  "---\na: 1\n---  ",
  "---\n--- ",
  // A byte order mark in front of the opening fence — and nowhere else.
  `${BOM}---\na: 1\n---\nBody\n`,
  `${BOM}---\n---\nBody\n`,
  `${BOM}---\r\na: 1\r\n---\r\nBody\r\n`,
  `${BOM}--- \n---\t\nBody\n`,
  `${BOM}# Heading\n`,
  `---\na: 1\n${BOM}---\nBody\n`,
  "---\n# only a comment\n---\nBody\n",
  "---\n{}\n---\nBody\n",
  // What is no fence: the YAML document end, an indented line, four dashes,
  // text behind the dashes. Such a line opens nothing and closes nothing.
  "---\na: 1\n...\nBody\n",
  "\n---\na: 1\n---\nBody\n",
  " ---\na: 1\n---\nBody\n",
  "----\na: 1\n----\nBody\n",
  "---\na: 1\n----\nBody\n---\n",
  "---\na: 1\n ---\nBody\n---\n",
  "--- x\na: 1\n---\nBody\n",
  "---\na: 1\n--- x\nBody\n---\n",
  // Never closed, a single line, not at the top, nothing at all.
  "---\na: 1\nBody\n",
  "---\n",
  "---",
  "---a\n---\n",
  "# Heading\n\n---\na: 1\n---\n",
  "",
  // A carriage return of its own ends a line, too: every line of a file from
  // a classic Mac.
  "---\ra: 1\r---\rBody\r",
  "---\ra: 1\rb: 2\r---\rBody",
  "---\ra:\r  - x\r  - y\r---\rBody\r",
  "---\r---\r# Single\r",
  "---\r---",
  "---\r---\r",
  "---\r\r---\r# Single\r",
  "---\r\r\r---\rBody",
  "---\ra: 1\r---",
  "---\ra: 1\r---  ",
  "--- \ra: 1\r---\t\rBody\r",
  `${BOM}---\ra: 1\r---\rBody\r`,
  "---\r---\r---\rtext\r",
  "---\ra: 1\r---\r\r---\r\rrule\r",
  // And a stray one among other line ends, at every place a line break stands.
  "---\ra: 1\n---\nBody\n",
  "---\na: 1\r---\nBody\n",
  "---\na: 1\n---\rBody\n",
  "---\na: 1\rb: 2\n---\nBody\n",
  "---\r\na: 1\rb: 2\r\n---\r\nBody\r\n",
  "---\n---\r---\rBody",
  // `\r\n` is one line break, `\n\r` and `\r\r\n` are two.
  "---\n\r---\nBody",
  "---\r\r\n---\nBody",
  "---\r\n\r---\r\nBody",
  // `\r\r\n` on every line: what a file from Windows has after its `\r\n` was
  // turned into line ends a second time. An empty line stands behind each line.
  "---\r\r\na: 1\r\r\nb: 2\r\r\n---\r\r\nBody\r\r\n",
  "---\r\r\n---\r\r\nBody\r\r\n",
  "---\r\r\na: 1\r\r\n---",
  // What is no fence stays none, whatever ends its line.
  "---\r",
  "---\ra: 1\r",
  "---\ra: 1\rBody\r",
  "\r---\ra: 1\r---\rBody\r",
  " ---\ra: 1\r---\rBody\r",
  "---\ra: 1\r...\rBody\r",
  "---\ra: 1\r ---\rBody\r---\r",
  "---\ra: 1\r----\rBody\r---\r",
  "---\ra: 1\r--- x\rBody\r---\r",
  "---x\r---\r",
  "# Heading\r\r---\ra: 1\r---\r",
];

/**
 * Notes for the runs that hold the readers together beyond the table: up to
 * seven lines out of fences, near-fences and text, each with a line ending of
 * its own — `\n` for most, `\r\n` or a carriage return alone for one in six
 * each —, the last line with or without one. Two notes in three open with a
 * fence, one in eight with a byte order mark. The same notes on every machine
 * and every run (mulberry32).
 */
export function generatedNotes(seed: number, count: number): string[] {
  const LINES = ["---", "---", "---", "--- ", "---\t ", "----", " ---", "---x", "...", "", "", "a: 1", "b: [x, y]", "# Heading", "text --- text", "- item"];
  let state = seed;
  const next = (below: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % below;
  };
  const notes: string[] = [];
  for (let run = 0; run < count; run++) {
    const lines = next(8);
    let note = next(8) === 0 ? BOM : "";
    for (let i = 0; i < lines; i++) {
      const last = i === lines - 1;
      const text = i === 0 && next(3) > 0 ? "---" : LINES[next(LINES.length)];
      const ending = next(6);
      note += text + (last && next(2) === 0 ? "" : ending === 0 ? "\r\n" : ending === 1 ? "\r" : "\n");
    }
    notes.push(note);
  }
  return notes;
}

/** Whether a text carries a carriage return of its own: one that no `\n` follows. */
export const hasLoneCarriageReturn = (text: string): boolean => /\r(?!\n)/.test(text);
