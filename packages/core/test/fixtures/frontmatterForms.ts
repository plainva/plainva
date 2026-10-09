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
];
