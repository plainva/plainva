import { defineBase } from "./baseBuilders";
import { welcomeBody, DEFAULT_DAILY_NOTE_TYPE, type VaultTemplateBase, type VaultTemplateDefinition, type VaultTemplateNote } from "./types";

/**
 * The "Plainva Tour" showcase template (plan "Vorlagen-Überarbeitung +
 * Plainva-Tour" § 2): a vault that demonstrates what Plainva can do instead of
 * describing it — a pinboard of quick notes, daily notes on a calendar, PARA+
 * areas/projects/tasks across gallery, board, timeline and tree views, and note
 * templates wired to their databases.
 *
 * Like `defineBase`, the STRUCTURE lives here ONCE and each language module only
 * passes translated strings. That is not tidiness: the tour is an order of
 * magnitude bigger than the older templates, and the cross-language parity test
 * requires all ten modules to agree on every folder, note and database count.
 * Assembling it ten times would guarantee drift.
 *
 * Note templates keep their `{{title}}`/`{{date}}` tokens verbatim — those are
 * resolved when a NOTE is created from the template. Sample notes may use
 * `{{today±N}}`, which the scaffolder resolves once while the vault is created.
 */

/** Folder names — the only structural strings, referenced by every path below. */
export interface TourFolders {
  quickNotes: string;
  journal: string;
  areas: string;
  projects: string;
  tasks: string;
  resources: string;
  archive: string;
  attachments: string;
  templates: string;
}

/** One shipped note template: file name (inside the templates folder) + body. */
export interface TourTemplate {
  /** File name incl. `.md`, e.g. "Projekt.md". */
  file: string;
  body: string;
  /** Only for templates that are NOT a `.base` new-item template: a template's
   * whole frontmatter is copied into every note created from it, so a
   * description would leak into each entry. */
  description?: string;
}

export interface TourStrings {
  name: string;
  description: string;
  folders: TourFolders;
  /** One line per folder for the welcome note's bullet list. */
  folderHints: Record<keyof TourFolders, string>;
  welcome: { file: string; title: string; intro: string; outro: string };
  templates: {
    project: TourTemplate;
    task: TourTemplate;
    area: TourTemplate;
    resource: TourTemplate;
    quickNote: TourTemplate;
    daily: TourTemplate;
    /** Deliberately NOT assigned to a database — shows the "all templates" group. */
    meeting: TourTemplate;
  };
  /** `.base` file names (without folder), used by the templates' assignments. */
  baseFiles: { areas: string; projects: string; tasks: string; resources: string; quickNotes: string };
  /** Column keys — translated but kept ASCII/umlaut-free so they stay portable
   * frontmatter keys. `done`/`due` follow the standard task-database convention
   * so the Tasks view recognizes the shipped database. */
  keys: {
    focus: string; cover: string; projects: string;
    status: string; area: string; start: string; end: string; tasks: string;
    done: string; project: string; due: string; priority: string;
  };
  /** Localized option values. The FIRST status is "open", the LAST "done" —
   * the task model reads them positionally. */
  options: {
    projectStatus: [string, string, string, string];
    taskStatus: [string, string, string];
    priority: [string, string, string];
  };
  /** Localized view names (Obsidian requires a non-empty name per view). */
  views: { table: string; board: string; timeline: string; gallery: string; list: string; tree: string };
  /** Localized headers for the stable sub-item keys. */
  subItems: { parent: string; children: string };
  /** Sample notes: title + one or two lines of body. */
  samples: {
    areas: TourSample[];
    projects: TourSample[];
    tasks: TourSample[];
  };
}

/** A sample note: file title, body text, plus the typed values it carries. */
export interface TourSample {
  title: string;
  body: string;
  icon?: string;
  color?: string;
  /** Extra frontmatter beyond what the builder derives (dates, relations …). */
  props?: Record<string, unknown>;
}

/** Petrol-toned sample sketch, embedded by a pinboard card and the cheat sheet. */
const SKETCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160" width="320" height="160" role="img" aria-label="Sketch">
  <rect width="320" height="160" rx="10" fill="#f2f7f6"/>
  <g fill="none" stroke="#2a7f7b" stroke-width="2.5" stroke-linecap="round">
    <path d="M56 104 L128 60"/>
    <path d="M128 60 L212 92"/>
    <path d="M212 92 L268 56"/>
  </g>
  <g fill="#2a7f7b">
    <circle cx="56" cy="104" r="11"/>
    <circle cx="128" cy="60" r="11"/>
    <circle cx="212" cy="92" r="11"/>
    <circle cx="268" cy="56" r="11"/>
  </g>
  <rect x="40" y="128" width="240" height="7" rx="3.5" fill="#cfe3e1"/>
