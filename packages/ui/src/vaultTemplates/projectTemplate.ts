import { defineBase } from "./baseBuilders";
import { welcomeBody, type VaultTemplateDefinition, type VaultTemplateNote } from "./types";
import type { ParaSample, ParaTemplate } from "./paraTemplate";

/**
 * The project vault template (plan "Projektwerkzeug" § 3, step S13).
 *
 * Every column this plan added exists here IN OPERATION, not as an empty
 * schema: a rollup that counts the open tasks of a project, a column footer
 * that sums the planned effort, a milestone that is a date without an end, and
 * a dependency that makes one task wait for another. A template whose views
 * open empty teaches nothing — that was the lesson of the July template rework,
 * and it applies to a project tool more than to anything else.
 *
 * The dependency column keeps the STABLE key `blockedBy` in every language and
 * carries a localized `displayName` instead. It is read by name across the app
 * (the task toggle strips it, the timeline draws it); a translated key would
 * make the feature silently stop working in nine of ten languages.
 */

/** The one frontmatter key that must not be translated. */
export const DEPENDENCY_KEY = "blockedBy";

export interface ProjectStrings {
  name: string;
  description: string;
  folders: { projects: string; tasks: string; milestones: string; people: string; templates: string };
  folderHints: { projects: string; tasks: string; milestones: string; people: string };
  welcome: { file: string; title: string; intro: string; outro: string; description?: string };
  welcomeSections: { databases: string; start: string };
  baseFiles: { projects: string; tasks: string; milestones: string; people: string };
  /** Frontmatter keys — translated but kept ASCII/umlaut-free. */
  keys: {
    status: string;
    start: string;
    end: string;
    date: string;
    project: string;
    person: string;
    effort: string;
    tasks: string;
    open: string;
    plannedEffort: string;
    role: string;
  };
  /** Localized header for the stable `blockedBy` key. */
  dependsOnLabel: string;
  options: {
    /** Four project states; FIRST not started, LAST done. */
    projectStatus: [string, string, string, string];
    /** Four task states; LAST is "done" (the rollup counts everything else). */
    taskStatus: [string, string, string, string];
    /** Three milestone states. */
    milestoneStatus: [string, string, string];
    /** Three roles for the people database. */
    role: [string, string, string];
  };
  views: { table: string; byStatus: string; schedule: string; dates: string };
  templates: { project: ParaTemplate; task: ParaTemplate };
  samples: {
    projects: [ParaSample, ParaSample];
    tasks: [ParaSample, ParaSample, ParaSample, ParaSample, ParaSample];
    milestones: [ParaSample, ParaSample, ParaSample];
    people: [ParaSample, ParaSample];
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

export function buildProject(s: ProjectStrings): VaultTemplateDefinition {
  const f = s.folders;
  const b = s.baseFiles;
  const k = s.keys;
  const v = s.views;
  const [pPlanned, pRunning, pWaiting, pDone] = s.options.projectStatus;
  const [tOpen, tRunning, tReview, tDone] = s.options.taskStatus;
  const [mOpen, mAtRisk, mReached] = s.options.milestoneStatus;
  const [rLead, rMember, rStakeholder] = s.options.role;

  return {
    id: "project",
    name: s.name,
    description: s.description,
    folders: [f.projects, f.tasks, f.milestones, f.people, f.templates],
    bases: [
      defineBase({
        path: b.projects,
        sourceFolder: f.projects,
        columns: [
          {
            key: k.status,
            input: "status",
            options: [
              { value: pPlanned, color: "gray" },
              { value: pRunning, color: "teal" },
              { value: pWaiting, color: "amber" },
              { value: pDone, color: "green" },
            ],
          },
          { key: k.start, input: "date" },
          { key: k.end, input: "date" },
          { key: k.tasks, reverseOf: { base: b.tasks, property: k.project } },
          // The two computed columns: how much is left, and how much it was
          // planned to cost. Both read the tasks through the reverse column.
          { key: k.open, rollup: { through: k.tasks, of: k.status, fn: "countWhere", where: { op: "!=", value: tDone } } },
          { key: k.plannedEffort, rollup: { through: k.tasks, of: k.effort, fn: "sum" } },
        ],
        views: [
          // The footer sums the same column the rollup adds up per project —
          // the plan's total, one line under the table.
          { name: v.table, type: "table", summaries: { [k.plannedEffort]: "Sum" } },
          { name: v.byStatus, type: "board", groupBy: k.status },
          { name: v.schedule, type: "timeline", dateField: k.start, endField: k.end },
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
              { value: tOpen, color: "gray" },
              { value: tRunning, color: "teal" },
              { value: tReview, color: "amber" },
              { value: tDone, color: "green" },
            ],
          },
          { key: k.project, input: "relation", relationBase: b.projects, relationLimit: "one" },
          { key: k.person, input: "relation", relationBase: b.people, relationLimit: "one" },
          { key: k.start, input: "date" },
          { key: k.end, input: "date" },
          { key: k.effort, input: "number" },
          { key: DEPENDENCY_KEY, input: "list", displayName: s.dependsOnLabel },
        ],
        views: [
          { name: v.table, type: "table", summaries: { [k.effort]: "Sum" } },
          { name: v.byStatus, type: "board", groupBy: k.status },
          // The dependency arrows are drawn here, between the two tasks the
          // samples chain together.
          { name: v.schedule, type: "timeline", dateField: k.start, endField: k.end },
        ],
        newItemTemplate: `${f.templates}/${s.templates.task.file}`,
      }),
      defineBase({
        path: b.milestones,
        sourceFolder: f.milestones,
        columns: [
          {
            key: k.status,
            input: "status",
            options: [
              { value: mOpen, color: "gray" },
              { value: mAtRisk, color: "coral" },
              { value: mReached, color: "green" },
            ],
          },
          { key: k.date, input: "date" },
          { key: k.project, input: "relation", relationBase: b.projects, relationLimit: "one" },
        ],
        views: [
          { name: v.table, type: "table", sort: [{ property: k.date, direction: "ASC" }] },
          // A date and no end: every entry renders as a diamond, not a bar.
          { name: v.dates, type: "timeline", dateField: k.date },
        ],
      }),
      defineBase({
        path: b.people,
        sourceFolder: f.people,
        columns: [
          {
            key: k.role,
            input: "select",
            options: [
              { value: rLead, color: "blue" },
              { value: rMember, color: "teal" },
              { value: rStakeholder, color: "purple" },
            ],
          },
          { key: k.tasks, reverseOf: { base: b.tasks, property: k.person } },
          { key: k.open, rollup: { through: k.tasks, of: k.status, fn: "countWhere", where: { op: "!=", value: tDone } } },
        ],
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
            { name: f.milestones, description: s.folderHints.milestones },
            { name: f.people, description: s.folderHints.people },
          ],
          s.welcome.outro,
          [
            {
              heading: s.welcomeSections.databases,
              links: [
                { name: b.projects, path: b.projects },
                { name: b.tasks, path: b.tasks },
                { name: b.milestones, path: b.milestones },
                { name: b.people, path: b.people },
              ],
            },
            {
              heading: s.welcomeSections.start,
              links: s.samples.projects.map((p) => ({ name: p.title, path: `${f.projects}/${p.title}.md` })),
            },
          ]
        ),
      },
      ...s.samples.projects.map((p) => sampleNote(f.projects, p)),
      ...s.samples.tasks.map((t) => sampleNote(f.tasks, t)),
      ...s.samples.milestones.map((m) => sampleNote(f.milestones, m)),
      ...s.samples.people.map((p) => sampleNote(f.people, p)),
      templateNote(f.templates, s.templates.project, b.projects, {
        [k.status]: pPlanned,
        [k.start]: "{{date}}",
      }),
      templateNote(f.templates, s.templates.task, b.tasks, {
        [k.status]: tOpen,
        [k.effort]: 60,
      }),
    ],
    settings: { templateFolder: f.templates },
  };
}

// ---------------------------------------------------------------------------
// Reference bundles. The eight machine-translated modules carry their own.
// ---------------------------------------------------------------------------

