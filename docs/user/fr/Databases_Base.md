# Bases de données (.base)

Dernière mise à jour : 2026-07-17

Avec les fichiers `.base`, vous transformez des notes en bases de données : tableaux, boards, calendriers — avec des filtres, des propriétés typées et des relations entre bases de données. Le concept ressemble aux bases de données Notion, avec une différence décisive : **les données ne vivent pas dans la base de données, elles vivent dans vos notes.**

> **Astuce :** Si vous créez un nouveau vault à partir du modèle **PARA**, **GTD**, **Zettelkasten** ou **Journal** (voir [Prise en main](Getting_Started.md)), des bases de données assorties sont déjà configurées et reliées entre elles — un bon point de départ pour voir comment tout s'articule.

## Le concept central

Un fichier `.base` stocke uniquement la *vue* sur vos notes : quelles sources (dossiers, tags), quelles vues, quels filtres et colonnes. Les valeurs réelles vivent dans le frontmatter des notes Markdown individuelles — chaque ligne du tableau *est* une note.

Concrètement, cela signifie :

- Modifiez une cellule dans le tableau et Plainva écrit la valeur dans le frontmatter de la note.
- Supprimez le fichier `.base` et vous ne perdez que la vue — toutes les données restent dans les notes.
- Les mêmes notes peuvent apparaître dans un nombre quelconque de bases de données à la fois.

Le format de fichier est compatible avec le format Bases d'Obsidian (détails à la fin de cette page).

## Créer une base de données