</svg>
`;

/** Neutral card cover for the gallery views. */
const COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 240" width="480" height="240" role="img" aria-label="Cover">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a7f7b"/>
      <stop offset="1" stop-color="#174f52"/>
    </linearGradient>
  </defs>
  <rect width="480" height="240" fill="url(#g)"/>
  <g fill="#ffffff" opacity="0.16">
    <circle cx="392" cy="52" r="76"/>
    <circle cx="96" cy="204" r="52"/>
  </g>
  <rect x="40" y="104" width="150" height="10" rx="5" fill="#ffffff" opacity="0.85"/>
  <rect x="40" y="130" width="96" height="10" rx="5" fill="#ffffff" opacity="0.55"/>
</svg>
`;

/** Frontmatter marker every shipped note template carries: keeps the template
 * itself out of the Tasks view. The engine strips it (together with
 * `templateFor`) from notes created FROM the template. */
const TEMPLATE_MARKER = { tasks: false } as const;

function templateNote(folder: string, tpl: TourTemplate, forBase?: string): VaultTemplateNote {
  const plainva: Record<string, unknown> = { ...TEMPLATE_MARKER };
  if (forBase) plainva.templateFor = [`[[${forBase}]]`];
  const note: VaultTemplateNote = {
    path: `${folder}/${tpl.file}`,
    body: tpl.body,
    properties: { plainva },
  };
  if (tpl.description) note.description = tpl.description;
  return note;
}

/** A sample note in `folder`, with icon/colour folded into the plainva map. */
function sampleNote(folder: string, sample: TourSample): VaultTemplateNote {
  const props: Record<string, unknown> = { ...(sample.props ?? {}) };
  const plainva: Record<string, unknown> = {};
  if (sample.icon) plainva.icon = sample.icon;
  if (sample.color) plainva.header_color = sample.color;
  if (Object.keys(plainva).length > 0) props.plainva = plainva;
  return { path: `${folder}/${sample.title}.md`, body: `# ${sample.title}\n\n${sample.body}\n`, properties: props };
}

/** The PARA+ core: areas (gallery), projects (board + timeline), tasks
 * (board + tree). The relations are wired both ways so the reverse columns show
 * real data the moment the vault is indexed. */
function coreBases(s: TourStrings): VaultTemplateBase[] {
  const f = s.folders;
  const k = s.keys;
  const b = s.baseFiles;
  const v = s.views;
  const [planned, active, waiting, finished] = s.options.projectStatus;
  const [open, doing, done] = s.options.taskStatus;
  const [high, medium, low] = s.options.priority;

  return [
    defineBase({
      path: b.areas,
      sourceFolder: f.areas,
      columns: [
        { key: k.focus, input: "text" },
        { key: k.cover, input: "text" },
        { key: k.projects, reverseOf: { base: b.projects, property: k.area } },
      ],
      // Gallery first: the cover images are the point of this view.
      views: [
        { name: v.gallery, type: "gallery", coverImage: k.cover },
        { name: v.list, type: "list" },
      ],
      newItemTemplate: `${f.templates}/${s.templates.area.file}`,
    }),
    defineBase({
      path: b.projects,
      sourceFolder: f.projects,
      columns: [
        {
          key: k.status,
          input: "status",
          options: [
            { value: planned, color: "blue" },
            { value: active, color: "teal" },
            { value: waiting, color: "amber" },
            { value: finished, color: "green" },
          ],
        },
        { key: k.area, input: "relation", relationBase: b.areas, relationLimit: "one" },
        { key: k.start, input: "date" },
        { key: k.end, input: "date" },
        { key: k.tasks, reverseOf: { base: b.tasks, property: k.project } },
      ],
      views: [
        { name: v.table, type: "table" },
        // Whole-column tint here, chips on the task board — the two modes side
        // by side is the point.
        { name: v.board, type: "board", groupBy: k.status, boardColorMode: "column" },
        { name: v.timeline, type: "timeline", dateField: k.start, endField: k.end },
      ],
      newItemTemplate: `${f.templates}/${s.templates.project.file}`,
    }),
    defineBase({
      path: b.tasks,
      sourceFolder: f.tasks,
      // Column shape follows the standard task-database convention (checkbox +
      // status with open first/done last + due date), so the Tasks view treats
      // the shipped database exactly like one created by its own one-click setup.
      columns: [
        { key: k.done, input: "checkbox" },
        {
          key: k.status,
          input: "status",
          options: [
            { value: open, color: "blue" },
            { value: doing, color: "amber" },
            { value: done, color: "green" },
          ],
        },
        { key: k.project, input: "relation", relationBase: b.projects, relationLimit: "one" },
        { key: k.due, input: "date" },
        {
          key: k.priority,
          input: "select",
          options: [
            { value: high, color: "coral" },
            { value: medium, color: "amber" },
            { value: low, color: "gray" },
          ],
        },
        { key: "parent", input: "relation", relationBase: b.tasks, relationLimit: "one", displayName: s.subItems.parent },
        { key: "subitems", reverseOf: { base: b.tasks, property: "parent" }, displayName: s.subItems.children },
      ],
      views: [
        { name: v.board, type: "board", groupBy: k.status },
        { name: v.table, type: "table" },
        { name: v.tree, type: "table", subItemsProperty: "parent" },
      ],
      newItemTemplate: `${f.templates}/${s.templates.task.file}`,
    }),
  ];
}

