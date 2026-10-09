/**
 * Where a wiki link leads — the cases every surface has to answer alike.
 *
 * Found 2026-10-08: the same `[[target]]` was resolved by three rules. The
 * desktop's editor asked the index for a note's TITLE or its whole path, the
 * phone walked the vault for the file's NAME, and the graph, the backlinks and
 * the relations matched the END of a path. Each case below is a small vault in
 * which those rules disagreed, with the one answer all of them give now. The
 * core, the desktop and the phone each run their own surface against this
 * list (`link-one-rule.test.ts`, `wikiLinkOneRule.test.ts` in both apps), so a
 * surface that drifts fails beside the others instead of on a device.
 *
 * The rule itself is `resolveLinkTargetIndexed` in `src/vault/LinkResolver.ts`.
 */

export interface LinkExpectation {
  /** The note the link stands in. */
  from: string;
  /** The link's target as written between the brackets — no anchor, no alias. */
  target: string;
  /** The file it leads to; null where a click would offer to create the note. */
  leadsTo: string | null;
}

export interface LinkCase {
  id: string;
  /** What the case shows, as a sentence a test title can carry. */
  shows: string;
  /** Vault path -> text. Every note names its links in its text, so the index holds them. */
  files: Record<string, string>;
  links: LinkExpectation[];
}

const titled = (title: string, body: string) => `---\ntitle: ${title}\n---\n\n${body}\n`;

