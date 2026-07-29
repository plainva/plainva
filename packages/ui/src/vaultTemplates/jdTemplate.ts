import { welcomeBody, type VaultTemplateDefinition, type VaultTemplateNote } from "./types";

/**
 * The Johnny.Decimal vault template (plan "Vorlagen-Überarbeitung +
 * Plainva-Tour" § 3). Database-free on purpose: the whole method is the
 * numbering, and a number is only convincing once you can see it used.
 *
 * Two notes could not show that. The samples now carry real IDs in the right
 * categories, and the index lists them — which is the method's one rule: if a
 * number is not in the index, it does not exist.
 */

/** One numbered note: `11.01`, its title, and the body. */
export interface JdSample {
  /** ID such as "11.01" — the file is named `<id> <title>.md`. */
  id: string;
  title: string;
  body: string;
}

export interface JdStrings {
  name: string;
  description: string;
  /** Area and category folder names, exactly as they appear on disk. */
  folders: {
    system: string;
    systemIndex: string;
    personal: string;
    finance: string;
    health: string;
    work: string;
    projects: string;
    meetings: string;
  };
  folderHints: { system: string; personal: string; work: string };
  welcome: { file: string; title: string; intro: string; outro: string; description?: string };
  welcomeSections: { start: string };
  /** The index note: `00.00` plus the headings of its two area lists. */
  index: { id: string; title: string; description: string; lead: string };
  /** One sample per populated category, in the order finance / projects / meetings. */
  samples: [JdSample, JdSample, JdSample];
}

function numbered(folder: string, sample: JdSample): VaultTemplateNote {
  return {
    path: `${folder}/${sample.id} ${sample.title}.md`,
    body: `# ${sample.id} ${sample.title}\n\n${sample.body}\n`,
  };
}

export function buildJd(s: JdStrings): VaultTemplateDefinition {
  const f = s.folders;
  const [finance, project, meeting] = s.samples;
  const indexPath = `${f.system}/${f.systemIndex}/${s.index.id} ${s.index.title}.md`;

  return {
    id: "jd",
    name: s.name,
    description: s.description,
    folders: [
      f.system,
      `${f.system}/${f.systemIndex}`,
      f.personal,
      `${f.personal}/${f.finance}`,
      `${f.personal}/${f.health}`,
      f.work,
      `${f.work}/${f.projects}`,
      `${f.work}/${f.meetings}`,
    ],
    notes: [
      {
        path: s.welcome.file,
        description: s.welcome.description ?? s.welcome.title,
        body: welcomeBody(
          s.welcome.title,
          s.welcome.intro,
          [
            { name: f.system, description: s.folderHints.system },
            { name: f.personal, description: s.folderHints.personal },
            { name: f.work, description: s.folderHints.work },
          ],
          s.welcome.outro,
          [
            {
              heading: s.welcomeSections.start,
              links: [{ name: `${s.index.id} ${s.index.title}`, path: indexPath }],
            },
          ]
        ),
      },
      {
        path: indexPath,
        description: s.index.description,
        // Every number that exists is listed here — including the samples, so
        // the index is true on the day the vault is created.
        body:
          `# ${s.index.id} ${s.index.title}\n\n${s.index.lead}\n\n` +
          `## ${f.personal}\n\n` +
          `- ${f.finance}\n  - [[${finance.id} ${finance.title}]]\n` +
          `- ${f.health}\n\n` +
          `## ${f.work}\n\n` +
          `- ${f.projects}\n  - [[${project.id} ${project.title}]]\n` +
          `- ${f.meetings}\n  - [[${meeting.id} ${meeting.title}]]\n`,
      },
      numbered(`${f.personal}/${f.finance}`, finance),
      numbered(`${f.work}/${f.projects}`, project),
      numbered(`${f.work}/${f.meetings}`, meeting),
    ],
  };
}

// ---------------------------------------------------------------------------
// Reference bundles. The eight machine-translated modules carry their own.
// ---------------------------------------------------------------------------