export const PROJECT_STRINGS_DE: ProjectStrings = {
  name: "Projekt",
  description: "Projekte, Aufgaben, Meilensteine und Beteiligte — mit Auswertungen, Abhängigkeiten und einer Zeitleiste.",
  folders: { projects: "Projekte", tasks: "Aufgaben", milestones: "Meilensteine", people: "Beteiligte", templates: "Vorlagen" },
  folderHints: {
    projects: "Ein Vorhaben je Notiz, mit Start, Ende und Status.",
    tasks: "Die Arbeit selbst — einem Projekt und einer Person zugeordnet.",
    milestones: "Ein Termin ohne Dauer: erreicht oder nicht.",
    people: "Wer beteiligt ist — und woran sie gerade arbeiten.",
  },
  welcome: {
    file: "Willkommen.md",
    title: "Willkommen",
    intro: "Diese Vorlage zeigt ein Projekt so, wie es in Plainva funktioniert: vier Datenbanken, die aufeinander zeigen.",
    outro:
      "In **Projekte** rechnen zwei Spalten mit: **Offen** zählt die Aufgaben, die noch nicht erledigt sind, **Geplant** addiert ihren Aufwand. Beides steht in keiner Datei — es wird bei jeder Abfrage neu ermittelt.\n\nIn **Aufgaben** trägt die Spalte **Wartet auf** die Abhängigkeiten. In der Zeitleiste zeichnet Plainva daraus Pfeile; beginnt eine Aufgabe, bevor ihre Vorgängerin fertig ist, wird der Pfeil rot. Geändert wird dabei nichts — die Daten sind Deine Aussage, Plainva sagt nur, dass zwei davon einander widersprechen.\n\nIn **Meilensteine** hat jeder Eintrag ein Datum und kein Ende. Genau daran erkennt die Zeitleiste einen Moment und zeichnet eine Raute statt eines Balkens.",
  },
  welcomeSections: { databases: "Datenbanken", start: "Zum Einstieg" },
  baseFiles: { projects: "Projekte.base", tasks: "Aufgaben.base", milestones: "Meilensteine.base", people: "Beteiligte.base" },
  keys: {
    status: "status",
    start: "start",
    end: "ende",
    date: "datum",
    project: "projekt",
    person: "person",
    effort: "aufwand",
    tasks: "aufgaben",
    open: "offen",
    plannedEffort: "geplant",
    role: "rolle",
  },
  dependsOnLabel: "Wartet auf",
  options: {
    projectStatus: ["Geplant", "Läuft", "Wartet", "Fertig"],
    taskStatus: ["Offen", "In Arbeit", "Prüfung", "Erledigt"],
    milestoneStatus: ["Offen", "Gefährdet", "Erreicht"],
    role: ["Leitung", "Team", "Auftraggeber"],
  },
  views: { table: "Tabelle", byStatus: "Nach Status", schedule: "Zeitplan", dates: "Termine" },
  templates: {
    project: {
      file: "Projekt.md",
      body: "# {{title}}\n\n## Ziel\n\n{{cursor}}\n\n## Umfang\n\n- \n\n## Risiken\n\n- \n",
    },
    task: {
      file: "Aufgabe.md",
      body: "# {{title}}\n\n## Was zu tun ist\n\n{{cursor}}\n\n## Fertig, wenn\n\n- \n",
    },
  },
  samples: {
    projects: [
      {
        title: "Website-Relaunch",
        body: "Die Seite ist seit vier Jahren unverändert. Neuer Aufbau, neue Texte, gleiche Inhalte.",
        props: { status: "Läuft", start: "{{today-14}}", ende: "{{today+30}}" },
      },
      {
        title: "Umzug ins neue Büro",
        body: "Zwei Etagen, dreißig Arbeitsplätze, ein Wochenende Zeit.",
        props: { status: "Geplant", start: "{{today+21}}", ende: "{{today+60}}" },
      },
    ],
    tasks: [
      {
        title: "Inhalte sichten",
        body: "Jede Seite einmal lesen und entscheiden: bleibt, wird neu geschrieben, fällt weg.",
        props: { status: "Erledigt", projekt: "[[Website-Relaunch]]", person: "[[Anna Berg]]", start: "{{today-14}}", ende: "{{today-7}}", aufwand: 480 },
      },
      {
        title: "Struktur festlegen",
        body: "Aus der Sichtung eine Navigation bauen. Wartet auf die Sichtung — vorher gibt es nichts zu sortieren.",
        props: { status: "In Arbeit", projekt: "[[Website-Relaunch]]", person: "[[Anna Berg]]", start: "{{today-6}}", ende: "{{today+2}}", aufwand: 240, blockedBy: [{ uid: "[[Inhalte sichten]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Texte schreiben",
        body: "Alle Seiten, die bleiben, neu formulieren.",
        props: { status: "Offen", projekt: "[[Website-Relaunch]]", person: "[[Jonas Feld]]", start: "{{today+3}}", ende: "{{today+17}}", aufwand: 900, blockedBy: [{ uid: "[[Struktur festlegen]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Umzugsplan erstellen",
        body: "Wer packt was, wer fährt wann, was bleibt stehen.",
        props: { status: "Offen", projekt: "[[Umzug ins neue Büro]]", person: "[[Jonas Feld]]", start: "{{today+21}}", ende: "{{today+28}}", aufwand: 300 },
      },
      {
        title: "Angebote einholen",
        body: "Drei Speditionen anfragen und vergleichen.",
        props: { status: "Prüfung", projekt: "[[Umzug ins neue Büro]]", person: "[[Anna Berg]]", start: "{{today+7}}", ende: "{{today+14}}", aufwand: 120 },
      },
    ],
    milestones: [
      {
        title: "Struktur steht",
        body: "Ab hier wird nur noch geschrieben, nicht mehr sortiert.",
        props: { status: "Offen", datum: "{{today+2}}", projekt: "[[Website-Relaunch]]" },
      },
      {
        title: "Seite ist online",
        body: "Der Tag, an dem umgeschaltet wird.",
        props: { status: "Offen", datum: "{{today+30}}", projekt: "[[Website-Relaunch]]" },
      },
      {
        title: "Schlüsselübergabe",
        body: "Ohne diesen Termin fängt der Umzug nicht an.",
        props: { status: "Gefährdet", datum: "{{today+21}}", projekt: "[[Umzug ins neue Büro]]" },
      },
    ],
    people: [
      { title: "Anna Berg", body: "Führt das Projekt und entscheidet im Zweifel.", props: { rolle: "Leitung" } },
      { title: "Jonas Feld", body: "Schreibt und plant mit.", props: { rolle: "Team" } },
    ],
  },
};

export const PROJECT_STRINGS_EN: ProjectStrings = {
  name: "Project",
  description: "Projects, tasks, milestones and people — with rollups, dependencies and a timeline.",
  folders: { projects: "Projects", tasks: "Tasks", milestones: "Milestones", people: "People", templates: "Templates" },
  folderHints: {
    projects: "One undertaking per note, with a start, an end and a status.",
    tasks: "The work itself — assigned to a project and to a person.",
    milestones: "A date with no duration: reached or not.",
    people: "Who is involved — and what they are working on.",
  },
  welcome: {
    file: "Welcome.md",
    title: "Welcome",
    intro: "This template shows a project the way it works in Plainva: four databases pointing at one another.",
    outro:
      "In **Projects** two columns do the counting: **Open** counts the tasks that are not done yet, **Planned** adds up their effort. Neither is stored in a file — both are worked out again on every query.\n\nIn **Tasks** the **Waits for** column carries the dependencies. The timeline draws arrows from them; when a task starts before its predecessor finishes, the arrow turns red. Nothing is changed in the process — the dates are your statement, Plainva only says that two of them disagree.\n\nIn **Milestones** every entry has a date and no end. That is exactly how the timeline recognizes a moment and draws a diamond instead of a bar.",
  },
  welcomeSections: { databases: "Databases", start: "Start here" },
  baseFiles: { projects: "Projects.base", tasks: "Tasks.base", milestones: "Milestones.base", people: "People.base" },
  keys: {
    status: "status",
    start: "start",
    end: "end",
    date: "date",
    project: "project",
    person: "person",
    effort: "effort",
    tasks: "tasks",
    open: "open",
    plannedEffort: "planned",
    role: "role",
  },
  dependsOnLabel: "Waits for",
  options: {
    projectStatus: ["Planned", "Running", "Waiting", "Done"],
    taskStatus: ["Open", "In progress", "Review", "Done"],
    milestoneStatus: ["Open", "At risk", "Reached"],
    role: ["Lead", "Team", "Stakeholder"],
  },
  views: { table: "Table", byStatus: "By status", schedule: "Schedule", dates: "Dates" },
  templates: {
    project: {
      file: "Project.md",
      body: "# {{title}}\n\n## Goal\n\n{{cursor}}\n\n## Scope\n\n- \n\n## Risks\n\n- \n",
    },
    task: {
      file: "Task.md",
      body: "# {{title}}\n\n## What to do\n\n{{cursor}}\n\n## Done when\n\n- \n",
    },
  },
  samples: {
    projects: [
      {
        title: "Website relaunch",
        body: "The site has not changed in four years. New structure, new copy, same content.",
        props: { status: "Running", start: "{{today-14}}", end: "{{today+30}}" },
      },
      {
        title: "Move to the new office",
        body: "Two floors, thirty desks, one weekend.",
        props: { status: "Planned", start: "{{today+21}}", end: "{{today+60}}" },
      },
    ],
    tasks: [
      {
        title: "Review the content",
        body: "Read every page once and decide: keep, rewrite, drop.",
        props: { status: "Done", project: "[[Website relaunch]]", person: "[[Anna Berg]]", start: "{{today-14}}", end: "{{today-7}}", effort: 480 },
      },
      {
        title: "Settle the structure",
        body: "Turn the review into a navigation. Waits for the review — there is nothing to sort before it.",
        props: { status: "In progress", project: "[[Website relaunch]]", person: "[[Anna Berg]]", start: "{{today-6}}", end: "{{today+2}}", effort: 240, blockedBy: [{ uid: "[[Review the content]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Write the copy",
        body: "Rewrite every page that stays.",
        props: { status: "Open", project: "[[Website relaunch]]", person: "[[Jonas Feld]]", start: "{{today+3}}", end: "{{today+17}}", effort: 900, blockedBy: [{ uid: "[[Settle the structure]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Draw up the moving plan",
        body: "Who packs what, who drives when, what stays put.",
        props: { status: "Open", project: "[[Move to the new office]]", person: "[[Jonas Feld]]", start: "{{today+21}}", end: "{{today+28}}", effort: 300 },
      },
      {
        title: "Collect quotes",
        body: "Ask three movers and compare.",
        props: { status: "Review", project: "[[Move to the new office]]", person: "[[Anna Berg]]", start: "{{today+7}}", end: "{{today+14}}", effort: 120 },
      },
    ],
    milestones: [
      {
        title: "Structure agreed",
        body: "From here on it is writing, not sorting.",
        props: { status: "Open", date: "{{today+2}}", project: "[[Website relaunch]]" },
      },
      {
        title: "Site is live",
        body: "The day the switch is flipped.",
        props: { status: "Open", date: "{{today+30}}", project: "[[Website relaunch]]" },
      },
      {
        title: "Keys handed over",
        body: "Without this date the move does not start.",
        props: { status: "At risk", date: "{{today+21}}", project: "[[Move to the new office]]" },
      },
    ],
    people: [
      { title: "Anna Berg", body: "Leads the project and decides when in doubt.", props: { role: "Lead" } },
      { title: "Jonas Feld", body: "Writes and plans along.", props: { role: "Team" } },
    ],
  },
};

export const PROJECT_STRINGS_FR: ProjectStrings = {
  name: "Projet",
  description: "Projets, tâches, jalons et personnes — avec des totaux calculés, des dépendances et une chronologie.",
  folders: { projects: "Projets", tasks: "Tâches", milestones: "Jalons", people: "Personnes", templates: "Modèles" },
  folderHints: {
    projects: "Un projet par note, avec un début, une fin et un statut.",
    tasks: "Le travail lui-même — attribué à un projet et à une personne.",
    milestones: "Une date sans durée : atteinte ou non.",
    people: "Qui est impliqué — et sur quoi ces personnes travaillent.",
  },
  welcome: {
    file: "Bienvenue.md",
    title: "Bienvenue",
    intro: "Ce modèle montre un projet tel qu'il fonctionne dans Plainva : quatre bases de données qui se pointent les unes vers les autres.",
    outro:
      "Dans **Projets**, deux colonnes font le calcul : **Ouvert** compte les tâches qui ne sont pas encore terminées, **Budget** additionne leur charge de travail. Aucune des deux n'est stockée dans un fichier — les deux sont recalculées à chaque requête.\n\nDans **Tâches**, la colonne **En attente de** porte les dépendances. La chronologie en tire des flèches ; quand une tâche commence avant que sa précédente ne soit terminée, la flèche devient rouge. Rien n'est modifié dans ce processus — les dates sont votre déclaration, Plainva se contente de signaler que deux d'entre elles se contredisent.\n\nDans **Jalons**, chaque entrée a une date et aucune fin. C'est exactement ainsi que la chronologie reconnaît un instant et dessine un losange au lieu d'une barre.",
  },
  welcomeSections: { databases: "Bases de données", start: "Pour commencer" },
  baseFiles: { projects: "Projets.base", tasks: "Tâches.base", milestones: "Jalons.base", people: "Personnes.base" },
  keys: {
    status: "status",
    start: "debut",
    end: "fin",
    date: "date",
    project: "projet",
    person: "personne",
    effort: "effort",
    tasks: "taches",
    open: "ouvert",
    plannedEffort: "budget",
    role: "role",
  },
  dependsOnLabel: "En attente de",
  options: {
    projectStatus: ["Planifié", "En cours", "En attente", "Terminé"],
    taskStatus: ["Ouverte", "En cours", "Révision", "Terminée"],
    milestoneStatus: ["Ouvert", "À risque", "Atteint"],
    role: ["Responsable", "Équipe", "Partie prenante"],
  },
  views: { table: "Tableau", byStatus: "Par statut", schedule: "Planning", dates: "Dates" },
  templates: {
    project: {
      file: "Projet.md",
      body: "# {{title}}\n\n## Objectif\n\n{{cursor}}\n\n## Périmètre\n\n- \n\n## Risques\n\n- \n",
    },
    task: {
      file: "Tâche.md",
      body: "# {{title}}\n\n## À faire\n\n{{cursor}}\n\n## Terminé quand\n\n- \n",
    },
  },
  samples: {
    projects: [
      {
        title: "Refonte du site web",
        body: "Le site n'a pas changé depuis quatre ans. Nouvelle structure, nouveaux textes, même contenu.",
        props: { status: "En cours", debut: "{{today-14}}", fin: "{{today+30}}" },
      },
      {
        title: "Déménagement vers le nouveau bureau",
        body: "Deux étages, trente bureaux, un week-end.",
        props: { status: "Planifié", debut: "{{today+21}}", fin: "{{today+60}}" },
      },
    ],
    tasks: [
      {
        title: "Passer en revue le contenu",
        body: "Lire chaque page une fois et décider : garder, réécrire, supprimer.",
        props: { status: "Terminée", projet: "[[Refonte du site web]]", personne: "[[Anna Berg]]", debut: "{{today-14}}", fin: "{{today-7}}", effort: 480 },
      },
      {
        title: "Définir la structure",
        body: "Transformer la revue en navigation. En attente de la revue — il n'y a rien à trier avant.",
        props: { status: "En cours", projet: "[[Refonte du site web]]", personne: "[[Anna Berg]]", debut: "{{today-6}}", fin: "{{today+2}}", effort: 240, blockedBy: [{ uid: "[[Passer en revue le contenu]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Rédiger les textes",
        body: "Réécrire chaque page qui reste.",
        props: { status: "Ouverte", projet: "[[Refonte du site web]]", personne: "[[Jonas Feld]]", debut: "{{today+3}}", fin: "{{today+17}}", effort: 900, blockedBy: [{ uid: "[[Définir la structure]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Élaborer le plan de déménagement",
        body: "Qui emballe quoi, qui conduit quand, ce qui reste sur place.",
        props: { status: "Ouverte", projet: "[[Déménagement vers le nouveau bureau]]", personne: "[[Jonas Feld]]", debut: "{{today+21}}", fin: "{{today+28}}", effort: 300 },
      },
      {
        title: "Obtenir des devis",
        body: "Demander trois déménageurs et comparer.",
        props: { status: "Révision", projet: "[[Déménagement vers le nouveau bureau]]", personne: "[[Anna Berg]]", debut: "{{today+7}}", fin: "{{today+14}}", effort: 120 },
      },
    ],
    milestones: [
      {
        title: "Structure validée",
        body: "À partir d'ici, on écrit, on ne trie plus.",
        props: { status: "Ouvert", date: "{{today+2}}", projet: "[[Refonte du site web]]" },
      },
      {
        title: "Site en ligne",
        body: "Le jour où le changement est activé.",
        props: { status: "Ouvert", date: "{{today+30}}", projet: "[[Refonte du site web]]" },
      },
      {
        title: "Remise des clés",
        body: "Sans cette date, le déménagement ne commence pas.",
        props: { status: "À risque", date: "{{today+21}}", projet: "[[Déménagement vers le nouveau bureau]]" },
      },
    ],
    people: [
      { title: "Anna Berg", body: "Dirige le projet et décide en cas de doute.", props: { role: "Responsable" } },
      { title: "Jonas Feld", body: "Écrit et participe à la planification.", props: { role: "Équipe" } },
    ],
  },
};

export const PROJECT_STRINGS_ES: ProjectStrings = {
  name: "Proyecto",
  description: "Proyectos, tareas, hitos y personas — con totales calculados, dependencias y una cronología.",
  folders: { projects: "Proyectos", tasks: "Tareas", milestones: "Hitos", people: "Personas", templates: "Plantillas" },
  folderHints: {
    projects: "Un proyecto por nota, con un inicio, un final y un estado.",
    tasks: "El trabajo en sí — asignado a un proyecto y a una persona.",
    milestones: "Una fecha sin duración: alcanzada o no.",
    people: "Quién está implicado — y en qué está trabajando.",
  },
  welcome: {
    file: "Bienvenida.md",
    title: "Bienvenida",
    intro: "Esta plantilla muestra un proyecto tal como funciona en Plainva: cuatro bases de datos que se apuntan entre sí.",
    outro:
      "En **Proyectos**, dos columnas hacen el cálculo: **Abierto** cuenta las tareas que aún no están terminadas, **Planificado** suma su esfuerzo. Ninguna de las dos se guarda en un archivo — ambas se recalculan en cada consulta.\n\nEn **Tareas**, la columna **En espera de** contiene las dependencias. La cronología dibuja flechas a partir de ellas; cuando una tarea empieza antes de que termine la anterior, la flecha se vuelve roja. En este proceso no se cambia nada — las fechas son tu declaración, Plainva solo indica que dos de ellas se contradicen.\n\nEn **Hitos**, cada entrada tiene una fecha y ningún final. Así es exactamente como la cronología reconoce un momento y dibuja un rombo en lugar de una barra.",
  },
  welcomeSections: { databases: "Bases de datos", start: "Por dónde empezar" },
  baseFiles: { projects: "Proyectos.base", tasks: "Tareas.base", milestones: "Hitos.base", people: "Personas.base" },
  keys: {
    status: "estado",
    start: "inicio",
    end: "fin",
    date: "fecha",
    project: "proyecto",
    person: "persona",
    effort: "esfuerzo",
    tasks: "tareas",
    open: "abierto",
    plannedEffort: "planificado",
    role: "rol",
  },
  dependsOnLabel: "En espera de",
  options: {
    projectStatus: ["Planificado", "Activo", "En espera", "Terminado"],
    taskStatus: ["Abierto", "En curso", "Revisión", "Terminado"],
    milestoneStatus: ["Abierto", "En riesgo", "Alcanzado"],
    role: ["Responsable", "Equipo", "Parte interesada"],
  },
  views: { table: "Tabla", byStatus: "Por estado", schedule: "Calendario", dates: "Fechas" },
  templates: {
    project: {
      file: "Proyecto.md",
      body: "# {{title}}\n\n## Objetivo\n\n{{cursor}}\n\n## Alcance\n\n- \n\n## Riesgos\n\n- \n",
    },
    task: {
      file: "Tarea.md",
      body: "# {{title}}\n\n## Qué hacer\n\n{{cursor}}\n\n## Terminado cuando\n\n- \n",
    },
  },
  samples: {
    projects: [
      {
        title: "Relanzamiento del sitio web",
        body: "El sitio no ha cambiado en cuatro años. Nueva estructura, nuevos textos, mismo contenido.",
        props: { estado: "Activo", inicio: "{{today-14}}", fin: "{{today+30}}" },
      },
      {
        title: "Mudanza a la nueva oficina",
        body: "Dos plantas, treinta puestos, un fin de semana.",
        props: { estado: "Planificado", inicio: "{{today+21}}", fin: "{{today+60}}" },
      },
    ],
    tasks: [
      {
        title: "Revisar el contenido",
        body: "Leer cada página una vez y decidir: mantener, reescribir, eliminar.",
        props: { estado: "Terminado", proyecto: "[[Relanzamiento del sitio web]]", persona: "[[Anna Berg]]", inicio: "{{today-14}}", fin: "{{today-7}}", esfuerzo: 480 },
      },
      {
        title: "Definir la estructura",
        body: "Convertir la revisión en una navegación. Espera a la revisión — no hay nada que ordenar antes.",
        props: { estado: "En curso", proyecto: "[[Relanzamiento del sitio web]]", persona: "[[Anna Berg]]", inicio: "{{today-6}}", fin: "{{today+2}}", esfuerzo: 240, blockedBy: [{ uid: "[[Revisar el contenido]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Escribir los textos",
        body: "Reescribir cada página que se mantiene.",
        props: { estado: "Abierto", proyecto: "[[Relanzamiento del sitio web]]", persona: "[[Jonas Feld]]", inicio: "{{today+3}}", fin: "{{today+17}}", esfuerzo: 900, blockedBy: [{ uid: "[[Definir la estructura]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Elaborar el plan de mudanza",
        body: "Quién empaca qué, quién conduce cuándo, qué se queda.",
        props: { estado: "Abierto", proyecto: "[[Mudanza a la nueva oficina]]", persona: "[[Jonas Feld]]", inicio: "{{today+21}}", fin: "{{today+28}}", esfuerzo: 300 },
      },
      {
        title: "Pedir presupuestos",
        body: "Pedir presupuesto a tres empresas de mudanza y comparar.",
        props: { estado: "Revisión", proyecto: "[[Mudanza a la nueva oficina]]", persona: "[[Anna Berg]]", inicio: "{{today+7}}", fin: "{{today+14}}", esfuerzo: 120 },
      },
    ],
    milestones: [
      {
        title: "Estructura acordada",
        body: "A partir de aquí solo se escribe, ya no se ordena.",
        props: { estado: "Abierto", fecha: "{{today+2}}", proyecto: "[[Relanzamiento del sitio web]]" },
      },
      {
        title: "Sitio en línea",
        body: "El día en que se activa el cambio.",
        props: { estado: "Abierto", fecha: "{{today+30}}", proyecto: "[[Relanzamiento del sitio web]]" },
      },
      {
        title: "Entrega de llaves",
        body: "Sin esta fecha, la mudanza no empieza.",
        props: { estado: "En riesgo", fecha: "{{today+21}}", proyecto: "[[Mudanza a la nueva oficina]]" },
      },
    ],
    people: [
      { title: "Anna Berg", body: "Dirige el proyecto y decide en caso de duda.", props: { rol: "Responsable" } },
      { title: "Jonas Feld", body: "Escribe y participa en la planificación.", props: { rol: "Equipo" } },
    ],
  },
};

export const PROJECT_STRINGS_PT_BR: ProjectStrings = {
  name: "Projeto",
  description: "Projetos, tarefas, marcos e pessoas — com totais calculados, dependências e uma linha do tempo.",
  folders: { projects: "Projetos", tasks: "Tarefas", milestones: "Marcos", people: "Pessoas", templates: "Modelos" },
  folderHints: {
    projects: "Um projeto por nota, com início, fim e status.",
    tasks: "O trabalho em si — atribuído a um projeto e a uma pessoa.",
    milestones: "Uma data sem duração: alcançada ou não.",
    people: "Quem está envolvido — e no que está trabalhando.",
  },
  welcome: {
    file: "Bem-vindo.md",
    title: "Bem-vindo",
    intro: "Este modelo mostra um projeto do jeito que ele funciona no Plainva: quatro bases de dados que apontam umas para as outras.",
    outro:
      "Em **Projetos**, duas colunas fazem a contagem: **Aberto** conta as tarefas que ainda não foram concluídas, **Planejado** soma o esforço delas. Nenhuma das duas fica salva em um arquivo — ambas são recalculadas a cada consulta.\n\nEm **Tarefas**, a coluna **Espera por** carrega as dependências. A linha do tempo desenha setas a partir delas; quando uma tarefa começa antes que sua antecessora termine, a seta fica vermelha. Nada é alterado nesse processo — as datas são a sua declaração, o Plainva só aponta que duas delas se contradizem.\n\nEm **Marcos**, cada item tem uma data e nenhum fim. É exatamente assim que a linha do tempo reconhece um momento e desenha um losango em vez de uma barra.",
  },
  welcomeSections: { databases: "Bases de dados", start: "Por onde começar" },
  baseFiles: { projects: "Projetos.base", tasks: "Tarefas.base", milestones: "Marcos.base", people: "Pessoas.base" },
  keys: {
    status: "status",
    start: "inicio",
    end: "fim",
    date: "data",
    project: "projeto",
    person: "pessoa",
    effort: "esforco",
    tasks: "tarefas",
    open: "aberto",
    plannedEffort: "planejado",
    role: "papel",
  },
  dependsOnLabel: "Espera por",
  options: {
    projectStatus: ["Planejado", "Ativo", "Aguardando", "Concluído"],
    taskStatus: ["A fazer", "Em andamento", "Revisão", "Concluída"],
    milestoneStatus: ["Aberto", "Em risco", "Alcançado"],
    role: ["Responsável", "Equipe", "Parte interessada"],
  },
  views: { table: "Tabela", byStatus: "Por status", schedule: "Cronograma", dates: "Datas" },
  templates: {
    project: {
      file: "Projeto.md",
      body: "# {{title}}\n\n## Objetivo\n\n{{cursor}}\n\n## Escopo\n\n- \n\n## Riscos\n\n- \n",
    },
    task: {
      file: "Tarefa.md",
      body: "# {{title}}\n\n## O que fazer\n\n{{cursor}}\n\n## Concluído quando\n\n- \n",
    },
  },
  samples: {
    projects: [
      {
        title: "Relançamento do site",
        body: "O site não muda há quatro anos. Nova estrutura, novos textos, mesmo conteúdo.",
        props: { status: "Ativo", inicio: "{{today-14}}", fim: "{{today+30}}" },
      },
      {
        title: "Mudança para o novo escritório",
        body: "Dois andares, trinta mesas, um fim de semana.",
        props: { status: "Planejado", inicio: "{{today+21}}", fim: "{{today+60}}" },
      },
    ],
    tasks: [
      {
        title: "Revisar o conteúdo",
        body: "Ler cada página uma vez e decidir: manter, reescrever, remover.",
        props: { status: "Concluída", projeto: "[[Relançamento do site]]", pessoa: "[[Anna Berg]]", inicio: "{{today-14}}", fim: "{{today-7}}", esforco: 480 },
      },
      {
        title: "Definir a estrutura",
        body: "Transformar a revisão em uma navegação. Espera pela revisão — não há nada para organizar antes disso.",
        props: { status: "Em andamento", projeto: "[[Relançamento do site]]", pessoa: "[[Anna Berg]]", inicio: "{{today-6}}", fim: "{{today+2}}", esforco: 240, blockedBy: [{ uid: "[[Revisar o conteúdo]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Escrever os textos",
        body: "Reescrever cada página que permanece.",
        props: { status: "A fazer", projeto: "[[Relançamento do site]]", pessoa: "[[Jonas Feld]]", inicio: "{{today+3}}", fim: "{{today+17}}", esforco: 900, blockedBy: [{ uid: "[[Definir a estrutura]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Elaborar o plano de mudança",
        body: "Quem embala o quê, quem dirige quando, o que fica no lugar.",
        props: { status: "A fazer", projeto: "[[Mudança para o novo escritório]]", pessoa: "[[Jonas Feld]]", inicio: "{{today+21}}", fim: "{{today+28}}", esforco: 300 },
      },
      {
        title: "Pedir orçamentos",
        body: "Pedir orçamento a três empresas de mudança e comparar.",
        props: { status: "Revisão", projeto: "[[Mudança para o novo escritório]]", pessoa: "[[Anna Berg]]", inicio: "{{today+7}}", fim: "{{today+14}}", esforco: 120 },
      },
    ],
    milestones: [
      {
        title: "Estrutura definida",
        body: "A partir daqui é só escrever, não organizar mais.",
        props: { status: "Aberto", data: "{{today+2}}", projeto: "[[Relançamento do site]]" },
      },
      {
        title: "Site no ar",
        body: "O dia em que a troca é ativada.",
        props: { status: "Aberto", data: "{{today+30}}", projeto: "[[Relançamento do site]]" },
      },
      {
        title: "Entrega das chaves",
        body: "Sem essa data, a mudança não começa.",
        props: { status: "Em risco", data: "{{today+21}}", projeto: "[[Mudança para o novo escritório]]" },
      },
    ],
    people: [
      { title: "Anna Berg", body: "Lidera o projeto e decide em caso de dúvida.", props: { papel: "Responsável" } },
      { title: "Jonas Feld", body: "Escreve e ajuda a planejar.", props: { papel: "Equipe" } },
    ],
  },
};

export const PROJECT_STRINGS_IT: ProjectStrings = {
  name: "Progetto",
  description: "Progetti, attività, milestone e persone — con totali calcolati, dipendenze e una timeline.",
  folders: { projects: "Progetti", tasks: "Attività", milestones: "Milestone", people: "Persone", templates: "Modelli" },
  folderHints: {
    projects: "Un progetto per nota, con un inizio, una fine e uno stato.",
    tasks: "Il lavoro stesso — assegnato a un progetto e a una persona.",
    milestones: "Una data senza durata: raggiunta o no.",
    people: "Chi è coinvolto — e su cosa sta lavorando.",
  },
  welcome: {
    file: "Benvenuto.md",
    title: "Benvenuto",
    intro: "Questo modello mostra un progetto così come funziona in Plainva: quattro database che puntano l'uno all'altro.",
    outro:
      "In **Progetti**, due colonne fanno il conteggio: **Aperto** conta le attività non ancora concluse, **Pianificato** somma il loro impegno. Nessuna delle due è salvata in un file — entrambe vengono ricalcolate a ogni interrogazione.\n\nIn **Attività**, la colonna **In attesa di** contiene le dipendenze. La timeline vi disegna delle frecce; quando un'attività inizia prima che la precedente sia conclusa, la freccia diventa rossa. In questo processo non viene modificato nulla — le date sono una tua dichiarazione, Plainva si limita a segnalare che due di esse sono in contraddizione.\n\nIn **Milestone**, ogni voce ha una data e nessuna fine. Proprio per questo la timeline riconosce un istante e disegna un rombo invece di una barra.",
  },
  welcomeSections: { databases: "Database", start: "Da dove iniziare" },
  baseFiles: { projects: "Progetti.base", tasks: "Attività.base", milestones: "Milestone.base", people: "Persone.base" },
  keys: {
    status: "stato",
    start: "inizio",
    end: "fine",
    date: "data",
    project: "progetto",
    person: "persona",
    effort: "sforzo",
    tasks: "attivita",
    open: "aperto",
    plannedEffort: "pianificato",
    role: "ruolo",
  },
  dependsOnLabel: "In attesa di",
  options: {
    projectStatus: ["Pianificato", "Attivo", "In attesa", "Concluso"],
    taskStatus: ["Aperta", "In corso", "Revisione", "Fatta"],
    milestoneStatus: ["Aperto", "A rischio", "Raggiunto"],
    role: ["Responsabile", "Team", "Parte interessata"],
  },
  views: { table: "Tabella", byStatus: "Per stato", schedule: "Pianificazione", dates: "Date" },
  templates: {
    project: {
      file: "Progetto.md",
      body: "# {{title}}\n\n## Obiettivo\n\n{{cursor}}\n\n## Ambito\n\n- \n\n## Rischi\n\n- \n",
    },
    task: {
      file: "Attività.md",
      body: "# {{title}}\n\n## Cosa fare\n\n{{cursor}}\n\n## Concluso quando\n\n- \n",
    },
  },
  samples: {
    projects: [
      {
        title: "Rilancio del sito web",
        body: "Il sito non cambia da quattro anni. Nuova struttura, nuovi testi, stessi contenuti.",
        props: { stato: "Attivo", inizio: "{{today-14}}", fine: "{{today+30}}" },
      },
      {
        title: "Trasloco nel nuovo ufficio",
        body: "Due piani, trenta scrivanie, un weekend.",
        props: { stato: "Pianificato", inizio: "{{today+21}}", fine: "{{today+60}}" },
      },
    ],
    tasks: [
      {
        title: "Rivedere i contenuti",
        body: "Leggere ogni pagina una volta e decidere: tenere, riscrivere, eliminare.",
        props: { stato: "Fatta", progetto: "[[Rilancio del sito web]]", persona: "[[Anna Berg]]", inizio: "{{today-14}}", fine: "{{today-7}}", sforzo: 480 },
      },
      {
        title: "Definire la struttura",
        body: "Trasformare la revisione in una struttura di navigazione. In attesa della revisione — prima non c'è nulla da ordinare.",
        props: { stato: "In corso", progetto: "[[Rilancio del sito web]]", persona: "[[Anna Berg]]", inizio: "{{today-6}}", fine: "{{today+2}}", sforzo: 240, blockedBy: [{ uid: "[[Rivedere i contenuti]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Scrivere i testi",
        body: "Riscrivere ogni pagina che rimane.",
        props: { stato: "Aperta", progetto: "[[Rilancio del sito web]]", persona: "[[Jonas Feld]]", inizio: "{{today+3}}", fine: "{{today+17}}", sforzo: 900, blockedBy: [{ uid: "[[Definire la struttura]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Elaborare il piano di trasloco",
        body: "Chi imballa cosa, chi guida quando, cosa resta al suo posto.",
        props: { stato: "Aperta", progetto: "[[Trasloco nel nuovo ufficio]]", persona: "[[Jonas Feld]]", inizio: "{{today+21}}", fine: "{{today+28}}", sforzo: 300 },
      },
      {
        title: "Richiedere preventivi",
        body: "Chiedere un preventivo a tre traslocatori e confrontare.",
        props: { stato: "Revisione", progetto: "[[Trasloco nel nuovo ufficio]]", persona: "[[Anna Berg]]", inizio: "{{today+7}}", fine: "{{today+14}}", sforzo: 120 },
      },
    ],
    milestones: [
      {
        title: "Struttura concordata",
        body: "Da qui in poi si scrive, non si ordina più.",
        props: { stato: "Aperto", data: "{{today+2}}", progetto: "[[Rilancio del sito web]]" },
      },
      {
        title: "Sito online",
        body: "Il giorno in cui scatta il passaggio.",
        props: { stato: "Aperto", data: "{{today+30}}", progetto: "[[Rilancio del sito web]]" },
      },
      {
        title: "Consegna delle chiavi",
        body: "Senza questa data il trasloco non inizia.",
        props: { stato: "A rischio", data: "{{today+21}}", progetto: "[[Trasloco nel nuovo ufficio]]" },
      },
    ],
    people: [
      { title: "Anna Berg", body: "Guida il progetto e decide in caso di dubbio.", props: { ruolo: "Responsabile" } },
      { title: "Jonas Feld", body: "Scrive e collabora alla pianificazione.", props: { ruolo: "Team" } },
    ],
  },
};

export const PROJECT_STRINGS_NL: ProjectStrings = {
  name: "Project",
  description: "Projecten, taken, mijlpalen en personen — met berekende totalen, afhankelijkheden en een tijdlijn.",
  folders: { projects: "Projecten", tasks: "Taken", milestones: "Mijlpalen", people: "Personen", templates: "Sjablonen" },
  folderHints: {
    projects: "Eén project per notitie, met een start, een einde en een status.",
    tasks: "Het werk zelf — toegewezen aan een project en aan een persoon.",
    milestones: "Een datum zonder duur: bereikt of niet.",
    people: "Wie erbij betrokken is — en waar ze aan werken.",
  },
  welcome: {
    file: "Welkom.md",
    title: "Welkom",
    intro: "Dit sjabloon toont een project zoals het in Plainva werkt: vier databases die naar elkaar verwijzen.",
    outro:
      "In **Projecten** rekenen twee kolommen mee: **Open** telt de taken die nog niet klaar zijn, **Gepland** telt hun inspanning op. Geen van beide staat in een bestand — allebei worden ze bij elke query opnieuw berekend.\n\nIn **Taken** draagt de kolom **Wacht op** de afhankelijkheden. De tijdlijn tekent daaruit pijlen; begint een taak voordat de vorige klaar is, dan wordt de pijl rood. Er verandert daarbij niets — de datums zijn jouw eigen opgave, Plainva meldt alleen dat twee ervan elkaar tegenspreken.\n\nIn **Mijlpalen** heeft elk item een datum en geen einde. Precies daaraan herkent de tijdlijn een moment en tekent ze een ruit in plaats van een balk.",
  },
  welcomeSections: { databases: "Databases", start: "Om te beginnen" },
  baseFiles: { projects: "Projecten.base", tasks: "Taken.base", milestones: "Mijlpalen.base", people: "Personen.base" },
  keys: {
    status: "status",
    start: "start",
    end: "einde",
    date: "datum",
    project: "project",
    person: "persoon",
    effort: "inspanning",
    tasks: "taken",
    open: "open",
    plannedEffort: "gepland",
    role: "rol",
  },
  dependsOnLabel: "Wacht op",
  options: {
    projectStatus: ["Gepland", "Actief", "Wachtend", "Afgerond"],
    taskStatus: ["Open", "Bezig", "Revisie", "Afgerond"],
    milestoneStatus: ["Open", "In gevaar", "Bereikt"],
    role: ["Trekker", "Team", "Belanghebbende"],
  },
  views: { table: "Tabel", byStatus: "Op status", schedule: "Planning", dates: "Datums" },
  templates: {
    project: {
      file: "Project.md",
      body: "# {{title}}\n\n## Doel\n\n{{cursor}}\n\n## Omvang\n\n- \n\n## Risico's\n\n- \n",
    },
    task: {
      file: "Taak.md",
      body: "# {{title}}\n\n## Wat te doen\n\n{{cursor}}\n\n## Klaar wanneer\n\n- \n",
    },
  },
  samples: {
    projects: [
      {
        title: "Website-relaunch",
        body: "De site is al vier jaar niet veranderd. Nieuwe structuur, nieuwe teksten, dezelfde inhoud.",
        props: { status: "Actief", start: "{{today-14}}", einde: "{{today+30}}" },
      },
      {
        title: "Kantoor verhuizen",
        body: "Twee verdiepingen, dertig bureaus, één weekend.",
        props: { status: "Gepland", start: "{{today+21}}", einde: "{{today+60}}" },
      },
    ],
    tasks: [
      {
        title: "Inhoud doornemen",
        body: "Elke pagina één keer lezen en beslissen: behouden, herschrijven, verwijderen.",
        props: { status: "Afgerond", project: "[[Website-relaunch]]", persoon: "[[Anna Berg]]", start: "{{today-14}}", einde: "{{today-7}}", inspanning: 480 },
      },
      {
        title: "Structuur bepalen",
        body: "De doorname omzetten in een navigatie. Wacht op de doorname — daarvoor is er niets te ordenen.",
        props: { status: "Bezig", project: "[[Website-relaunch]]", persoon: "[[Anna Berg]]", start: "{{today-6}}", einde: "{{today+2}}", inspanning: 240, blockedBy: [{ uid: "[[Inhoud doornemen]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Teksten schrijven",
        body: "Elke pagina die blijft herschrijven.",
        props: { status: "Open", project: "[[Website-relaunch]]", persoon: "[[Jonas Feld]]", start: "{{today+3}}", einde: "{{today+17}}", inspanning: 900, blockedBy: [{ uid: "[[Structuur bepalen]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Verhuisplan opstellen",
        body: "Wie pakt wat in, wie rijdt wanneer, wat blijft staan.",
        props: { status: "Open", project: "[[Kantoor verhuizen]]", persoon: "[[Jonas Feld]]", start: "{{today+21}}", einde: "{{today+28}}", inspanning: 300 },
      },
      {
        title: "Offertes opvragen",
        body: "Drie verhuisbedrijven om een offerte vragen en vergelijken.",
        props: { status: "Revisie", project: "[[Kantoor verhuizen]]", persoon: "[[Anna Berg]]", start: "{{today+7}}", einde: "{{today+14}}", inspanning: 120 },
      },
    ],
    milestones: [
      {
        title: "Structuur vastgesteld",
        body: "Vanaf hier wordt er alleen nog geschreven, niet meer geordend.",
        props: { status: "Open", datum: "{{today+2}}", project: "[[Website-relaunch]]" },
      },
      {
        title: "Site live",
        body: "De dag waarop de omschakeling plaatsvindt.",
        props: { status: "Open", datum: "{{today+30}}", project: "[[Website-relaunch]]" },
      },
      {
        title: "Sleuteloverdracht",
        body: "Zonder deze datum begint de verhuizing niet.",
        props: { status: "In gevaar", datum: "{{today+21}}", project: "[[Kantoor verhuizen]]" },
      },
    ],
    people: [
      { title: "Anna Berg", body: "Leidt het project en beslist bij twijfel.", props: { rol: "Trekker" } },
      { title: "Jonas Feld", body: "Schrijft en denkt mee over de planning.", props: { rol: "Team" } },
    ],
  },
};

export const PROJECT_STRINGS_PL: ProjectStrings = {
  name: "Projekt",
  description: "Projekty, zadania, kamienie milowe i osoby — z podsumowaniami, zależnościami i osią czasu.",
  folders: { projects: "Projekty", tasks: "Zadania", milestones: "Kamienie milowe", people: "Osoby", templates: "Szablony" },
  folderHints: {
    projects: "Jeden projekt na notatkę, z datą rozpoczęcia, zakończenia i statusem.",
    tasks: "Sama praca — przypisana do projektu i do osoby.",
    milestones: "Data bez czasu trwania: osiągnięta albo nie.",
    people: "Kto jest zaangażowany — i nad czym pracuje.",
  },
  welcome: {
    file: "Witaj.md",
    title: "Witaj",
    intro: "Ten szablon pokazuje projekt tak, jak działa w Plainva: cztery bazy danych wskazujące na siebie nawzajem.",
    outro:
      "W bazie **Projekty** dwie kolumny liczą automatycznie: **Otwarte** zlicza zadania, które nie są jeszcze ukończone, **Planowane** sumuje ich nakład pracy. Żadna z nich nie jest zapisana w pliku — obie są przeliczane od nowa przy każdym zapytaniu.\n\nW **Zadaniach** kolumna **Czeka na** przenosi zależności. Oś czasu rysuje z nich strzałki; jeśli zadanie zaczyna się, zanim skończy się jego poprzednik, strzałka staje się czerwona. Nic nie jest przy tym zmieniane — daty to Twoje własne dane, Plainva tylko wskazuje, że dwie z nich są ze sobą sprzeczne.\n\nW **Kamieniach milowych** każdy wpis ma datę i żadnego końca. Właśnie po tym oś czasu rozpoznaje moment i rysuje romb zamiast paska.",
  },
  welcomeSections: { databases: "Bazy danych", start: "Od czego zacząć" },
  baseFiles: { projects: "Projekty.base", tasks: "Zadania.base", milestones: "Kamienie milowe.base", people: "Osoby.base" },
  keys: {
    status: "status",
    start: "start",
    end: "koniec",
    date: "data",
    project: "projekt",
    person: "osoba",
    effort: "wysilek",
    tasks: "zadania",
    open: "otwarte",
    plannedEffort: "planowane",
    role: "rola",
  },
  dependsOnLabel: "Czeka na",
  options: {
    projectStatus: ["Zaplanowane", "Aktywne", "Oczekuje", "Ukończone"],
    taskStatus: ["Otwarte", "W trakcie", "Przegląd", "Ukończone"],
    milestoneStatus: ["Otwarty", "Zagrożony", "Osiągnięty"],
    role: ["Lider", "Zespół", "Interesariusz"],
  },
  views: { table: "Tabela", byStatus: "Według statusu", schedule: "Harmonogram", dates: "Terminy" },
  templates: {
    project: {
      file: "Projekt.md",
      body: "# {{title}}\n\n## Cel\n\n{{cursor}}\n\n## Zakres\n\n- \n\n## Ryzyka\n\n- \n",
    },
    task: {
      file: "Zadanie.md",
      body: "# {{title}}\n\n## Co zrobić\n\n{{cursor}}\n\n## Gotowe, gdy\n\n- \n",
    },
  },
  samples: {
    projects: [
      {
        title: "Relaunch strony internetowej",
        body: "Strona nie zmieniła się od czterech lat. Nowa struktura, nowe teksty, ta sama treść.",
        props: { status: "Aktywne", start: "{{today-14}}", koniec: "{{today+30}}" },
      },
      {
        title: "Przeprowadzka do nowego biura",
        body: "Dwa piętra, trzydzieści biurek, jeden weekend.",
        props: { status: "Zaplanowane", start: "{{today+21}}", koniec: "{{today+60}}" },
      },
    ],
    tasks: [
      {
        title: "Przejrzeć treści",
        body: "Przejrzeć każdą stronę i zdecydować: zostaje, do przepisania, usunąć.",
        props: { status: "Ukończone", projekt: "[[Relaunch strony internetowej]]", osoba: "[[Anna Berg]]", start: "{{today-14}}", koniec: "{{today-7}}", wysilek: 480 },
      },
      {
        title: "Ustalić strukturę",
        body: "Zamienić przegląd w strukturę nawigacji. Czeka na przegląd — wcześniej nie ma nic do sortowania.",
        props: { status: "W trakcie", projekt: "[[Relaunch strony internetowej]]", osoba: "[[Anna Berg]]", start: "{{today-6}}", koniec: "{{today+2}}", wysilek: 240, blockedBy: [{ uid: "[[Przejrzeć treści]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Napisać teksty",
        body: "Przepisać każdą stronę, która zostaje.",
        props: { status: "Otwarte", projekt: "[[Relaunch strony internetowej]]", osoba: "[[Jonas Feld]]", start: "{{today+3}}", koniec: "{{today+17}}", wysilek: 900, blockedBy: [{ uid: "[[Ustalić strukturę]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "Opracować plan przeprowadzki",
        body: "Kto pakuje co, kto kiedy jedzie, co zostaje na miejscu.",
        props: { status: "Otwarte", projekt: "[[Przeprowadzka do nowego biura]]", osoba: "[[Jonas Feld]]", start: "{{today+21}}", koniec: "{{today+28}}", wysilek: 300 },
      },
      {
        title: "Zebrać oferty",
        body: "Poprosić o wycenę trzy firmy przeprowadzkowe i porównać.",
        props: { status: "Przegląd", projekt: "[[Przeprowadzka do nowego biura]]", osoba: "[[Anna Berg]]", start: "{{today+7}}", koniec: "{{today+14}}", wysilek: 120 },
      },
    ],
    milestones: [
      {
        title: "Struktura uzgodniona",
        body: "Od teraz tylko pisanie, już bez sortowania.",
        props: { status: "Otwarty", data: "{{today+2}}", projekt: "[[Relaunch strony internetowej]]" },
      },
      {
        title: "Strona działa",
        body: "Dzień, w którym następuje przełączenie.",
        props: { status: "Otwarty", data: "{{today+30}}", projekt: "[[Relaunch strony internetowej]]" },
      },
      {
        title: "Przekazanie kluczy",
        body: "Bez tej daty przeprowadzka się nie zacznie.",
        props: { status: "Zagrożony", data: "{{today+21}}", projekt: "[[Przeprowadzka do nowego biura]]" },
      },
    ],
    people: [
      { title: "Anna Berg", body: "Prowadzi projekt i podejmuje decyzje w razie wątpliwości.", props: { rola: "Lider" } },
      { title: "Jonas Feld", body: "Pisze i uczestniczy w planowaniu.", props: { rola: "Zespół" } },
    ],
  },
};

export const PROJECT_STRINGS_ZH_CN: ProjectStrings = {
  name: "项目",
  description: "项目、任务、里程碑和人员——带有自动汇总、依赖关系和时间轴。",
  folders: { projects: "项目", tasks: "任务", milestones: "里程碑", people: "人员", templates: "模板" },
  folderHints: {
    projects: "一个项目一条笔记，包含开始日期、结束日期和状态。",
    tasks: "具体的工作本身——分配给某个项目和某个人员。",
    milestones: "只有日期、没有时长的节点：达成或未达成。",
    people: "谁参与了这个项目——以及他们正在做什么。",
  },
  welcome: {
    file: "欢迎.md",
    title: "欢迎",
    intro: "这个模板展示了一个项目在Plainva中的运作方式：四个互相指向的数据库。",
    outro:
      "在**项目**数据库中，有两栏会自动计算：**Weiwan**（未完成的任务数）统计还没有完成的任务，**Jihuagongshi**（计划工时）把这些任务的工时加起来。这两项都不保存在文件里——每次查询都会重新计算一次。\n\n在**任务**数据库中，**等待**这一栏记录着依赖关系。时间轴会据此画出箭头；如果一项任务在它的前置任务完成之前就开始了，箭头就会变红。这个过程不会修改任何内容——日期是你自己给出的说明，Plainva只是指出其中两项互相矛盾。\n\n在**里程碑**数据库中，每一条记录都只有日期，没有结束时间。正因如此，时间轴才能识别出一个时间点，并画出菱形而不是长条。",
  },
  welcomeSections: { databases: "数据库", start: "从这里开始" },
  baseFiles: { projects: "项目.base", tasks: "任务.base", milestones: "里程碑.base", people: "人员.base" },
  keys: {
    status: "status",
    start: "kaishi",
    end: "jieshu",
    date: "riqi",
    project: "xiangmu",
    person: "chengyuan",
    effort: "gongshi",
    tasks: "renwu",
    open: "weiwan",
    plannedEffort: "jihuagongshi",
    role: "juese",
  },
  dependsOnLabel: "等待",
  options: {
    projectStatus: ["计划中", "进行中", "等待中", "已完成"],
    taskStatus: ["待处理", "进行中", "审核中", "已完成"],
    milestoneStatus: ["待达成", "有风险", "已达成"],
    role: ["负责人", "成员", "利益相关方"],
  },
  views: { table: "表格", byStatus: "按状态", schedule: "排期", dates: "日期" },
  templates: {
    project: {
      file: "项目.md",
      body: "# {{title}}\n\n## 目标\n\n{{cursor}}\n\n## 范围\n\n- \n\n## 风险\n\n- \n",
    },
    task: {
      file: "任务.md",
      body: "# {{title}}\n\n## 要做什么\n\n{{cursor}}\n\n## 完成标准\n\n- \n",
    },
  },
  samples: {
    projects: [
      {
        title: "网站改版",
        body: "这个网站四年没有变过了。新结构，新文案，内容不变。",
        props: { status: "进行中", kaishi: "{{today-14}}", jieshu: "{{today+30}}" },
      },
      {
        title: "搬到新办公室",
        body: "两层楼，三十个工位，只有一个周末的时间。",
        props: { status: "计划中", kaishi: "{{today+21}}", jieshu: "{{today+60}}" },
      },
    ],
    tasks: [
      {
        title: "梳理内容",
        body: "把每一页看一遍，然后决定：保留、重写，还是删除。",
        props: { status: "已完成", xiangmu: "[[网站改版]]", chengyuan: "[[Anna Berg]]", kaishi: "{{today-14}}", jieshu: "{{today-7}}", gongshi: 480 },
      },
      {
        title: "确定结构",
        body: "把梳理的结果变成导航结构。等待内容梳理完成——在那之前没什么可以排序的。",
        props: { status: "进行中", xiangmu: "[[网站改版]]", chengyuan: "[[Anna Berg]]", kaishi: "{{today-6}}", jieshu: "{{today+2}}", gongshi: 240, blockedBy: [{ uid: "[[梳理内容]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "撰写文案",
        body: "把所有保留下来的页面重新写一遍。",
        props: { status: "待处理", xiangmu: "[[网站改版]]", chengyuan: "[[Jonas Feld]]", kaishi: "{{today+3}}", jieshu: "{{today+17}}", gongshi: 900, blockedBy: [{ uid: "[[确定结构]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "制定搬家计划",
        body: "谁打包什么，谁什么时候开车，什么东西留在原地。",
        props: { status: "待处理", xiangmu: "[[搬到新办公室]]", chengyuan: "[[Jonas Feld]]", kaishi: "{{today+21}}", jieshu: "{{today+28}}", gongshi: 300 },
      },
      {
        title: "收集报价",
        body: "向三家搬家公司询价并比较。",
        props: { status: "审核中", xiangmu: "[[搬到新办公室]]", chengyuan: "[[Anna Berg]]", kaishi: "{{today+7}}", jieshu: "{{today+14}}", gongshi: 120 },
      },
    ],
    milestones: [
      {
        title: "结构已确定",
        body: "从这里开始只是写作，不再需要排序。",
        props: { status: "待达成", riqi: "{{today+2}}", xiangmu: "[[网站改版]]" },
      },
      {
        title: "网站已上线",
        body: "正式切换上线的那一天。",
        props: { status: "待达成", riqi: "{{today+30}}", xiangmu: "[[网站改版]]" },
      },
      {
        title: "交接钥匙",
        body: "没有这个日期，搬家就无法开始。",
        props: { status: "有风险", riqi: "{{today+21}}", xiangmu: "[[搬到新办公室]]" },
      },
    ],
    people: [
      { title: "Anna Berg", body: "带领这个项目，遇到分歧时做决定。", props: { juese: "负责人" } },
      { title: "Jonas Feld", body: "负责撰写内容，也参与计划。", props: { juese: "成员" } },
    ],
  },
};

export const PROJECT_STRINGS_JA: ProjectStrings = {
  name: "プロジェクト",
  description: "プロジェクト、タスク、マイルストーン、メンバー——集計、依存関係、タイムライン付き。",
  folders: { projects: "プロジェクト", tasks: "タスク", milestones: "マイルストーン", people: "メンバー", templates: "テンプレート" },
  folderHints: {
    projects: "1つのプロジェクトにつき1件のノート——開始日、終了日、ステータスを持ちます。",
    tasks: "実際の作業そのものです——プロジェクトとメンバーに割り当てられます。",
    milestones: "期間を持たない日付です——達成したかどうかだけを表します。",
    people: "誰が関わっているか——そして何に取り組んでいるかです。",
  },
  welcome: {
    file: "はじめに.md",
    title: "はじめに",
    intro: "このテンプレートは、Plainvaでのプロジェクトの動き方を示しています。お互いを参照し合う4つのデータベースで構成されています。",
    outro:
      "**プロジェクト**では、2つの列が自動的に計算されます。**Open**はまだ完了していないタスクの数を数え、**Planned**はその作業量を合計します。どちらもファイルには保存されません——クエリのたびに毎回計算し直されます。\n\n**タスク**では、**待ち**列が依存関係を表します。タイムラインはそこから矢印を描きます。あるタスクが前のタスクの完了より前に始まると、矢印は赤くなります。この過程で何かが変更されるわけではありません——日付はあなた自身の申告であり、Plainvaはそのうち2つが矛盾していることを伝えるだけです。\n\n**マイルストーン**では、すべての項目に日付があり、終了日はありません。そのおかげでタイムラインは瞬間を認識し、バーの代わりにひし形を描きます。",
  },
  welcomeSections: { databases: "データベース", start: "はじめの一歩" },
  baseFiles: { projects: "プロジェクト.base", tasks: "タスク.base", milestones: "マイルストーン.base", people: "メンバー.base" },
  keys: {
    status: "status",
    start: "start",
    end: "end",
    date: "date",
    project: "project",
    person: "person",
    effort: "effort",
    tasks: "tasks",
    open: "open",
    plannedEffort: "planned",
    role: "role",
  },
  dependsOnLabel: "待ち",
  options: {
    projectStatus: ["予定", "進行中", "待機中", "完了"],
    taskStatus: ["未着手", "進行中", "レビュー中", "完了"],
    milestoneStatus: ["未達成", "リスクあり", "達成"],
    role: ["リーダー", "メンバー", "ステークホルダー"],
  },
  views: { table: "テーブル", byStatus: "ステータス別", schedule: "スケジュール", dates: "日付" },
  templates: {
    project: {
      file: "プロジェクト.md",
      body: "# {{title}}\n\n## 目標\n\n{{cursor}}\n\n## 範囲\n\n- \n\n## リスク\n\n- \n",
    },
    task: {
      file: "タスク.md",
      body: "# {{title}}\n\n## やること\n\n{{cursor}}\n\n## 完了の条件\n\n- \n",
    },
  },
  samples: {
    projects: [
      {
        title: "ウェブサイトのリニューアル",
        body: "このサイトは4年間変わっていません。新しい構成、新しい文章、内容は同じです。",
        props: { status: "進行中", start: "{{today-14}}", end: "{{today+30}}" },
      },
      {
        title: "新オフィスへの移転",
        body: "2フロア、30席、猶予は週末1回分です。",
        props: { status: "予定", start: "{{today+21}}", end: "{{today+60}}" },
      },
    ],
    tasks: [
      {
        title: "コンテンツを見直す",
        body: "各ページを一度読んで、残す・書き直す・削除するを決めます。",
        props: { status: "完了", project: "[[ウェブサイトのリニューアル]]", person: "[[Anna Berg]]", start: "{{today-14}}", end: "{{today-7}}", effort: 480 },
      },
      {
        title: "構成を固める",
        body: "見直しの結果をナビゲーションにまとめます。見直しの完了待ち——それより前には整理するものがありません。",
        props: { status: "進行中", project: "[[ウェブサイトのリニューアル]]", person: "[[Anna Berg]]", start: "{{today-6}}", end: "{{today+2}}", effort: 240, blockedBy: [{ uid: "[[コンテンツを見直す]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "文章を書く",
        body: "残すページをすべて書き直します。",
        props: { status: "未着手", project: "[[ウェブサイトのリニューアル]]", person: "[[Jonas Feld]]", start: "{{today+3}}", end: "{{today+17}}", effort: 900, blockedBy: [{ uid: "[[構成を固める]]", reltype: "FINISHTOSTART" }] },
      },
      {
        title: "引っ越し計画を立てる",
        body: "誰が何を梱包するか、誰がいつ運転するか、何をそのままにしておくか。",
        props: { status: "未着手", project: "[[新オフィスへの移転]]", person: "[[Jonas Feld]]", start: "{{today+21}}", end: "{{today+28}}", effort: 300 },
      },
      {
        title: "見積もりを集める",
        body: "引っ越し業者3社に依頼して比較します。",
        props: { status: "レビュー中", project: "[[新オフィスへの移転]]", person: "[[Anna Berg]]", start: "{{today+7}}", end: "{{today+14}}", effort: 120 },
      },
    ],
    milestones: [
      {
        title: "構成が固まった",
        body: "ここから先は書くだけで、もう整理する必要はありません。",
        props: { status: "未達成", date: "{{today+2}}", project: "[[ウェブサイトのリニューアル]]" },
      },
      {
        title: "サイトが公開された",
        body: "切り替えが行われる日です。",
        props: { status: "未達成", date: "{{today+30}}", project: "[[ウェブサイトのリニューアル]]" },
      },
      {
        title: "鍵の引き渡し",
        body: "この日がなければ、引っ越しは始まりません。",
        props: { status: "リスクあり", date: "{{today+21}}", project: "[[新オフィスへの移転]]" },
      },
    ],
    people: [
      { title: "Anna Berg", body: "プロジェクトを率い、迷ったときは判断を下します。", props: { role: "リーダー" } },
      { title: "Jonas Feld", body: "執筆を担当し、計画にも関わります。", props: { role: "メンバー" } },
    ],
  },
};
