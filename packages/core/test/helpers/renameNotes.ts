/**
 * A vault in which one note is renamed, for the tests that run a shell's own
 * rename over real files (finding 2026-10-09): the desktop's in
 * `apps/desktop/src/renameLinkBytes.test.ts`, the phone's in
 * `apps/mobile/src/services/renameLinkBytes.test.ts`. One set of notes, so
 * that both shells are held to the same bytes.
 *
 * Every note is a TEMPLATE. `{T}` stands where a link names the note the way
 * a wiki link does, `{E}` where a Markdown link does (percent-encoded). The
 * file on disk is the template with the old name; what has to lie there after
 * the rename is the SAME template with the new name. Whatever else a template
 * holds — the old name in a code span or in a sentence, and every form the
 * Markdown serializer and the YAML library write their own way — has to be
 * there untouched.
 */

// Built at run time: the mark is never typed into a source file.
export const MARK = String.fromCharCode(0xfeff);
export const OLD_NAME = "Old Note";
export const NEW_NAME = "New Note";
export const OLD_PATH = `Projects/${OLD_NAME}.md`;
export const NEW_PATH = `Projects/${NEW_NAME}.md`;

/** A template as the note it is while the renamed note is called `name`. */
export const fill = (template: string, name: string): string => template.split("{T}").join(name).split("{E}").join(encodeURI(name));
/** How many links to the renamed note a template holds. */
export const linksIn = (template: string): number => template.split("{T}").length - 1 + (template.split("{E}").length - 1);

const windows = (lines: string[]) => MARK + lines.join("\r\n");
const unix = (lines: string[]) => lines.join("\n");
const LONG = "word ".repeat(30).trim();

/** From Windows: a mark, `\r\n`, and every form the two writers used to rewrite. No line end at the end. */
const WINDOWS = windows([
  "---",
  "# a comment in the block",
  "title:    Windows",
  "tags: [a, b]",
  "plz: 01067",
  `long: ${LONG}`,
  'related:   "[[{T}]]"   # the main one',
  "refs:",
  '- "[[Projects/{T}#Part|shown]]"',
  "- '[[Keep]]'",
  "---",
  "# Windows",
  "",
  "* item with [[{T}]]",
  "* *emphasis* and __strong__ [[{T}|an alias]]",
  "+ [[{T}#Part]] and [[{T}#Part|both]] and [[{T}^block]]",
  "",
  "| note | what |",
  "|---|:-:|",
  "| [[{T}\\|in a table]] | ![[{T}]] |",
  "",
  "***",
  "",
  "1) the `[[Old Note]]` in a code span stays",
  "2) and so does the Old Note in a sentence",
  "",
  "last line without a line end",
]);

/** With `\n`: Markdown links in the forms vaults hold, a quote, a nested list, a line end at the end. */
const UNIX = unix([
  "Setext heading",
  "==============",
  "",
  "> a quote",
  "> with [the note]({E}.md) on its second line",
  "",
  "- item",
  '  continued [with a title](Projects/{E}.md#Part "a title")',
  "  - deeper [between angle brackets](<Projects/{T}.md>)",
  "    and deeper still ![[{T}|300]]   ",
  "",
  "A &amp; B&nbsp;[[{T}]] beside two character references, and [[Keep]].",
  "",
]);

/** Paths that name a place: only the name at their end changes. */
const SIBLING = unix(["[[./{T}]] and [x](./{E}.md) and ![[./{T}#Part]]", ""]);
const DEEP = windows(["[[/Projects/{T}]]", "", "* [up](../Projects/{E}.md)", "* [[Projects/{T}|deep]]", ""]);

/** The notes that link to the renamed one, by their vault paths. */
export const LINKING_NOTES: Readonly<Record<string, string>> = {
  "Windows.md": WINDOWS,
  "Unix.md": UNIX,
  "Projects/Sibling.md": SIBLING,
  "Other/Deep.md": DEEP,
};

/** Those of them that carry a form the Markdown serializer writes another way (`Sibling.md` is one line of links). */
export const REFORMATTED_BY_THE_SERIALIZER: readonly string[] = ["Windows.md", "Unix.md", "Other/Deep.md"];

/** The renamed note itself: it links to itself. Its heading is its own text and stays. */
export const RENAMED_NOTE = unix(["# Old Note", "", "Self: [[{T}#Part]]", "", "## Part", ""]);

