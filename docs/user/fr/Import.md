# Importer depuis une autre application

Dernière mise à jour : 2026-07-28

Plainva peut reprendre des notes depuis d'autres applications de prise de notes. L'import écrit toujours dans le vault que vous avez actuellement ouvert, dans un sous-dossier que vous nommez — il ne touche donc jamais au reste de votre vault, et vous pouvez déplacer ou supprimer le dossier importé par la suite comme n'importe quel autre dossier.

**L’import s’effectue sur le bureau.** L’application mobile ne peut pas importer : récupérez les notes sur le bureau, elles arrivent ensuite sur votre téléphone via la synchronisation, comme tout autre fichier.

## Démarrer un import

Trois façons de démarrer :

- **Écran d'accueil** → **Importer depuis une autre application** — le point d'entrée si vous n'avez pas encore de vault, ce qui est le cas normal lorsque vous changez d'application.
- **Palette de commandes** (`Mod+P`) → **Importer depuis une autre application…**
- **Clic droit sur un dossier** dans l'arborescence de fichiers → **Importer depuis une autre application…**

La première étape demande votre export — **Choisir des fichiers…** ou **Choisir un dossier…**, selon ce que vous avez. L'assistant nomme ensuite l'application qu'il a reconnue, puis vous décidez où l'import doit écrire. Un aperçu suit, avec les chiffres de l'exécution, les limites de cet import et les options propres à la source. Rien n'est écrit tant que vous n'appuyez pas sur **Démarrer l'import**.

**Vous n'avez pas besoin de savoir quelle entrée correspond à votre export.** Choisissez les fichiers, et Plainva reconnaît la source — un export Notion grâce aux identifiants longs dans ses chemins, un graphe Logseq grâce à ses dossiers `journals/` et `pages/`, un export Keep ou Simplenote grâce au contenu du JSON. L'assistant indique ce qu'il a reconnu ; s'il s'est trompé, modifiez-le dans la liste ci-dessus et votre choix est conservé.

## Où l'import écrit

Exactement l'un des deux par import — jamais les deux :

- **Nouveau vault** : vous choisissez un dossier vide, Plainva y crée un vault tout neuf et importe dedans. Rien de ce que vous avez déjà ne peut être touché, et annuler tout l'import revient à supprimer ce dossier. C'est le bon choix si vous essayez Plainva.
- **Sous-dossier du vault actuellement ouvert** : tout atterrit dans un seul sous-dossier nouvellement créé, que vous nommez. Le reste de votre vault reste intact.

La ligne de destination sous le choix indique toujours le dossier exact, de sorte que l'endroit où les choses atterrissent n'est jamais une supposition.

## Options de cet import

L'aperçu affiche, sous les chiffres, les options **qui correspondent à la source reconnue** — chaque source apporte les siennes, et ce qu'une source ne sait pas faire n'apparaît jamais là. Elles se trouvent à cet endroit plutôt que plus tôt, car les questions n'ont de sens qu'une fois que vous voyez ce qui s'annonce ; une option qui change les chiffres les fait aussitôt recompter.

- **Conserver les dates de la source** (activé) — les notes importées conservent les dates de création et de modification de la source. Sans cette option, elles sont toutes datées d'aujourd'hui.
- **Importer aussi les notes supprimées** (désactivé) — pour Google Keep et Simplenote, dont l'export inclut la corbeille. Par défaut, ce qui s'y trouve y reste ; le rapport le nomme.

## Ce que montre l'aperçu

L'aperçu est la dernière étape avant toute écriture, et il indique tout ce qui serait sinon une surprise par la suite :

- les chiffres de l'exécution — notes et bases de données, plus **les pièces jointes** et **les listes de tâches** là où la source en a,
- le dossier cible exact,
- ce que cet importateur **ne peut pas** récupérer, et chaque entrée de l'archive qui a été ignorée,
- pour un vault avec une connexion cloud, le fait que les notes importées seront **téléversées** ensuite,
- pour les très grandes sources, le fait que l'indexation de recherche et la première synchronisation prendront un moment.

## Arrêter une exécution

Un grand espace de travail peut prendre du temps, c'est pourquoi un import peut être arrêté : **Arrêter l'import** pendant l'exécution. Ce qui a déjà atteint le vault y reste, et le rapport le décrit — un import partiel n'est pas un import cassé. Comme pour un import complet, l'annulation consiste à supprimer le dossier.

## Ce que vous pouvez importer

