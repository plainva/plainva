import { defineBase } from "./baseBuilders";
import { welcomeBody, type VaultTemplateDefinition, type VaultTemplateNote } from "./types";
import type { ParaSample, ParaTemplate } from "./paraTemplate";

/**
 * The GTD vault template (plan "Vorlagen-Überarbeitung + Plainva-Tour" § 3).
 *
 * Shared structure, per-language strings — same reason as PARA and the tour: the
 * parity test requires all ten modules to agree on every folder, note and
 * database, and this template now ships sixteen notes.
 *
 * The point of the samples is that both task boards are FULL: every status has a
 * card and every context has a card. A board with four empty columns teaches
 * nothing about a method whose whole idea is sorting by state and by place.
 */

export interface GtdStrings {
  name: string;
  description: string;
  folders: {
    inbox: string;
    tasks: string;
    projects: string;
    reference: string;
    someday: string;
    templates: string;
  };
  folderHints: { inbox: string; tasks: string; projects: string; reference: string; someday: string };
  welcome: { file: string; title: string; intro: string; outro: string; description?: string };
  welcomeSections: { databases: string; start: string };
  baseFiles: { tasks: string; projects: string };
  /** Frontmatter keys — translated but kept ASCII/umlaut-free. */
  keys: { status: string; context: string; project: string; due: string; tasks: string };
  options: {
    /** Five task states; FIRST is "just arrived", LAST is "done". */
    taskStatus: [string, string, string, string, string];
    /** Four contexts — every one of them gets a sample, so the board is full. */
    context: [string, string, string, string];
    /** Four project states; FIRST not started, LAST done. */
    projectStatus: [string, string, string, string];
  };
  views: { table: string; byStatus: string; byContext: string };
  templates: { task: ParaTemplate; project: ParaTemplate };
  /** The weekly review — the one habit that keeps GTD honest. */
  review: { title: string; description: string; body: string };
  samples: {
    projects: [ParaSample, ParaSample, ParaSample, ParaSample];
    tasks: [ParaSample, ParaSample, ParaSample, ParaSample, ParaSample, ParaSample];
    reference: [ParaSample];
    someday: [ParaSample];
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

export function buildGtd(s: GtdStrings): VaultTemplateDefinition {
  const f = s.folders;
  const b = s.baseFiles;
  const k = s.keys;
  const v = s.views;
  const [inboxState, next, waiting, someday, done] = s.options.taskStatus;
  const [home, work, out, phone] = s.options.context;
  const [pActive, pWaiting, pSomeday, pDone] = s.options.projectStatus;

  return {
    id: "gtd",
    name: s.name,
    description: s.description,
    folders: [f.inbox, f.tasks, f.projects, f.reference, f.someday, f.templates],
    bases: [
      defineBase({
        path: b.tasks,
        sourceFolder: f.tasks,
        columns: [
          {
            key: k.status,
            input: "status",
            options: [
              { value: inboxState, color: "gray" },
              { value: next, color: "blue" },
              { value: waiting, color: "amber" },
              { value: someday, color: "purple" },
              { value: done, color: "green" },
            ],
          },
          {
            key: k.context,
            input: "select",
            options: [
              { value: home, color: "teal" },
              { value: work, color: "blue" },
              { value: out, color: "coral" },
              { value: phone, color: "amber" },
            ],
          },
          { key: k.project, input: "relation", relationBase: b.projects, relationLimit: "one" },
          { key: k.due, input: "date" },
        ],
        views: [
          { name: v.table, type: "table" },
          { name: v.byStatus, type: "board", groupBy: k.status },
          { name: v.byContext, type: "board", groupBy: k.context },
        ],
        newItemTemplate: `${f.templates}/${s.templates.task.file}`,
      }),
      defineBase({
        path: b.projects,
        sourceFolder: f.projects,
        columns: [
          {
            key: k.status,
            input: "status",
            options: [
              { value: pActive, color: "teal" },
              { value: pWaiting, color: "amber" },
              { value: pSomeday, color: "purple" },
              { value: pDone, color: "green" },
            ],
          },
          { key: k.tasks, reverseOf: { base: b.tasks, property: k.project } },
        ],
        views: [
          { name: v.table, type: "table" },
          { name: v.byStatus, type: "board", groupBy: k.status },
        ],
        newItemTemplate: `${f.templates}/${s.templates.project.file}`,
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
            { name: f.inbox, description: s.folderHints.inbox },
            { name: f.tasks, description: s.folderHints.tasks },
            { name: f.projects, description: s.folderHints.projects },
            { name: f.reference, description: s.folderHints.reference },
            { name: f.someday, description: s.folderHints.someday },
          ],
          s.welcome.outro,
          [
            {
              heading: s.welcomeSections.databases,
              links: [
                { name: b.tasks, path: b.tasks },
                { name: b.projects, path: b.projects },
              ],
            },
            {
              // Without these the welcome note has no graph-visible edge: the
              // folder bullets point at managed index.md files, which are hidden.
              heading: s.welcomeSections.start,
              links: [
                { name: s.review.title, path: `${s.review.title}.md` },
                { name: s.samples.projects[0].title, path: `${f.projects}/${s.samples.projects[0].title}.md` },
              ],
            },
          ]
        ),
      },
      {
        path: `${s.review.title}.md`,
        description: s.review.description,
        body: `# ${s.review.title}\n\n${s.review.body}\n`,
      },
      ...s.samples.projects.map((n) => sampleNote(f.projects, n)),
      ...s.samples.tasks.map((n) => sampleNote(f.tasks, n)),
      ...s.samples.reference.map((n) => sampleNote(f.reference, n)),
      ...s.samples.someday.map((n) => sampleNote(f.someday, n)),
      templateNote(f.templates, s.templates.task, b.tasks, { [k.status]: inboxState }),
      templateNote(f.templates, s.templates.project, b.projects, { [k.status]: pActive }),
    ],
    settings: {
      templateFolder: f.templates,
      taskDatabase: b.tasks,
      folderTemplates: [
        { folder: f.tasks, template: s.templates.task.file },
        { folder: f.projects, template: s.templates.project.file },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Reference bundles. The eight machine-translated modules carry their own.
// ---------------------------------------------------------------------------

export const GTD_STRINGS_DE: GtdStrings = {
  name: "GTD",
  description: "Getting Things Done — Eingang, Aufgaben, Projekte, Referenz und Irgendwann-Listen.",
  folders: {
    inbox: "Eingang",
    tasks: "Aufgaben",
    projects: "Projekte",
    reference: "Referenz",
    someday: "Irgendwann",
    templates: "Vorlagen",
  },
  folderHints: {
    inbox: "Sammelstelle für alles Neue — regelmäßig leeren.",
    tasks: "Einzelne nächste Aktionen — nach Status und Kontext organisiert (Aufgaben.base).",
    projects: "Alles, was mehr als einen Schritt braucht (Projekte.base).",
    reference: "Nachschlagematerial ohne Handlungsbedarf.",
    someday: "Ideen und Vielleicht-später-Vorhaben.",
  },
  welcome: {
    file: "Willkommen.md",
    title: "Willkommen",
    description: "Startpunkt und Kurzanleitung für diesen Vault.",
    intro:
      "Dieser Vault folgt Getting Things Done (David Allen): alles landet zuerst im Eingang und wird von dort in konkrete Aufgaben und Projekte verarbeitet. Die Beispiele unten sind echte Notizen — verarbeite sie, verschiebe sie, lösche sie.",
    outro:
      "In Aufgaben.base ordnest du jede Aufgabe über die Eigenschaft Projekt einem Projekt zu; die Projekte.base zeigt in der Spalte Aufgaben automatisch, was zu jedem Projekt gehört. Der Wochenrückblick hält das System verlässlich.",
  },
  welcomeSections: { databases: "Deine Datenbanken", start: "Zum Einstieg" },
  baseFiles: { tasks: "Aufgaben.base", projects: "Projekte.base" },
  keys: { status: "status", context: "kontext", project: "projekt", due: "frist", tasks: "aufgaben" },
  options: {
    taskStatus: ["Eingang", "Nächste", "Wartet", "Irgendwann", "Erledigt"],
    context: ["@Zuhause", "@Arbeit", "@Unterwegs", "@Telefon"],
    projectStatus: ["Aktiv", "Wartet", "Irgendwann", "Abgeschlossen"],
  },
  views: { table: "Tabelle", byStatus: "Nach Status", byContext: "Nach Kontext" },
  templates: {
    task: { file: "Aufgabe.md", body: "# {{title}}\n\n## Notizen\n\n- [ ] \n" },
    project: { file: "Projekt.md", body: "# {{title}}\n\n## Gewünschtes Ergebnis\n\n## Nächste Schritte\n\n- [ ] \n" },
  },
  review: {
    title: "Wochenrückblick",
    description: "Checkliste für den wöchentlichen GTD-Rückblick.",
    body: "- [ ] Eingang auf null bringen\n- [ ] Projektliste durchgehen und nächste Schritte prüfen\n- [ ] Irgendwann-Liste überfliegen\n- [ ] Kalender der nächsten zwei Wochen ansehen",
  },
  samples: {
    projects: [
      {
        title: "Küche renovieren",
        body: "Gewünschtes Ergebnis: Was ist fertig, wenn es fertig ist? In GTD ist alles ein Projekt, was mehr als einen Schritt braucht — auch das, was sich nicht nach „Projekt“ anfühlt.",
        props: { status: "Aktiv" },
      },
      {
        title: "Auto zur Inspektion",
        body: "Wartet auf jemand anderen — hier auf einen Rückruf der Werkstatt. Im Board steht dieses Projekt deshalb in der zweiten Spalte.",
        props: { status: "Wartet" },
      },
      {
        title: "Spanisch lernen",
        body: "Irgendwann, vielleicht. Es steht im System, damit es nicht im Kopf herumliegt — aber es beansprucht gerade keine Aufmerksamkeit.",
        props: { status: "Irgendwann" },
      },
      {
        title: "Steuerunterlagen sortieren",
        body: "Abgeschlossen. Ein fertiges Projekt bleibt sichtbar, bis du es aufräumst — die Datenbank folgt der Datei.",
        props: { status: "Abgeschlossen" },
      },
    ],
    tasks: [
      {
        title: "Ideen sammeln",
        body: "Frisch im Eingang gelandet und noch nicht verarbeitet — deshalb ohne Kontext und ohne Projekt. Beim nächsten Rückblick bekommt sie beides.",
        props: { status: "Eingang" },
      },
      {
        title: "Maße der Küche nehmen",
        body: "Eine Aufgabe ist eine einzelne, konkrete nächste Aktion. Über die Eigenschaft Projekt gehört sie zur Renovierung.",
        props: { status: "Nächste", kontext: "@Zuhause", projekt: "[[Küche renovieren]]", frist: "{{today+2}}" },
      },
      {
        title: "Angebot des Schreiners prüfen",
        body: "Ziehe die Karte im Board in eine andere Spalte: Plainva schreibt den neuen Status in die Notiz.",
        props: { status: "Nächste", kontext: "@Arbeit", projekt: "[[Küche renovieren]]", frist: "{{today+5}}" },
      },
      {
        title: "Werkstatt zurückrufen",
        body: "Wartet auf jemand anderen. Der Kontext @Telefon sammelt alles, was du in einem Rutsch erledigen kannst, sobald du das Telefon in der Hand hast.",
        props: { status: "Wartet", kontext: "@Telefon", projekt: "[[Auto zur Inspektion]]" },
      },
      {
        title: "Sprachkurs in der Umgebung suchen",
        body: "Gehört zu einem Irgendwann-Projekt und wartet mit ihm. Auch das ist eine Entscheidung — nur eben gegen jetzt.",
        props: { status: "Irgendwann", kontext: "@Unterwegs", projekt: "[[Spanisch lernen]]" },
      },
      {
        title: "Belege des Vorjahrs einscannen",
        body: "Erledigt. Die Aufgabe bleibt als Notiz bestehen; nur ihr Status hat sich geändert.",
        props: { status: "Erledigt", kontext: "@Zuhause", projekt: "[[Steuerunterlagen sortieren]]", frist: "{{today-4}}" },
      },
    ],
    reference: [
      {
        title: "Die zwei GTD-Grundfragen",
        body: "Referenz ist Material ohne Handlungsbedarf — es liegt bewusst in keiner Datenbank.\n\nBeim Verarbeiten des Eingangs beantwortest du zwei Fragen: Ist es umsetzbar? Und wenn ja — was ist die eine, konkrete nächste Aktion? Alles Übrige ist Referenz, Irgendwann oder Papierkorb.",
      },
    ],
    someday: [
      {
        title: "Fotobuch vom letzten Sommer",
        body: "Irgendwann heißt nicht nie, sondern nicht jetzt. Beim Wochenrückblick überfliegst du diese Liste — was dich zweimal anspringt, wird ein Projekt.",
      },
    ],
  },
};

export const GTD_STRINGS_EN: GtdStrings = {
  name: "GTD",
  description: "Getting Things Done — inbox, tasks, projects, reference and someday lists.",
  folders: {
    inbox: "Inbox",
    tasks: "Tasks",
    projects: "Projects",
    reference: "Reference",
    someday: "Someday",
    templates: "Templates",
  },
  folderHints: {
    inbox: "Collection point for anything new — empty it regularly.",
    tasks: "Single next actions — organized by status and context (Tasks.base).",
    projects: "Anything that takes more than one step (Projects.base).",
    reference: "Material to look up, with nothing to do about it.",
    someday: "Ideas and maybe-later plans.",
  },
  welcome: {
    file: "Welcome.md",
    title: "Welcome",
    description: "Starting point and quick guide for this vault.",
    intro:
      "This vault follows Getting Things Done (David Allen): everything lands in the Inbox first and is processed from there into concrete tasks and projects. The examples below are real notes — process them, move them, delete them.",
    outro:
      "In Tasks.base you assign each task to a project through its Project property; Projects.base then shows what belongs to each project in its Tasks column. The weekly review is what keeps the system trustworthy.",
  },
  welcomeSections: { databases: "Your databases", start: "Where to start" },
  baseFiles: { tasks: "Tasks.base", projects: "Projects.base" },
  keys: { status: "status", context: "context", project: "project", due: "due", tasks: "tasks" },
  options: {
    taskStatus: ["Inbox", "Next", "Waiting", "Someday", "Done"],
    context: ["@Home", "@Work", "@Errands", "@Phone"],
    projectStatus: ["Active", "Waiting", "Someday", "Done"],
  },
  views: { table: "Table", byStatus: "By status", byContext: "By context" },
  templates: {
    task: { file: "Task.md", body: "# {{title}}\n\n## Notes\n\n- [ ] \n" },
    project: { file: "Project.md", body: "# {{title}}\n\n## Desired outcome\n\n## Next steps\n\n- [ ] \n" },
  },
  review: {
    title: "Weekly review",
    description: "Checklist for the weekly GTD review.",
    body: "- [ ] Get the inbox to zero\n- [ ] Walk the project list and check every next step\n- [ ] Skim the someday list\n- [ ] Look at the next two weeks in the calendar",
  },
  samples: {
    projects: [
      {
        title: "Renovate the kitchen",
        body: "Desired outcome: what is true when this is finished? In GTD anything that takes more than one step is a project — including things that do not feel like one.",
        props: { status: "Active" },
      },
      {
        title: "Car service",
        body: "Waiting on someone else — here, a call back from the garage. That is why this project sits in the second board column.",
        props: { status: "Waiting" },
      },
      {
        title: "Learn Spanish",
        body: "Someday, maybe. It lives in the system so it stops living in your head — but it is not asking for attention right now.",
        props: { status: "Someday" },
      },
      {
        title: "Sort the tax paperwork",
        body: "Done. A finished project stays visible until you clear it out — the database follows the file.",
        props: { status: "Done" },
      },
    ],
    tasks: [
      {
        title: "Collect ideas",
        body: "Just landed in the inbox and not processed yet — which is why it has no context and no project. The next review gives it both.",
        props: { status: "Inbox" },
      },
      {
        title: "Measure the kitchen",
        body: "A task is a single, concrete next action. Through its Project property it belongs to the renovation.",
        props: { status: "Next", context: "@Home", project: "[[Renovate the kitchen]]", due: "{{today+2}}" },
      },
      {
        title: "Review the carpenter's quote",
        body: "Drag the card to another column in the board: Plainva writes the new status into the note.",
        props: { status: "Next", context: "@Work", project: "[[Renovate the kitchen]]", due: "{{today+5}}" },
      },
      {
        title: "Call the garage back",
        body: "Waiting on someone else. The @Phone context collects everything you can clear in one go once the phone is in your hand.",
        props: { status: "Waiting", context: "@Phone", project: "[[Car service]]" },
      },
      {
        title: "Look for a language course nearby",
        body: "Belongs to a someday project and waits with it. That is a decision too — just one against doing it now.",
        props: { status: "Someday", context: "@Errands", project: "[[Learn Spanish]]" },
      },
      {
        title: "Scan last year's receipts",
        body: "Done. The task stays a note; only its status changed.",
        props: { status: "Done", context: "@Home", project: "[[Sort the tax paperwork]]", due: "{{today-4}}" },
      },
    ],
    reference: [
      {
        title: "The two GTD questions",
        body: "Reference is material with nothing to do about it — it deliberately sits in no database.\n\nWhen you process the inbox you answer two questions: is it actionable? And if so — what is the one concrete next action? Everything else is reference, someday, or the bin.",
      },
    ],
    someday: [
      {
        title: "Photo book from last summer",
        body: "Someday does not mean never, it means not now. During the weekly review you skim this list — whatever catches your eye twice becomes a project.",
      },
    ],
  },
};