/** A note that only mentions the name: it is no note that links to it, and is not even written. */
export const UNTOUCHED_PATH = "Untouched.md";
export const UNTOUCHED_NOTE = windows(["Mentions the Old Note, `[[Old Note]]` in code, and links to [[Keep]].", "", "* a", "* b", ""]);

/** Every file of the vault before the rename. */
export function vaultBeforeRename(): Record<string, string> {
  const files: Record<string, string> = { [OLD_PATH]: fill(RENAMED_NOTE, OLD_NAME), [UNTOUCHED_PATH]: UNTOUCHED_NOTE, "Keep.md": "# Keep\n" };
  for (const [path, template] of Object.entries(LINKING_NOTES)) files[path] = fill(template, OLD_NAME);
  return files;
}

/** What has to lie in the vault afterwards: the same templates with the new name. */
export function vaultAfterRename(): Record<string, string> {
  const files: Record<string, string> = { [NEW_PATH]: fill(RENAMED_NOTE, NEW_NAME), [UNTOUCHED_PATH]: UNTOUCHED_NOTE, "Keep.md": "# Keep\n" };
  for (const [path, template] of Object.entries(LINKING_NOTES)) files[path] = fill(template, NEW_NAME);
  return files;
}

/** The links to the renamed note in all of the vault, and the notes that hold one. */
export const LINK_COUNT = Object.values(LINKING_NOTES).reduce((sum, template) => sum + linksIn(template), linksIn(RENAMED_NOTE));
export const NOTES_WITH_A_LINK: readonly string[] = [...Object.keys(LINKING_NOTES), NEW_PATH].sort();

/**
 * A note that is adopted as the overview of its folder. `{A}`, `{B}`, `{C}`
 * and `{G}` stand where a wiki link becomes a Markdown link when the note is
 * prepared for it; nothing else of the note changes then, but for its
 * properties block, which goes.
 */
const MAP = windows([
  "---",
  "type: MOC",
  "tags: [maps]",
  "---",
  "",
  "# Map",
  "",
  "* {A} — first",
  "* *emphasis* {B}",
  "+ ![[Alpha]] stays an embed",
  "+ [[Nowhere]] stays a wiki link",
  "",
  "| note | what |",
  "|---|---|",
  "| {C} | {G} |",
  "",
  "***",
  "",
  "last line without a line end",
]);
const AS_WIKI_LINKS = { "{A}": "[[Alpha]]", "{B}": "[[Beta Note|the second]]", "{C}": "[[Alpha\\|in a table]]", "{G}": "[[Other/Gamma#Intro]]" };
const AS_MARKDOWN_LINKS = { "{A}": "[Alpha](Alpha.md)", "{B}": "[the second](Beta%20Note.md)", "{C}": "[in a table](Alpha.md)", "{G}": "[Other/Gamma#Intro](../Other/Gamma.md#Intro)" };
const withLinks = (template: string, links: Record<string, string>) => Object.entries(links).reduce((text, [mark, link]) => text.split(mark).join(link), template);
const START = windows(["See [[Map]] and [the map](Maps/Map.md).", "", "* a", "* *b*", ""]);

export const OVERVIEW = {
  path: "Maps/Map.md",
  folder: "Maps",
  indexPath: "Maps/index.md",
  /** The note as it lies in the vault. */
  note: withLinks(MAP, AS_WIKI_LINKS),
  /**
   * The note prepared: the block is gone — the mark in front of it stays, and
   * so does the blank line that stood behind it, which is the text's — and the
   * four links are Markdown links.
   */
  prepared: MARK + withLinks(MAP, AS_MARKDOWN_LINKS).slice(withLinks(MAP, AS_MARKDOWN_LINKS).indexOf("---\r\n", MARK.length + 3) + 5),
  /** What preparing it reports. */
  preparation: { converted: 4, embeds: 1, unresolved: 1 },
  /** The other files of that vault. */
  others: { "Maps/Alpha.md": "# Alpha\n", "Maps/Beta Note.md": "# Beta\n", "Other/Gamma.md": "# Gamma\n\n## Intro\n" } as Readonly<Record<string, string>>,
  /** A note that links to the map, before and after the map became `index.md`. */
  linkingPath: "Start.md",
  linking: START,
  linkingAfter: START.replace("[[Map]]", "[[index]]").replace("Maps/Map.md", "Maps/index.md"),
};
