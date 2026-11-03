# Référence des bases de données (.base)

Dernière mise à jour : 2026-11-03

Cette page recense tout ce qu'un fichier `.base` peut contenir et ce que Plainva fait de chaque partie : chaque clé de premier niveau, chaque forme de filtre, chaque type de vue avec ses options, les synthèses, le tri, les limites, ce qui arrive aux clés que Plainva ne connaît pas, et les points où Plainva se comporte autrement qu'Obsidian Bases. Elle décrit ce que le code de Plainva lit, évalue et écrit aujourd'hui — pas la documentation d'Obsidian.

Pour l'usage courant, lisez d'abord [Bases de données (.base)](Databases_Base.md). Les règles qu'un outil doit respecter lorsqu'il écrit directement dans les fichiers du vault, ainsi que l'exemple complet de relation, se trouvent dans la [Référence du format de fichier](File_Format_Reference.md).

## Vue d'ensemble

| Partie du fichier | Ce que fait Plainva |
|---|---|
| `filters` | Lit et applique les sources (dossier, tag) et les conditions décrites sous [Filtres](#filtres) |
| `views` | Lit les huit types de vue, leur ordre, leur tri, leurs filtres et leurs synthèses |
| `properties` | Lit le schéma des colonnes, le nom affiché et le bloc `plainva` de Plainva |
| `summaries` (vue) | Calcule les quatorze synthèses intégrées |
| `formulas` | Les conserve dans le fichier, ne les calcule pas |
| `summaries` (premier niveau) | Conserve les formules de synthèse personnalisées, ne les calcule pas |
| `this` | Pas encore pris en charge |
| Autres clés | Les conserve dans le fichier (voir [Clés que Plainva ne connaît pas](#clés-que-plainva-ne-connaît-pas)) |

## Clés de premier niveau

Un fichier `.base` est du YAML avec ces clés de premier niveau. Toutes sont facultatives ; un fichier sans `views` s'ouvre avec un tableau.

| Clé | Contenu | Dans Plainva |
|---|---|---|
| `filters` | Quelles notes appartiennent à la base de données (sources) | Lue et appliquée |
| `properties` | Une entrée par colonne, indexée par l'identifiant de propriété | Lue ; les ajouts de Plainva vivent dans son bloc `plainva` |
| `views` | La liste des vues | Lue ; chaque vue a besoin d'un `name` |
| `formulas` | Formules d'Obsidian, `name: expression` | Conservées telles quelles, non calculées |
| `summaries` | Formules de synthèse personnalisées d'Obsidian | Conservées telles quelles, non calculées |

Plainva n'écrit jamais d'autre clé de premier niveau : Obsidian refuse d'ouvrir un `.base` contenant une clé qu'il ne connaît pas. Une clé `columns:` de premier niveau, écrite par de très anciennes versions de Plainva, est encore lue et déplacée dans `properties` à la prochaine sauvegarde du fichier.

## Propriétés (`properties`)

### Identifiants de propriété

Un identifiant de propriété désigne une colonne. Il en existe trois sortes :

| Id | Signification | Exemple |
|---|---|---|
| `note.<key>` | Une clé du frontmatter des notes | `note.status` |
| `file.<field>` | Une information sur le fichier (voir [Champs de fichier](#champs-de-fichier-file)) | `file.mtime` |
| `formula.<name>` | Une formule d'Obsidian issue de `formulas` | `formula.price_per_unit` |

Les clés de `properties`, le `order` d'une vue et `sort[].property` utilisent ces identifiants. Dans une expression de filtre et dans un bloc `plainva`, une clé de frontmatter s'écrit nue (`status`) ; une expression de filtre comprend aussi `note.status`.

Lorsqu'une note écrit une clé avec une casse différente de celle de la colonne (`Due` pour la colonne `due`), Plainva affiche tout de même la valeur dans cette colonne et réécrit les modifications sous l'orthographe propre à la note.

### Nom affiché

`properties.<id>.displayName` est le libellé de colonne d'Obsidian. Plainva l'affiche comme en-tête de colonne et le conserve. Sans lui, une clé de frontmatter s'affiche avec une majuscule initiale (à l'écran uniquement) ; les champs de fichier ont leurs propres noms, par exemple **Nom**, **Modifié**, **Taille**, **Chemin**, **Liste de tâches** et **Jour d'après le nom du fichier**.

### Le bloc `plainva` d'une colonne

Tout ce que Plainva ajoute à une colonne vit sous `properties.<id>.plainva`. Obsidian l'ignore.

| Clé | Valeur | Signification |
|---|---|---|
| `input` | un type de champ (liste ci-dessous) | Le type de champ de la colonne |
| `ratingMax` | nombre, de 1 à 10 | Le nombre de repères d'une évaluation (5 par défaut) |
| `ratingGlyph` | un caractère | Le repère que dessine une évaluation (un point par défaut) |
| `options` | liste d'options | Valeurs fixes pour sélection, statut et sélection multiple |
| `relationBase` | chemin `.base` relatif au vault | La base de données vers laquelle pointe une relation |
| `relationLimit` | `one` | Une relation contient exactement un lien ; absente, elle n'a pas de limite |
| `reverseOf` | `{ base, property }` | Une colonne de relation inverse calculée |
| `rollup` | `{ through, of, fn, where }` | Une colonne d'agrégation calculée (voir [Agrégations](#agrégations)) |
| `previousKeys` | liste de 8 anciens noms au plus | Permet aux commentaires de retrouver une colonne renommée |

### Types de champ (`input`)

`text`, `number`, `rating`, `checkbox`, `date`, `datetime`, `select`, `status`, `multiselect`, `list`, `tags`, `url`, `email`, `phone`, `relation`.

Deux anciennes graphies sont lues aussi : `multi-select` comme `multiselect`, et `link` comme `relation`. Une colonne sans `input` — ou avec une valeur absente de cette liste — reçoit son type d'après les valeurs des notes : `true`/`false` donne une case à cocher, un nombre un nombre, une liste de `[[links]]` une relation, `2026-07-03` une date, une adresse web une URL, et ainsi de suite. Une colonne de relation inverse et une colonne d'agrégation n'ont pas d'`input`.

### Options et couleurs

Une option est `{ value, label, color, group }` ; seul `value` est obligatoire. `color` est l'un des noms de la palette `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink` — un nom inconnu se replie sur une couleur dérivée de la valeur. `group` ne sert qu'à **Statut** : les options du même groupe forment une étape. Une simple chaîne est lue comme une option portant cette valeur.

### Agrégations

Une colonne d'agrégation calcule une valeur à partir des notes vers lesquelles pointe une colonne de lien de cette base de données. La valeur n'est enregistrée dans aucun fichier.

- `through` — une colonne de relation ou de relation inverse de cette base de données.
- `of` — une propriété des notes liées ; inutile pour `count`.
- `fn` — l'une des valeurs `count`, `countWhere`, `percentWhere`, `sum`, `average`, `median`, `min`, `max`, `earliest`, `latest`, `checked`, `unchecked`, `empty`, `filled`, `unique`.
- `where` — `{ op, value }`, requis par `countWhere` et `percentWhere` ; `op` est l'un des opérateurs `==`, `!=`, `contains`, `notContains`, `>`, `<`, `>=`, `<=`, et une `value` vide signifie « est vide ».

Une agrégation à laquelle il manque une partie requise, ou qui nomme une fonction absente de cette liste, est ignorée : la colonne reste vide et la base de données s'ouvre quand même. Une agrégation passant par une autre colonne calculée reste vide aussi.

## Champs de fichier (`file.*`)

Ces valeurs viennent du fichier, pas de son frontmatter. Chaque ligne d'une base de données porte les champs suivants :

| Champ | Valeur |
|---|---|
| `file.name` | La propriété `title` de la note si elle en a une, sinon le nom du fichier sans `.md` |
| `file.path` | Le chemin relatif au vault |
| `file.mtime` | Dernière modification, en millisecondes |
| `file.ctime` | Création, en millisecondes, lorsque le système de fichiers l'indique |
| `file.size` | Taille en octets |
| `file.tags` | Tous les tags de la note, frontmatter et texte, chacun avec `#` ; rempli lorsqu'un filtre ou un tableau d'affichage en a besoin |
| `file.tasks` | Progression des cases à cocher sous la forme `done/total` ; rempli pour les boards et pour une vue qui affiche la colonne |
| `file.day` | Le jour que représente le nom de fichier d'une note quotidienne, d'après le dossier et le format du vault ; en lecture seule, et seul le champ de date d'un calendrier ou d'une chronologie peut l'utiliser |
| `file.revision` | Un repère de modification interne ; ne vous y fiez pas |

`file.folder` fonctionne comme source (voir [Sources](#sources)) mais n'est pas une colonne. `file.basename`, `file.ext`, `file.links`, `file.backlinks`, `file.embeds`, `file.properties` et `file.file` ne sont pas fournis : une colonne qui en utilise un reste vide, et un filtre les lit comme vides.

## Filtres

### Où vivent les filtres

Le `filters` de premier niveau contient les **sources** — les notes qui appartiennent à la base de données. Chaque vue peut porter ses propres `filters`, avec des conditions qui ne restreignent que cette vue ; c'est là que Plainva écrit les conditions. Les deux niveaux s'appliquent ensemble. Les conditions qu'un fichier garde au premier niveau fonctionnent toujours ; la prochaine sauvegarde dans Plainva les déplace dans chaque vue.

### Sources

| Source | Expression |
|---|---|
| Dossier | `file.folder == "Projects/Active"` — le dossier et tous ses sous-dossiers ; `"/"` désigne le vault entier |
| Tag | `file.hasTag("project")` — la note porte exactement ce tag ; un `#` initial est ignoré |

Plusieurs sources se combinent avec `and` ou `or` comme n'importe quelle autre condition. Une base de données sans source contient toutes les notes du vault. Les pièces jointes, les fichiers réservés `index.md` et `log.md`, ainsi que les fichiers ou dossiers dont le nom commence par un point ne sont jamais des lignes.

### Conditions

Une condition est une chaîne. Les valeurs sont entre guillemets doubles ; `\"` et `\\` échappent un guillemet et une barre oblique inverse. La propriété s'écrit nue ou avec `note.`.

| Condition | Expression |
|---|---|
| est | `status == "Done"` |
| n'est pas | `status != "Done"` |
| contient | `contains(labels, "urgent")` ou `labels.contains("urgent")` |
| ne contient pas | `!contains(labels, "urgent")` ou `!labels.contains("urgent")` |
| supérieur à, inférieur à | `effort > "3"`, `effort < "8"` |
| au moins, au plus | `due >= "2026-07-01"`, `due <= "2026-07-31"` |
| est vide | `status == ""` ou `status.isEmpty()` |
| n'est pas vide | `status != ""` ou `!status.isEmpty()` |
| a un tag | `file.tags.contains("#work")`, négation avec `!` |
| couleur d'en-tête, icône | `note.plainva.header_color == "#2a7f7b"`, `note.plainva.icon == "lucide:pin"` |

### Comment les valeurs se comparent

- **est** et **n'est pas** comparent du texte. Sur une liste (tags, sélection multiple, relation), **est** signifie « la liste contient cette entrée », **n'est pas** « elle ne la contient pas ». Une note sans la propriété ne correspond jamais à **est** et correspond toujours à **n'est pas**.
- **contient** cherche le texte à l'intérieur de la valeur, ou à l'intérieur de chaque entrée d'une liste. `labels.contains("x")` sur une liste exige une entrée qui soit exactement `x` ; sur `file.tags`, les deux formes exigent le tag entier, donc `#work` ne correspond ni à `#workshop` ni à `#work/child`.
- **supérieur à**, **inférieur à**, **au moins**, **au plus** comparent comme des nombres lorsque les deux côtés sont des nombres, sinon comme du texte — ce qui met les dates ISO (`2026-07-03`) dans le bon ordre. Une note sans valeur n'y correspond jamais.
- **est vide** correspond à une propriété absente, à une valeur vide et à une liste vide.
- Une case à cocher se compare comme `"true"` ou `"false"`.

### `and`, `or`, `not`

Un objet `filters` porte exactement un des éléments `and`, `or` et `not` à chaque niveau ; ses entrées sont des chaînes de condition ou d'autres objets de filtre.

| Clé | Correspond lorsque |
|---|---|
| `and` | chaque entrée correspond |
| `or` | au moins une entrée correspond |
| `not` | aucune entrée ne correspond |

Plainva évalue n'importe quelle profondeur. Le panneau de filtre modifie un niveau de groupes sous **Toutes** ou **Au moins une** (**Ajouter un groupe**) ; une structure plus profonde apparaît comme **Filtre complexe (non modifiable)**, reste dans le fichier et est appliquée. Un ancien fichier avec `and` et `or` côte à côte au même niveau est lu comme « tous ceux de `and` et un de ceux de `or` », puis réécrit sous la forme valide à la prochaine sauvegarde.

### Ce que Plainva ne sait pas lire

Seules les formes des deux tableaux ci-dessus sont comprises. Tout le reste — `file.inFolder(…)`, `file.hasLink(…)`, `file.hasProperty(…)`, un nombre sans guillemets (`price > 2`), `&&` et `||` dans une même chaîne, l'arithmétique, les fonctions de date comme `now()`, ou `this` — reste dans le fichier et s'affiche tel quel dans le panneau de filtre, mais Plainva ne l'applique pas. La vue montre alors plus de notes que le même filtre dans Obsidian.

## Formules

Plainva ne calcule pas les formules d'Obsidian. `formulas` reste dans le fichier sans changement, et une colonne `formula.<name>` dans le `order` d'une vue s'affiche sans valeurs. **Exporter le tableau** → **Formules (.base)** écrit certaines agrégations sous forme de formules pour qu'Obsidian puisse les calculer (voir [Bases de données](Databases_Base.md)).

## Vues

### Clés de chaque vue

| Clé | Valeur | Dans Plainva |
|---|---|---|
| `type` | `table`, `list`, `cards` | Le type de vue ; voir le tableau suivant |
| `name` | texte | Requis ; Plainva donne un nom à une vue qui n'en a pas lorsqu'il enregistre |
| `order` | liste d'identifiants de propriété | Les colonnes visibles, dans cet ordre |
| `sort` | liste de `{ property, direction }` | Règles de tri, `ASC` ou `DESC` |
| `filters` | objet de filtre | Les conditions propres à la vue |
| `summaries` | table identifiant de propriété → nom de synthèse | Le pied de chaque colonne |
| `plainva` | table | Les options de vue de Plainva, ci-dessous |

### Les huit types de vue

Obsidian connaît `table`, `list` et `cards`. Les autres types de vue de Plainva sont enregistrés comme `type: table` plus `plainva.render`, de sorte qu'Obsidian les affiche comme un tableau.

| Type de vue | `type` sur le disque | `plainva.render` |
|---|---|---|
| **Tableau** (`table`) | `table` | — |
| **Liste** (`list`) | `list` | — |
| **Galerie** (`gallery`) | `cards` | — |
| **Kanban** (`board`) | `table` | `board` |
| **Calendrier** (`calendar`) | `table` | `calendar` |
| **Chronologie** (`timeline`) | `table` | `timeline` |
| **Graphe** (`graph`) | `table` | `graph` |
| **Tableau d'affichage** (`pinboard`) | `table` | `pinboard` |

Kanban, Calendrier, Chronologie, Graphe et Tableau d'affichage ne sont proposés comme **Type de vue** que tant que **Autoriser les extensions Plainva pour les fichiers .base** est activé. Un `type` que Plainva ne connaît pas s'affiche comme un tableau.

### Options de vue (`views[i].plainva`)

Dans le bloc `plainva`, une propriété s'écrit nue (`status`), pas comme `note.status`.

| Clé | Types de vue | Valeur |
|---|---|---|
| `render` | Kanban, Calendrier, Chronologie, Graphe, Tableau d'affichage | Le type de vue, voir ci-dessus |
| `groupBy` | Kanban | La propriété dont sont faites les colonnes |
| `boardLaneBy` | Kanban | Une seconde propriété pour **Couloirs par** |
| `boardWipLimits` | Kanban | Table valeur de colonne → nombre maximal de cartes (**Limite de WIP**), nombres entiers supérieurs à 0 |
| `boardColorMode` | Kanban | `column` teinte toute la colonne ; absent = seulement la puce d'en-tête |
| `boardColumnOrder` | Kanban | Ordre manuel des colonnes ; `__UNGROUPED__` est la colonne sans valeur |
| `colorBy` | Kanban, Chronologie | Les cartes et les barres prennent la couleur d'option de cette propriété (**Couleur selon**) |
| `dateField` | Calendrier, Chronologie | La date de début (**Champ de date**, **Date de début**) ; une propriété de date ou `file.day` |
| `endField` | Calendrier, Chronologie | La **Date de fin** |
| `coverImage` | Galerie | La propriété qui contient l'**Image de couverture** |
| `subItemsProperty` | Tableau | La relation parente pour les **Sous-éléments** |
| `widths` | Tableau | Table colonne → largeur en pixels |
| `dateFormat` | toutes | `long`, `iso` ou `relative` ; absent = la forme courte par défaut |
| `graphEdges` | Graphe | Propriétés de relation dessinées comme arêtes |
| `graphColorBy` | Graphe | Une propriété de sélection ou de statut qui colore les nœuds |
| `graphSizeBy` | Graphe | Une propriété numérique qui dimensionne les nœuds |
| `graphShowExternal` | Graphe | `true` affiche aussi les cibles de lien extérieures à la vue |
| `graphShowIncoming` | Graphe | `true` affiche aussi les liens venant d'autres bases de données |
| `pinboardOrder` | Tableau d'affichage | Chemins des cartes non épinglées, dans l'ordre manuel |
| `pinboardPinned` | Tableau d'affichage | Chemins des cartes épinglées, dans l'ordre |
| `pinboardFilterBy` | Tableau d'affichage | **Source des libellés** : une propriété à sélection multiple ; absent = les tags |

### Options valables pour tout le fichier (première vue uniquement)

Ces clés appartiennent à toute la base de données. Plainva les écrit uniquement dans le bloc `plainva` de la première vue et lit la première valeur valide de chacune.

| Clé | Valeur |
|---|---|
| `fileIconColor` | Couleur hexadécimale de l'icône de la base de données (**Couleur de l'icône de la base de données**) |
| `newItemFolder` | Dossier où **Entrée** enregistre les nouvelles entrées |
| `newItemTemplate` | Modèle des nouvelles entrées |
| `contextFilters` | Propriétés qui limitent une base de données intégrée à la note dans laquelle elle est intégrée (**Cette note**) |
| `taskList` | Compte et liste (`"<account id> <list id>"`) dans lesquels une nouvelle tâche est aussi créée |

## Synthèses

`views[i].summaries` associe une colonne à l'un de ces noms ; le pied de colonne le calcule sur les lignes que la vue affiche.

| Nom | Dans Plainva | Résultat |
|---|---|---|
| `Average` | **Moyenne** | Moyenne des nombres |
| `Min` | **Min** | Plus petit nombre |
| `Max` | **Max** | Plus grand nombre |
| `Sum` | **Somme** | Total des nombres |
| `Range` | **Étendue** | Plus grand nombre moins plus petit ; pour les dates, l'écart en jours |
| `Median` | **Médiane** | Valeur centrale des nombres |
| `Stddev` | **Écart-type** | Écart-type de tous les nombres (population) |
| `Earliest` | **Plus ancienne** | Date la plus ancienne |
| `Latest` | **Plus récente** | Date la plus récente |
| `Checked` | **Cochées** | Lignes dont la valeur est `true` ou `yes` |
| `Unchecked` | **Non cochées** | Toutes les autres lignes |
| `Empty` | **Sans valeur** | Lignes sans valeur |
| `Filled` | **Avec valeur** | Lignes avec une valeur |
| `Unique` | **Distinctes** | Nombre de valeurs différentes ; les entrées d'une liste comptent une à une |

Les nombres sont arrondis à deux décimales, et une virgule décimale est lue aussi. Une colonne sans valeur exploitable n'affiche pas de pied plutôt que 0. Tout autre nom est une formule personnalisée issue du `summaries` de premier niveau : Plainva la conserve et affiche **Personnalisée : …** dans le menu, mais ne calcule aucune valeur.

## Tri et regroupement

- **Tri** — `sort` est une liste de règles ; la première décide en premier, la suivante seulement entre lignes égales. Les nombres se trient comme des nombres, tout le reste comme du texte (les dates ISO dans le bon ordre). Les lignes sans valeur viennent en dernier dans les deux sens. Sans règle, les notes modifiées le plus récemment viennent en premier. Plainva lit aussi `field` pour `property`, et `asc`/`desc` quelle que soit la casse.
- **Regroupement** — le kanban regroupe d'après `plainva.groupBy`, avec des couloirs d'après `plainva.boardLaneBy`. Le `groupBy` propre à Obsidian pour une vue est conservé dans le fichier, mais Plainva ne regroupe pas un tableau d'après lui.

## Intégrer une base de données, et `this`

`![[Projects.base]]` dans une note affiche la base de données dans la note, en mode lecture et dans l'éditeur. Une partie après `#` (un nom de vue, comme dans `![[Projects.base#Board]]`) est ignorée : l'intégration affiche la dernière vue utilisée pour cette base de données. Un bloc de code ` ```base ` dans une note s'affiche comme du code, pas comme une base de données.

**`this` n'est pas encore pris en charge.** Un filtre ou une formule qui utilise `this` reste dans le fichier, mais Plainva ne l'évalue pas. Deux choses couvrent le cas le plus courant, « afficher les entrées qui appartiennent à cette note » : `contextFilters` (**Cette note** dans le panneau de filtre) limite une base de données intégrée à la note dans laquelle elle est intégrée, via une propriété de relation, et une base de données intégrée qui est en relation avec la base de données de sa note hôte propose d'elle-même **Filtrer cette base sur la note actuelle**. Les deux n'agissent qu'à l'intérieur de Plainva ; Obsidian affiche toutes les lignes.

## Limites

- Le `limit` d'Obsidian pour une vue est conservé mais non appliqué : une vue affiche toutes ses lignes.
- Le panneau de filtre modifie un niveau de groupes de filtres ; les niveaux plus profonds sont appliqués mais on ne peut que les supprimer depuis ce panneau.
- Une valeur de filtre doit être entre guillemets doubles (voir [Ce que Plainva ne sait pas lire](#ce-que-plainva-ne-sait-pas-lire)).
- Une source de type dossier inclut toujours les sous-dossiers.
- `ratingMax` est dessiné entre 1 et 10, `previousKeys` conserve 8 noms au plus, une **Limite de WIP** n'accepte que des nombres entiers supérieurs à 0, et `relationLimit` ne connaît que `one`.
- Une agrégation ne peut pas calculer à partir d'une autre colonne calculée.

## Clés que Plainva ne connaît pas

Plainva lit un `.base`, ne modifie que ce que vous avez modifié dans l'application, et réécrit le fichier en entier — en YAML avec des fins de ligne LF et sans BOM, de sorte que les commentaires et la mise en forme d'un fichier écrit à la main ne sont pas conservés. Parmi ce qu'il ne connaît pas :

- **Conservé :** toute autre clé de premier niveau, `formulas`, le `summaries` de premier niveau, `displayName` et toute autre clé d'une entrée de `properties` en dehors de son bloc `plainva`, les clés d'une vue que Plainva n'utilise pas (`limit`, `groupBy`, `image`, …), les clés inconnues dans le bloc `plainva` d'une vue, et les conditions de filtre qu'il ne sait pas lire.
- **Non conservé :** les clés du bloc `plainva` d'une colonne que cette version de Plainva ne connaît pas, et une agrégation qu'il ne sait pas lire — les deux disparaissent à la prochaine sauvegarde. Une vue d'un type que Plainva ne connaît pas est réécrite comme `type: table`.
- **Position :** les clés qu'une vue conserve appartiennent à sa place dans la liste. Actuellement, supprimer ou déplacer une vue dans Plainva les laisse à l'ancien emplacement, où la vue suivante les reçoit.

## Différences avec Obsidian Bases

| Sujet | Obsidian | Plainva |
|---|---|---|
| Formules, synthèses personnalisées | Calculées | Conservées, non calculées |
| `this` | Pris en charge | Pas encore pris en charge |
| Expressions de filtre | Le langage d'expressions complet | Les formes de [Conditions](#conditions) |
| `file.folder == "X"` | Seulement les notes directement dans `X` | `X` et tous ses sous-dossiers |
| `file.hasTag("x")` | Aussi `#x/child` | Exactement `#x` |
| `file.name` | Le nom du fichier | La propriété `title` si la note en a une |
| `limit`, `groupBy` d'une vue | Appliqués | Conservés, non appliqués |
| Types de vue | `table`, `list`, `cards` et types de plugins | Huit types ; les inconnus comme un tableau |
| `![[db.base#View]]` | Ouvre cette vue | La dernière vue utilisée |
| Bloc de code ` ```base ` | Une base de données | Un bloc de code |
| Blocs `plainva` de Plainva | Ignorés | Kanban, calendrier, chronologie, graphe, tableau d'affichage, relations, agrégations, types de champ |

## Voir aussi

- [Bases de données (.base)](Databases_Base.md) — les bases de données au quotidien
- [Référence du format de fichier](File_Format_Reference.md) — les règles sur le disque pour les outils, les relations dans les deux sens, `index.md`
- [Notes & Markdown](Notes_and_Markdown.md) — les propriétés dans une note
