import type { VaultTemplateDefinition } from "./types";
import { buildPlainvaTour, type TourStrings } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";
import { buildGtd, type GtdStrings } from "./gtdTemplate";
import { buildZettelkasten, type ZettelkastenStrings } from "./zettelkastenTemplate";
import { buildAce, type AceStrings } from "./aceTemplate";
import { buildJd, type JdStrings } from "./jdTemplate";
import { buildJournal, type JournalStrings } from "./journalTemplate";

/** French template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/diacritic-free; option VALUES, view names and `.base` file names are
 * fully localized. Relation columns and their reverse counterparts are wired
 * here so the databases show real data as soon as the vault is indexed. */

// ---------------------------------------------------------------------------
// Plainva Tour — shared structure (plainvaTour.ts), French strings.
// ---------------------------------------------------------------------------

const CHEAT_SHEET_FR = `Tout ce qui suit est du Markdown pur. Basculez entre lecture et édition avec la barre d'outils — l'éditeur n'affiche les marques de mise en forme qu'à l'endroit où se trouve votre curseur.

> [!tip] Callouts
> Commencez une citation par \`> [!tip]\`. Il existe d'autres types : note, warning, danger, example, question.

## Un tableau

| Raccourci | Action |
| --- | --- |
| \`Mod+P\` | Palette de commandes |
| \`Mod+O\` | Sélecteur rapide |
| \`F1\` | Tous les raccourcis clavier |

## Un diagramme

\`\`\`mermaid
flowchart LR
  A[Note rapide] --> B[Tâche]
  B --> C[Projet]
  C --> D[Domaine]
\`\`\`

## Une formule

Dans le texte : $E = mc^2$

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

## Une image

![[Pièces jointes/skizze.svg]]

## Tâches et surlignage

- [x] Quelque chose de terminé
- [ ] Quelque chose ==à marquer== #tour

Les liens pointent vers des notes : [[Refonte du site web]] et [[Travail]].

Les notes de bas de page fonctionnent aussi.[^1]

[^1]: Comme celle-ci.
`;