- **Arborescence de fichiers** : clic droit → **Nouvelle base de données (.base)** — ou via le bouton **Nouveau** de la barre latérale (**Nouvelle base**).
- L'assistant **Nouvelle base de données** demande deux choses : la **Source de données** (au moins un **Dossier** ou un **Tag** ; les combiner restreint le résultat — un compteur en direct affiche le nombre de notes correspondantes) et les colonnes (propriétés trouvées dans les notes correspondantes, prêtes à adopter). Puis **Créer la base de données**.
- **Dans une note** : commande slash **Intégrer une base de données** (afficher une `.base` existante en ligne) ou **Créer une base de données intégrée** (créer une nouvelle `.base` dans le dossier et l'intégrer).

Chaque base de données peut porter sa propre icône avec une **Couleur de l'icône de la base de données** — visible dans l'arborescence de fichiers, les onglets et l'en-tête.

## Vues

Une base de données peut avoir un nombre quelconque de vues ; chacune a un **Type de vue** :

| Vue | À quoi ça sert |
|---|---|
| **Tableau** | Grille classique, triable, avec édition en ligne et sous-éléments facultatifs |
| **Liste** | Liste de lignes compacte |
| **Galerie** | Cartes avec une **Image de couverture** facultative |
| **Kanban** | Colonnes Kanban groupées par une propriété (**Regrouper par**) — glisser des cartes entre les colonnes modifie la valeur ; glisser un **en-tête de colonne** réordonne les colonnes |
| **Calendrier** | Entrées par **Champ de date** sur un calendrier mensuel, déplaçables |
| **Chronologie** | Axe temporel avec une **Date de début** et une **Date de fin** facultative |
| **Tableau d'affichage** | Tableau de notes autocollantes façon Google Keep — les cartes affichent le contenu rendu de la note (section dédiée plus bas) |

**Ajouter une vue** en crée de nouvelles ; **Options de la vue** propose **Renommer**, **Dupliquer**, **Supprimer** et le réordonnancement par glisser-déposer. Plainva se souvient de la dernière vue active par fichier. Le calendrier et la chronologie ont besoin d'un champ de date (**Date seule** ou **Date & heure** comme **Format**) ; les entrées affichent les champs activés sous **Propriétés**.

## Configurer : sources, filtres, tri, propriétés

Le bouton **Configurer** (en haut à droite) ouvre le panneau avec quatre zones :

- **Source de données** — les sources de dossiers et de tags de la base de données (le **Dossier racine** peut aussi être sélectionné). Aucune source = tous les fichiers.
- **Filtre** — des lignes de règles composées de propriété, opérateur et valeur. Les opérateurs s'adaptent au type de champ : **est** / **n'est pas** / **contient** / **ne contient pas** / **est vide** / **n'est pas vide**, pour les nombres **supérieur à** / **inférieur à** / **au moins** / **au plus**, pour les dates **après** / **avant** / **à partir de** / **jusqu'à**. La **Logique** en haut décide si **Toutes** les conditions (ET) ou **Au moins une** (OU) doivent correspondre. **Ajouter un groupe** construit des groupes de filtres à la Notion : un encadré avec sa propre logique ET/OU à l'intérieur de la logique principale. Les filtres profondément imbriqués provenant d'Obsidian apparaissent comme **Filtre complexe (non modifiable)** — ils sont conservés et appliqués. Les filtres sont enregistrés **par vue** (le panneau indique **S'applique à cette vue**) : chaque vue conserve ses propres règles de filtre, tandis que la **Source de données** (dossiers/tags) reste partagée pour toute la base de données. Tout vit dans le fichier `.base`, pas dans un stockage séparé.
- **Tri** — plusieurs règles de tri (**Croissant**/**Décroissant**) ; changez leur priorité en les faisant glisser.
- **Propriétés** — afficher/masquer des colonnes, réordonner par glisser-déposer, créer une **Nouvelle propriété**.

## Propriétés et types de champ

Cliquer sur un en-tête de colonne ouvre l'éditeur de propriété (**Propriété : X**) :

- **Nom** — le renommage affecte les notes : à l'enregistrement, la propriété est renommée dans le frontmatter de chaque note correspondante (avec confirmation et un indicateur de progression).
- **Type de champ** — Texte, Nombre, Case à cocher, Date, Date & heure, Liste, Tags, Sélection, Statut, Sélection multiple, URL, E-mail, Téléphone, Relation (le même menu de types groupés que dans le panneau **Propriétés** des notes).
- **Options** (pour Sélection/Statut/Sélection multiple) — des valeurs fixes avec une **Couleur** et, pour **Statut**, un **Groupe**/une étape (p. ex. à faire → en cours → terminé) ; réordonnez par glisser-déposer. À l'ouverture de l'éditeur de colonne, la liste des options est déjà préremplie avec les valeurs déjà présentes dans la base de données — vous pouvez ainsi donner une couleur à chacune sans avoir à la ressaisir.
- **Supprimer la propriété** — retire la colonne, le schéma, les filtres et les règles de tri de la base de données. La case à cocher **Aussi la retirer du frontmatter des notes** (activée par défaut) nettoie en plus les notes sources.

Notes sur le comportement :

- Si une propriété manque dans certaines notes, Plainva propose de l'**ajouter (vide) à N fichiers sources**.
- Pour **Sélection**, **Statut**, **Sélection multiple**, **Liste** et **Tags**, une virgule dans une valeur sépare plusieurs entrées ; dans le type **Texte**, une virgule reste du texte brut.
- Les champs système OKF `type` et `okf_version` sont protégés ici aussi : le nom, le type de champ et la suppression sont verrouillés, et les cellules `okf_version` sont en lecture seule (contexte : [OKF](OKF.md)).

## Relations

Les relations lient des notes entre elles — comme dans Notion, mais stockées comme de parfaits `[[liens wiki]]` normaux dans le frontmatter (visibles dans Obsidian comme des liens de propriété cliquables).

- **Créer** : ajoutez une propriété de type de champ **Relation**. Choisissez éventuellement une **Base de données cible (.base)** — le sélecteur ne suggère alors que des notes de cette base de données (vide = **N'importe quelle note** ; **Cette base de données** active les auto-relations). La **Cardinalité** limite à **Exactement 1** ou permet **Sans limite**.
- **Définir des valeurs** : le sélecteur recherche des notes, exclut l'entrée actuelle, et peut créer une cible à la volée via **Créer une nouvelle note**. Un badge « La note liée n'existe pas » signale un lien rompu (cible supprimée/renommée en dehors de Plainva).
- **Relation inverse** : l'option **Afficher sur « X »** crée une colonne calculée dans la base de données cible montrant les liens en sens inverse — elle est directement modifiable (les modifications s'écrivent dans les notes qui créent le lien). Supprimer la relation retire aussi sa colonne inverse.
- **Sous-éléments** : pour les auto-relations, vous pouvez **Activer les sous-éléments** — les entrées avec une relation parent apparaissent repliables sous leur entrée parente dans le tableau (les cycles sont gérés ; désactivé, la liste reste plate et les valeurs sont conservées).
- **Kanban par relation** : les boards peuvent se regrouper par une relation ; glisser des cartes entre les colonnes réécrit le lien.
- **Filtrer sur les relations** : contient / ne contient pas / est vide / n'est pas vide, avec un sélecteur de notes.
- Les backlinks comptent aussi : les liens du frontmatter apparaissent dans le panneau **Backlinks**, et les renommages de fichiers mettent automatiquement à jour les liens de relation.

## Créer de nouveaux éléments

Le bouton **Entrée** en haut à gauche (auparavant **Nouveau** ; clairement distinct du **Nouveau** global de la barre latérale) crée un nouvel élément :

- Le nom du fichier suit le modèle `{nom de la base de données}_{numéro séquentiel}` (les espaces deviennent `_`) ; la note commence par un titre correspondant et hérite des sources de tags et des valeurs de filtre simples de la base de données afin d'apparaître immédiatement dans la vue. La fenêtre d'aperçu s'ouvre ensuite pour le remplissage.
- **Dossier de stockage** : les nouveaux éléments atterrissent toujours dans un dossier désigné. Si la base de données n'a pas de source de dossier, un dialogue vous guide une fois pour en créer un ; avec plusieurs sources de dossiers, vous choisissez une fois. Modifiez-le à tout moment via le menu flèche du bouton → **Changer de dossier de stockage…**.
- **Modèles** : le menu flèche (**Modèles et dossier de stockage**) liste les modèles du dossier de modèles de votre vault — utilisez-en un ponctuellement, marquez-en un d'une étoile via **Définir par défaut** (chaque clic sur **Entrée** de cette base de données l'utilise alors), ou **Créer un modèle** (un nouveau modèle commence par un titre `# {{title}}`, de sorte que les éléments créés à partir de lui héritent de leur nom de fichier comme titre H1). Le même menu propose aussi **Ouvrir le dossier des modèles**, qui affiche le dossier des modèles dans l'arborescence des fichiers — les modèles sont des notes ordinaires que vous pouvez y modifier, renommer ou supprimer.
- **Modèles par base de données** : des modèles peuvent être associés à des bases de données. Par défaut, le menu flèche n'affiche que les modèles associés à cette base de données (plus son modèle par défaut) ; tout le reste est accessible via **Afficher tous les modèles (n)**. Associez-les directement là — l'icône de base de données de chaque ligne indique **Associer à cette base de données** ou **Retirer l’association à cette base de données** — ou depuis le modèle lui-même : le menu **⋮** de l'éditeur propose **Bases de données cibles…**, une boîte de dialogue avec un champ de recherche où vous associez le modèle à un nombre quelconque de bases de données. Un modèle créé depuis une base de données via **Créer un modèle** lui est associé dès le départ. L'association est stockée comme une liste `plainva.templateFor` dans le frontmatter du modèle (voir la [Référence du format de fichier](File_Format_Reference.md)) ; elle n'est jamais copiée dans les éléments créés à partir du modèle, et renommer une `.base` conserve les associations. La commande slash **Insérer un modèle** reste volontairement non filtrée — elle insère du texte dans une note existante et n'a pas de contexte de base de données.
- **Espaces réservés des modèles** : les modèles interpolent `{{title}}`, `{{date}}` et `{{time}}`. Quand vous *insérez* un modèle dans une note (commande slash **Insérer un modèle** / `Mod+Alt+T`), deux autres sont résolus : `{{cursor}}` marque l'endroit où le curseur atterrit après l'insertion, et `{{prompt:Libellé}}` vous demande une valeur (intitulée *Libellé*) et insère votre réponse. Créer une *nouvelle* note à partir d'un modèle supprime `{{cursor}}` et laisse tout `{{prompt:…}}` vide.

## Tableau d'affichage (notes autocollantes façon Google Keep)

Le type de vue **Tableau d'affichage** montre les notes de la base de données sous forme de cartes avec leur contenu rendu — un tableau plein de notes autocollantes. Les cartes affichent le texte, les listes et des cases à cocher cliquables (un clic coche la tâche directement dans la note), les images et la mise en forme ; les tableaux, formules et éléments intégrés apparaissent comme de discrets espaces réservés. Cliquer sur une carte ouvre la note dans la fenêtre d'aperçu.

- **Capture rapide** : le champ **Écrire une note…** au-dessus du tableau crée une nouvelle note dans le dossier de stockage de la base de données quand vous appuyez sur Entrée — pas de modèle, pas de détour ; le texte saisi est le contenu, et le nom du fichier provient de ses premiers mots.
- **Épingler** : le bouton d'épingle (en haut à droite au survol d'une carte) fait passer une carte dans la section **Épinglées**.
- **Organiser** : faites glisser les cartes pour les réordonner ; l'ordre vit dans le fichier `.base` et se synchronise avec lui. Les cartes pas encore organisées (capturées récemment ou créées en dehors de Plainva) apparaissent en haut, les plus récentes en premier. Si une règle de tri est définie sous **Configurer**, elle prend le dessus — le glisser-déposer est alors désactivé.
- **Libellés** : la barre de puces au-dessus du tableau filtre les cartes — par tags par défaut, commutable vers une propriété à sélection multiple (**Configurer** → **Source des libellés**). Plusieurs puces se combinent avec un ET logique ; la sélection est éphémère et n'est jamais écrite dans le fichier. Modifiez les libellés d'une carte via **Libellés** dans le menu contextuel de la carte.
- **Couleur** : le menu contextuel teinte la carte. La couleur est la couleur d'en-tête de la note (`plainva.header_color`) — elle s'applique partout où la note apparaît, y compris dans l'en-tête de l'éditeur.
- **Mobile** : sur le téléphone, une pression simple ouvre la note, un appui long affiche les actions (épingler, libellés, couleur, supprimer), et faire glisser après un appui long réordonne. Astuce : pointez la base de données vers votre dossier de boîte de réception (**Paramètres** → **Dossiers**) et les notes rapides du ＋ ainsi que les textes partagés depuis d'autres applications atterrissent directement sur le tableau.

Remarque pour les vaults synchronisés : si deux appareils organisent le tableau en même temps, une copie `.CONFLICT` du fichier `.base` peut apparaître — seule l'organisation est affectée, jamais le contenu des notes ; supprimez ou fusionnez la copie.

## Utilisation au quotidien

- **Édition en ligne** : un simple clic dans une cellule (ou sur une valeur de carte) la rend modifiable — dans toutes les vues.
- **Ouvrir** : cliquer sur le titre d'un élément ouvre la note dans la fenêtre d'aperçu — une fenêtre flottante que vous pouvez déplacer par sa barre de titre et redimensionner depuis le coin. Elle conserve son propre historique **Retour**/**Avancer** pour les notes que vous y ouvrez, propose un bouton qui bascule l'affichage d'une colonne **Propriétés** pour la note affichée, et offre **Ouvrir en onglet** et **Ouvrir dans la vue scindée**. `Ctrl`+clic ouvre directement dans la vue scindée ; vous pouvez aussi faire glisser une carte sur la zone de dépôt **Déposer ici : ouvrir dans la vue scindée**.
- **Glisser-déposer** : pendant le glissement de cartes (Kanban, Calendrier, Chronologie), une carte fantôme suit le pointeur. Dans un **Kanban**, vous pouvez aussi faire glisser un **en-tête de colonne** pour réordonner les colonnes — pour les boards **Sélection**/**Statut**, cela réordonne les options de la propriété (les listes déroulantes suivent partout) ; les boards de relation et de texte libre mémorisent l'ordre par vue.
- **Couleur du Kanban** : dans les paramètres **Vue** d'un Kanban, **Couleur de colonne** permet à une colonne de prendre la couleur de son groupe — soit **Colonne entière** (toute la colonne est teintée), soit **Puce seulement** (seulement la puce de l'en-tête, par défaut). S'applique aux groupes Sélection/Statut/Sélection multiple.
- **Intégration** : les bases de données peuvent être intégrées dans des notes (commande slash **Intégrer une base de données** ou `@` → **Bases de données**) et y être utilisées avec toutes leurs fonctionnalités.
- **Portée automatique dans un élément lié** : quand vous intégrez une base de données à l'intérieur d'un seul élément d'une base de données *liée*, elle se filtre automatiquement sur cet élément — intégrez la base de données des tâches dans la note d'un projet et vous ne voyez que les tâches de ce projet. Cela fonctionne dans les deux sens (intégrez le côté « plusieurs » pour voir les lignes qui pointent vers l'élément hôte, ou le côté « un » pour voir ce vers quoi l'hôte pointe) et pour les bases de données en auto-relation avec une hiérarchie parent/sous-éléments (l'intégrer à l'intérieur d'un élément affiche les sous-éléments de cet élément, imbriqués). Un petit badge **Filtre** dans l'en-tête de la base de données intégrée indique sur quoi porte la portée ; utilisez-le pour changer de relation ou choisir **Tout afficher**. La portée n'est jamais écrite dans le fichier `.base`, de sorte que la même base de données affiche les bonnes lignes dans chaque élément où elle est intégrée.
- **Les nouvelles entrées héritent du lien** : créer une entrée avec **Entrée** à l'intérieur d'une telle intégration à portée automatique la lie automatiquement à l'élément hôte (une tâche que vous créez dans la liste des tâches intégrée d'un projet appartient immédiatement à ce projet). Dans le sens inverse, c'est l'hôte qui est lié à la nouvelle entrée à la place ; une relation à valeur unique déjà définie reste inchangée.
- **Filtre explicite « Cette note » (comme le filtre « cette page » de Notion)** : plutôt que de compter sur la portée automatique, vous pouvez la rendre explicite et permanente. Dans **Configurer → Filtre**, ajoutez une règle sur une propriété de relation et choisissez la valeur **Cette note**. La base de données se filtre alors sur la note dans laquelle elle est intégrée, quelle qu'elle soit — idéal pour les **modèles** : intégrez la base de données des tâches dans un modèle de projet, et chaque projet créé à partir de celui-ci affiche ses propres tâches. Cela fonctionne pour toute propriété de lien wiki, pas seulement les relations détectées, et un filtre **Cette note** explicite prend le pas sur la portée automatique. Ce filtre ne vit que dans Plainva (il n'est pas écrit dans le fichier `.base` comme un filtre normal), de sorte qu'Obsidian et une ouverture autonome affichent toutes les lignes.

