# Tâches

Dernière mise à jour : 2026-07-15

La vue Tâches réunit en un seul endroit chaque case à cocher de votre vault : tous les éléments de liste `- [ ]` et `- [x]` de toutes vos notes, regroupés par la note où ils se trouvent. C'est la vue « qu'est-ce qu'il me reste à faire ? » sur du Markdown pur — aucun plugin, aucun fichier spécial.

## Pourquoi une vue séparée (et pas une `.base`)

Une [base de données (`.base`)](Databases_Base.md) fonctionne sur des notes entières — une ligne par note. Une case à cocher n'est qu'une seule *ligne* à l'intérieur d'une note, et une note peut en contenir plusieurs, donc une `.base` ne peut pas les lister. La vue Tâches est basée sur les lignes : elle lit directement les lignes de tâches, si bien qu'une seule note de projet avec dix sous-tâches en affiche bien dix.

## Ouvrir la vue Tâches

- Cliquez sur l'**icône de liste de tâches** dans la barre d'actions tout à gauche, ou
- ouvrez la **palette de commandes** (`Ctrl/Cmd+P`) et exécutez **Ouvrir les tâches**.

Elle s'ouvre comme un onglet, comme n'importe quelle note.

## Lire la liste

Les tâches sont regroupées par note ; le titre de la note est un en-tête sur lequel vous pouvez cliquer pour ouvrir la note. Chaque tâche affiche sa case à cocher et son texte, barré une fois qu'elle est terminée. Une **date d'échéance** écrite sous la forme `📅 2026-08-01` dans la ligne de tâche apparaît comme un petit badge.

## Filtrer

La barre en haut restreint la liste :

- **Ouvertes / Terminées / Toutes** — selon l'état de la case à cocher (commence sur **Ouvertes**).
- **Filtrer les tâches…** — texte libre ; correspond au texte de la tâche.
- **Tous les dossiers** — uniquement les tâches du dossier choisi (et de ses sous-dossiers).
- **Toutes les étiquettes** — uniquement les tâches portant un `#tag` en ligne choisi.
- **Avec échéance** — uniquement les tâches ayant une date `📅`.

Les étiquettes et les dates d'échéance sont lues directement dans la ligne de tâche — par exemple `- [ ] Payer la facture #finance 📅 2026-08-01`.

## Cocher des tâches

Cliquez sur la **case à cocher** d'une tâche pour basculer entre ouverte et terminée. La modification est réécrite directement dans la note (comme une écriture de fichier normale et sûre — seul le caractère `[ ]`/`[x]` change), si bien que la note, Obsidian et toute synchronisation restent en phase. Cliquez plutôt sur le **texte** de la tâche pour ouvrir la note et sauter à cette ligne.

Si une note a changé depuis la construction de la liste, un basculement obsolète est ignoré et la liste s'actualise — utilisez le bouton **actualiser** en haut à droite pour recharger à tout moment.

## Compatibilité Obsidian

Les tâches sont des cases à cocher GFM (GitHub-Flavored Markdown) ordinaires. Plainva n'ajoute jamais de syntaxe spéciale : les mêmes lignes `- [ ]` se rendent comme des cases à cocher dans Obsidian et se lisent proprement dans n'importe quel éditeur. Les conventions `📅 date` et `#tag` correspondent au style courant d'Obsidian-Tasks, mais ce ne sont que du texte dans votre note.

## Voir aussi

- [Notes & Markdown](Notes_and_Markdown.md) — écrire des listes de tâches dans l'éditeur
- [Recherche](Search.md) — recherche en texte intégral dans tout le vault
- [Bases de données (.base)](Databases_Base.md) — bases de données au niveau des notes