const TOUR_STRINGS_FR: TourStrings = {
  name: "Tour Plainva",
  description: "Un vault guidé : tableau d'affichage, notes quotidiennes, domaines, projets et tâches — toutes les vues offertes par Plainva, remplies d'exemples.",
  folders: {
    quickNotes: "Notes rapides",
    journal: "Journal",
    areas: "Domaines",
    projects: "Projets",
    tasks: "Tâches",
    resources: "Ressources",
    archive: "Archives",
    attachments: "Pièces jointes",
    templates: "Modèles",
  },
  folderHints: {
    quickNotes: "Tout ce qui n'a pas encore de place — en tableau d'affichage.",
    journal: "Une note par jour, dans le calendrier.",
    areas: "Des responsabilités durables, en galerie.",
    projects: "Des projets avec une fin, sur un kanban et une chronologie.",
    tasks: "La base de données de tâches standard — kanban et tableau.",
    resources: "Du matériel que vous voulez conserver.",
    archive: "Le travail terminé ; déplacer une note ici la retire des vues actives.",
    attachments: "Images et fichiers.",
    templates: "Des modèles de notes, chacun relié à sa base de données.",
  },
  welcome: {
    file: "Bienvenue.md",
    title: "Bienvenue dans Plainva",
    intro: "Ce vault est une visite guidée. Chaque dossier ci-dessous est rempli d'exemples, et chaque base de données montre une vue différente — ouvrez-les et modifiez-les : rien ici n'est précieux.",
    outro: "Tout ce que vous voyez est du Markdown pur dans ce dossier. Supprimez ce dont vous n'avez pas besoin, renommez le reste, et le vault est à vous.",
  },
  templates: {
    project: { file: "Projet.md", body: "# {{title}}\n\n## Objectif\n\n## Prochaines étapes\n\n- [ ] \n" },
    task: { file: "Tâche.md", body: "# {{title}}\n\n" },
    area: { file: "Domaine.md", body: "# {{title}}\n\n## À quoi ressemble la réussite\n\n" },
    resource: { file: "Ressource.md", body: "# {{title}}\n\n## Pourquoi cela vaut la peine d'être gardé\n\n" },
    quickNote: { file: "Note rapide.md", body: "# {{title}}\n\n" },
    daily: {
      file: "Note quotidienne.md",
      description: "Modèle pour les nouvelles notes quotidiennes — {{date}}, {{time}} et {{daily±1}} sont remplacés.",
      body: "# {{title}}\n\n{{daily-1}} · {{date:dddd}} · {{daily+1}}\n\n## Tâches\n\n- [ ] \n\n## Notes\n\n{{cursor}}\n",
    },
    meeting: {
      file: "Réunion.md",
      description: "Non assigné à une base de données — il apparaît sous « Afficher tous les modèles ». Pose trois questions dans UN SEUL dialogue.",
      body: "# {{title}}\n\n**Type :** {{select:Type|Hebdomadaire,Tête-à-tête,Atelier,Revue}}\n**Date :** {{date_prompt:Date de la réunion}}\n**Présents :** {{prompt:Présents|moi}}\n\n## Ordre du jour\n\n{{cursor}}\n\n## Décisions\n\n## Tâches\n\n- [ ] \n",
    },
  },
  baseFiles: {
    areas: "Domaines.base",
    projects: "Projets.base",
    tasks: "Tâches.base",
    resources: "Ressources.base",
    quickNotes: "Notes rapides.base",
    journal: "Journal.base",
    archive: "Archives.base",
  },
  keys: {
    focus: "focus", cover: "cover", projects: "projets",
    status: "status", area: "domaine", start: "debut", end: "fin", tasks: "taches",
    done: "termine", project: "projet", due: "echeance", priority: "prio",
    date: "date", mood: "humeur", topics: "motscles",
    kind: "genre", url: "url", readStatus: "status",
    finished: "cloture",
  },
  options: {
    projectStatus: ["Planifié", "Actif", "En attente", "Terminé"],
    taskStatus: ["Ouverte", "En cours", "Terminée"],
    priority: ["Haute", "Moyenne", "Basse"],
    mood: ["Bonne", "Neutre", "Difficile", "Productive"],
    resourceKind: ["Livre", "Article", "Vidéo", "Outil", "Référence"],
    resourceStatus: ["Nouveau", "Consulté"],
  },
  views: {
    table: "Tableau", board: "Kanban", timeline: "Chronologie", gallery: "Galerie",
    list: "Liste", tree: "Arborescence", calendar: "Calendrier", pinboard: "Tableau d'affichage",
  },
  subItems: { parent: "Élément parent", children: "Sous-éléments" },
  welcomeSections: { databases: "Vos bases de données", start: "Pour commencer" },
  samples: {
    areas: [
      { title: "Travail", body: "Tout ce pour quoi je suis payé. Les projets ici ont des échéances.", icon: "💼", color: "#2a7f7b", props: { focus: "Livrer sans heures supplémentaires", cover: "Pièces jointes/cover.svg" } },
      { title: "Maison", body: "L'appartement, la paperasse, les choses qui continuent de tourner.", icon: "🏠", color: "#8a6d3b", props: { focus: "Rien en retard", cover: "Pièces jointes/cover.svg" } },
      { title: "Santé", body: "Le sommeil, le mouvement, l'alimentation — les choses ennuyeuses qui déterminent tout le reste.", icon: "🌱", color: "#3d7f4a", props: { focus: "Trois séances par semaine" } },
      { title: "Apprentissage", body: "Ce que je veux améliorer l'année prochaine.", icon: "📚", color: "#5a5a8a", props: { focus: "Un livre par mois" } },
    ],
    projects: [
      { title: "Refonte du site web", body: "Nouvelle page d'accueil et une structure plus claire.\n\nVoir [[Travail]].", props: { status: "Actif", domaine: "[[Travail]]", debut: "{{today-6}}", fin: "{{today+9}}" } },
      { title: "Déménager le bureau", body: "Pièce plus petite, même bureau.", props: { status: "Planifié", domaine: "[[Travail]]", debut: "{{today+4}}", fin: "{{today+13}}" } },
      { title: "Déclaration d'impôts", body: "En attente de deux justificatifs.", props: { status: "En attente", domaine: "[[Maison]]", debut: "{{today-3}}", fin: "{{today+6}}" } },
      { title: "Plan marathon", body: "Douze semaines, trois sorties par semaine.\n\nAppartient à [[Santé]].", props: { status: "Terminé", domaine: "[[Santé]]", debut: "{{today-12}}", fin: "{{today-2}}" } },
    ],
    tasks: [
      { title: "Ébaucher la page d'accueil", body: "Deux variantes, puis décider.", props: { termine: false, status: "En cours", projet: "[[Refonte du site web]]", echeance: "{{today+1}}", prio: "Haute" } },
      { title: "Recueillir les retours", body: "Trois personnes, quinze minutes chacune.", props: { termine: false, status: "Ouverte", projet: "[[Refonte du site web]]", echeance: "{{today+5}}", prio: "Moyenne", parent: "[[Ébaucher la page d'accueil]]" } },
      { title: "Rédiger les textes", body: "Des phrases courtes.", props: { termine: false, status: "Ouverte", projet: "[[Refonte du site web]]", echeance: "{{today+7}}", prio: "Moyenne" } },
      { title: "Trier les anciennes pages", body: "", props: { termine: true, status: "Terminée", projet: "[[Refonte du site web]]", echeance: "{{today-2}}", prio: "Basse" } },
      { title: "Mesurer la nouvelle pièce", body: "Le bureau fait 160 cm.", props: { termine: false, status: "Ouverte", projet: "[[Déménager le bureau]]", echeance: "{{today+3}}", prio: "Moyenne" } },
      { title: "Commander des cartons", body: "", props: { termine: false, status: "Ouverte", projet: "[[Déménager le bureau]]", echeance: "{{today+8}}", prio: "Basse" } },
      { title: "Demander les justificatifs", body: "Par e-mail, en restant bref.", props: { termine: false, status: "En cours", projet: "[[Déclaration d'impôts]]", echeance: "{{today}}", prio: "Haute" } },
      { title: "Réserver le kiné", body: "", props: { termine: true, status: "Terminée", projet: "[[Plan marathon]]", echeance: "{{today-4}}", prio: "Moyenne" } },
      { title: "Planifier la saison prochaine", body: "Des distances plus courtes, plus de sommeil.", props: { termine: false, status: "Ouverte", echeance: "{{today+11}}", prio: "Basse" } },
    ],
    quickNotes: [
      { title: "Lisez-moi d'abord", body: "Les cartes sur ce tableau d'affichage sont des notes ordinaires. Déplacez-les, épinglez-les, colorez-les — ou supprimez-les toutes.\n\n#tour", pinned: true, color: "#2a7f7b" },
      { title: "Courses", body: "- [ ] Café\n- [ ] Huile d'olive\n- [x] Pain\n\n#maison", color: "#8a6d3b" },
      { title: "Idée de soirée lecture", body: "Une fois par mois, un livre, pas de diapositives.\n\n#idée" },
      { title: "Citation", body: "> Une note que l'on ne retrouve jamais n'a jamais été écrite.\n\n#citation", color: "#5a5a8a" },
      { title: "Croquis", body: "L'image ci-dessous se trouve dans le dossier des pièces jointes.\n\n![[Pièces jointes/skizze.svg]]\n\n#tour", pinned: true },
      { title: "Clavier", body: "`Mod+P` ouvre la palette de commandes, `F1` liste tous les raccourcis.\n\n#tour" },
    ],
    journal: [
      { title: "{{today}}", body: "Commencé la visite. Le kanban est plus clair qu'une liste.\n\nTravaillé sur [[Ébaucher la page d'accueil]].", props: { date: "{{today}}", humeur: "Productive", motscles: ["tour"] } },
      { title: "{{today-1}}", body: "Journée calme. Trié les papiers de la [[Déclaration d'impôts]].", props: { date: "{{today-1}}", humeur: "Neutre", motscles: ["maison"] } },
    ],
    resources: [
      { title: "Aide-mémoire Markdown", body: CHEAT_SHEET_FR, props: { genre: "Référence", status: "Consulté", cover: "Pièces jointes/cover.svg" } },
      { title: "Manuel Plainva", body: "Le guide complet se trouve sur plainva.com/docs.", props: { genre: "Référence", url: "https://plainva.com/docs", status: "Nouveau" } },
      { title: "Deep work", body: "Cal Newport. Le chapitre sur la planification est le plus utile.", props: { genre: "Livre", status: "Nouveau", domaine: "[[Apprentissage]]" } },
      { title: "Raccourcis clavier", body: "Appuyez sur `F1` dans Plainva — vous pouvez chercher dans la liste.", props: { genre: "Référence", status: "Consulté", domaine: "[[Apprentissage]]" } },
    ],
    archive: [
      { title: "Ancien site web", body: "Remplacé par [[Refonte du site web]]. Conservé pour les textes.", props: { cloture: "{{today-20}}" } },
    ],
  },
};

