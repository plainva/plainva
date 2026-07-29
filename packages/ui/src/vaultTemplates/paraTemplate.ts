import { defineBase } from "./baseBuilders";
import { welcomeBody, type VaultTemplateDefinition, type VaultTemplateNote } from "./types";

/**
 * The PARA vault template (plan "Vorlagen-Überarbeitung + Plainva-Tour" § 3).
 *
 * Built from a shared structure and a per-language string bundle, for the same
 * reason as the tour: the cross-language parity test requires all ten modules to
 * agree on every folder, note and database, and PARA now ships nineteen notes
 * with statuses, relations and dates. Assembling that ten times by hand would
 * guarantee drift — here a language only translates.
 *
 * PARA stays deliberately sober next to the tour: option colours yes, icons and
 * header colours no. It is the workhorse template, not the showcase.
 */

/** One sample note: file title, body, and the typed values it carries. */
export interface ParaSample {
  title: string;
  body: string;
  /** Frontmatter beyond what the builder derives. Dates may use `{{today±N}}`. */
  props?: Record<string, unknown>;
}

/** One shipped note template. */
export interface ParaTemplate {
  /** File name incl. `.md`, e.g. "Projekt.md". */
  file: string;
  body: string;
}

export interface ParaStrings {
  name: string;
  description: string;
  folders: {
    projects: string;
    tasks: string;
    areas: string;
    resources: string;
    archive: string;
    templates: string;
  };
  /** One line per folder for the welcome note's bullet list (Templates omitted:
   * it is plumbing, not a place to work). */
  folderHints: { projects: string; tasks: string; areas: string; resources: string; archive: string };
  welcome: {
    file: string;
    title: string;
    intro: string;
    outro: string;
    /** Frontmatter description; falls back to the title when a language has none. */
    description?: string;
  };
  /** Headings of the welcome note's link sections. */
  welcomeSections: { databases: string; start: string };
  /** `.base` file names at the vault root. */
  baseFiles: { projects: string; tasks: string; areas: string };
  /** Frontmatter keys — translated but kept ASCII/umlaut-free so they stay
   * portable across tools that read the files directly. */
  keys: { status: string; area: string; due: string; tasks: string; project: string; projects: string };
  /** The FIRST status is "open", the LAST "done" — read positionally. */
  options: { projectStatus: [string, string, string, string]; taskStatus: [string, string, string] };
  views: { table: string; byStatus: string };
  templates: { project: ParaTemplate; task: ParaTemplate };
  samples: {
    areas: [ParaSample, ParaSample, ParaSample];
    /** One per project status, so every board column holds a card. */
    projects: [ParaSample, ParaSample, ParaSample, ParaSample];
    tasks: [ParaSample, ParaSample, ParaSample, ParaSample, ParaSample, ParaSample];
    resources: [ParaSample, ParaSample];
    archive: [ParaSample];
  };
}

/** Keeps a template out of the Tasks view; stripped from notes made from it. */
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

