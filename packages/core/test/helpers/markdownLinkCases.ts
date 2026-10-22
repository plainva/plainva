/**
 * Where a Markdown link leads — the cases every surface has to answer alike.
 *
 * Found 2026-10-09 and recorded on 2026-10-12: `[text](target)` was opened in
 * eight places, and hardly two of them read it alike. The desktop's reading
 * view read it from the linking note's folder alone, its editor sent a bare
 * name through the wiki rule without decoding it, the phone tried the note's
 * folder and the vault's root, and the graph and the backlinks resolved it by
 * the wiki rule. Each case below is a small vault in which those readings
 * disagreed, with the one answer all of them give now. The core, the desktop
 * and the phone each run their own surface against this list
 * (`markdown-link-one-rule.test.ts`, `markdownLinkOneRule.test.ts` in both
 * apps), beside the cases for wiki links (`linkCases.ts`).
 *
 * The rule itself is `resolveMarkdownLinkIndexed` in `src/vault/LinkResolver.ts`.
 */

export interface MarkdownLinkExpectation {
  /** The note the link stands in. One link per note, so a surface's answer is that link's. */
  from: string;
  /** The link's destination as written between the parentheses. */
  href: string;
  /** The file it leads to — for a folder the `index.md` in it; null where it leads to no file. */
  leadsTo: string | null;
  /** A folder that is there and holds no `index.md`: the folder a shell shows ("" = the vault's root). */
  folder?: string;
  /** Leads nowhere, and is a bare note name: the note a click offers to create. */
  creates?: string;
  /** The anchor a click lands on. */
  anchor?: string;
}

export interface MarkdownLinkCase {
  id: string;
  /** What the case shows, as a sentence a test title can carry. */
  shows: string;
  /** Vault path -> text, the linking notes aside: `markdownCaseVault` writes those. */
  files: Record<string, string>;
  links: MarkdownLinkExpectation[];
}

const NOTE = "Text.\n";
const titled = (title: string) => `---\ntitle: ${title}\n---\n\nText.\n`;
// A decomposed U-umlaut, as macOS hands file names out: "U" and a combining diaeresis.
const DECOMPOSED_UE = "U%CC%88";

