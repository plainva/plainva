import { welcomeBody, DEFAULT_DAILY_NOTE_TYPE, type VaultTemplateDefinition, type VaultTemplateNote } from "./types";
import type { ParaSample } from "./paraTemplate";

/**
 * The ACE / "Linking Your Thinking" vault template (plan
 * "Vorlagen-Überarbeitung + Plainva-Tour" § 3). Deliberately database-free: this
 * method navigates by Maps of Content, not by rows and columns.
 *
 * Which is exactly why the samples matter. A Home note that links nothing is a
 * heading; the whole claim of the method is that a map beats a hierarchy, and
 * that only shows once Home points at two maps and each map points somewhere
 * real — including out of the Atlas, into an effort.
 */

export interface AceStrings {
  name: string;
  description: string;
  folders: { atlas: string; calendar: string; efforts: string };
  folderHints: { atlas: string; calendar: string; efforts: string };
  welcome: { file: string; title: string; intro: string; outro: string; description?: string };
  welcomeSections: { start: string };
  /** The Home MOC and the two topic MOCs it links. */
  home: { title: string; description: string; lead: string; mapsHeading: string; effortsHeading: string };
  /** Two topic maps; each points at one note that really exists. */
  maps: [{ title: string; body: string; leads: string }, { title: string; body: string; leads: string }];
  samples: {
    /** Linked by the first map. */
    atlas: [ParaSample];
    /** Linked by the second map — a map may point out of the Atlas. */
    efforts: [ParaSample];
    /** File name is a date: use `{{today}}` as the title. */
    calendar: [ParaSample];
  };
}

function note(folder: string, sample: ParaSample): VaultTemplateNote {
  return {
    path: `${folder}/${sample.title}.md`,
    body: `# ${sample.title}\n\n${sample.body}\n`,
    properties: sample.props ? { ...sample.props } : undefined,
  };
}

export function buildAce(s: AceStrings): VaultTemplateDefinition {
  const f = s.folders;
  const [mapA, mapB] = s.maps;
  const atlasNote = s.samples.atlas[0];
  const effortNote = s.samples.efforts[0];

  return {
    id: "ace",
    name: s.name,
    description: s.description,
    folders: [f.atlas, f.calendar, f.efforts],
    notes: [
      {
        path: s.welcome.file,
        description: s.welcome.description ?? s.welcome.title,
        body: welcomeBody(
          s.welcome.title,
          s.welcome.intro,
          [
            { name: f.atlas, description: s.folderHints.atlas },
            { name: f.calendar, description: s.folderHints.calendar },
            { name: f.efforts, description: s.folderHints.efforts },
          ],
          s.welcome.outro,
          [
            {
              heading: s.welcomeSections.start,
              links: [{ name: s.home.title, path: `${f.atlas}/${s.home.title}.md` }],
            },
          ]
        ),
      },
      {
        path: `${f.atlas}/${s.home.title}.md`,
        description: s.home.description,
        // The one note that has to carry links: everything else in this vault is
        // reachable from here, or it is not reachable at all.
        body:
          `# ${s.home.title}\n\n${s.home.lead}\n\n` +
          `## ${s.home.mapsHeading}\n\n- [[${mapA.title}]]\n- [[${mapB.title}]]\n\n` +
          `## ${s.home.effortsHeading}\n\n- [[${effortNote.title}]]\n`,
      },
      {
        path: `${f.atlas}/${mapA.title}.md`,
        body: `# ${mapA.title}\n\n${mapA.body}\n\n${mapA.leads}\n\n- [[${atlasNote.title}]]\n`,
      },
      {
        path: `${f.atlas}/${mapB.title}.md`,
        body: `# ${mapB.title}\n\n${mapB.body}\n\n${mapB.leads}\n\n- [[${effortNote.title}]]\n`,
      },
      note(f.atlas, atlasNote),
      note(f.efforts, effortNote),
      // The Calendar note is a daily note: ACE puts time-bound material there,
      // so the daily-note button and the sidebar calendar have to land in it.
      { ...note(f.calendar, s.samples.calendar[0]), type: DEFAULT_DAILY_NOTE_TYPE },
    ],
    settings: { dailyNotesFolder: f.calendar },
  };
}

// ---------------------------------------------------------------------------
// Reference bundles. The eight machine-translated modules carry their own.
// ---------------------------------------------------------------------------