export const LINK_CASES: LinkCase[] = [
  {
    id: "a",
    shows: "a note whose properties carry a title of their own is still found by its file's name",
    files: {
      "Start.md": "See [[Brief]], [[brief]] and [[Nirgends]].\n",
      "Projekte/Brief.md": titled("Angebotsbrief", "The offer."),
    },
    links: [
      { from: "Start.md", target: "Brief", leadsTo: "Projekte/Brief.md" },
      { from: "Start.md", target: "brief", leadsTo: "Projekte/Brief.md" },
      { from: "Start.md", target: "Nirgends", leadsTo: null },
    ],
  },
  {
    id: "b",
    shows: "the title of a note's properties names the note too",
    files: {
      "Start.md": "See [[Angebotsbrief]] and [[angebotsbrief]].\n",
      "Projekte/Brief.md": titled("Angebotsbrief", "The offer."),
    },
    links: [
      { from: "Start.md", target: "Angebotsbrief", leadsTo: "Projekte/Brief.md" },
      { from: "Start.md", target: "angebotsbrief", leadsTo: "Projekte/Brief.md" },
    ],
  },
  {
    id: "c",
    shows: "a link that names the end of a path finds the file",
    files: {
      "Start.md": "See [[Hafenkante/Brief]], [[Projekte/Hafenkante/Brief]] and [[Speicherstadt/Brief]].\n",
      "Projekte/Hafenkante/Brief.md": "The letter.\n",
    },
    links: [
      { from: "Start.md", target: "Hafenkante/Brief", leadsTo: "Projekte/Hafenkante/Brief.md" },
      { from: "Start.md", target: "Projekte/Hafenkante/Brief", leadsTo: "Projekte/Hafenkante/Brief.md" },
      { from: "Start.md", target: "Speicherstadt/Brief", leadsTo: null },
    ],
  },
  {
    id: "d",
    shows: "of two notes with one name, the one beside the linking note wins, then the shorter path",
    files: {
      "Start.md": "See [[Brief]].\n",
      "Projekte/Hafenkante/Brief.md": "The letter of the project.\n",
      "Projekte/Hafenkante/Plan.md": "See [[Brief]].\n",
      "Archiv/Brief.md": "An old letter.\n",
    },
    links: [
      { from: "Projekte/Hafenkante/Plan.md", target: "Brief", leadsTo: "Projekte/Hafenkante/Brief.md" },
      { from: "Start.md", target: "Brief", leadsTo: "Archiv/Brief.md" },
    ],
  },
  {
    id: "e",
    shows: "a file's name comes before another note's title",
    files: {
      "Start.md": "See [[Angebot]].\n",
      "Kunden/Brief.md": titled("Angebot", "A note that is merely titled so."),
      "Vorlagen/Angebot.md": "The note that is called so.\n",
    },
    links: [{ from: "Start.md", target: "Angebot", leadsTo: "Vorlagen/Angebot.md" }],
  },
  {
    id: "f",
    shows: "letters beyond ASCII are compared without regard to case as well",
    files: {
      "Start.md": "See [[übersicht]] and [[KÄSEKUCHEN]].\n",
      "Rezepte/Käsekuchen.md": "Quark.\n",
      "Übersicht.md": "Everything.\n",
    },
    links: [
      // SQLite's NOCASE folds A to Z only: `ü` and `Ü` were two names to the index.
      { from: "Start.md", target: "übersicht", leadsTo: "Übersicht.md" },
      { from: "Start.md", target: "KÄSEKUCHEN", leadsTo: "Rezepte/Käsekuchen.md" },
    ],
  },
  {
    id: "g",
    shows: "an attachment and a database are found by their file's name, extension included",
    files: {
      "Start.md": "See [[plan.pdf]], [[Aufgaben.base]] and [[Aufgaben]].\n",
      "Anhang/plan.pdf": "%PDF-1.4\n",
      "Daten/Aufgaben.base": "views:\n  - type: table\n    name: All\n",
    },
    links: [
      { from: "Start.md", target: "plan.pdf", leadsTo: "Anhang/plan.pdf" },
      { from: "Start.md", target: "Aufgaben.base", leadsTo: "Daten/Aufgaben.base" },
      // A database is no note: its name without the extension names nothing.
      { from: "Start.md", target: "Aufgaben", leadsTo: null },
    ],
  },
  {
    id: "h",
    shows: "a target without an extension is a note wherever one answers, and a file without an extension is found by its own name",
    files: {
      "Start.md": "See [[License]], [[license]], [[LICENSE]], [[Makefile]] and [[makefile]].\n",
      LICENSE: "MIT\n",
      "License.md": "What the licence means for this vault.\n",
      "Werkzeug/Makefile": "all:\n",
    },
    links: [
      // The note — although the file beside it reads the same once letter case is set aside.
      { from: "Start.md", target: "License", leadsTo: "License.md" },
      { from: "Start.md", target: "license", leadsTo: "License.md" },
      // Spelled exactly like the file, it is the file.
      { from: "Start.md", target: "LICENSE", leadsTo: "LICENSE" },
      // No note is called so: the file, by its name, anywhere in the vault.
      { from: "Start.md", target: "Makefile", leadsTo: "Werkzeug/Makefile" },
      { from: "Start.md", target: "makefile", leadsTo: "Werkzeug/Makefile" },
    ],
  },
  {
    id: "i",
    shows: "an explicit path names one place, from the vault's root or from the folder of the linking note",
    files: {
      "Projekte/Hafenkante/Plan.md": "See [[./Brief]], [[../Brief]], [[/Archiv/Brief]], [[../../Brief]], [[./заметки]], [[../Hafenkante]] and [[../Hafenkante/]].\n",
      "Projekte/Hafenkante/Brief.md": "The letter of the project.\n",
      "Projekte/Hafenkante/Заметки.md": "Notes, in letters that all have a second case.\n",
      "Projekte/Hafenkante.md": "A note called like the folder beside it.\n",
      "Projekte/Brief.md": "The letter of the folder above.\n",
      "Archiv/Brief.md": "An old letter.\n",
    },
    links: [
      { from: "Projekte/Hafenkante/Plan.md", target: "./Brief", leadsTo: "Projekte/Hafenkante/Brief.md" },
      { from: "Projekte/Hafenkante/Plan.md", target: "../Brief", leadsTo: "Projekte/Brief.md" },
      { from: "Projekte/Hafenkante/Plan.md", target: "/Archiv/Brief", leadsTo: "Archiv/Brief.md" },
      // Nothing else is tried for a path that names one place: no `Brief.md` lies at the root.
      { from: "Projekte/Hafenkante/Plan.md", target: "../../Brief", leadsTo: null },
      { from: "Projekte/Hafenkante/Plan.md", target: "./заметки", leadsTo: "Projekte/Hafenkante/Заметки.md" },
      { from: "Projekte/Hafenkante/Plan.md", target: "../Hafenkante", leadsTo: "Projekte/Hafenkante.md" },
      // A path that ends in a folder names no file — not the note called like that folder either.
      { from: "Projekte/Hafenkante/Plan.md", target: "../Hafenkante/", leadsTo: null },
    ],
  },
];
