import { defineBase } from "./baseBuilders";
import { welcomeBody, DEFAULT_DAILY_NOTE_TYPE, type VaultTemplateDefinition, type VaultTemplateNote } from "./types";

/**
 * The Journal vault template (plan "Vorlagen-Überarbeitung + Plainva-Tour" § 3).
 *
 * It shipped a database and a template and not a single entry, so the calendar
 * view opened empty and the table had no rows — the two things the template
 * exists to show. It now scaffolds today and yesterday, named in the daily-note
 * format, so both views are populated the moment the vault is created.
 */

export interface JournalSample {
  /** Day offset for the file name and the date property: 0 = today. */
  offset: 0 | -1;
  mood: string;
  tags: string[];
  body: string;
}

export interface JournalStrings {
  name: string;
  description: string;
  folders: { journal: string; templates: string };
  folderHints: { journal: string; templates: string };
  welcome: { file: string; title: string; intro: string; outro: string; description?: string };
  welcomeSections: { databases: string; start: string };
  baseFile: string;
  /** Frontmatter keys — translated but kept ASCII/umlaut-free. */
  keys: { date: string; mood: string; tags: string };
  /** Five moods, coloured in the board and the table. */
  moods: [string, string, string, string, string];
  views: { table: string; calendar: string };
  template: { file: string; description: string; body: string };
  /** Today and yesterday, so the calendar is not empty on day one. */
  samples: [JournalSample, JournalSample];
}

export function buildJournal(s: JournalStrings): VaultTemplateDefinition {
  const f = s.folders;
  const k = s.keys;
  const [good, neutral, bad, productive, tired] = s.moods;

  const day = (sample: JournalSample): VaultTemplateNote => {
    const token = sample.offset === 0 ? "{{today}}" : `{{today${sample.offset}}}`;
    return {
      path: `${f.journal}/${token}.md`,
      // A scaffolded entry is a daily note like any other, so the daily-note
      // setting and the calendar recognize it.
      type: DEFAULT_DAILY_NOTE_TYPE,
      properties: { [k.date]: token, [k.mood]: sample.mood, [k.tags]: sample.tags },
      body: `# ${token}\n\n${sample.body}\n`,
    };
  };

  return {
    id: "journal",
    name: s.name,
    description: s.description,
    folders: [f.journal, f.templates],
    bases: [
      defineBase({
        path: s.baseFile,
        sourceFolder: f.journal,
        columns: [
          { key: k.date, input: "date" },
          {
            key: k.mood,
            input: "select",
            options: [
              { value: good, color: "green" },
              { value: neutral, color: "gray" },
              { value: bad, color: "coral" },
              { value: productive, color: "teal" },
              { value: tired, color: "amber" },
            ],
          },
          { key: k.tags, input: "tags" },
        ],
        views: [
          { name: s.views.table, type: "table", sort: [{ property: k.date, direction: "DESC" }] },
          { name: s.views.calendar, type: "calendar", dateField: k.date },
        ],
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
            { name: f.journal, description: s.folderHints.journal },
            { name: f.templates, description: s.folderHints.templates },
          ],
          s.welcome.outro,
          [
            { heading: s.welcomeSections.databases, links: [{ name: s.baseFile, path: s.baseFile }] },
            {
              heading: s.welcomeSections.start,
              links: [{ name: s.template.file.replace(/\.md$/, ""), path: `${f.templates}/${s.template.file}` }],
            },
          ]
        ),
      },
      ...s.samples.map(day),
      {
        path: `${f.templates}/${s.template.file}`,
        description: s.template.description,
        type: DEFAULT_DAILY_NOTE_TYPE,
        // The empty task line is scaffolding, not work: without this the
        // template itself shows up in the Tasks view. Notes created FROM the
        // template drop the key (applyTemplatePlaceholders strips it).
        properties: { [k.date]: "{{date}}", plainva: { tasks: false } },
        body: s.template.body,
      },
    ],
    settings: {
      dailyNotesFolder: f.journal,
      templateFolder: f.templates,
      dailyNoteTemplate: s.template.file,
    },
  };
}

// ---------------------------------------------------------------------------
// Reference bundles. The eight machine-translated modules carry their own.
// ---------------------------------------------------------------------------