/** Assembles the tour from one language's strings. */
export function buildPlainvaTour(s: TourStrings): VaultTemplateDefinition {
  const f = s.folders;
  const folders = [
    f.quickNotes,
    f.journal,
    f.areas,
    f.projects,
    f.tasks,
    f.resources,
    f.archive,
    f.attachments,
    f.templates,
  ];

  const welcome: VaultTemplateNote = {
    path: s.welcome.file,
    body: welcomeBody(
      s.welcome.title,
      s.welcome.intro,
      (Object.keys(f) as (keyof TourFolders)[]).map((key) => ({ name: f[key], description: s.folderHints[key] })),
      s.welcome.outro
    ),
  };

  const t = s.templates;
  const notes: VaultTemplateNote[] = [
    // The parity test expects the root welcome note first.
    welcome,
    templateNote(f.templates, t.project, s.baseFiles.projects),
    templateNote(f.templates, t.task, s.baseFiles.tasks),
    templateNote(f.templates, t.area, s.baseFiles.areas),
    templateNote(f.templates, t.resource, s.baseFiles.resources),
    templateNote(f.templates, t.quickNote, s.baseFiles.quickNotes),
    // The daily template belongs to the daily-note setting, not to a database.
    { ...templateNote(f.templates, t.daily), type: DEFAULT_DAILY_NOTE_TYPE, properties: { plainva: { ...TEMPLATE_MARKER }, datum: "{{date}}" } },
    templateNote(f.templates, t.meeting),
    ...s.samples.areas.map((n) => sampleNote(f.areas, n)),
    ...s.samples.projects.map((n) => sampleNote(f.projects, n)),
    ...s.samples.tasks.map((n) => sampleNote(f.tasks, n)),
  ];

  return {
    id: "plainva",
    name: s.name,
    description: s.description,
    folders,
    notes,
    bases: coreBases(s),
    rawFiles: [
      { path: `${f.attachments}/skizze.svg`, content: SKETCH_SVG },
      { path: `${f.attachments}/cover.svg`, content: COVER_SVG },
    ],
    settings: {
      templateFolder: f.templates,
      dailyNotesFolder: f.journal,
      dailyNoteTemplate: t.daily.file,
      taskDatabase: s.baseFiles.tasks,
    },
  };
}

/** English strings — also the fallback bundle for languages whose own tour
 * translation has not landed yet (structure is identical either way). */