const PARA_STRINGS_FR: ParaStrings = {
  name: "PARA",
  description: "Projets, Domaines, Ressources, Archives — triés par caractère actionnable (Tiago Forte).",
  folders: {
    projects: "Projets",
    tasks: "Tâches",
    areas: "Domaines",
    resources: "Ressources",
    archive: "Archives",
    templates: "Modèles",
  },
  folderHints: {
    projects: "Des initiatives avec un objectif clair et une date de fin (Projets.base).",
    tasks: "Des prochaines étapes uniques — chacune renvoie à son projet (Tâches.base).",
    areas: "Des responsabilités durables, sans date de fin.",
    resources: "Des sujets, du matériel et des références à conserver.",
    archive: "Ce qui est terminé ou inactif, venu des autres dossiers.",
  },
  welcome: {
    file: "Bienvenue.md",
    description: "Point de départ et guide rapide pour ce vault.",
    title: "Bienvenue",
    intro:
      "Ce vault est organisé selon la méthode PARA (Tiago Forte) : le contenu est trié par caractère actionnable, pas par thème. Les exemples ci-dessous sont de vraies notes — modifiez-les, déplacez-les, supprimez-les.",
    outro:
      "Ouvrez les bases de données pour voir les projets par statut, leur associer des tâches et les relier à leurs domaines — ce qui est terminé passe dans Archives, tandis que les liens et les vues d'ensemble index.md sont mis à jour automatiquement.",
  },
  welcomeSections: { databases: "Vos bases de données", start: "Pour commencer" },
  baseFiles: { projects: "Projets.base", tasks: "Tâches.base", areas: "Domaines.base" },
  keys: { status: "status", area: "domaine", due: "echeance", tasks: "taches", project: "projet", projects: "projets" },
  options: {
    projectStatus: ["Planifié", "Actif", "En attente", "Terminé"],
    taskStatus: ["Ouverte", "En cours", "Terminée"],
  },
  views: { table: "Tableau", byStatus: "Par statut" },
  templates: {
    project: { file: "Projet.md", body: "# {{title}}\n\n## Objectif\n\n## Prochaines étapes\n\n- [ ] \n" },
    task: { file: "Tâche.md", body: "# {{title}}\n\n## Notes\n\n- [ ] \n" },
  },
  samples: {
    areas: [
      {
        title: "Équipe",
        body: "Un domaine est une responsabilité durable, sans date de fin. Les projets s'y rattachent via leur propriété Domaine — le tableau de Domaines.base les reflète en retour.",
      },
      { title: "Finances", body: "Comptabilité, contrats, assurances. Ça continue même quand aucun projet n'est ouvert." },
      { title: "Santé", body: "Tout ce qui demande une attention durable plutôt qu'une fin." },
    ],
    projects: [
      {
        title: "Déclaration d'impôts 2026",
        body: "Un projet a un objectif clair et une fin prévisible. Celui-ci est planifié, mais pas encore commencé — c'est pourquoi il se trouve dans la première colonne du tableau.",
        props: { status: "Planifié", domaine: "[[Finances]]", echeance: "{{today+45}}" },
      },
      {
        title: "Déménagement vers le nouveau bureau",
        body: "L'exemple actif : les tâches ci-dessous pointent ici via leur propriété Projet, et Projets.base les reflète dans sa colonne Tâches.\n\n- [ ] Noter l'objectif du projet\n- [ ] Décider de la prochaine étape",
        props: { status: "Actif", domaine: "[[Équipe]]", echeance: "{{today+21}}" },
      },
      {
        title: "Programme pour le dos",
        body: "En attente de quelque chose hors de votre contrôle — ici, un rendez-vous. C'est exactement à cela que sert la troisième colonne.",
        props: { status: "En attente", domaine: "[[Santé]]", echeance: "{{today+10}}" },
      },
      {
        title: "Refonte du site web",
        body: "Terminé. Un projet achevé reste visible jusqu'à ce que vous le déplaciez dans Archives — la base de données suit le fichier.",
        props: { status: "Terminé", domaine: "[[Équipe]]", echeance: "{{today-5}}" },
      },
    ],
    tasks: [
      {
        title: "Obtenir des devis de déménageurs",
        body: "Une tâche est une prochaine étape unique et concrète.",
        props: { status: "Ouverte", projet: "[[Déménagement vers le nouveau bureau]]", echeance: "{{today+3}}" },
      },
      {
        title: "Vérifier le préavis pour les anciens locaux",
        body: "Commencée mais pas terminée — la colonne du milieu dans le tableau.",
        props: { status: "En cours", projet: "[[Déménagement vers le nouveau bureau]]", echeance: "{{today+1}}" },
      },
      {
        title: "Valider le plan avec l'équipe",
        body: "Faites glisser la carte vers une autre colonne du tableau : Plainva écrit le nouveau statut dans la note.",
        props: { status: "En cours", projet: "[[Déménagement vers le nouveau bureau]]", echeance: "{{today+7}}" },
      },
      {
        title: "Trier les justificatifs",
        body: "Appartient à un projet qui n'a pas encore commencé — c'est permis, et souvent utile.",
        props: { status: "Ouverte", projet: "[[Déclaration d'impôts 2026]]", echeance: "{{today+14}}" },
      },
      {
        title: "Prendre rendez-vous chez le kinésithérapeute",
        body: "Terminée. La tâche reste une note ; seul son statut a changé.",
        props: { status: "Terminée", projet: "[[Programme pour le dos]]", echeance: "{{today-2}}" },
      },
      {
        title: "Rediriger l'ancien domaine",
        body: "La dernière étape du projet achevé.",
        props: { status: "Terminée", projet: "[[Refonte du site web]]", echeance: "{{today-6}}" },
      },
    ],
    resources: [
      {
        title: "Checklist déménagement de bureau",
        body: "Les ressources sont du matériel à consulter — pas d'objectif, pas de date de fin. Elles ne se trouvent volontairement dans aucune base de données : tout n'a pas besoin de lignes et de colonnes.\n\n- [ ] Changement d'adresse à la banque et à l'assurance\n- [ ] Mesurer le réseau et les imprimantes",
      },
      {
        title: "Ce qui distingue PARA des dossiers classiques",
        body: "PARA trie par caractère actionnable : les projets ont une fin, les domaines continuent, les ressources sont des références, les archives regroupent tout le reste. Déplacez une note d'un dossier à l'autre dès que son rôle change.",
      },
    ],
    archive: [
      {
        title: "Salon professionnel 2025",
        body: "Voici à quoi ressemble une note archivée : une note ordinaire, simplement dans un autre dossier. Rien n'est perdu — elle n'apparaît simplement plus dans les bases de données actives.",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// GTD — shared structure (gtdTemplate.ts), French strings.
// ---------------------------------------------------------------------------

const GTD_STRINGS_FR: GtdStrings = {
  name: "GTD",
  description: "Getting Things Done — boîte de réception, tâches, projets, références et liste Un jour peut-être.",
  folders: {
    inbox: "Boîte de réception",
    tasks: "Tâches",
    projects: "Projets",
    reference: "Références",
    someday: "Un jour peut-être",
    templates: "Modèles",
  },
  folderHints: {
    inbox: "Le point de collecte de tout ce qui arrive — videz-la régulièrement.",
    tasks: "Des prochaines actions uniques — organisées par statut et contexte (Tâches.base).",
    projects: "Tout ce qui demande plus d'une étape (Projets.base).",
    reference: "Du matériel à consulter, sans action requise.",
    someday: "Des idées et des projets pour plus tard.",
  },
  welcome: {
    file: "Bienvenue.md",
    title: "Bienvenue",
    description: "Point de départ et guide rapide pour ce vault.",
    intro:
      "Ce vault suit Getting Things Done (David Allen) : tout atterrit d'abord dans la boîte de réception, puis est traité en tâches et projets concrets.",
    outro:
      "Dans Tâches.base, vous rattachez chaque tâche à un projet via sa propriété Projet ; Projets.base affiche alors automatiquement, dans la colonne Tâches, ce qui appartient à chaque projet. La revue hebdomadaire garde le système fiable.",
  },
  welcomeSections: { databases: "Vos bases de données", start: "Pour commencer" },
  baseFiles: { tasks: "Tâches.base", projects: "Projets.base" },
  keys: { status: "status", context: "contexte", project: "projet", due: "echeance", tasks: "taches" },
  options: {
    taskStatus: ["Boîte de réception", "Suivante", "En attente", "Un jour", "Terminée"],
    context: ["@Maison", "@Travail", "@Courses", "@Téléphone"],
    projectStatus: ["Actif", "En attente", "Un jour", "Terminé"],
  },
  views: { table: "Tableau", byStatus: "Par statut", byContext: "Par contexte" },
  templates: {
    task: { file: "Tâche.md", body: "# {{title}}\n\n## Notes\n\n- [ ] \n" },
    project: { file: "Projet.md", body: "# {{title}}\n\n## Résultat souhaité\n\n## Prochaines étapes\n\n- [ ] \n" },
  },
  review: {
    title: "Revue hebdomadaire",
    description: "Liste de contrôle pour la revue hebdomadaire GTD.",
    body: "- [ ] Vider la boîte de réception\n- [ ] Parcourir la liste des projets et vérifier les prochaines actions\n- [ ] Survoler la liste Un jour peut-être\n- [ ] Regarder le calendrier des deux prochaines semaines",
  },
  samples: {
    projects: [
      {
        title: "Rénover la cuisine",
        body: "Résultat souhaité : à quoi ressemble « terminé » ? En GTD, tout ce qui demande plus d'une étape est un projet — même ce qui n'en a pas l'air.",
        props: { status: "Actif" },
      },
      {
        title: "Révision de la voiture",
        body: "En attente de quelqu'un d'autre — ici, un rappel du garage. C'est pourquoi ce projet se trouve dans la deuxième colonne du tableau.",
        props: { status: "En attente" },
      },
      {
        title: "Apprendre l'espagnol",
        body: "Un jour, peut-être. Il figure dans le système pour cesser d'occuper votre esprit — mais il ne demande pas d'attention pour l'instant.",
        props: { status: "Un jour" },
      },
      {
        title: "Trier les déclarations d'impôts",
        body: "Terminé. Un projet achevé reste visible jusqu'à ce que vous le supprimiez — la base de données suit le fichier.",
        props: { status: "Terminé" },
      },
    ],
    tasks: [
      {
        title: "Rassembler des idées",
        body: "Tout juste arrivée dans la boîte de réception et pas encore traitée — elle n'a donc ni contexte ni projet. La prochaine revue lui donnera les deux.",
        props: { status: "Boîte de réception" },
      },
      {
        title: "Prendre les mesures de la cuisine",
        body: "Une tâche est une prochaine action unique et concrète. Via sa propriété Projet, elle appartient à la rénovation.",
        props: { status: "Suivante", contexte: "@Maison", projet: "[[Rénover la cuisine]]", echeance: "{{today+2}}" },
      },
      {
        title: "Examiner le devis du menuisier",
        body: "Faites glisser la carte vers une autre colonne du tableau : Plainva écrit le nouveau statut dans la note.",
        props: { status: "Suivante", contexte: "@Travail", projet: "[[Rénover la cuisine]]", echeance: "{{today+5}}" },
      },
      {
        title: "Rappeler le garage",
        body: "En attente de quelqu'un d'autre. Le contexte @Téléphone rassemble tout ce que vous pouvez régler d'un coup, une fois le téléphone en main.",
        props: { status: "En attente", contexte: "@Téléphone", projet: "[[Révision de la voiture]]" },
      },
      {
        title: "Chercher un cours de langue à proximité",
        body: "Appartient à un projet Un jour et attend avec lui. C'est aussi une décision — juste une décision contre le maintenant.",
        props: { status: "Un jour", contexte: "@Courses", projet: "[[Apprendre l'espagnol]]" },
      },
      {
        title: "Scanner les justificatifs de l'année dernière",
        body: "Terminée. La tâche reste une note ; seul son statut a changé.",
        props: { status: "Terminée", contexte: "@Maison", projet: "[[Trier les déclarations d'impôts]]", echeance: "{{today-4}}" },
      },
    ],
    reference: [
      {
        title: "Les deux questions du GTD",
        body: "Une référence est du matériel sans action à mener — elle ne se trouve volontairement dans aucune base de données.\n\nEn traitant la boîte de réception, vous répondez à deux questions : est-ce actionnable ? Et si oui — quelle est l'unique prochaine action concrète ? Tout le reste est référence, à faire un jour, ou à la corbeille.",
      },
    ],
    someday: [
      {
        title: "Livre photo de l'été dernier",
        body: "Un jour ne veut pas dire jamais, mais pas maintenant. Pendant la revue hebdomadaire, vous parcourez cette liste — ce qui attire votre regard deux fois devient un projet.",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Zettelkasten — shared structure (zettelkastenTemplate.ts), French strings.
// ---------------------------------------------------------------------------

const ZK_STRINGS_FR: ZettelkastenStrings = {
  name: "Zettelkasten",
  description: "Une idée par note, densément liée — notes éphémères, de lecture et permanentes (Luhmann).",
  folders: {
    fleeting: "Notes éphémères",
    literature: "Notes de lecture",
    permanent: "Notes permanentes",
    templates: "Modèles",
  },
  folderHints: {
    fleeting: "Des pensées brutes et rapides — éphémères, traitées plus tard.",
    literature: "Des résumés de vos lectures, dans vos propres mots, avec la source.",
    permanent: "Des idées durables et bien formulées — une par note, fortement liées.",
  },
  welcome: {
    file: "Bienvenue.md",
    title: "Bienvenue",
    description: "Point de départ et guide rapide pour ce vault.",
    intro:
      "Ce vault suit la méthode Zettelkasten (Niklas Luhmann) : une idée par note — les connexions naissent des liens, pas des hiérarchies de dossiers.",
    outro:
      "Utilisez Lecture.base pour suivre vos sources par statut de lecture ; Fiches.base relie les notes permanentes, via leur propriété Source, à la lecture dont elles proviennent.",
  },
  welcomeSections: { databases: "Vos bases de données", start: "Pour commencer" },
  baseFiles: { literature: "Lecture.base", slips: "Fiches.base" },
  keys: { author: "auteur", year: "annee", kind: "genre", status: "status", url: "url", slips: "fiches", source: "source" },
  options: {
    kind: ["Livre", "Article", "Vidéo", "Podcast", "Site web"],
    status: ["À lire", "Lu", "Traité"],
  },
  views: { table: "Tableau", byStatus: "Par statut" },
  templates: {
    literature: { file: "Note de lecture.md", body: "# {{title}}\n\n## Résumé\n\n## Source\n" },
    slip: { file: "Fiche.md", body: "# {{title}}\n\nUne idée, en phrases complètes.\n\n## Fiches apparentées\n\n- \n" },
  },
  samples: {
    permanent: [
      {
        title: "Une idée par fiche",
        body: "Une fiche permanente contient exactement une idée, rédigée en phrases complètes et dans vos propres mots. C'est seulement ainsi qu'elle pourra être réutilisée plus tard dans un autre contexte, sans avoir à retrouver l'original.\n\nÀ suivre : [[Relier plutôt que classer]] et [[Écrire, c'est penser]].",
        props: { source: ["[[Luhmann - Communiquer avec des boîtes de fiches]]"] },
      },
      {
        title: "Relier plutôt que classer",
        body: "Un dossier force chaque note dans un seul tiroir. Un lien lui permet d'exister dans autant de contextes qu'elle le mérite — c'est pourquoi une boîte de fiches gagne en valeur avec le temps au lieu de devenir ingérable.\n\nContrepartie : [[Une idée par fiche]]. Conséquence pratique : [[La fiche d'entrée]].",
        props: { source: ["[[Luhmann - Communiquer avec des boîtes de fiches]]"] },
      },
      {
        title: "Écrire, c'est penser",
        body: "Si vous pouvez écrire une idée dans vos propres mots, c'est que vous l'avez comprise ; sinon, pas encore. Transformer une note de lecture en fiche n'est donc pas une simple copie — c'est le vrai travail.\n\nVoir aussi [[Une idée par fiche]].",
        props: { source: ["[[Ahrens - Comment prendre des notes intelligentes]]"] },
      },
      {
        title: "La fiche d'entrée",
        body: "Une boîte de fiches a besoin de portes. Une fiche d'entrée rassemble des liens vers les fils sur lesquels vous travaillez — elle ne remplace pas une table des matières, elle est elle-même une fiche en perpétuelle évolution.\n\nFils : [[Relier plutôt que classer]] · [[Écrire, c'est penser]].",
      },
    ],
    literature: [
      {
        title: "Luhmann - Communiquer avec des boîtes de fiches",
        body: "Résumez ici dans vos propres mots ce que vous avez lu et notez la source. Les fiches permanentes renvoient ici via leur propriété Source — la colonne Fiches vous montre lesquelles.",
        props: { auteur: "Niklas Luhmann", annee: 1981, genre: "Article", status: "Traité" },
      },
      {
        title: "Ahrens - Comment prendre des notes intelligentes",
        body: "Lu, mais pas encore transformé en fiches. C'est justement le rôle du statut : au prochain coup d'œil, il vous indique où le travail s'est arrêté.",
        props: { auteur: "Sönke Ahrens", annee: 2017, genre: "Livre", status: "Lu" },
      },
      {
        title: "Podcast sur la prise de notes",
        body: "Pas encore lu — ou plutôt écouté. Dans le tableau, cette source reste dans la première colonne tant que vous n'y touchez pas.",
        props: { genre: "Podcast", status: "À lire" },
      },
    ],
    fleeting: [
      {
        title: "Notes prises en marchant",
        body: "Les notes éphémères sont de la matière première : griffonnées, incomplètes, de courte durée. Le traitement en fait une fiche — ou rien du tout, et c'est très bien aussi.\n\n- Idée : les références valent plus que les dossiers\n- Vérifier : cette citation de Luhmann est-elle exacte ?",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// ACE (Linking Your Thinking) — shared structure (aceTemplate.ts), French strings.
// ---------------------------------------------------------------------------

const ACE_STRINGS_FR: AceStrings = {
  name: "ACE (Linking Your Thinking)",
  description: "Atlas, Calendrier et Efforts — travail de la connaissance centré sur les MOC, d'après Nick Milo.",
  folders: { atlas: "Atlas", calendar: "Calendrier", efforts: "Efforts" },
  folderHints: {
    atlas: "Les cartes de votre connaissance — MOCs et notes de synthèse.",
    calendar: "Les notes liées au temps — notes quotidiennes, journaux, rétrospectives.",
    efforts: "Tout ce sur quoi vous travaillez activement.",
  },
  welcome: {
    file: "Bienvenue.md",
    title: "Bienvenue",
    description: "Point de départ et guide rapide pour ce vault.",
    intro:
      "Ce vault utilise le schéma ACE de « Linking Your Thinking » (Nick Milo) : la connaissance est reliée par des Maps of Content (MOCs) plutôt que par une imbrication profonde. Tout ce qui suit part de la note Home — parcourez les liens, puis jetez un œil au graphe.",
    outro:
      "Commencez dans l'Atlas avec la note Home et tissez des liens vers votre connaissance depuis là. Un MOC n'est lui-même qu'une note : il peut grandir, se scinder, et disparaître à nouveau.",
  },
  welcomeSections: { start: "Pour commencer" },
  home: {
    title: "Home",
    description: "Votre Map of Content de plus haut niveau.",
    lead: "La note Home est votre point d'entrée : reliez ici vos Maps of Content les plus importantes et vos efforts en cours. Aucun dossier ne peut faire cela — un dossier ne peut classer une note qu'à un seul endroit.",
    mapsHeading: "Cartes",
    effortsHeading: "Efforts en cours",
  },
  maps: [
    {
      title: "MOC Écriture",
      body: "Une Map of Content rassemble ce qui appartient à un sujet et l'organise avec vos propres mots. Elle ne remplace pas une table des matières — c'est votre point de vue sur un sujet, à un instant donné.",
      leads: "À partir d'ici :",
    },
    {
      title: "MOC Jardin",
      body: "Un MOC peut aussi pointer hors de l'Atlas : cette carte mène à un effort en cours. Ce croisement est précisément l'idée.",
      leads: "À partir d'ici :",
    },
  ],
  samples: {
    atlas: [
      {
        title: "Pourquoi des cartes plutôt que des dossiers",
        body: "Un dossier répond à la question « où se trouve-t-il ? ». Une carte répond à « qu'est-ce qui va ensemble, et pourquoi ? » — et la même note peut figurer sur plusieurs cartes.\n\nRetour à la carte : [[MOC Écriture]].",
      },
    ],
    efforts: [
      {
        title: "Construire un carré potager",
        body: "Un effort est quelque chose sur quoi vous travaillez maintenant, avec une fin prévisible. Il ne vit volontairement pas dans l'Atlas : l'Atlas est fait pour ce qui dure.\n\n- [ ] Fixer les dimensions\n- [ ] Se procurer le bois\n\nAppartient à [[MOC Jardin]].",
      },
    ],
    calendar: [
      {
        title: "{{today}}",
        body: "Les notes liées au temps vont dans le dossier Calendrier : notes quotidiennes, rétrospectives, tout ce qui se rattache à une date plutôt qu'à un sujet.\n\nConsulté aujourd'hui : [[Pourquoi des cartes plutôt que des dossiers]].",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Johnny.Decimal — shared structure (jdTemplate.ts), French strings.
// ---------------------------------------------------------------------------

const JD_STRINGS_FR: JdStrings = {
  name: "Johnny.Decimal",
  description: "Des zones et catégories numérotées (10-19 / 11 / 11.01) pour tout retrouver à coup sûr.",
  folders: {
    system: "00-09 Système",
    systemIndex: "00 Index",
    personal: "10-19 Personnel",
    finance: "11 Finances",
    health: "12 Santé",
    work: "20-29 Travail",
    projects: "21 Projets",
    meetings: "22 Réunions",
  },
  folderHints: {
    system: "La gestion du système lui-même — index et conventions.",
    personal: "Zone d'exemple pour les sujets personnels.",
    work: "Zone d'exemple pour les sujets professionnels.",
  },
  welcome: {
    file: "Bienvenue.md",
    title: "Bienvenue",
    description: "Point de départ et guide rapide pour ce vault.",
    intro:
      "Ce vault est organisé selon Johnny.Decimal : au plus dix zones (10-19, 20-29, …), au plus dix catégories par zone (11, 12, …) — et chaque note reçoit un identifiant comme 11.01. Les exemples ci-dessous montrent à quoi cela ressemble.",
    outro:
      "Renommez les zones et catégories selon vos sujets — la profondeur volontairement limitée (zone → catégorie → identifiant) est le cœur de la méthode. Un numéro n'est jamais réattribué, même quand la note disparaît.",
  },
  welcomeSections: { start: "Pour commencer" },
  index: {
    id: "00.00",
    title: "Index",
    description: "L'index Johnny.Decimal : tous les numéros au même endroit.",
    lead: "Tenez ici la liste de toutes les zones, catégories et identifiants. Qui cherche un numéro regarde d'abord ici — s'il n'y figure pas, il n'existe pas.",
  },
  samples: [
    {
      id: "11.01",
      title: "Budget familial",
      body: "La première note de la catégorie 11 reçoit le 01 — la suivante le 02, et ainsi de suite. Le numéro reste attaché à la note même si vous la renommez.",
    },
    {
      id: "21.01",
      title: "Relance du site web",
      body: "Un projet entier reçoit lui aussi exactement un numéro. Tout ce qui s'y rattache s'y réfère au lieu de disparaître dans un sous-dossier qui lui serait propre.",
    },
    {
      id: "22.01",
      title: "Lancement du site web",
      body: "Les comptes rendus de réunion forment leur propre catégorie afin de ne pas encombrer le numéro du projet. Celui-ci appartient à [[21.01 Relance du site web]].",
    },
  ],
};

// ---------------------------------------------------------------------------
// Journal — shared structure (journalTemplate.ts), French strings.
// ---------------------------------------------------------------------------

const JOURNAL_STRINGS_FR: JournalStrings = {
  name: "Journal",
  description: "Des notes quotidiennes avec un modèle prêt à l'emploi et une base de données de journal — tout est configuré d'emblée.",
  folders: { journal: "Journal", templates: "Modèles" },
  folderHints: {
    journal: "Vos notes quotidiennes, une par jour.",
    templates: "Les modèles pour les nouvelles notes — le modèle de note quotidienne est déjà configuré.",
  },
  welcome: {
    file: "Bienvenue.md",
    title: "Bienvenue",
    description: "Point de départ et guide rapide pour ce vault.",
    intro:
      "Ce vault est fait pour l'écriture quotidienne : les notes quotidiennes vivent dans le dossier Journal et sont créées à partir du modèle du dossier Modèles. Deux journées d'exemple sont déjà là — aujourd'hui et hier.",
    outro:
      "Ouvrez le calendrier dans la barre latérale droite et cliquez sur un jour pour créer la note quotidienne suivante. Journal.base montre vos entrées sous forme de tableau et sur un calendrier — avec la date, l'humeur et les mots-clés.",
  },
  welcomeSections: { databases: "Vos bases de données", start: "Pour commencer" },
  baseFile: "Journal.base",
  keys: { date: "date", mood: "humeur", tags: "motscles" },
  moods: ["Bonne", "Neutre", "Mauvaise", "Productive", "Fatiguée"],
  views: { table: "Tableau", calendar: "Calendrier" },
  template: {
    file: "Note quotidienne.md",
    description: "Modèle pour les nouvelles notes quotidiennes — {{date}}, {{time}} et {{title}} sont remplacés.",
    body: "# {{title}}\n\n## Notes\n\n## Tâches\n\n- [ ] \n",
  },
  samples: [
    {
      offset: 0,
      mood: "Productive",
      tags: ["travail", "écriture"],
      body: "Voici à quoi ressemble une entrée. L'humeur et les mots-clés vivent dans le frontmatter — c'est ainsi que Journal.base peut trier et filtrer sans que vous ayez à tenir quoi que ce soit à jour deux fois.\n\n## Notes\n\n- Le calendrier dans la barre latérale droite vous mène à n'importe quel jour.\n\n## Tâches\n\n- [x] Écrire la première note quotidienne\n- [ ] Revenir demain",
    },
    {
      offset: -1,
      mood: "Fatiguée",
      tags: ["quotidien"],
      body: "Une entrée courte est une entrée quand même. Avec le temps, ce qui compte n'est pas le jour isolé mais la suite des jours — c'est justement à cela que sert le tableau trié par date.\n\n## Notes\n\n- Pas grand-chose fait, mais une fin de journée tôt.",
    },
  ],
};

export function templates(): VaultTemplateDefinition[] {
  return [
    buildPlainvaTour(TOUR_STRINGS_FR),
    buildPara(PARA_STRINGS_FR),
    buildZettelkasten(ZK_STRINGS_FR),
    buildAce(ACE_STRINGS_FR),
    buildJd(JD_STRINGS_FR),
    buildGtd(GTD_STRINGS_FR),
    buildJournal(JOURNAL_STRINGS_FR),
  ];
}
