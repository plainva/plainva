import { defineBase } from "./baseBuilders";
import { welcomeBody, type VaultTemplateDefinition, type VaultTemplateNote } from "./types";
import type { ParaSample, ParaTemplate } from "./paraTemplate";

/**
 * The Zettelkasten vault template (plan "Vorlagen-Überarbeitung + Plainva-Tour"
 * § 3). Shared structure, per-language strings — same reason as PARA and GTD.
 *
 * The one thing this template has to show is the WEB: permanent notes that link
 * to each other in their own text, not through a folder. A single example note
 * cannot demonstrate that, which is why the four slips here cross-reference each
 * other and each name the literature it came from.
 */

export interface ZettelkastenStrings {
  name: string;
  description: string;
  folders: { fleeting: string; literature: string; permanent: string; templates: string };
  folderHints: { fleeting: string; literature: string; permanent: string };
  welcome: { file: string; title: string; intro: string; outro: string; description?: string };
  welcomeSections: { databases: string; start: string };
  baseFiles: { literature: string; slips: string };
  /** Frontmatter keys — translated but kept ASCII/umlaut-free. */
  keys: { author: string; year: string; kind: string; status: string; url: string; slips: string; source: string };
  options: {
    /** Five media kinds; the samples use three of them. */
    kind: [string, string, string, string, string];
    /** Reading states; FIRST unread, LAST fully worked through. */
    status: [string, string, string];
  };
  views: { table: string; byStatus: string };
  templates: { literature: ParaTemplate; slip: ParaTemplate };
  samples: {
    /** Cross-linked in their bodies — that is the point of the method. */
    permanent: [ParaSample, ParaSample, ParaSample, ParaSample];
    literature: [ParaSample, ParaSample, ParaSample];
    fleeting: [ParaSample];
  };
}

const TEMPLATE_MARKER = { tasks: false } as const;

function sampleNote(folder: string, sample: ParaSample): VaultTemplateNote {
  return {
    path: `${folder}/${sample.title}.md`,
    body: `# ${sample.title}\n\n${sample.body}\n`,
    properties: sample.props ? { ...sample.props } : undefined,
  };
}

function templateNote(folder: string, tpl: ParaTemplate, forBase: string, props: Record<string, unknown>): VaultTemplateNote {
  return {
    path: `${folder}/${tpl.file}`,
    body: tpl.body,
    properties: { ...props, plainva: { ...TEMPLATE_MARKER, templateFor: [`[[${forBase}]]`] } },
  };
}

