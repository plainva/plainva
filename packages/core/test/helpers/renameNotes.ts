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
 * A note renamed to a name Markdown reads something into, and back (finding
 * 2026-10-11). For Markdown `__init__` is a word in bold and `~~old~~` one
 * struck through; until the wiki link was read by the tokenizer the index
 * listed no link to such a name, and a reference like `&amp;` it listed
 * resolved. The rename wrote the new name — and the next rename left the
 * links on it. (`*` stands in no file's name on Windows.)
 */
export const MARKED_NAMES: readonly string[] = ["__init__", "_private_", "~~old~~", "Tom &amp; Jerry"];
export const MARKED = {
  /** The note that is renamed, under its plain name. */
  path: "Code/Setup.md",
  name: "Setup",
  linkingPath: "Linking.md",
  /** The note that links to it: a link, an alias, an embed with an anchor, a link in a table cell. */
  linking: windows(["* See [[{T}]] and [[{T}|*the* alias]]", "* and ![[{T}#Part]]", "", "| a |", "|---|", "| [[{T}\\|in a table]] |", ""]),
  links: 4,
};

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
  preparation: { converted: 4, embeds: 1, unresolved: 1, inLabels: 0 },
  /** The other files of that vault. */
  others: { "Maps/Alpha.md": "# Alpha\n", "Maps/Beta Note.md": "# Beta\n", "Other/Gamma.md": "# Gamma\n\n## Intro\n" } as Readonly<Record<string, string>>,
  /** A note that links to the map, before and after the map became `index.md`. */
  linkingPath: "Start.md",
  linking: START,
  // A folder's overview is named by its folder: `index` is what every folder's overview is called.
  linkingAfter: START.replace("[[Map]]", "[[Maps/index]]").replace("Maps/Map.md", "Maps/index.md"),
};

/**
 * An overview adopted in a vault of the kind OKF makes — the root and another
 * folder hold an `index.md` already — that is tied into it in every way a note
 * can be (finding 2026-10-12): it links to itself by its name, with an anchor,
 * by the `title` of its properties, in an embed and in the label of a link;
 * other notes reach it by its name and by that title, in their text and in
 * their properties.
 *
 * Every template holds `{I}` where a wiki link names the overview's file, and
 * the overview's own holds `{A}` to `{D}` where a wiki link becomes a Markdown
 * link when it is prepared. Whatever else a template holds has to be there
 * afterwards, byte for byte.
 */
const HUB_NAME = "Map";
const HUB_TITLE = "Projects Map";
/** `index` is no name of one file in this vault: a wiki link says which one it means. */
const HUB_ADOPTED = "Projects/index";

const HUB_BLOCK = unix(["---", `title: ${HUB_TITLE}`, "type: MOC", "---", ""]);
const HUB = unix([
  "# Map",
  "",
  "* {A} is this note, {B} a part of it, and {C} its title",
  "* ![[{I}#Part One]] stays an embed",
  "* [see [[Alpha]] and [[{I}]] here](Beta.md) keeps the link around them",
  "* {D}",
  "",
  "## Part One",
  "",
  "last line without a line end",
]);
const hubLinks = (name: string) => ({ "{A}": `[[${name}]]`, "{B}": `[[${name}#Part One|here]]`, "{C}": `[[${HUB_TITLE}]]`, "{D}": "[[Alpha]] and [[Other/Gamma]]" });
/** The links of the overview to itself name it from its own folder; their labels say what the wiki links showed. */
const HUB_AS_MARKDOWN_LINKS = { "{A}": "[Map](./index.md)", "{B}": "[here](./index.md#Part%20One)", "{C}": "[Projects Map](./index.md)", "{D}": "[Alpha](Alpha.md) and [Gamma](../Other/Gamma.md)" };
const named = (template: string, name: string) => template.split("{I}").join(name);

/** The notes that reach the overview: `{I}` by its name, `{T}` by the title of its properties. */
const HUB_LINKING: Readonly<Record<string, string>> = {
  "Start.md": unix(["See [[{I}]], [[{T}]] and [the map](Projects/{E}.md).", ""]),
  "Projects/Alpha.md": windows(["# Alpha", "", "* up: [[{T}|the map]] and ![[{T}#Part One]]", ""]),
  "Projects/Beta.md": unix(["---", 'up: "[[{T}]]"   # by its title', 'see: "[[{I}]]"', "---", "# Beta", ""]),
};
const HUB_OTHERS: Readonly<Record<string, string>> = { "index.md": "# Vault\n", "Other/index.md": "# Other\n", "Other/Gamma.md": "# Gamma\n" };
/** A linking note while the overview's file is called `name`, its Markdown path ends in `file` and its title is reached as `title`. */
const linking = (template: string, name: string, file: string, title: string) => named(template, name).split("{T}").join(title).split("{E}").join(file);
const hubVault = (overview: Record<string, string>, name: string, file: string, title: string): Record<string, string> => {
  const files: Record<string, string> = { ...HUB_OTHERS, ...overview };
  for (const [path, template] of Object.entries(HUB_LINKING)) files[path] = linking(template, name, file, title);
  return files;
};

export const HUB_OVERVIEW = {
  path: "Projects/Map.md",
  folder: "Projects",
  indexPath: "Projects/index.md",
  /** The note with a title in its properties that other notes link to it by. */
  note: HUB_BLOCK + withLinks(named(HUB, HUB_NAME), hubLinks(HUB_NAME)),
  /** Every file of the vault before the adoption. */
  before: (): Record<string, string> => hubVault({ "Projects/Map.md": HUB_BLOCK + withLinks(named(HUB, HUB_NAME), hubLinks(HUB_NAME)) }, HUB_NAME, HUB_NAME, HUB_TITLE),
  /**
   * Adopted as it is: every link that named the file names the new one, in the
   * note itself and in the others. A link by the title still leads there —
   * the title is still in the block.
   */
  adopted: (): Record<string, string> => hubVault({ "Projects/index.md": HUB_BLOCK + withLinks(named(HUB, HUB_ADOPTED), hubLinks(HUB_ADOPTED)) }, HUB_ADOPTED, "index", HUB_TITLE),
  adoptedReport: { renamedLinks: 7, changedFiles: 3, linkUpdateFailed: false },
  /**
   * Adopted and prepared: the block is gone, and the title with it — so the
   * links that reached the note by its title name the file now. The note's
   * own links to itself are Markdown links to `./index.md`; the embed and the
   * wiki link in a label stay what they are and follow the file's name.
   */
  prepared: (): Record<string, string> => hubVault({ "Projects/index.md": withLinks(named(HUB, HUB_ADOPTED), HUB_AS_MARKDOWN_LINKS) }, HUB_ADOPTED, "index", HUB_ADOPTED),
  preparedReport: { renamedLinks: 9, changedFiles: 4, linkUpdateFailed: false, preparation: { converted: 5, embeds: 1, unresolved: 0, inLabels: 2 } },
};