export const JOURNAL_STRINGS_DE: JournalStrings = {
  name: "Journal",
  description: "Tagesnotizen mit vorbereiteter Vorlage und Journal-Datenbank — Daily Notes sind sofort verdrahtet.",
  folders: { journal: "Journal", templates: "Vorlagen" },
  folderHints: {
    journal: "Deine Tagesnotizen, eine pro Tag.",
    templates: "Vorlagen für neue Notizen — die Tagesnotiz-Vorlage ist bereits eingerichtet.",
  },
  welcome: {
    file: "Willkommen.md",
    title: "Willkommen",
    description: "Startpunkt und Kurzanleitung für diesen Vault.",
    intro:
      "Dieser Vault ist auf tägliches Schreiben ausgelegt: Tagesnotizen landen im Ordner Journal und entstehen aus der Vorlage im Ordner Vorlagen. Zwei Beispieltage liegen schon da — heute und gestern.",
    outro:
      "Öffne den Kalender in der rechten Seitenleiste und klicke auf einen Tag, um die nächste Tagesnotiz anzulegen. Journal.base zeigt deine Einträge als Tabelle und im Kalender — mit Datum, Stimmung und Schlagworten.",
  },
  welcomeSections: { databases: "Deine Datenbanken", start: "Zum Einstieg" },
  baseFile: "Journal.base",
  keys: { date: "datum", mood: "stimmung", tags: "schlagworte" },
  moods: ["Gut", "Neutral", "Schlecht", "Produktiv", "Müde"],
  views: { table: "Tabelle", calendar: "Kalender" },
  template: {
    file: "Tagesnotiz.md",
    description: "Vorlage für neue Tagesnotizen — {{date}}, {{time}} und {{title}} werden ersetzt.",
    body: "# {{title}}\n\n## Notizen\n\n## Aufgaben\n\n- [ ] \n",
  },
  samples: [
    {
      offset: 0,
      mood: "Produktiv",
      tags: ["arbeit", "schreiben"],
      body: "So sieht ein Eintrag aus. Stimmung und Schlagworte stehen im Frontmatter — deshalb kann Journal.base danach sortieren und filtern, ohne dass Du etwas doppelt pflegst.\n\n## Notizen\n\n- Der Kalender in der rechten Seitenleiste führt zu jedem Tag.\n\n## Aufgaben\n\n- [x] Erste Tagesnotiz schreiben\n- [ ] Morgen wiederkommen",
    },
    {
      offset: -1,
      mood: "Müde",
      tags: ["alltag"],
      body: "Auch ein kurzer Eintrag ist ein Eintrag. Über die Zeit ist nicht der einzelne Tag interessant, sondern die Reihe — dafür ist die Tabellenansicht nach Datum da.\n\n## Notizen\n\n- Wenig geschafft, dafür früh Feierabend.",
    },
  ],
};

export const JOURNAL_STRINGS_EN: JournalStrings = {
  name: "Journal",
  description: "Daily notes with a prepared template and a journal database — daily notes are wired from the start.",
  folders: { journal: "Journal", templates: "Templates" },
  folderHints: {
    journal: "Your daily notes, one per day.",
    templates: "Templates for new notes — the daily-note template is already set up.",
  },
  welcome: {
    file: "Welcome.md",
    title: "Welcome",
    description: "Starting point and quick guide for this vault.",
    intro:
      "This vault is built for writing every day: daily notes land in the Journal folder and start from the template in Templates. Two example days are already there — today and yesterday.",
    outro:
      "Open the calendar in the right sidebar and click a day to create the next daily note. Journal.base shows your entries as a table and in the calendar — with date, mood and tags.",
  },
  welcomeSections: { databases: "Your databases", start: "Where to start" },
  baseFile: "Journal.base",
  keys: { date: "date", mood: "mood", tags: "tags" },
  moods: ["Good", "Neutral", "Bad", "Productive", "Tired"],
  views: { table: "Table", calendar: "Calendar" },
  template: {
    file: "Daily Note.md",
    description: "Template for new daily notes — {{date}}, {{time}} and {{title}} are replaced.",
    body: "# {{title}}\n\n## Notes\n\n## Tasks\n\n- [ ] \n",
  },
  samples: [
    {
      offset: 0,
      mood: "Productive",
      tags: ["work", "writing"],
      body: "This is what an entry looks like. Mood and tags live in the frontmatter — which is how Journal.base can sort and filter by them without you maintaining anything twice.\n\n## Notes\n\n- The calendar in the right sidebar takes you to any day.\n\n## Tasks\n\n- [x] Write the first daily note\n- [ ] Come back tomorrow",
    },
    {
      offset: -1,
      mood: "Tired",
      tags: ["everyday"],
      body: "A short entry is an entry too. Over time the interesting thing is not the single day but the run of them — that is what the table sorted by date is for.\n\n## Notes\n\n- Not much done, but an early finish.",
    },
  ],
};