export const ACE_STRINGS_DE: AceStrings = {
  name: "ACE (Linking Your Thinking)",
  description: "Atlas, Kalender und Vorhaben — MOC-zentriertes Arbeiten nach Nick Milo.",
  folders: { atlas: "Atlas", calendar: "Kalender", efforts: "Vorhaben" },
  folderHints: {
    atlas: "Karten deines Wissens — MOCs und Übersichtsnotizen.",
    calendar: "Zeitgebundenes — Tagesnotizen, Journale, Rückblicke.",
    efforts: "Efforts — alles, woran du aktiv arbeitest.",
  },
  welcome: {
    file: "Willkommen.md",
    title: "Willkommen",
    description: "Startpunkt und Kurzanleitung für diesen Vault.",
    intro:
      "Dieser Vault nutzt das ACE-Schema aus „Linking Your Thinking“ (Nick Milo): Wissen wird über Maps of Content (MOCs) verknüpft statt tief verschachtelt. Die Beispiele unten hängen alle an der Home-Notiz — sieh Dir nach dem Durchklicken den Graphen an.",
    outro:
      "Starte im Atlas mit der Home-Notiz und verlinke von dort in dein Wissen. Ein MOC ist selbst nur eine Notiz: Er darf wachsen, sich teilen und wieder verschwinden.",
  },
  welcomeSections: { start: "Zum Einstieg" },
  home: {
    title: "Home",
    description: "Deine oberste Map of Content.",
    lead: "Die Home-Notiz ist Dein Einstiegspunkt: Verlinke hier die wichtigsten Maps of Content und aktuellen Vorhaben. Kein Ordner leistet das — ein Ordner kann eine Notiz nur an einer Stelle führen.",
    mapsHeading: "Karten",
    effortsHeading: "Aktuelle Vorhaben",
  },
  maps: [
    {
      title: "Schreiben MOC",
      body: "Eine Map of Content sammelt, was zu einem Thema gehört, und ordnet es mit eigenen Worten. Sie ersetzt kein Inhaltsverzeichnis — sie ist Deine Sicht auf ein Thema, zu einem Zeitpunkt.",
      leads: "Von hier weiter:",
    },
    {
      title: "Garten MOC",
      body: "Auch ein MOC darf aus dem Atlas herauszeigen: Diese Karte verweist auf ein laufendes Vorhaben. Genau dieses Kreuz-und-quer ist der Punkt.",
      leads: "Von hier weiter:",
    },
  ],
  samples: {
    atlas: [
      {
        title: "Warum Karten statt Ordner",
        body: "Ein Ordner beantwortet die Frage „wo liegt das?“. Eine Karte beantwortet „was gehört zusammen und warum?“ — und dieselbe Notiz darf auf mehreren Karten stehen.\n\nZurück zur Karte: [[Schreiben MOC]].",
      },
    ],
    efforts: [
      {
        title: "Hochbeet bauen",
        body: "Ein Vorhaben (Effort) ist etwas, woran Du gerade arbeitest — mit einem absehbaren Ende. Es liegt bewusst nicht im Atlas: Der Atlas ist für Bleibendes.\n\n- [ ] Maße festlegen\n- [ ] Holz besorgen\n\nGehört zu [[Garten MOC]].",
      },
    ],
    calendar: [
      {
        title: "{{today}}",
        body: "Zeitgebundenes gehört in den Kalender-Ordner: Tagesnotizen, Rückblicke, alles, was zu einem Datum gehört und nicht zu einem Thema.\n\nHeute angesehen: [[Warum Karten statt Ordner]].",
      },
    ],
  },
};

export const ACE_STRINGS_EN: AceStrings = {
  name: "ACE (Linking Your Thinking)",
  description: "Atlas, Calendar and Efforts — MOC-centred work after Nick Milo.",
  folders: { atlas: "Atlas", calendar: "Calendar", efforts: "Efforts" },
  folderHints: {
    atlas: "Maps of your knowledge — MOCs and overview notes.",
    calendar: "Time-bound material — daily notes, journals, reviews.",
    efforts: "Efforts — everything you are actively working on.",
  },
  welcome: {
    file: "Welcome.md",
    title: "Welcome",
    description: "Starting point and quick guide for this vault.",
    intro:
      "This vault uses the ACE scheme from \"Linking Your Thinking\" (Nick Milo): knowledge is connected through Maps of Content (MOCs) instead of nested deeply. Everything below hangs off the Home note — click through it, then look at the graph.",
    outro:
      "Start in the Atlas with the Home note and link out from there into your knowledge. A MOC is just a note: it may grow, split, and disappear again.",
  },
  welcomeSections: { start: "Where to start" },
  home: {
    title: "Home",
    description: "Your top-level Map of Content.",
    lead: "The Home note is your entry point: link the most important Maps of Content and current efforts here. No folder does that — a folder can only file a note in one place.",
    mapsHeading: "Maps",
    effortsHeading: "Current efforts",
  },
  maps: [
    {
      title: "Writing MOC",
      body: "A Map of Content collects what belongs to a topic and arranges it in your own words. It does not replace a table of contents — it is your view of a topic, at a point in time.",
      leads: "From here:",
    },
    {
      title: "Garden MOC",
      body: "A MOC may point out of the Atlas too: this map leads to an ongoing effort. That crosswise linking is the whole idea.",
      leads: "From here:",
    },
  ],
  samples: {
    atlas: [
      {
        title: "Why maps instead of folders",
        body: "A folder answers \"where is it?\". A map answers \"what belongs together, and why?\" — and the same note may appear on several maps.\n\nBack to the map: [[Writing MOC]].",
      },
    ],
    efforts: [
      {
        title: "Build a raised bed",
        body: "An effort is something you are working on right now, with a foreseeable end. It deliberately does not live in the Atlas: the Atlas is for what lasts.\n\n- [ ] Decide the dimensions\n- [ ] Get the timber\n\nBelongs to [[Garden MOC]].",
      },
    ],
    calendar: [
      {
        title: "{{today}}",
        body: "Time-bound material belongs in the Calendar folder: daily notes, reviews, anything tied to a date rather than to a topic.\n\nLooked at today: [[Why maps instead of folders]].",
      },
    ],
  },
};