| Source | Ce que vous sélectionnez | Ce qui est repris |
|---|---|---|
| **Notion (API)** | Un jeton d'intégration | Pages, hiérarchie de dossiers, bases de données avec leurs lignes, relations, 21 types de propriétés |
| **Notion (export ZIP)** | Le ZIP ou le dossier décompressé | Pages et structure de dossiers ; une base de données reçoit ses colonnes et les valeurs de ses lignes du CSV voisin |
| **Evernote (ENEX)** | Un ou plusieurs fichiers `.enex` | Notes, tags, listes de tâches (cochées et non cochées), dates de création/modification |
| **Google Keep (Takeout)** | Le ZIP Google Takeout ou les fichiers `.json` | Notes, listes de contrôle, libellés comme étiquettes, couleur dans l’en-tête de la note, notes épinglées comme tableau |
| **Simplenote** | Le fichier `.json` exporté | Notes actives et leurs tags |
| **Logseq** | Le dossier de votre graphe | Les fichiers, copiés tels quels |
| **Joplin** | Le dossier ou le ZIP de l’export Markdown | Notes avec leurs carnets, frontmatter, étiquettes et ressources |
| **Bear (TextBundle)** | Les dossiers `.textbundle` exportés | Notes avec leurs images |
| **Notesnook** | L’export Markdown | Notes et leurs dossiers de carnets ; une note classée dans deux carnets est importée une fois |
| **Capacities** | Le dossier ou le ZIP de l’export | Notes avec leurs propriétés en frontmatter, plus les médias |
| **Amplenote** | Le ZIP de l’export | Notes avec leur frontmatter et leurs images |
| **Supernotes** | L’export Markdown | Cartes en Markdown, avec les fichiers de métadonnées à côté |
| **Heptabase** | L’export Markdown | Cartes avec leur frontmatter ; la disposition du whiteboard n’est pas reprise |
| **UpNote** | L’export Markdown | Notes avec leurs carnets et pièces jointes |
| **Craft** | L’export Markdown | Documents avec leurs ressources |
| **Anytype** | L’export Markdown | Objets avec leurs relations en frontmatter |
| **Standard Notes** | La sauvegarde JSON déchiffrée | Notes avec leurs titres et étiquettes |
| **Workflowy / Dynalist** | L’export OPML | Une note par élément de premier niveau, ses enfants en listes imbriquées |
| **Trilium** | L’export de sous-arbre | L’arborescence des notes et ses pièces jointes ; les notes HTML deviennent du Markdown |
| **Dossier Markdown / ZIP** | Un dossier, des fichiers ou un ZIP | Les fichiers `.md` et leur structure de dossiers |

**Obsidian** figure aussi dans la liste, mais ne déclenche aucun import — et n'en a d'ailleurs pas besoin. Plainva fonctionne avec les mêmes fichiers Markdown : l'entrée l'explique et vous propose **Ouvrir le vault**. Les liens wiki, les tags, le frontmatter et les fichiers `.base` continuent de fonctionner, et votre vault reste utilisable dans Obsidian. En toute honnêteté : il n'y a pas d'écosystème de plugins, pas de Canvas et pas de Dataview — vous avez à la place des filtres dans `.base`, et la syntaxe de plugin dans vos notes y reste sous forme de texte brut.

## Pourquoi mon application manque-t-elle ?

Certaines applications ne figurent pas dans la liste, et la raison est différente à chaque fois — ce qui compte, car deux d'entre elles ne manquent que pour l'instant.

- **OneNote** — il n'existe pas d'export en masse qui produise quoi que ce soit d'exploitable. La voie possible serait l'API Graph de Microsoft avec une connexion déléguée : un appel par page, un autre pour chaque image, plus la question de savoir comment une surface libre devient du Markdown. C'est noté comme un projet futur, pas écarté — l'API elle-même est librement disponible.
- **Apple Notes** — Apple n'offre pas non plus d'export en masse, et lire les notes revient à rétro-ingénierer une base de données SQLite, uniquement sous macOS. Des outils d'export établis le font déjà. Exportez vers Markdown avec l'un d'eux, puis reprenez le dossier via **Dossier Markdown / ZIP**.
- **Zoho Notebook**, **Turtl**, **Nimbus/FuseBase** — aucun export documenté qui vaille la peine d'être importé.

Pour tout ce qui n'est pas listé, la voie est la même : si votre application peut écrire des fichiers Markdown, l'entrée **Dossier Markdown / ZIP** les accepte, avec leur structure de dossiers.

## Notion en détail

Notion est la seule source où les deux voies diffèrent nettement.

**Avec un jeton d'intégration (recommandé).** Créez un jeton sur `notion.so/my-integrations` — l'assistant détaille les trois étapes et ouvre la page pour vous. Ouvrez ensuite chaque page Notion que vous souhaitez importer, choisissez « ... » en haut à droite → **Connexions**, et ajoutez votre intégration — Notion n'expose que les pages que vous avez explicitement connectées.

**Plainva ne conserve pas le jeton.** Il est utilisé pour cet unique import puis disparaît ; aucun compte connecté n'est créé. Pour le prochain import, vous devrez le coller de nouveau.

Via l'API, Plainva voit la structure, pas seulement le texte :