## Exemple : à quoi ressemble un fichier .base

Les fichiers `.base` sont en YAML — voici une simple liste de projets :

```yaml
filters:
  and:
    - 'file.hasTag("projet")'
properties:
  note.status:
    displayName: Status
    plainva:
      input: status
      options:
        - value: ouvert
          color: teal
          group: Actif
        - value: terminé
          color: gray
          group: Terminé
views:
  - type: table
    name: Tous les projets
  - type: table
    name: Board
    plainva:
      render: board
      groupBy: status
```

Tout ce qui est spécifique à Plainva (couleurs, rendu du board, relations, dossier de stockage) vit sous les clés `plainva:`.

## Modifier directement les fichiers .base (outils et IA)

Un fichier `.base` est du YAML texte brut, donc un outil, un script ou un assistant IA peut le modifier directement — sans passer par l'interface de Plainva. Trois règles strictes :

- Seules ces clés de premier niveau sont autorisées : `filters`, `formulas`, `properties`, `views`. En ajouter une autre fait rejeter le fichier entier par Obsidian.
- Chaque vue a besoin d'un `name` en chaîne non vide.
- Un objet `filters` porte exactement un de `and` / `or` / `not` à chaque niveau — jamais deux côte à côte.

Un piège courant : les clés de la map `properties:` (et les listes `order:`/`sort[].property`) utilisent un identifiant préfixé par `note.` (p. ex. `note.status`), mais à l'intérieur des expressions de filtre et des sous-clés `plainva` (`groupBy`, `dateField`, etc.), c'est la clé de propriété nue (p. ex. `status`) qui compte.