export const JD_STRINGS_DE: JdStrings = {
  name: "Johnny.Decimal",
  description: "Nummerierte Bereiche und Kategorien (10-19 / 11 / 11.01) für strikte Auffindbarkeit.",
  folders: {
    system: "00-09 System",
    systemIndex: "00 Index",
    personal: "10-19 Privat",
    finance: "11 Finanzen",
    health: "12 Gesundheit",
    work: "20-29 Arbeit",
    projects: "21 Projekte",
    meetings: "22 Besprechungen",
  },
  folderHints: {
    system: "Verwaltung des Systems selbst — Index und Konventionen.",
    personal: "Beispielbereich für private Themen.",
    work: "Beispielbereich für berufliche Themen.",
  },
  welcome: {
    file: "Willkommen.md",
    title: "Willkommen",
    description: "Startpunkt und Kurzanleitung für diesen Vault.",
    intro:
      "Dieser Vault ist nach Johnny.Decimal organisiert: maximal zehn Bereiche (10-19, 20-29, …), je Bereich maximal zehn Kategorien (11, 12, …) — und jede Notiz bekommt eine ID wie 11.01. Die Beispiele unten zeigen, wie das aussieht.",
    outro:
      "Benenne Bereiche und Kategorien nach deinen Themen um — die bewusst begrenzte Tiefe (Bereich → Kategorie → ID) ist der Kern der Methode. Eine Nummer wird nie neu vergeben, auch wenn die Notiz verschwindet.",
  },
  welcomeSections: { start: "Zum Einstieg" },
  index: {
    id: "00.00",
    title: "Index",
    description: "Der Johnny.Decimal-Index: alle Nummern an einem Ort.",
    lead: "Führe hier die Liste aller Bereiche, Kategorien und IDs. Wer eine Nummer sucht, schaut zuerst hier — steht sie nicht im Index, gibt es sie nicht.",
  },
  samples: [
    {
      id: "11.01",
      title: "Haushaltsbudget",
      body: "Die erste Notiz in der Kategorie 11 bekommt die 01 — die nächste die 02, und so weiter. Die Nummer bleibt bei der Notiz, auch wenn Du sie umbenennst.",
    },
    {
      id: "21.01",
      title: "Website-Relaunch",
      body: "Auch ein ganzes Projekt bekommt genau eine Nummer. Alles, was dazugehört, verweist auf sie — statt in einem eigenen Unterordner zu verschwinden.",
    },
    {
      id: "22.01",
      title: "Kick-off Website",
      body: "Besprechungsnotizen sind eine eigene Kategorie, damit sie die Projektnummer nicht verstopfen. Diese hier gehört zu [[21.01 Website-Relaunch]].",
    },
  ],
};

export const JD_STRINGS_EN: JdStrings = {
  name: "Johnny.Decimal",
  description: "Numbered areas and categories (10-19 / 11 / 11.01) for strict findability.",
  folders: {
    system: "00-09 System",
    systemIndex: "00 Index",
    personal: "10-19 Personal",
    finance: "11 Finances",
    health: "12 Health",
    work: "20-29 Work",
    projects: "21 Projects",
    meetings: "22 Meetings",
  },
  folderHints: {
    system: "Administration of the system itself — index and conventions.",
    personal: "Example area for personal topics.",
    work: "Example area for professional topics.",
  },
  welcome: {
    file: "Welcome.md",
    title: "Welcome",
    description: "Starting point and quick guide for this vault.",
    intro:
      "This vault is organized with Johnny.Decimal: at most ten areas (10-19, 20-29, …), at most ten categories per area (11, 12, …) — and every note gets an ID like 11.01. The examples below show what that looks like.",
    outro:
      "Rename areas and categories to match your own topics — the deliberately limited depth (area → category → ID) is the heart of the method. A number is never reissued, even when the note is gone.",
  },
  welcomeSections: { start: "Where to start" },
  index: {
    id: "00.00",
    title: "Index",
    description: "The Johnny.Decimal index: every number in one place.",
    lead: "Keep the list of all areas, categories and IDs here. Anyone looking for a number looks here first — if it is not in the index, it does not exist.",
  },
  samples: [
    {
      id: "11.01",
      title: "Household budget",
      body: "The first note in category 11 gets 01 — the next one 02, and so on. The number stays with the note even when you rename it.",
    },
    {
      id: "21.01",
      title: "Website relaunch",
      body: "A whole project gets exactly one number too. Everything belonging to it refers to that number instead of disappearing into a subfolder of its own.",
    },
    {
      id: "22.01",
      title: "Website kick-off",
      body: "Meeting notes are a category of their own so they do not clog the project number. This one belongs to [[21.01 Website relaunch]].",
    },
  ],
};