- La hiérarchie des pages devient une structure de dossiers.
- Chaque base de données devient un fichier `.base` plus un dossier avec **une note par ligne**.
- **Les relations deviennent des liens wiki** entre ces notes, dans les deux sens.
- 21 types de propriétés sont pris en charge — sélection, statut, sélection multiple, date, nombre, case à cocher, URL, e-mail, téléphone, formule, rollup, relation, personnes, ID unique et plus.
- Les vues tableau, kanban, calendrier et liste sont générées à partir du schéma de la base de données.
- Les bases de données intégrées dans une page deviennent des intégrations `![[Database.base]]` en direct.

**Depuis un export ZIP.** Cela fonctionne hors ligne et ne nécessite aucun jeton, mais l'export de Notion ne contient ni le schéma des bases de données ni les identifiants des pages. Les pages et leurs dossiers sont repris, et **les liens entre les pages importées continuent de fonctionner** — Notion les écrit avec un identifiant long dans chaque segment de chemin, et Plainva les fait pointer vers les notes qu'il a effectivement écrites. Le `.csv` à côté de chaque dossier de base de données est lu pour ce que les pages elles-mêmes ne portent pas : les colonnes, leurs types et les valeurs de chaque ligne en frontmatter. Les lignes dont l'export n'a pas de page sont écrites comme notes. La correspondance se fait par titre — la voie de l'API est celle qui a de vrais identifiants, et reste la meilleure pour un espace bâti sur des relations.

## Ce que les imports ne peuvent pas récupérer

Chaque importateur indique ses limites dans l'aperçu, puis à nouveau dans le rapport. Les principales :

- **Les pièces jointes sont reprises.** Depuis un ZIP ou un dossier, elles gardent la place qu'elles avaient dans l'export, si bien qu'un lien d'image relatif dans une note continue de fonctionner. Depuis Notion par l'API, elles sont téléchargées pendant l'import — Notion signe ces liens et ils expirent en moins d'une heure — et arrivent dans un dossier `Attachments` ; les images qu'une page va chercher ailleurs sur le web restent des liens. Deux exceptions restent dans votre export et sont nommées une par une dans le rapport : les pièces jointes à l'intérieur d'un `.enex` Evernote, et les images Google Keep.
- **Certaines entrées d'archive sont ignorées volontairement :** les fichiers très volumineux, les liens symboliques et les entrées dont le chemin n'est pas sûr. Elles apparaissent avec une raison dans l'aperçu, avant que vous démarriez l'import.
- **Les pages Notion très longues** sont lues intégralement, mais le contenu imbriqué dans des listes à bascule, des colonnes ou des sous-listes n'est pas suivi.
- **Les fichiers Logseq sont copiés tels quels** — les propriétés `key:: value` et les références de blocs ne sont pas converties en propriétés ou liens Plainva.
- **Les notes supprimées restent supprimées.** La corbeille de Simplenote et de Google Keep est ignorée — vous avez décidé un jour de vous passer de ces notes, et un import ne doit pas vous les rendre en douce. Elles sont nommées dans le rapport, afin que vous voyiez ce qui a été laissé de côté.
- **Les exports ZIP de Notion** associent les lignes aux pages par le titre (voir ci-dessus) et ne reprennent aucune relation entre bases de données.

## Les dates sont reprises

Une collection accumulée au fil des années perd son repère temporel si tout porte la date du jour après un import. Plainva reprend donc les dates de la source :

- Elles apparaissent comme `created` et `updated` dans le frontmatter de la note importée — c'est aussi là que l'axe temporel du graphe les lit.
- Le fichier lui-même reçoit également la date de modification de la source, afin que le tri par date et **Ouverts récemment** soient corrects. La date de création du fichier ne peut être définie que sous Windows ; sur les autres systèmes, c'est le frontmatter qui porte l'information.
- Si une source ne fournit aucune date, Plainva utilise la date du fichier d'export. Elle n'en invente jamais : faute d'indication, le champ reste vide.

## Un échec n'arrête pas tout l'import

Si une seule note ne peut pas être écrite, l'import continue et le rapport la mentionne avec la raison. Le rapport est écrit même lorsque l'exécution s'arrête prématurément — vous voyez donc toujours ce qui se trouve déjà dans votre vault.

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

Tout en bas figure la façon d'**annuler** l'import : tout ce qui provient d'une exécution se trouve dans un seul dossier — le supprimer fait disparaître l'import. Avec la destination **Nouveau vault**, il s'agit du dossier du nouveau vault lui-même. Aucune commande d'annulation dédiée n'est nécessaire pour cela. Le rapport lui-même est une note ordinaire et peut être supprimé une fois que vous l'avez lu.

## Pages associées

- [Bases de données (.base)](Databases_Base.md) — ce qui arrive aux bases de données Notion importées
- [OKF](OKF.md) — le frontmatter que reçoivent les notes importées
- [Prise en main](Getting_Started.md) — créer un vault séparé pour un import
