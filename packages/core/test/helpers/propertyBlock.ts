/**
 * A note whose properties block holds everything the YAML library writes its
 * own way, for the tests that hold the property writers to the bytes (finding
 * 2026-10-11): the core's in `packages/core/test/frontmatter-entry.test.ts`,
 * the desktop's panel and cell in
 * `apps/desktop/src/components/PropertiesSection.entryBytes.test.tsx` and
 * `apps/desktop/src/components/base/useBaseCells.entryBytes.test.tsx`, the
 * phone's write chain in
 * `apps/mobile/src/services/propertyEntryBytes.test.ts`. One block, so that
 * the core and both shells are held to the same bytes.
 *
 * Until then every writer of a property printed the whole block through the
 * library: a value it had read as a number came back written from the number
 * (`plz: 01067` as `1067`), a long line folded at 80 characters, a bracket
 * list padded, a list indented, blank lines collapsed. So a test says what has
 * to come back as the SAME lines with the one change it asked for
 * (`withLine`, `withLinesBehind`, `withoutLines`) — whatever else the block
 * holds has to be there untouched.
 */

// Built at run time: the mark is never typed into a source file.
export const MARK = String.fromCharCode(0xfeff);

const LONG = "word ".repeat(30).trim();

/**
 * The lines between the fences. Every one of them but the comments and the
 * blank lines came back changed from any write to the block
 * (`whatTheLibraryWrites` in the core's test shows it for each).
 */
export const BLOCK: readonly string[] = [
  "# a comment at the top",
  "",
  // Values the library reads as numbers, and writes anew from the number.
  "plz: 01067",
  "phone: +4915112345678",
  "id: 12345678901234567890",
  "half: .5",
  "big: 1e3",
  "hex: 0x1F",
  // Forms it writes its own way: brackets, a long line, a line somebody folded, a list at the margin, blanks.
  "tags: [a, b]",
  `long: ${LONG}`,
  `address: "${LONG}"`,
  'source: "https://example.com/watch?v=8RSpdD5zojk&list=PLHluZpyhn1-zUtlFOsWE\\',
  '  d0x4zgNMFc7lu&index=16"',
  "list:",
  "- one",
  "- two",
  "title:    Spaced",
  "",
  "",
  "status: open   # the state",
  // A reference and what it refers to, block scalars, quotes.
  "anchored: &anchor !!str kept",
  "alias: *anchor",
  "text: |",
  "  line one",
  "  line two",
  "folded: >-",
  "  a folded",
  "  text",
  "single: 'it''s'",
  // A map indented by four, with a map in braces in it; a placeholder as a template holds one; links in quotes.
  "plainva:",
  "    icon: x",
  "    pim: {uid: 007, list: [1, 2]}",
  "names:",
  "  - {{alias}}",
  "people:",
  '  - "[[Anna]]"',
  "  - '[[Ben]]'   # since May",
  // A key the index names by its text.
  "2024: goals",
  "# a comment at the end",
];

/** The note's text behind the block: a rule in it, a task, and no line end at the end. */
export const TEXT: readonly string[] = ["# A note", "", "Text with a [[Link]], and a rule:", "", "---", "", "- [ ] a task"];

/** How a note lies on disk: its line end, and whether it starts with a byte order mark. */
export interface NoteShape {
  eol: string;
  mark: string;
}

/** The shapes every test of the bytes runs in. */
export const SHAPES: ReadonlyArray<readonly [string, NoteShape]> = [
  ["\\n", { eol: "\n", mark: "" }],
  ["\\r\\n", { eol: "\r\n", mark: "" }],
  ["\\r\\n and a byte order mark", { eol: "\r\n", mark: MARK }],
];

/** A note: its mark, the block between its fences, its text. */
export function noteOf(block: readonly string[], shape: NoteShape = SHAPES[0][1]): string {
  return shape.mark + ["---", ...block, "---", ...TEXT].join(shape.eol);
}

/** Where a line stands in the block. It has to stand there exactly once: a test that names a line means that one. */
function indexOf(block: readonly string[], line: string): number {
  const at = block.indexOf(line);
  if (at < 0 || block.indexOf(line, at + 1) >= 0) throw new Error(`the block holds ${at < 0 ? "no" : "more than one"} line ${JSON.stringify(line)}`);
  return at;
}

/** The block with one line exchanged for others. */
export function withLine(block: readonly string[], line: string, ...instead: string[]): string[] {
  const at = indexOf(block, line);
  return [...block.slice(0, at), ...instead, ...block.slice(at + 1)];
}

/** The block with lines put behind one of its lines. */
export function withLinesBehind(block: readonly string[], line: string, ...added: string[]): string[] {
  const at = indexOf(block, line);
  return [...block.slice(0, at + 1), ...added, ...block.slice(at + 1)];
}

/** The block without the lines from one line through another. */
export function withoutLines(block: readonly string[], from: string, through: string = from): string[] {
  return [...block.slice(0, indexOf(block, from)), ...block.slice(indexOf(block, through) + 1)];
}

/** The last entry of the block: a new one goes behind it, in front of the comment at the end. */
export const LAST_ENTRY = "2024: goals";

/**
 * What the index's reader hands out for the block — the set the properties
 * panel and a database cell start from. Written out, so that a test of a shell
 * says what it hands the writer.
 */
export const READ: Readonly<Record<string, unknown>> = {
  plz: 1067,
  phone: 4915112345678,
  id: 12345678901234567000,
  half: 0.5,
  big: 1000,
  hex: 31,
  tags: ["a", "b"],
  long: LONG,
  address: LONG,
  source: "https://example.com/watch?v=8RSpdD5zojk&list=PLHluZpyhn1-zUtlFOsWEd0x4zgNMFc7lu&index=16",
  list: ["one", "two"],
  title: "Spaced",
  status: "open",
  anchored: "kept",
  alias: "kept",
  text: "line one\nline two\n",
  folded: "a folded text",
  single: "it's",
  plainva: { icon: "x", pim: { uid: 7, list: [1, 2] } },
  names: [{ "{ alias }": null }],
  people: ["[[Anna]]", "[[Ben]]"],
  "2024": "goals",
};
