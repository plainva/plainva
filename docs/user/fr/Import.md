# Importer depuis une autre application

Dernière mise à jour : 2026-07-25

Plainva peut reprendre des notes depuis d'autres applications de prise de notes. L'import écrit toujours dans le vault que vous avez actuellement ouvert, dans un sous-dossier que vous nommez — il ne touche donc jamais au reste de votre vault, et vous pouvez déplacer ou supprimer le dossier importé par la suite comme n'importe quel autre dossier.

## Démarrer un import

Deux façons de démarrer :

- **Palette de commandes** (`Mod+P`) → **Importer depuis une autre application…**
- **Clic droit sur un dossier** dans l'arborescence de fichiers → **Importer depuis une autre application…**

L'assistant comporte trois étapes : choisir l'application d'où vous venez, choisir les fichiers d'export (ou saisir un jeton Notion), et nommer le dossier cible. Vous obtenez ensuite un aperçu avec le nombre de notes et de bases de données, ainsi qu'une liste de tout ce que l'importateur ne peut pas récupérer. Rien n'est écrit tant que vous n'appuyez pas sur **Démarrer l'import**.

## Ce que vous pouvez importer

| Source | Ce que vous sélectionnez | Ce qui est repris |
|---|---|---|
| **Notion (API)** | Un jeton d'intégration | Pages, hiérarchie de dossiers, bases de données avec leurs lignes, relations, 21 types de propriétés |
| **Notion (export ZIP)** | Le ZIP ou le dossier décompressé | Pages et structure de dossiers. Les bases de données sont créées **vides** |
| **Evernote (ENEX)** | Un ou plusieurs fichiers `.enex` | Notes, tags, listes de tâches, dates de création/modification |
| **Google Keep (Takeout)** | Le ZIP Google Takeout ou les fichiers `.json` | Notes, listes de tâches, libellés convertis en tags, couleur, épinglé/archivé |
| **Simplenote** | Le fichier `.json` exporté | Notes actives et leurs tags |
| **Logseq** | Le dossier de votre graphe | Les fichiers, copiés tels quels |
| **Dossier Markdown / ZIP** | Un dossier, des fichiers ou un ZIP | Les fichiers `.md` et leur structure de dossiers |

Il n'existe pas d'importateur Obsidian — et ce n'est pas nécessaire. Plainva ouvre directement un vault Obsidian : **Ouvrir un vault** et choisissez le dossier.

## Notion en détail

Notion est la seule source où les deux voies diffèrent nettement.

**Avec un jeton d'intégration (recommandé).** Créez un jeton sur `notion.so/my-integrations`. Ouvrez ensuite chaque page Notion que vous souhaitez importer, choisissez « ... » en haut à droite → **Connexions**, et ajoutez votre intégration — Notion n'expose que les pages que vous avez explicitement connectées.

Via l'API, Plainva voit la structure, pas seulement le texte :

- La hiérarchie des pages devient une structure de dossiers.
- Chaque base de données devient un fichier `.base` plus un dossier avec **une note par ligne**.
- **Les relations deviennent des liens wiki** entre ces notes, dans les deux sens.
- 21 types de propriétés sont pris en charge — sélection, statut, sélection multiple, date, nombre, case à cocher, URL, e-mail, téléphone, formule, rollup, relation, personnes, ID unique et plus.
- Les vues tableau, kanban, calendrier et liste sont générées à partir du schéma de la base de données.
- Les bases de données intégrées dans une page deviennent des intégrations `![[Database.base]]` en direct.

**Depuis un export ZIP.** Cela fonctionne hors ligne et ne nécessite aucun jeton, mais l'export de Notion ne contient ni le schéma des bases de données ni les identifiants des pages. Les pages et leurs dossiers sont repris ; les bases de données sont créées comme des fichiers `.base` **vides**, et le rapport le signale. Si vos bases de données comptent, utilisez la voie de l'API.

## Ce que les imports ne peuvent pas récupérer

Chaque importateur indique ses limites dans l'aperçu, puis à nouveau dans le rapport. Les principales :

- **Les pièces jointes et les images ne sont pas importées.** Les archives ZIP ne sont lues que pour les fichiers texte ; les pièces jointes Evernote et les images Keep restent de côté.
- **Les pages Notion très longues** sont lues intégralement, mais le contenu imbriqué dans des listes à bascule, des colonnes ou des sous-listes n'est pas suivi.
- **Les fichiers Logseq sont copiés tels quels** — les propriétés `key:: value` et les références de blocs ne sont pas converties en propriétés ou liens Plainva.
- **La corbeille de Simplenote** est ignorée.
- **Les exports ZIP de Notion** créent des bases de données vides (voir ci-dessus).

## Rien n'est écrasé

L'import écrit dans le vault que vous avez ouvert ; il est donc conçu pour ne rien détruire :

- Si un nom de note est déjà pris, la note importée est **numérotée** (`Meeting (2).md`) au lieu de remplacer celle qui existe déjà. Cela s'applique aussi lorsque deux notes source partagent le même nom.
- Les notes importées reçoivent le frontmatter OKF habituel (`type`, `okf_version`), et se comportent donc comme n'importe quelle autre note Plainva dans les filtres et les vues `.base`.
- Rien en dehors du sous-dossier cible n'est modifié.

Si vous préférez garder l'import totalement séparé, créez d'abord un nouveau vault (**Nouveau vault** sur l'écran d'accueil) puis importez dedans.

## Le rapport d'import

Chaque exécution écrit un **rapport d'import** dans le dossier cible. Il liste :

- combien de notes et de bases de données ont été importées,
- ce que cet importateur ne peut absolument pas récupérer,
- tout ce qui est arrivé de façon **incomplète** ou a été **ignoré**, avec la raison,
- et chaque fichier, avec son statut.

Le rapport est le compte-rendu honnête de l'exécution — si quelque chose a été tronqué ou abandonné, cela y apparaît plutôt que d'être compté silencieusement comme un succès. Il vaut la peine d'être lu avant de supprimer l'export.

## Pages associées

- [Bases de données (.base)](Databases_Base.md) — ce qui arrive aux bases de données Notion importées
- [OKF](OKF.md) — le frontmatter que reçoivent les notes importées
- [Prise en main](Getting_Started.md) — créer un vault séparé pour un import