export function buildPara(s: ParaStrings): VaultTemplateDefinition {
  const f = s.folders;
  const b = s.baseFiles;
  const k = s.keys;
  const v = s.views;
  const [planned, active, waiting, projectDone] = s.options.projectStatus;
  const [open, doing, taskDone] = s.options.taskStatus;

  return {
    id: "para",
    name: s.name,
    description: s.description,
    folders: [f.projects, f.tasks, f.areas, f.resources, f.archive, f.templates],
    bases: [
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
              { value: projectDone, color: "green" },
            ],
          },
          { key: k.area, input: "relation", relationBase: b.areas, relationLimit: "one" },
          { key: k.due, input: "date" },
          { key: k.tasks, reverseOf: { base: b.tasks, property: k.project } },
        ],
        views: [
          { name: v.table, type: "table" },
          { name: v.byStatus, type: "board", groupBy: k.status },
        ],
        newItemTemplate: `${f.templates}/${s.templates.project.file}`,
      }),
      defineBase({
        path: b.tasks,
        sourceFolder: f.tasks,
        columns: [
          {
            key: k.status,
            input: "status",
            options: [
              { value: open, color: "blue" },
              { value: doing, color: "amber" },
              { value: taskDone, color: "green" },
            ],
          },
          { key: k.project, input: "relation", relationBase: b.projects, relationLimit: "one" },
          { key: k.due, input: "date" },
        ],
        views: [
          { name: v.table, type: "table" },
          { name: v.byStatus, type: "board", groupBy: k.status },
        ],
        newItemTemplate: `${f.templates}/${s.templates.task.file}`,
      }),
      defineBase({
        path: b.areas,
        sourceFolder: f.areas,
        columns: [{ key: k.projects, reverseOf: { base: b.projects, property: k.area } }],
        views: [{ name: v.table, type: "table" }],
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
            { name: f.projects, description: s.folderHints.projects },
            { name: f.tasks, description: s.folderHints.tasks },
            { name: f.areas, description: s.folderHints.areas },
            { name: f.resources, description: s.folderHints.resources },
            { name: f.archive, description: s.folderHints.archive },
          ],
          s.welcome.outro,
          [
            {
              heading: s.welcomeSections.databases,
              links: [
                { name: b.projects, path: b.projects },
                { name: b.tasks, path: b.tasks },
                { name: b.areas, path: b.areas },
              ],
            },
            {
              // The folder bullets above point at managed index.md files, which
              // the graph hides — without these the welcome note sits in the
              // graph without a single visible edge.
              heading: s.welcomeSections.start,
              links: [
                { name: s.samples.projects[1].title, path: `${f.projects}/${s.samples.projects[1].title}.md` },
                { name: s.samples.areas[0].title, path: `${f.areas}/${s.samples.areas[0].title}.md` },
                { name: s.samples.resources[0].title, path: `${f.resources}/${s.samples.resources[0].title}.md` },
              ],
            },
          ]
        ),
      },
      ...s.samples.areas.map((n) => sampleNote(f.areas, n)),
      ...s.samples.projects.map((n) => sampleNote(f.projects, n)),
      ...s.samples.tasks.map((n) => sampleNote(f.tasks, n)),
      ...s.samples.resources.map((n) => sampleNote(f.resources, n)),
      ...s.samples.archive.map((n) => sampleNote(f.archive, n)),
      templateNote(f.templates, s.templates.project, b.projects, { [k.status]: planned }),
      templateNote(f.templates, s.templates.task, b.tasks, { [k.status]: open }),
    ],
    settings: {
      templateFolder: f.templates,
      taskDatabase: b.tasks,
      // A note created in one of these folders starts from the matching
      // template, wherever it was created from. Resources and the archive get
      // none: they hold whatever is worth keeping, in no fixed shape.
      folderTemplates: [
        { folder: f.projects, template: s.templates.project.file },
        { folder: f.tasks, template: s.templates.task.file },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Reference bundles. The eight machine-translated modules carry their own.
// ---------------------------------------------------------------------------

export const PARA_STRINGS_DE: ParaStrings = {
  name: "PARA",
  description: "Projekte, Bereiche, Ressourcen, Archiv — nach Handlungsnähe sortiert (Tiago Forte).",
  folders: {
    projects: "Projekte",
    tasks: "Aufgaben",
    areas: "Bereiche",
    resources: "Ressourcen",
    archive: "Archiv",
    templates: "Vorlagen",
  },
  folderHints: {
    projects: "Vorhaben mit klarem Ziel und Enddatum (Projekte.base).",
    tasks: "Einzelne nächste Schritte — jeder verweist auf sein Projekt (Aufgaben.base).",
    areas: "Dauerhafte Verantwortungsbereiche ohne Enddatum.",
    resources: "Themen, Material und Wissenswertes zum Nachschlagen.",
    archive: "Abgeschlossenes und Inaktives aus den anderen Ordnern.",
  },
  welcome: {
    file: "Willkommen.md",
    description: "Startpunkt und Kurzanleitung für diesen Vault.",
    title: "Willkommen",
    intro:
      "Dieser Vault ist nach der PARA-Methode (Tiago Forte) organisiert: Inhalte werden nach Handlungsnähe sortiert, nicht nach Thema. Die Beispiele unten sind echte Notizen — ändere sie, verschiebe sie, lösche sie.",
    outro:
      "Öffne die Datenbanken, um Projekte nach Status zu sehen, ihnen Aufgaben zuzuordnen und sie mit ihren Bereichen zu verknüpfen — Abgeschlossenes wandert ins Archiv, Links und die index.md-Übersichten pflegt Plainva automatisch.",
  },
  welcomeSections: { databases: "Deine Datenbanken", start: "Zum Einstieg" },
  baseFiles: { projects: "Projekte.base", tasks: "Aufgaben.base", areas: "Bereiche.base" },
  keys: { status: "status", area: "bereich", due: "frist", tasks: "aufgaben", project: "projekt", projects: "projekte" },
  options: {
    projectStatus: ["Geplant", "Aktiv", "Wartet", "Abgeschlossen"],
    taskStatus: ["Offen", "In Arbeit", "Erledigt"],
  },
  views: { table: "Tabelle", byStatus: "Nach Status" },
  templates: {
    project: { file: "Projekt.md", body: "# {{title}}\n\n## Ziel\n\n## Nächste Schritte\n\n- [ ] \n" },
    task: { file: "Aufgabe.md", body: "# {{title}}\n\n## Notizen\n\n- [ ] \n" },
  },
  samples: {
    areas: [
      {
        title: "Team",
        body: "Ein Bereich ist eine dauerhafte Verantwortung ohne Enddatum. Projekte verknüpfen sich über die Eigenschaft Bereich mit ihm — in der Tabelle von Bereiche.base siehst Du sie zurückgespiegelt.",
      },
      { title: "Finanzen", body: "Buchhaltung, Verträge, Versicherungen. Läuft weiter, auch wenn gerade kein Projekt offen ist." },
      { title: "Gesundheit", body: "Alles, was dauerhaft Aufmerksamkeit braucht statt ein Ende zu haben." },
    ],
    projects: [
      {
        title: "Steuererklärung 2026",
        body: "Ein Projekt hat ein klares Ziel und ein absehbares Ende. Dieses hier ist geplant, aber noch nicht begonnen — im Board steht es deshalb in der ersten Spalte.",
        props: { status: "Geplant", bereich: "[[Finanzen]]", frist: "{{today+45}}" },
      },
      {
        title: "Umzug ins neue Büro",
        body: "Das aktive Beispiel: Die Aufgaben unten verweisen über die Eigenschaft Projekt hierher, und Projekte.base spiegelt sie in der Spalte Aufgaben zurück.\n\n- [ ] Ziel des Projekts notieren\n- [ ] Nächsten Schritt festlegen",
        props: { status: "Aktiv", bereich: "[[Team]]", frist: "{{today+21}}" },
      },
      {
        title: "Rückenprogramm",
        body: "Wartet auf etwas außerhalb Deiner Kontrolle — hier auf einen Termin. Genau dafür ist die dritte Spalte da.",
        props: { status: "Wartet", bereich: "[[Gesundheit]]", frist: "{{today+10}}" },
      },
      {
        title: "Website-Relaunch",
        body: "Abgeschlossen. Ein fertiges Projekt bleibt sichtbar, bis Du es ins Archiv verschiebst — die Datenbank folgt der Datei.",
        props: { status: "Abgeschlossen", bereich: "[[Team]]", frist: "{{today-5}}" },
      },
    ],
    tasks: [
      {
        title: "Angebote für Umzugsfirmen einholen",
        body: "Eine Aufgabe ist ein einzelner, konkreter nächster Schritt.",
        props: { status: "Offen", projekt: "[[Umzug ins neue Büro]]", frist: "{{today+3}}" },
      },
      {
        title: "Kündigungsfrist der alten Räume prüfen",
        body: "Angefangen, aber noch nicht fertig — im Board die mittlere Spalte.",
        props: { status: "In Arbeit", projekt: "[[Umzug ins neue Büro]]", frist: "{{today+1}}" },
      },
      {
        title: "Grundriss mit dem Team abstimmen",
        body: "Ziehe die Karte im Board in eine andere Spalte: Plainva schreibt den neuen Status in die Notiz.",
        props: { status: "In Arbeit", projekt: "[[Umzug ins neue Büro]]", frist: "{{today+7}}" },
      },
      {
        title: "Belege sortieren",
        body: "Gehört zu einem Projekt, das noch gar nicht begonnen hat — das ist erlaubt und oft nützlich.",
        props: { status: "Offen", projekt: "[[Steuererklärung 2026]]", frist: "{{today+14}}" },
      },
      {
        title: "Physiotermin vereinbaren",
        body: "Erledigt. Die Aufgabe bleibt als Notiz bestehen; nur ihr Status hat sich geändert.",
        props: { status: "Erledigt", projekt: "[[Rückenprogramm]]", frist: "{{today-2}}" },
      },
      {
        title: "Alte Domain umleiten",
        body: "Der letzte Schritt des abgeschlossenen Projekts.",
        props: { status: "Erledigt", projekt: "[[Website-Relaunch]]", frist: "{{today-6}}" },
      },
    ],
    resources: [
      {
        title: "Checkliste Büroumzug",
        body: "Ressourcen sind Material zum Nachschlagen — kein Ziel, kein Enddatum. Sie liegen bewusst in keiner Datenbank: nicht alles muss Zeilen und Spalten haben.\n\n- [ ] Adressänderung bei Bank und Versicherung\n- [ ] Netzwerk und Drucker einmessen",
      },
      {
        title: "Was PARA von Ordnern unterscheidet",
        body: "PARA sortiert nach Handlungsnähe: Projekte haben ein Ende, Bereiche laufen weiter, Ressourcen sind Nachschlagewerk, das Archiv ist alles Übrige. Verschiebe eine Notiz zwischen den Ordnern, sobald sich ihre Rolle ändert.",
      },
    ],
    archive: [
      {
        title: "Messeauftritt 2025",
        body: "So sieht Archiviertes aus: eine ganz normale Notiz, nur in einem anderen Ordner. Nichts geht verloren, sie taucht bloß nicht mehr in den aktiven Datenbanken auf.",
      },
    ],
  },
};

export const PARA_STRINGS_EN: ParaStrings = {
  name: "PARA",
  description: "Projects, Areas, Resources, Archive — sorted by actionability (Tiago Forte).",
  folders: {
    projects: "Projects",
    tasks: "Tasks",
    areas: "Areas",
    resources: "Resources",
    archive: "Archive",
    templates: "Templates",
  },
  folderHints: {
    projects: "Efforts with a clear goal and an end date (Projects.base).",
    tasks: "Single next steps — each points at its project (Tasks.base).",
    areas: "Ongoing responsibilities without an end date.",
    resources: "Topics, material and references worth keeping.",
    archive: "Completed and inactive items from the other folders.",
  },
  welcome: {
    file: "Welcome.md",
    description: "Starting point and quick guide for this vault.",
    title: "Welcome",
    intro:
      "This vault is organized with the PARA method (Tiago Forte): content is sorted by actionability, not by topic. The examples below are real notes — change them, move them, delete them.",
    outro:
      "Open the databases to see projects by status, assign tasks to them and link them to their areas — finished work moves to the Archive, while links and the index.md overviews are maintained automatically.",
  },
  welcomeSections: { databases: "Your databases", start: "Where to start" },
  baseFiles: { projects: "Projects.base", tasks: "Tasks.base", areas: "Areas.base" },
  keys: { status: "status", area: "area", due: "due", tasks: "tasks", project: "project", projects: "projects" },
  options: {
    projectStatus: ["Planned", "Active", "Waiting", "Done"],
    taskStatus: ["Open", "In progress", "Done"],
  },
  views: { table: "Table", byStatus: "By status" },
  templates: {
    project: { file: "Project.md", body: "# {{title}}\n\n## Goal\n\n## Next steps\n\n- [ ] \n" },
    task: { file: "Task.md", body: "# {{title}}\n\n## Notes\n\n- [ ] \n" },
  },
  samples: {
    areas: [
      {
        title: "Team",
        body: "An area is an ongoing responsibility with no end date. Projects link to it through their Area property — the table in Areas.base mirrors them back.",
      },
      { title: "Finances", body: "Bookkeeping, contracts, insurance. It keeps running even when no project is open." },
      { title: "Health", body: "Everything that needs lasting attention instead of having an end." },
    ],
    projects: [
      {
        title: "Tax return 2026",
        body: "A project has a clear goal and a foreseeable end. This one is planned but not started — which is why it sits in the first board column.",
        props: { status: "Planned", area: "[[Finances]]", due: "{{today+45}}" },
      },
      {
        title: "Move to the new office",
        body: "The active example: the tasks below point here through their Project property, and Projects.base mirrors them back in its Tasks column.\n\n- [ ] Write down the project goal\n- [ ] Decide the next step",
        props: { status: "Active", area: "[[Team]]", due: "{{today+21}}" },
      },
      {
        title: "Back programme",
        body: "Waiting on something outside your control — here, an appointment. That is what the third column is for.",
        props: { status: "Waiting", area: "[[Health]]", due: "{{today+10}}" },
      },
      {
        title: "Website relaunch",
        body: "Done. A finished project stays visible until you move it to the Archive — the database follows the file.",
        props: { status: "Done", area: "[[Team]]", due: "{{today-5}}" },
      },
    ],
    tasks: [
      {
        title: "Get quotes from movers",
        body: "A task is a single, concrete next step.",
        props: { status: "Open", project: "[[Move to the new office]]", due: "{{today+3}}" },
      },
      {
        title: "Check the notice period for the old rooms",
        body: "Started but not finished — the middle board column.",
        props: { status: "In progress", project: "[[Move to the new office]]", due: "{{today+1}}" },
      },
      {
        title: "Agree the floor plan with the team",
        body: "Drag the card to another column in the board: Plainva writes the new status into the note.",
        props: { status: "In progress", project: "[[Move to the new office]]", due: "{{today+7}}" },
      },
      {
        title: "Sort the receipts",
        body: "Belongs to a project that has not started yet — that is allowed, and often useful.",
        props: { status: "Open", project: "[[Tax return 2026]]", due: "{{today+14}}" },
      },
      {
        title: "Book the physio appointment",
        body: "Done. The task stays a note; only its status changed.",
        props: { status: "Done", project: "[[Back programme]]", due: "{{today-2}}" },
      },
      {
        title: "Redirect the old domain",
        body: "The last step of the finished project.",
        props: { status: "Done", project: "[[Website relaunch]]", due: "{{today-6}}" },
      },
    ],
    resources: [
      {
        title: "Office move checklist",
        body: "Resources are material to look things up in — no goal, no end date. They deliberately sit in no database: not everything needs rows and columns.\n\n- [ ] Change of address at the bank and the insurer\n- [ ] Measure out network and printers",
      },
      {
        title: "What sets PARA apart from folders",
        body: "PARA sorts by actionability: projects end, areas keep running, resources are reference, the archive is everything else. Move a note between the folders as soon as its role changes.",
      },
    ],
    archive: [
      {
        title: "Trade fair 2025",
        body: "This is what archived looks like: an ordinary note, just in another folder. Nothing is lost — it simply no longer shows up in the active databases.",
      },
    ],
  },
};