export const TOUR_STRINGS_EN: TourStrings = {
  name: "Plainva Tour",
  description: "A guided vault: pinboard, daily notes, areas, projects and tasks — every view Plainva offers, filled with examples.",
  folders: {
    quickNotes: "Quick Notes",
    journal: "Journal",
    areas: "Areas",
    projects: "Projects",
    tasks: "Tasks",
    resources: "Resources",
    archive: "Archive",
    attachments: "Attachments",
    templates: "Templates",
  },
  folderHints: {
    quickNotes: "Anything without a place yet — shown as a pinboard.",
    journal: "One note per day, shown on a calendar.",
    areas: "Ongoing responsibilities, as a gallery.",
    projects: "Things with an end, on a board and a timeline.",
    tasks: "The standard task database — board and table.",
    resources: "Material you want to keep.",
    archive: "Finished work; moving a note here removes it from the active views.",
    attachments: "Images and files.",
    templates: "Note templates, each wired to its database.",
  },
  welcome: {
    file: "Welcome.md",
    title: "Welcome to Plainva",
    intro: "This vault is a tour. Every folder below is filled with examples, and every database shows a different view — open them and change things: nothing here is precious.",
    outro: "Everything you see is plain Markdown in this folder. Delete what you do not need, rename the rest, and the vault is yours.",
  },
  templates: {
    project: { file: "Project.md", body: "# {{title}}\n\n## Goal\n\n## Next steps\n\n- [ ] \n" },
    task: { file: "Task.md", body: "# {{title}}\n\n" },
    area: { file: "Area.md", body: "# {{title}}\n\n## What good looks like\n\n" },
    resource: { file: "Resource.md", body: "# {{title}}\n\n## Why it is worth keeping\n\n" },
    quickNote: { file: "Quick Note.md", body: "# {{title}}\n\n" },
    daily: {
      file: "Daily Note.md",
      description: "Template for new daily notes — {{date}}, {{time}} and {{title}} are replaced.",
      body: "# {{title}}\n\n## Tasks\n\n- [ ] \n\n## Notes\n\n",
    },
    meeting: {
      file: "Meeting.md",
      description: "Not assigned to a database — it appears under \"Show all templates\".",
      body: "# {{title}}\n\n**Date:** {{date}}\n\n## Attendees\n\n## Decisions\n\n## Tasks\n\n- [ ] \n",
    },
  },
  baseFiles: {
    areas: "Areas.base",
    projects: "Projects.base",
    tasks: "Tasks.base",
    resources: "Resources.base",
    quickNotes: "Quick Notes.base",
  },
  keys: {
    focus: "focus", cover: "cover", projects: "projects",
    status: "status", area: "area", start: "start", end: "end", tasks: "tasks",
    done: "done", project: "project", due: "due", priority: "priority",
  },
  options: {
    projectStatus: ["Planned", "Active", "Waiting", "Finished"],
    taskStatus: ["Open", "In progress", "Done"],
    priority: ["High", "Medium", "Low"],
  },
  views: { table: "Table", board: "Board", timeline: "Timeline", gallery: "Gallery", list: "List", tree: "Tree" },
  subItems: { parent: "Parent item", children: "Sub-items" },
  samples: {
    areas: [
      { title: "Work", body: "Everything I am paid for. Projects here have deadlines.", icon: "💼", color: "#2a7f7b", props: { focus: "Deliver without overtime", cover: "Attachments/cover.svg" } },
      { title: "Home", body: "The flat, the paperwork, the things that keep running.", icon: "🏠", color: "#8a6d3b", props: { focus: "Nothing overdue", cover: "Attachments/cover.svg" } },
      { title: "Health", body: "Sleep, movement, food — the boring things that decide everything else.", icon: "🌱", color: "#3d7f4a", props: { focus: "Three sessions a week" } },
      { title: "Learning", body: "What I want to be better at next year.", icon: "📚", color: "#5a5a8a", props: { focus: "One book a month" } },
    ],
    projects: [
      { title: "Website relaunch", body: "New start page and a clearer structure.\n\nSee [[Work]].", props: { status: "Active", area: "[[Work]]", start: "{{today-6}}", end: "{{today+9}}" } },
      { title: "Move the office", body: "Smaller room, same desk.", props: { status: "Planned", area: "[[Work]]", start: "{{today+4}}", end: "{{today+13}}" } },
      { title: "Tax return", body: "Waiting for two receipts.", props: { status: "Waiting", area: "[[Home]]", start: "{{today-3}}", end: "{{today+6}}" } },
      { title: "Marathon plan", body: "Twelve weeks, three runs a week.\n\nBelongs to [[Health]].", props: { status: "Finished", area: "[[Health]]", start: "{{today-12}}", end: "{{today-2}}" } },
    ],
    tasks: [
      { title: "Draft the start page", body: "Two variants, then decide.", props: { done: false, status: "In progress", project: "[[Website relaunch]]", due: "{{today+1}}", priority: "High" } },
      { title: "Collect feedback", body: "Three people, fifteen minutes each.", props: { done: false, status: "Open", project: "[[Website relaunch]]", due: "{{today+5}}", priority: "Medium", parent: "[[Draft the start page]]" } },
      { title: "Write the texts", body: "Short sentences.", props: { done: false, status: "Open", project: "[[Website relaunch]]", due: "{{today+7}}", priority: "Medium" } },
      { title: "Sort out the old pages", body: "", props: { done: true, status: "Done", project: "[[Website relaunch]]", due: "{{today-2}}", priority: "Low" } },
      { title: "Measure the new room", body: "Desk is 160 cm.", props: { done: false, status: "Open", project: "[[Move the office]]", due: "{{today+3}}", priority: "Medium" } },
      { title: "Order boxes", body: "", props: { done: false, status: "Open", project: "[[Move the office]]", due: "{{today+8}}", priority: "Low" } },
      { title: "Ask for the receipts", body: "By mail, keep it short.", props: { done: false, status: "In progress", project: "[[Tax return]]", due: "{{today}}", priority: "High" } },
      { title: "Book the physio", body: "", props: { done: true, status: "Done", project: "[[Marathon plan]]", due: "{{today-4}}", priority: "Medium" } },
      { title: "Plan next season", body: "Shorter distances, more sleep.", props: { done: false, status: "Open", due: "{{today+11}}", priority: "Low" } },
    ],
  },
};