export function buildZettelkasten(s: ZettelkastenStrings): VaultTemplateDefinition {
  const f = s.folders;
  const b = s.baseFiles;
  const k = s.keys;
  const v = s.views;
  const [book, article, video, podcast, website] = s.options.kind;
  const [toRead, read, processed] = s.options.status;

  return {
    id: "zettelkasten",
    name: s.name,
    description: s.description,
    folders: [f.fleeting, f.literature, f.permanent, f.templates],
    bases: [
      defineBase({
        path: b.literature,
        sourceFolder: f.literature,
        columns: [
          { key: k.author, input: "text" },
          { key: k.year, input: "number" },
          {
            key: k.kind,
            input: "select",
            options: [
              { value: book, color: "blue" },
              { value: article, color: "teal" },
              { value: video, color: "coral" },
              { value: podcast, color: "purple" },
              { value: website, color: "gray" },
            ],
          },
          {
            key: k.status,
            input: "status",
            options: [
              { value: toRead, color: "gray" },
              { value: read, color: "amber" },
              { value: processed, color: "green" },
            ],
          },
          { key: k.url, input: "url" },
          { key: k.slips, reverseOf: { base: b.slips, property: k.source } },
        ],
        views: [
          { name: v.table, type: "table" },
          { name: v.byStatus, type: "board", groupBy: k.status },
        ],
        newItemTemplate: `${f.templates}/${s.templates.literature.file}`,
      }),
      defineBase({
        path: b.slips,
        sourceFolder: f.permanent,
        columns: [{ key: k.source, input: "relation", relationBase: b.literature }],
        views: [{ name: v.table, type: "table" }],
        newItemTemplate: `${f.templates}/${s.templates.slip.file}`,
      }),
    ],
    notes: [
      {
        path: s.welcome.file,
        description: s.welcome.description ?? s.welcome.title,
        body: welcomeBody(
          s.welcome.title,
          s.welcome.intro,
          [
            { name: f.fleeting, description: s.folderHints.fleeting },
            { name: f.literature, description: s.folderHints.literature },
            { name: f.permanent, description: s.folderHints.permanent },
          ],
          s.welcome.outro,
          [
            {
              heading: s.welcomeSections.databases,
              links: [
                { name: b.literature, path: b.literature },
                { name: b.slips, path: b.slips },
              ],
            },
            {
              heading: s.welcomeSections.start,
              links: [
                { name: s.samples.permanent[0].title, path: `${f.permanent}/${s.samples.permanent[0].title}.md` },
                { name: s.samples.literature[0].title, path: `${f.literature}/${s.samples.literature[0].title}.md` },
              ],
            },
          ]
        ),
      },
      ...s.samples.permanent.map((n) => sampleNote(f.permanent, n)),
      ...s.samples.literature.map((n) => sampleNote(f.literature, n)),
      ...s.samples.fleeting.map((n) => sampleNote(f.fleeting, n)),
      templateNote(f.templates, s.templates.literature, b.literature, { [k.status]: toRead }),
      templateNote(f.templates, s.templates.slip, b.slips, {}),
    ],
    settings: {
      templateFolder: f.templates,
      folderTemplates: [
        { folder: f.literature, template: s.templates.literature.file },
        { folder: f.permanent, template: s.templates.slip.file },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Reference bundles. The eight machine-translated modules carry their own.
// ---------------------------------------------------------------------------

export const ZK_STRINGS_DE: ZettelkastenStrings = {
  name: "Zettelkasten",
  description: "Eine Idee pro Notiz, dicht verlinkt — flüchtige, Literatur- und permanente Notizen (Luhmann).",
  folders: {
    fleeting: "Flüchtige Notizen",
    literature: "Literaturnotizen",
    permanent: "Permanente Notizen",
    templates: "Vorlagen",
  },
  folderHints: {
    fleeting: "Schnelle Rohgedanken — kurzlebig, werden später verarbeitet.",
    literature: "Zusammenfassungen von Gelesenem in eigenen Worten, mit Quelle.",
    permanent: "Ausformulierte, dauerhafte Ideen — eine pro Notiz, stark verlinkt.",
  },
  welcome: {
    file: "Willkommen.md",
    title: "Willkommen",
    description: "Startpunkt und Kurzanleitung für diesen Vault.",
    intro:
      "Dieser Vault folgt der Zettelkasten-Methode (Niklas Luhmann): eine Idee pro Notiz — Verbindungen entstehen über Links statt über Ordnerhierarchien. Die Zettel unten verweisen aufeinander; folge ihnen und sieh Dir danach den Graphen an.",
    outro:
      "In Literatur.base pflegst du deine Quellen nach Lesestatus; Zettel.base verknüpft permanente Notizen über die Eigenschaft Quelle mit der Literatur, aus der sie stammen.",
  },
  welcomeSections: { databases: "Deine Datenbanken", start: "Zum Einstieg" },
  baseFiles: { literature: "Literatur.base", slips: "Zettel.base" },
  keys: { author: "autor", year: "jahr", kind: "art", status: "status", url: "url", slips: "zettel", source: "quelle" },
  options: {
    kind: ["Buch", "Artikel", "Video", "Podcast", "Webseite"],
    status: ["Zu lesen", "Gelesen", "Verarbeitet"],
  },
  views: { table: "Tabelle", byStatus: "Nach Status" },
  templates: {
    literature: { file: "Literaturnotiz.md", body: "# {{title}}\n\n## Zusammenfassung\n\n## Quelle\n" },
    slip: { file: "Zettel.md", body: "# {{title}}\n\nEine Idee, in ganzen Sätzen.\n\n## Verwandte Zettel\n\n- \n" },
  },
  samples: {
    permanent: [
      {
        title: "Ein Gedanke pro Zettel",
        body: "Eine permanente Notiz enthält genau eine Idee, in ganzen Sätzen und in eigenen Worten. Erst dadurch lässt sie sich später in einem anderen Zusammenhang wiederverwenden, ohne dass man den ursprünglichen nachschlagen müsste.\n\nWeiter: [[Verlinken statt einsortieren]] und [[Schreiben ist Denken]].",
        props: { quelle: ["[[Luhmann - Kommunikation mit Zettelkästen]]"] },
      },
      {
        title: "Verlinken statt einsortieren",
        body: "Ein Ordner zwingt jede Notiz in genau eine Schublade. Ein Link erlaubt ihr, in beliebig vielen Zusammenhängen zu stehen — deshalb wächst ein Zettelkasten mit der Zeit an Wert, statt unübersichtlich zu werden.\n\nGegenprobe: [[Ein Gedanke pro Zettel]]. Praktische Folge: [[Der Einstiegszettel]].",
        props: { quelle: ["[[Luhmann - Kommunikation mit Zettelkästen]]"] },
      },
      {
        title: "Schreiben ist Denken",
        body: "Wer eine Idee in eigenen Worten aufschreiben kann, hat sie verstanden; wer es nicht kann, hat sie noch nicht. Das Umschreiben einer Literaturnotiz in einen Zettel ist deshalb kein Übertragen, sondern die eigentliche Arbeit.\n\nSiehe auch [[Ein Gedanke pro Zettel]].",
        props: { quelle: ["[[Ahrens - Das Zettelkasten-Prinzip]]"] },
      },
      {
        title: "Der Einstiegszettel",
        body: "Ein Zettelkasten braucht Türen. Ein Einstiegszettel sammelt Links zu den Strängen, an denen Du gerade arbeitest — er ersetzt kein Inhaltsverzeichnis, sondern ist selbst ein Zettel, der sich verändert.\n\nStränge: [[Verlinken statt einsortieren]] · [[Schreiben ist Denken]].",
      },
    ],
    literature: [
      {
        title: "Luhmann - Kommunikation mit Zettelkästen",
        body: "Fasse hier in eigenen Worten zusammen, was Du gelesen hast, und halte die Quelle fest. Permanente Notizen verweisen über die Eigenschaft Quelle auf diese Literaturnotiz — in der Spalte Zettel siehst Du, welche das sind.",
        props: { autor: "Niklas Luhmann", jahr: 1981, art: "Artikel", status: "Verarbeitet" },
      },
      {
        title: "Ahrens - Das Zettelkasten-Prinzip",
        body: "Gelesen, aber noch nicht in Zettel übersetzt. Genau dafür ist der Status da: Er sagt Dir beim nächsten Blick, wo die Arbeit liegengeblieben ist.",
        props: { autor: "Sönke Ahrens", jahr: 2017, art: "Buch", status: "Gelesen" },
      },
      {
        title: "Podcast zur Notizarbeit",
        body: "Noch nicht gelesen beziehungsweise gehört. Im Board steht diese Quelle in der ersten Spalte, bis Du sie anfasst.",
        props: { art: "Podcast", status: "Zu lesen" },
      },
    ],
    fleeting: [
      {
        title: "Notizzettel vom Spaziergang",
        body: "Flüchtige Notizen sind Rohmaterial: hingekritzelt, unvollständig, kurzlebig. Beim Verarbeiten wird daraus entweder ein Zettel — oder nichts, und das ist auch in Ordnung.\n\n- Idee: Verweise sind wertvoller als Ordner\n- Nachlesen: stimmt das Luhmann-Zitat so?",
      },
    ],
  },
};

export const ZK_STRINGS_EN: ZettelkastenStrings = {
  name: "Zettelkasten",
  description: "One idea per note, densely linked — fleeting, literature and permanent notes (Luhmann).",
  folders: {
    fleeting: "Fleeting Notes",
    literature: "Literature Notes",
    permanent: "Permanent Notes",
    templates: "Templates",
  },
  folderHints: {
    fleeting: "Quick raw thoughts — short-lived, processed later.",
    literature: "Summaries of what you read, in your own words, with the source.",
    permanent: "Well-formed, lasting ideas — one per note, heavily linked.",
  },
  welcome: {
    file: "Welcome.md",
    title: "Welcome",
    description: "Starting point and quick guide for this vault.",
    intro:
      "This vault follows the Zettelkasten method (Niklas Luhmann): one idea per note — connections grow through links, not folder hierarchies. The slips below point at each other; follow them, then look at the graph.",
    outro:
      "Use Literature.base to track your sources by reading status; Slips.base links permanent notes to the literature they came from through their Source property.",
  },
  welcomeSections: { databases: "Your databases", start: "Where to start" },
  baseFiles: { literature: "Literature.base", slips: "Slips.base" },
  keys: { author: "author", year: "year", kind: "kind", status: "status", url: "url", slips: "slips", source: "source" },
  options: {
    kind: ["Book", "Article", "Video", "Podcast", "Website"],
    status: ["To read", "Read", "Processed"],
  },
  views: { table: "Table", byStatus: "By status" },
  templates: {
    literature: { file: "Literature Note.md", body: "# {{title}}\n\n## Summary\n\n## Source\n" },
    slip: { file: "Slip.md", body: "# {{title}}\n\nOne idea, in full sentences.\n\n## Related slips\n\n- \n" },
  },
  samples: {
    permanent: [
      {
        title: "One thought per slip",
        body: "A permanent note holds exactly one idea, in full sentences and in your own words. Only then can it be reused in a different context later without looking up the original one.\n\nNext: [[Link instead of filing]] and [[Writing is thinking]].",
        props: { source: ["[[Luhmann - Communicating with slip boxes]]"] },
      },
      {
        title: "Link instead of filing",
        body: "A folder forces every note into exactly one drawer. A link lets it sit in as many contexts as it belongs to — which is why a slip box gains value over time instead of becoming unmanageable.\n\nCounterpart: [[One thought per slip]]. Practical consequence: [[The entry slip]].",
        props: { source: ["[[Luhmann - Communicating with slip boxes]]"] },
      },
      {
        title: "Writing is thinking",
        body: "If you can write an idea in your own words, you understood it; if you cannot, you have not yet. Turning a literature note into a slip is therefore not copying — it is the actual work.\n\nSee also [[One thought per slip]].",
        props: { source: ["[[Ahrens - How to take smart notes]]"] },
      },
      {
        title: "The entry slip",
        body: "A slip box needs doors. An entry slip collects links to the threads you are working on — it does not replace a table of contents, it is itself a slip that keeps changing.\n\nThreads: [[Link instead of filing]] · [[Writing is thinking]].",
      },
    ],
    literature: [
      {
        title: "Luhmann - Communicating with slip boxes",
        body: "Summarize what you read in your own words and record the source. Permanent notes point back here through their Source property — the Slips column shows you which ones do.",
        props: { author: "Niklas Luhmann", year: 1981, kind: "Article", status: "Processed" },
      },
      {
        title: "Ahrens - How to take smart notes",
        body: "Read, but not yet turned into slips. That is what the status is for: next time you look, it tells you where the work stopped.",
        props: { author: "Sönke Ahrens", year: 2017, kind: "Book", status: "Read" },
      },
      {
        title: "Podcast on note-taking",
        body: "Not read — or listened to — yet. In the board this source sits in the first column until you touch it.",
        props: { kind: "Podcast", status: "To read" },
      },
    ],
    fleeting: [
      {
        title: "Notes from a walk",
        body: "Fleeting notes are raw material: scribbled, incomplete, short-lived. Processing turns them into a slip — or into nothing, and that is fine too.\n\n- Idea: references are worth more than folders\n- Check: is that Luhmann quote accurate?",
      },
    ],
  },
};
