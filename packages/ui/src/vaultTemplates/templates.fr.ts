import { DEFAULT_DAILY_NOTE_TYPE, welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";
import { buildPlainvaTour, TOUR_STRINGS_EN } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";

/** French template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/diacritic-free; option VALUES, view names and `.base` file names are
 * fully localized. Relation columns and their reverse counterparts are wired
 * here so the databases show real data as soon as the vault is indexed. */
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

export function templates(): VaultTemplateDefinition[] {
  return [
    // TODO(P4): replace with this language's own tour strings (structure is identical).
    buildPlainvaTour(TOUR_STRINGS_EN),
    buildPara(PARA_STRINGS_FR),
    {
      id: "zettelkasten",
      name: "Zettelkasten",
      description: "Une idée par note, densément liée — notes éphémères, de lecture et permanentes (Luhmann).",
      folders: ["Notes éphémères", "Notes de lecture", "Notes permanentes", "Modèles"],
      bases: [
        defineBase({
          path: "Lecture.base",
          sourceFolder: "Notes de lecture",
          columns: [
            { key: "auteur", input: "text" },
            { key: "annee", input: "number" },
            { key: "genre", input: "select", options: ["Livre", "Article", "Vidéo", "Podcast", "Site web"] },
            { key: "status", input: "status", options: ["À lire", "Lu", "Traité"] },
            { key: "url", input: "url" },
            { key: "fiches", reverseOf: { base: "Fiches.base", property: "source" } },
          ],
          views: [
            { name: "Tableau", type: "table" },
            { name: "Par statut", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Modèles/Note de lecture.md",
        }),
        defineBase({
          path: "Fiches.base",
          sourceFolder: "Notes permanentes",
          columns: [{ key: "source", input: "relation", relationBase: "Lecture.base" }],
          views: [{ name: "Tableau", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Bienvenue.md",
          description: "Point de départ et guide rapide pour ce vault.",
          body: welcomeBody(
            "Bienvenue",
            "Ce vault suit la méthode Zettelkasten (Niklas Luhmann) : une idée par note — les connexions naissent des liens, pas des hiérarchies de dossiers.",
            [
              { name: "Notes éphémères", description: "Des pensées brutes et rapides — éphémères, traitées plus tard." },
              { name: "Notes de lecture", description: "Des résumés de vos lectures, dans vos propres mots, avec la source." },
              { name: "Notes permanentes", description: "Des idées durables et bien formulées — une par note, fortement liées." },
            ],
            "Utilisez Lecture.base pour suivre vos sources par statut de lecture ; Fiches.base relie les notes permanentes, via leur propriété Source, à la lecture dont elles proviennent."
          ),
        },
        {
          path: "Notes permanentes/Exemple de note.md",
          description: "Un exemple de note permanente.",
          properties: { source: ["[[Exemple de note de lecture]]"] },
          body: "# Exemple de note\n\nUne note permanente contient exactement une idée, rédigée en phrases complètes et dans vos propres mots.\n\nReliez les notes apparentées directement dans le texte — c'est ainsi que grandit le réseau d'idées.\n",
        },
        {
          path: "Notes de lecture/Exemple de note de lecture.md",
          description: "Un exemple de note de lecture.",
          properties: { auteur: "Niklas Luhmann", annee: 1992, genre: "Livre", status: "Lu" },
          body: "# Exemple de note de lecture\n\nRésumez ici dans vos propres mots ce que vous avez lu et notez la source. Les notes permanentes renvoient à cette note de lecture via leur propriété Source.\n",
        },
        {
          path: "Modèles/Note de lecture.md",
          properties: { status: "À lire" },
          body: "# {{title}}\n\n## Résumé\n\n## Source\n",
        },
      ],
      settings: { templateFolder: "Modèles" },
    },
    {
      id: "ace",
      name: "ACE (Linking Your Thinking)",
      description: "Atlas, Calendrier et Efforts — travail de la connaissance centré sur les MOC, d'après Nick Milo.",
      folders: ["Atlas", "Calendrier", "Efforts"],
      notes: [
        {
          path: "Bienvenue.md",
          description: "Point de départ et guide rapide pour ce vault.",
          body: welcomeBody(
            "Bienvenue",
            "Ce vault utilise le schéma ACE de « Linking Your Thinking » (Nick Milo) : la connaissance est reliée par des Maps of Content (MOC) plutôt que par une imbrication profonde.",
            [
              { name: "Atlas", description: "Les cartes de votre connaissance — MOC et notes de synthèse." },
              { name: "Calendrier", description: "Les notes liées au temps — notes quotidiennes, journaux, rétrospectives." },
              { name: "Efforts", description: "Tout ce sur quoi vous travaillez activement." },
            ],
            "Commencez dans l'Atlas avec la note Home et tissez des liens vers votre connaissance depuis là."
          ),
        },
        {
          path: "Atlas/Home.md",
          description: "Votre Map of Content de plus haut niveau.",
          body: "# Home\n\nLa note Home est votre point d'entrée : reliez ici vos Maps of Content les plus importantes et vos efforts en cours.\n",
        },
      ],
    },
    {
      id: "jd",
      name: "Johnny.Decimal",
      description: "Des zones et catégories numérotées (10-19 / 11 / 11.01) pour tout retrouver à coup sûr.",
      folders: [
        "00-09 Système",
        "00-09 Système/00 Index",
        "10-19 Personnel",
        "10-19 Personnel/11 Finances",
        "10-19 Personnel/12 Santé",
        "20-29 Travail",
        "20-29 Travail/21 Projets",
        "20-29 Travail/22 Réunions",
      ],
      notes: [
        {
          path: "Bienvenue.md",
          description: "Point de départ et guide rapide pour ce vault.",
          body: welcomeBody(
            "Bienvenue",
            "Ce vault est organisé selon Johnny.Decimal : au plus dix zones (10-19, 20-29, …), au plus dix catégories par zone (11, 12, …) — et chaque note reçoit un identifiant comme 11.01.",
            [
              { name: "00-09 Système", description: "La gestion du système lui-même — index et conventions." },
              { name: "10-19 Personnel", description: "Zone d'exemple pour les sujets personnels." },
              { name: "20-29 Travail", description: "Zone d'exemple pour les sujets professionnels." },
            ],
            "Renommez les zones et catégories selon vos sujets — la profondeur volontairement limitée (zone → catégorie → identifiant) est le cœur de la méthode."
          ),
        },
        {
          path: "00-09 Système/00 Index/00.00 Index.md",
          description: "L'index Johnny.Decimal : tous les numéros au même endroit.",
          body: "# 00.00 Index\n\nTenez ici la liste de toutes les zones, catégories et identifiants. Qui cherche un numéro regarde d'abord ici.\n\n## 10-19 Personnel\n\n- 11 Finances\n- 12 Santé\n\n## 20-29 Travail\n\n- 21 Projets\n- 22 Réunions\n",
        },
      ],
    },
    {
      id: "gtd",
      name: "GTD",
      description: "Getting Things Done — boîte de réception, tâches, projets, références et liste Un jour peut-être.",
      folders: ["Boîte de réception", "Tâches", "Projets", "Références", "Un jour peut-être", "Modèles"],
      bases: [
        defineBase({
          path: "Tâches.base",
          sourceFolder: "Tâches",
          columns: [
            { key: "status", input: "status", options: ["Boîte de réception", "Suivante", "En attente", "Un jour", "Terminée"] },
            { key: "contexte", input: "select", options: ["@Maison", "@Travail", "@Courses", "@Téléphone"] },
            { key: "projet", input: "relation", relationBase: "Projets.base", relationLimit: "one" },
            { key: "echeance", input: "date" },
          ],
          views: [
            { name: "Tableau", type: "table" },
            { name: "Par statut", type: "board", groupBy: "status" },
            { name: "Par contexte", type: "board", groupBy: "contexte" },
          ],
          newItemTemplate: "Modèles/Tâche.md",
        }),
        defineBase({
          path: "Projets.base",
          sourceFolder: "Projets",
          columns: [
            { key: "status", input: "status", options: ["Actif", "En attente", "Un jour", "Terminé"] },
            { key: "taches", reverseOf: { base: "Tâches.base", property: "projet" } },
          ],
          views: [
            { name: "Tableau", type: "table" },
            { name: "Par statut", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Modèles/Projet.md",
        }),
      ],
      notes: [
        {
          path: "Bienvenue.md",
          description: "Point de départ et guide rapide pour ce vault.",
          body: welcomeBody(
            "Bienvenue",
            "Ce vault suit Getting Things Done (David Allen) : tout atterrit d'abord dans la boîte de réception, puis est traité en tâches et projets concrets.",
            [
              { name: "Boîte de réception", description: "Le point de collecte de tout ce qui arrive — videz-la régulièrement." },
              { name: "Tâches", description: "Des prochaines actions uniques — organisées par statut et contexte (Tâches.base)." },
              { name: "Projets", description: "Tout ce qui demande plus d'une étape (Projets.base)." },
              { name: "Références", description: "Du matériel à consulter, sans action requise." },
              { name: "Un jour peut-être", description: "Des idées et des projets pour plus tard." },
            ],
            "Dans Tâches.base, vous rattachez chaque tâche à un projet via sa propriété Projet ; Projets.base affiche alors automatiquement, dans la colonne Tâches, ce qui appartient à chaque projet. La revue hebdomadaire garde le système fiable."
          ),
        },
        {
          path: "Revue hebdomadaire.md",
          description: "Liste de contrôle pour la revue hebdomadaire GTD.",
          body: "# Revue hebdomadaire\n\n- [ ] Vider la boîte de réception\n- [ ] Parcourir la liste des projets et vérifier les prochaines actions\n- [ ] Survoler la liste Un jour peut-être\n- [ ] Regarder le calendrier des deux prochaines semaines\n",
        },
        {
          path: "Projets/Exemple de projet.md",
          description: "Un exemple de note de projet GTD.",
          properties: { status: "Actif" },
          body: "# Exemple de projet\n\nRésultat souhaité : à quoi ressemble « terminé » ?\n\nProchaine action :\n\n- [ ] Noter la prochaine étape concrète\n",
        },
        {
          path: "Tâches/Exemple de tâche.md",
          description: "Un exemple de tâche reliée à un projet.",
          properties: { status: "Suivante", contexte: "@Travail", projet: "[[Exemple de projet]]" },
          body: "# Exemple de tâche\n\nUne tâche est une prochaine action unique et concrète. Via sa propriété Projet, elle appartient à l'Exemple de projet.\n",
        },
        {
          path: "Tâches/Rassembler des idées.md",
          description: "Un exemple d'élément fraîchement arrivé dans la boîte de réception.",
          properties: { status: "Boîte de réception" },
          body: "# Rassembler des idées\n\nFraîchement arrivé dans la boîte de réception et pas encore traité. À la prochaine revue, cette tâche recevra un contexte et un projet.\n",
        },
        {
          path: "Modèles/Tâche.md",
          properties: { status: "Boîte de réception" },
          body: "# {{title}}\n\n## Notes\n\n- [ ] \n",
        },
        {
          path: "Modèles/Projet.md",
          properties: { status: "Actif" },
          body: "# {{title}}\n\n## Résultat souhaité\n\n## Prochaines étapes\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Modèles" },
    },
    {
      id: "journal",
      name: "Journal",
      description: "Des notes quotidiennes avec un modèle prêt à l'emploi et une base de données de journal — tout est configuré d'emblée.",
      folders: ["Journal", "Modèles"],
      bases: [
        defineBase({
          path: "Journal.base",
          sourceFolder: "Journal",
          columns: [
            { key: "date", input: "date" },
            { key: "humeur", input: "select", options: ["Bonne", "Neutre", "Mauvaise", "Productive", "Fatiguée"] },
            { key: "motscles", input: "tags" },
          ],
          views: [
            { name: "Tableau", type: "table", sort: [{ property: "date", direction: "DESC" }] },
            { name: "Calendrier", type: "calendar", dateField: "date" },
          ],
        }),
      ],
      notes: [
        {
          path: "Bienvenue.md",
          description: "Point de départ et guide rapide pour ce vault.",
          body: welcomeBody(
            "Bienvenue",
            "Ce vault est fait pour l'écriture quotidienne : les notes quotidiennes vivent dans le dossier Journal et sont créées à partir du modèle du dossier Modèles.",
            [
              { name: "Journal", description: "Vos notes quotidiennes, une par jour." },
              { name: "Modèles", description: "Les modèles pour les nouvelles notes — le modèle de note quotidienne est déjà configuré." },
            ],
            "Ouvrez le calendrier dans la barre latérale droite et cliquez sur un jour pour créer votre première note quotidienne. Journal.base montre vos entrées sous forme de tableau et sur un calendrier — avec la date, l'humeur et les mots-clés."
          ),
        },
        {
          path: "Modèles/Note quotidienne.md",
          description: "Modèle pour les nouvelles notes quotidiennes — {{date}}, {{time}} et {{title}} sont remplacés.",
          type: DEFAULT_DAILY_NOTE_TYPE,
          properties: { date: "{{date}}" },
          body: "# {{title}}\n\n## Notes\n\n## Tâches\n\n- [ ] \n",
        },
      ],
      settings: { dailyNotesFolder: "Journal", templateFolder: "Modèles", dailyNoteTemplate: "Note quotidienne.md" },
    },
  ];
}