/** German strings. */
export const TOUR_STRINGS_DE: TourStrings = {
  name: "Plainva-Tour",
  description: "Ein geführter Vault: Pinnwand, Tagesnotizen, Bereiche, Projekte und Aufgaben — jede Ansicht, die Plainva kann, mit Beispielen gefüllt.",
  folders: {
    quickNotes: "Notizzettel",
    journal: "Journal",
    areas: "Bereiche",
    projects: "Projekte",
    tasks: "Aufgaben",
    resources: "Ressourcen",
    archive: "Archiv",
    attachments: "Anhänge",
    templates: "Vorlagen",
  },
  folderHints: {
    quickNotes: "Alles, was noch keinen Platz hat — als Pinnwand.",
    journal: "Eine Notiz pro Tag, im Kalender.",
    areas: "Dauerthemen, als Galerie.",
    projects: "Vorhaben mit Ende, auf Board und Zeitleiste.",
    tasks: "Die Standard-Aufgabendatenbank — Board und Tabelle.",
    resources: "Material, das Du behalten willst.",
    archive: "Abgeschlossenes; wer eine Notiz hierher schiebt, nimmt sie aus den aktiven Ansichten.",
    attachments: "Bilder und Dateien.",
    templates: "Notiz-Vorlagen, jede ihrer Datenbank zugeordnet.",
  },
  welcome: {
    file: "Willkommen.md",
    title: "Willkommen bei Plainva",
    intro: "Dieser Vault ist eine Tour. Jeder Ordner unten ist mit Beispielen gefüllt, und jede Datenbank zeigt eine andere Ansicht — öffne sie und ändere etwas: Hier ist nichts kostbar.",
    outro: "Alles, was Du siehst, ist reines Markdown in diesem Ordner. Lösche, was Du nicht brauchst, benenne den Rest um — dann gehört der Vault Dir.",
  },
  templates: {
    project: { file: "Projekt.md", body: "# {{title}}\n\n## Ziel\n\n## Nächste Schritte\n\n- [ ] \n" },
    task: { file: "Aufgabe.md", body: "# {{title}}\n\n" },
    area: { file: "Bereich.md", body: "# {{title}}\n\n## Woran ich merke, dass es rundläuft\n\n" },
    resource: { file: "Ressource.md", body: "# {{title}}\n\n## Warum das aufhebenswert ist\n\n" },
    quickNote: { file: "Notizzettel.md", body: "# {{title}}\n\n" },
    daily: {
      file: "Tagesnotiz.md",
      description: "Vorlage für neue Tagesnotizen — {{date}}, {{time}} und {{title}} werden ersetzt.",
      body: "# {{title}}\n\n## Aufgaben\n\n- [ ] \n\n## Notizen\n\n",
    },
    meeting: {
      file: "Besprechung.md",
      description: "Keiner Datenbank zugeordnet — erscheint unter „Alle Vorlagen anzeigen“.",
      body: "# {{title}}\n\n**Datum:** {{date}}\n\n## Teilnehmer\n\n## Entscheidungen\n\n## Aufgaben\n\n- [ ] \n",
    },
  },
  baseFiles: {
    areas: "Bereiche.base",
    projects: "Projekte.base",
    tasks: "Aufgaben.base",
    resources: "Ressourcen.base",
    quickNotes: "Notizzettel.base",
  },
  keys: {
    focus: "fokus", cover: "cover", projects: "projekte",
    status: "status", area: "bereich", start: "start", end: "ende", tasks: "aufgaben",
    done: "erledigt", project: "projekt", due: "frist", priority: "prio",
  },
  options: {
    projectStatus: ["Geplant", "Aktiv", "Wartet", "Abgeschlossen"],
    taskStatus: ["Offen", "In Arbeit", "Erledigt"],
    priority: ["Hoch", "Mittel", "Niedrig"],
  },
  views: { table: "Tabelle", board: "Board", timeline: "Zeitleiste", gallery: "Galerie", list: "Liste", tree: "Baum" },
  subItems: { parent: "Übergeordnet", children: "Unterelemente" },
  samples: {
    areas: [
      { title: "Arbeit", body: "Alles, wofür ich bezahlt werde. Projekte hier haben Fristen.", icon: "💼", color: "#2a7f7b", props: { fokus: "Liefern ohne Überstunden", cover: "Anhänge/cover.svg" } },
      { title: "Zuhause", body: "Die Wohnung, der Papierkram, die Dinge, die weiterlaufen müssen.", icon: "🏠", color: "#8a6d3b", props: { fokus: "Nichts überfällig", cover: "Anhänge/cover.svg" } },
      { title: "Gesundheit", body: "Schlaf, Bewegung, Essen — das Langweilige, das über alles andere entscheidet.", icon: "🌱", color: "#3d7f4a", props: { fokus: "Dreimal die Woche" } },
      { title: "Lernen", body: "Worin ich nächstes Jahr besser sein will.", icon: "📚", color: "#5a5a8a", props: { fokus: "Ein Buch im Monat" } },
    ],
    projects: [
      { title: "Website-Relaunch", body: "Neue Startseite und eine klarere Struktur.\n\nGehört zu [[Arbeit]].", props: { status: "Aktiv", bereich: "[[Arbeit]]", start: "{{today-6}}", ende: "{{today+9}}" } },
      { title: "Büro umziehen", body: "Kleinerer Raum, gleicher Schreibtisch.", props: { status: "Geplant", bereich: "[[Arbeit]]", start: "{{today+4}}", ende: "{{today+13}}" } },
      { title: "Steuererklärung", body: "Warte noch auf zwei Belege.", props: { status: "Wartet", bereich: "[[Zuhause]]", start: "{{today-3}}", ende: "{{today+6}}" } },
      { title: "Marathon-Plan", body: "Zwölf Wochen, drei Läufe pro Woche.\n\nGehört zu [[Gesundheit]].", props: { status: "Abgeschlossen", bereich: "[[Gesundheit]]", start: "{{today-12}}", ende: "{{today-2}}" } },
    ],
    tasks: [
      { title: "Startseite entwerfen", body: "Zwei Varianten, dann entscheiden.", props: { erledigt: false, status: "In Arbeit", projekt: "[[Website-Relaunch]]", frist: "{{today+1}}", prio: "Hoch" } },
      { title: "Rückmeldungen einsammeln", body: "Drei Leute, je eine Viertelstunde.", props: { erledigt: false, status: "Offen", projekt: "[[Website-Relaunch]]", frist: "{{today+5}}", prio: "Mittel", parent: "[[Startseite entwerfen]]" } },
      { title: "Texte schreiben", body: "Kurze Sätze.", props: { erledigt: false, status: "Offen", projekt: "[[Website-Relaunch]]", frist: "{{today+7}}", prio: "Mittel" } },
      { title: "Alte Seiten aussortieren", body: "", props: { erledigt: true, status: "Erledigt", projekt: "[[Website-Relaunch]]", frist: "{{today-2}}", prio: "Niedrig" } },
      { title: "Neuen Raum ausmessen", body: "Schreibtisch ist 160 cm.", props: { erledigt: false, status: "Offen", projekt: "[[Büro umziehen]]", frist: "{{today+3}}", prio: "Mittel" } },
      { title: "Kartons bestellen", body: "", props: { erledigt: false, status: "Offen", projekt: "[[Büro umziehen]]", frist: "{{today+8}}", prio: "Niedrig" } },
      { title: "Belege anfordern", body: "Per Mail, kurz halten.", props: { erledigt: false, status: "In Arbeit", projekt: "[[Steuererklärung]]", frist: "{{today}}", prio: "Hoch" } },
      { title: "Physio buchen", body: "", props: { erledigt: true, status: "Erledigt", projekt: "[[Marathon-Plan]]", frist: "{{today-4}}", prio: "Mittel" } },
      { title: "Nächste Saison planen", body: "Kürzere Strecken, mehr Schlaf.", props: { erledigt: false, status: "Offen", frist: "{{today+11}}", prio: "Niedrig" } },
    ],
  },
};