Le contrat de champ exact — quelles valeurs sont autorisées, comment chaque type de propriété se sérialise, et les règles de noms réservés — vit dans la [Référence du format de fichier](File_Format_Reference.md).

## Et Obsidian ?

Le format correspond au format Bases d'Obsidian ; Plainva écrit ses extensions exclusivement dans des sous-clés `plainva:`, qu'Obsidian ignore (« dégradation gracieuse ») :

- Obsidian ouvre le fichier sans erreur ; les vues propres à Plainva comme Kanban/Calendrier/Chronologie y apparaissent comme un simple tableau.
- Les colonnes de relation inverse apparaissent vides dans Obsidian (elles sont calculées) ; les valeurs de relation dans les notes y sont visibles comme des liens cliquables.
- La première fois que vous utilisez une telle extension, un dialogue (**Extension Plainva**) le signale ; il peut être désactivé sous **Paramètres** via **Bases de données étendues** ou **Avertissements**.

## Voir aussi

- [Référence du format de fichier](File_Format_Reference.md) — le contrat exact sur le disque des fichiers .base pour les outils et l'édition à la main
- [Notes & Markdown](Notes_and_Markdown.md) — les propriétés/le frontmatter en détail
- [OKF](OKF.md) — ce qu'un `type` uniforme apporte concrètement