export const MARKDOWN_LINK_CASES: MarkdownLinkCase[] = [
  {
    id: "near",
    shows: "a path is read from the folder of the linking note",
    files: {
      "Projekte/Ablage/Brief.md": NOTE,
      "Projekte/Ablage/Mein Brief.md": "## Absatz\n\nText.\n",
      "Projekte/img/shot.png": "PNG\n",
    },
    links: [
      { from: "Projekte/Plan.md", href: "Ablage/Brief.md", leadsTo: "Projekte/Ablage/Brief.md" },
      // The desktop demanded the exact file name; the phone and the graph did not.
      { from: "Projekte/Ohne.md", href: "Ablage/Brief", leadsTo: "Projekte/Ablage/Brief.md" },
      // Another letter case: the stored path is the answer, never the spelling written.
      { from: "Projekte/Klein.md", href: "ablage/brief.md", leadsTo: "Projekte/Ablage/Brief.md" },
      { from: "Projekte/Anker.md", href: "Ablage/Mein%20Brief.md#Absatz", leadsTo: "Projekte/Ablage/Mein Brief.md", anchor: "#Absatz" },
      { from: "Projekte/Bild.md", href: "img/shot.png", leadsTo: "Projekte/img/shot.png" },
    ],
  },
  {
    id: "root",
    shows: "where nothing lies below the note's folder, the path is read from the vault's root",
    files: { "Ablage/Brief.md": NOTE },
    links: [
      // Obsidian's "absolute path in vault" has no leading slash. The desktop said "not found".
      { from: "Projekte/Plan.md", href: "Ablage/Brief.md", leadsTo: "Ablage/Brief.md" },
      { from: "Projekte/Ohne.md", href: "Ablage/Brief", leadsTo: "Ablage/Brief.md" },
    ],
  },
  {
    id: "both",
    shows: "a file below the note's folder comes before one at the same path from the root",
    files: { "Projekte/Ablage/Brief.md": NOTE, "Ablage/Brief.md": NOTE },
    links: [
      // The graph drew this edge to the note at the root.
      { from: "Projekte/Plan.md", href: "Ablage/Brief.md", leadsTo: "Projekte/Ablage/Brief.md" },
      { from: "Start.md", href: "Ablage/Brief.md", leadsTo: "Ablage/Brief.md" },
    ],
  },
  {
    id: "listing",
    shows: "the entry of a listing names the note beside it, although one of that name lies at the root",
    files: { "Brief.md": NOTE, "Projekte/Brief.md": NOTE, "Projekte/Mein Brief.md": NOTE },
    links: [
      // The desktop's editor and the graph answered with the note at the root.
      { from: "Projekte/Liste.md", href: "Brief.md", leadsTo: "Projekte/Brief.md" },
      { from: "Projekte/Ohne.md", href: "Brief", leadsTo: "Projekte/Brief.md" },
      // What Plainva's own listing writes for a note with a blank in its name.
      // The desktop's editor created a note `Mein%20Brief.md` for it.
      { from: "Projekte/Leer.md", href: "Mein%20Brief.md", leadsTo: "Projekte/Mein Brief.md" },
      { from: "Start.md", href: "Brief.md", leadsTo: "Brief.md" },
    ],
  },
  {
    id: "name",
    shows: "a bare file name finds the file anywhere in the vault, as the wiki link of the same text does",
    files: { "Archiv/Brief.md": NOTE, "Archiv/Mein Brief.md": NOTE, "Anhang/report.pdf": "%PDF-1.4\n" },
    links: [
      // The phone created a second `Brief.md` beside the linking note; the reading view said "not found".
      { from: "Projekte/Plan.md", href: "Brief.md", leadsTo: "Archiv/Brief.md" },
      { from: "Projekte/Ohne.md", href: "Brief", leadsTo: "Archiv/Brief.md" },
      // Obsidian's own Markdown form: a name, encoded, no extension. Both editors created a note for it.
      { from: "Projekte/Obsidian.md", href: "Mein%20Brief", leadsTo: "Archiv/Mein Brief.md" },
      { from: "Projekte/Anhang.md", href: "report.pdf", leadsTo: "Anhang/report.pdf" },
    ],
  },
  {
    id: "suffix",
    shows: "a path that lies neither below the note nor at the root is found by its end",
    files: { "Archiv/Ablage/Brief.md": NOTE },
    links: [{ from: "Projekte/Plan.md", href: "Ablage/Brief.md", leadsTo: "Archiv/Ablage/Brief.md" }],
  },
  {
    id: "explicit",
    shows: "an explicit path names one place, and nothing else is tried for it",
    files: {
      "Ablage/Brief.md": NOTE,
      "Archiv/Brief.md": NOTE,
      "Archiv/Nirgends.md": NOTE,
      "Projekte/Brief.md": NOTE,
      "Draussen.md": NOTE,
    },
    links: [
      { from: "Projekte/Hoch.md", href: "../Ablage/Brief.md", leadsTo: "Ablage/Brief.md" },
      { from: "Projekte/Ohne.md", href: "../Ablage/Brief", leadsTo: "Ablage/Brief.md" },
      { from: "Projekte/Wurzel.md", href: "/Archiv/Brief.md", leadsTo: "Archiv/Brief.md" },
      { from: "Projekte/Hier.md", href: "./Brief.md", leadsTo: "Projekte/Brief.md" },
      // Out of the vault: nowhere. The phone folded such a path back in and opened `Draussen.md`.
      { from: "Projekte/Hinaus.md", href: "../../Draussen.md", leadsTo: null },
      // A note of that name lies elsewhere — an explicit path does not go looking for it.
      { from: "Projekte/Fest.md", href: "./Nirgends.md", leadsTo: null },
    ],
  },
  {
    id: "folder",
    shows: "a target that ends in a slash names a folder: its index.md, or the folder itself",
    files: {
      "Projekte/Ablage/index.md": NOTE,
      "Projekte/Leer/Notiz.md": NOTE,
      "Wurzelordner/index.md": NOTE,
    },
    links: [
      // The graph listed every folder link as broken; the phone handed the folder on as a note.
      { from: "Projekte/Plan.md", href: "Ablage/", leadsTo: "Projekte/Ablage/index.md" },
      { from: "Projekte/Ohne.md", href: "Leer/", leadsTo: null, folder: "Projekte/Leer" },
      // Only at the root: the desktop revealed `Projekte/Wurzelordner`, which is not there.
      { from: "Projekte/Wurzel.md", href: "Wurzelordner/", leadsTo: "Wurzelordner/index.md" },
      { from: "Projekte/Hoch.md", href: "../", leadsTo: null, folder: "" },
      { from: "Projekte/Fehlt.md", href: "Nirgends/", leadsTo: null },
    ],
  },
  {
    id: "title",
    shows: "the title of a note's properties names the note, last",
    files: { "Archiv/Brief.md": titled("Angebotsbrief") },
    links: [{ from: "Projekte/Plan.md", href: "Angebotsbrief", leadsTo: "Archiv/Brief.md" }],
  },
  {
    id: "database",
    shows: "a database needs its extension, as it does in a wiki link",
    files: { "Daten/Aufgaben.base": "views:\n  - type: table\n    name: All\n" },
    links: [
      // The phone filled in `.base`.
      { from: "Projekte/Ohne.md", href: "Daten/Aufgaben", leadsTo: null },
      { from: "Projekte/Mit.md", href: "Daten/Aufgaben.base", leadsTo: "Daten/Aufgaben.base" },
    ],
  },
  {
    id: "hash",
    shows: "a # that belongs to the file's name arrives encoded and stays in the name",
    files: { "Projekte/Draft #1.md": "## Part\n\nText.\n", "Projekte/Draft.md": NOTE },
    links: [
      // The index listed this link under the target `Draft`.
      { from: "Projekte/Plan.md", href: "Draft%20%231.md", leadsTo: "Projekte/Draft #1.md" },
      { from: "Projekte/Anker.md", href: "Draft%20%231.md#Part", leadsTo: "Projekte/Draft #1.md", anchor: "#Part" },
      { from: "Projekte/Ohne.md", href: "Draft.md", leadsTo: "Projekte/Draft.md" },
    ],
  },
  {
    id: "composed",
    shows: "a composed and a decomposed spelling of a letter are one name",
    files: { "Projekte/Übersicht.md": NOTE },
    links: [{ from: "Projekte/Plan.md", href: `${DECOMPOSED_UE}bersicht.md`, leadsTo: "Projekte/Übersicht.md" }],
  },
  {
    id: "nothing",
    shows: "a link that leads nowhere offers a note only where it is a bare note name",
    files: {},
    links: [
      { from: "Projekte/Plan.md", href: "Neu.md", leadsTo: null, creates: "Projekte/Neu.md" },
      { from: "Projekte/Ohne.md", href: "Neu", leadsTo: null, creates: "Projekte/Neu.md" },
      { from: "Start.md", href: "Neu%20hier.md", leadsTo: null, creates: "Neu hier.md" },
      // A path names a place: nothing is created for it (issue 61).
      { from: "Projekte/Ordner.md", href: "Ablage/Neu.md", leadsTo: null },
      // A table cell created a note `img/shot.png.md` for this one.
      { from: "Projekte/Bild.md", href: "img/shot.png", leadsTo: null },
      { from: "Projekte/Anhang.md", href: "report.pdf", leadsTo: null },
    ],
  },
];

/** A case's vault: its files, and each linking note with its one link. */
export function markdownCaseVault(linkCase: MarkdownLinkCase): Record<string, string> {
  const files: Record<string, string> = { ...linkCase.files };
  for (const link of linkCase.links) {
    if (files[link.from] !== undefined) throw new Error(`case ${linkCase.id}: ${link.from} is there already - one link per note`);
    files[link.from] = `[x](${link.href})\n`;
  }
  return files;
}
