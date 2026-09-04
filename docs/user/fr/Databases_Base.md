# Bases de données (.base)

Dernière mise à jour : 2026-09-04

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

Une base de données peut aussi servir de **Base de tâches par défaut** du vault (Paramètres → **Contenu et structure**) : la [vue Tâches](Tasks.md) affiche alors ses entrées comme une section à part et peut y déplacer des cases à cocher depuis les notes.

## Vues

Une base de données peut avoir un nombre quelconque de vues ; chacune a un **Type de vue** :

| Vue | À quoi ça sert |
|---|---|
| **Tableau** | Grille classique, triable, avec édition en ligne et sous-éléments facultatifs |
| **Liste** | Liste de lignes compacte |
| **Galerie** | Cartes avec une **Image de couverture** facultative |
| **Kanban** | Colonnes Kanban groupées par une propriété (**Regrouper par**) — glisser des cartes entre les colonnes modifie la valeur ; glisser un **en-tête de colonne** réordonne les colonnes |
| **Calendrier** | Entrées par **Champ de date** en **Mois**, **Semaine** ou **Jour**, déplaçables |
| **Chronologie** | Axe temporel avec une **Date de début** et une **Date de fin** facultative |
| **Tableau d'affichage** | Tableau de notes autocollantes façon Google Keep — les cartes affichent le contenu rendu de la note (section dédiée plus bas) |

**Ajouter une vue** en crée de nouvelles ; **Options de la vue** propose **Renommer**, **Dupliquer**, **Supprimer** et le réordonnancement par glisser-déposer. Plainva se souvient de la dernière vue active par fichier. Le calendrier et la chronologie ont besoin d'un champ de date (**Date seule** ou **Date & heure** comme **Format**) ; les entrées affichent les champs activés sous **Propriétés**.

## Configurer : onglets pour la vue, les colonnes, le filtre, le tri, la source de données

Le bouton **Configurer** (en haut à droite) ouvre le panneau **à côté** de la vue en cours, de sorte que chaque changement s'affiche immédiatement dans le tableau ou le kanban. Des **onglets** en haut permettent de choisir une zone — une seule est affichée à la fois, plutôt qu'une longue liste. Un petit repère indique, pour chaque zone, si elle affecte **Cette vue** ou la **Base entière** :

- **Vue** — le **type de vue** sous forme de sélecteur de vignettes avec icônes (Tableau, Liste, Carte, Kanban, Galerie, Calendrier, Chronologie, Tableau d'affichage), avec ses options spécifiques au type : regroupement et couleur de colonne pour le kanban, champ de date pour le calendrier/la chronologie, image de couverture de la galerie, sous-éléments, format de date. Ces sélecteurs ne proposent que les propriétés du **type correspondant** : le **champ de date** uniquement les propriétés de date, **Regrouper par** uniquement les propriétés de sélection/statut/sélection multiple/relation, l'**image de couverture** uniquement les propriétés de texte/URL. Pour le type de vue **Graphe**, l'onglet **Propriétés** est désactivé — le graphe n'affiche aucune colonne (couleur/taille/arêtes se règlent dans sa propre barre d'outils).
- **Colonnes** — les propriétés de la vue, réparties en **Visibles** et **Masquées**. Cliquez sur l'œil pour afficher ou masquer une colonne ; faites glisser la poignée pour réordonner. Chaque ligne affiche un badge de type de champ, la roue crantée ouvre l'éditeur de colonne, **Nouvelle propriété** en ajoute une.
- **Filtre** — chaque règle s'affiche comme une **puce** lisible (par ex. « Statut n'est pas Terminé ») ; cliquez dessus pour déployer l'éditeur (propriété, opérateur, valeur). Les opérateurs s'adaptent au type de champ : **est** / **n'est pas** / **contient** / **ne contient pas** / **est vide** / **n'est pas vide**, pour les nombres **supérieur à** / **inférieur à** / **au moins** / **au plus**, pour les dates **après** / **avant** / **à partir de** / **jusqu'à**. La **Logique** en haut décide si **Toutes** les conditions (ET) ou **Au moins une** (OU) doivent correspondre. **Ajouter un groupe** construit des groupes de filtres à la Notion : un encadré avec sa propre logique ET/OU à l'intérieur de la logique principale. Les filtres profondément imbriqués provenant d'Obsidian apparaissent comme **Filtre complexe (non modifiable)** — ils sont conservés et appliqués. Les filtres sont enregistrés **par vue** ; tout vit dans le fichier `.base`, pas dans un stockage séparé.
- **Tri** — plusieurs règles de tri (**Croissant**/**Décroissant**) ; changez leur priorité en les faisant glisser.
- **Source de données** — les sources de dossiers et de tags de la base de données (le **Dossier racine** peut aussi être sélectionné). Aucune source = tous les fichiers. S'applique à toute la base de données, pas uniquement à la vue active.

Sur le téléphone, **Configurer** ouvre les mêmes zones sous forme de liste ; toucher l'une d'elles ouvre la zone de détail correspondante, et la flèche retour permet d'en sortir.

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

## Agrégations

Une **agrégation** calcule une valeur à partir des notes vers lesquelles pointe un lien — « combien des tâches de ce projet sont encore ouvertes », « quel est l'effort total qu'il représente », « quand la dernière est-elle due ».

- **Créer une agrégation** : une nouvelle propriété de type de champ **Agrégation**. Vous choisissez trois choses : le **lien** à travers lequel calculer (une relation ou une relation inverse de cette base de données), la **propriété** des notes liées, et le **calcul**. **Nombre avec condition** et **Pourcentage avec condition** ajoutent une **condition** — avec les mêmes opérateurs que les filtres.
- **Calculs** : nombre · nombre avec condition · pourcentage avec condition · somme · moyenne · médiane · valeur minimale et maximale · date la plus ancienne et la plus récente · coché et non coché · avec et sans valeur · valeurs distinctes.
- **Aperçu** : pendant que vous la configurez, l'éditeur affiche les valeurs que cela produirait pour les premières entrées. Elles suivent le même chemin que la colonne finie, l'aperçu ne peut donc rien montrer d'autre que ce que le tableau affichera.
- **La valeur n'est jamais enregistrée.** Elle est calculée à chaque affichage — comme la relation inverse. Aucune note ne porte « 12 tâches ouvertes », donc aucune synchronisation ne peut traîner un chiffre périmé et aucun appareil ne peut en revendiquer un autre. La cellule n'est donc **pas modifiable** : ce que vous voulez changer, vous le changez dans les notes liées.
- **Rien à mesurer n'équivaut pas à zéro** : une somme sans la moindre valeur numérique reste vide au lieu d'afficher 0. **Nombre**, en revanche, compte des notes — un projet sans tâches a honnêtement 0.
- **Dans Obsidian**, la colonne reste vide : Obsidian ne connaît pas l'agrégation et affiche la base de données comme un tableau sans ces valeurs. Le fichier reste valide, rien n'est perdu.
- **Limite** : une agrégation ne calcule pas à partir d'une autre agrégation. Si le lien choisi pointe vers une colonne calculée, la nouvelle colonne reste vide.

## Pieds de colonne

Une colonne de tableau peut porter une ligne en dessous qui la résume — la **Somme** d'un effort, la date **Plus ancienne**, ou le nombre de lignes qui ont ne serait-ce qu'une valeur.

- **Réglage** : sous **Configurer → Colonnes**, choisissez un **Pied de colonne** à côté de la colonne. **Aucun pied de colonne** l'enlève à nouveau.
- **Calculs** : Moyenne · Min · Max · Somme · Étendue · Médiane · Écart-type · Plus ancienne · Plus récente · Cochées · Non cochées · Sans valeur · Avec valeur · Distinctes.
- **Le pied calcule sur les lignes que la vue affiche** — pas sur tout le vault. Un filtre modifie donc aussi le nombre en dessous.
- **Rien à mesurer n'équivaut pas à zéro** : une colonne sans la moindre valeur exploitable laisse son pied de colonne vide au lieu d'afficher 0. Une colonne sans pied de colonne propre reste vide et n'emprunte jamais le nombre de sa colonne voisine.
- **Visible dans Obsidian** : les pieds de colonne sont une fonctionnalité propre à Obsidian, pas un ajout de Plainva. Ce que vous réglez ici, vous le voyez là-bas — et inversement. Les expressions de formule personnalisées écrites dans Obsidian sont conservées dans le fichier ; Plainva ne leur affiche simplement aucune valeur.

## Planifier un projet : jalons, dépendances, charge

La vue chronologie transforme une base en plan. Quatre éléments le permettent, et tous vivent dans les notes, pas dans le fichier `.base` :

- **Un jalon** est une entrée avec une date et **sans fin**. La chronologie le dessine en losange plutôt qu'en barre — un instant, pas une période. Rien à activer : laissez la propriété de fin vide.
- **Les dépendances** disent « ceci ne peut pas commencer avant que cela soit terminé ». La propriété est `blockedBy` et sa forme suit **RFC 9253** — le vocabulaire que le plugin TaskNotes écrit déjà :

```yaml
blockedBy:
  - uid: "[[Projects/Rollout]]"
    reltype: FINISHTOSTART
    gap: P1D
```

  Une **seule** direction est enregistrée : une paire enregistrée, ce sont deux faits qui peuvent se contredire. Seul `FINISHTOSTART` est évalué et dessiné ; les autres types restent intacts dans le fichier. Un cycle est refusé à l'écriture, en nommant le chemin qu'il fermerait.
- **Un conflit est signalé, jamais corrigé.** Si une tâche commence avant la fin de celle qu'elle attend, la flèche devient rouge et le reste. Les dates sont votre affirmation — Plainva dit seulement que deux d'entre elles se contredisent.
- **La charge** est un simple nombre de minutes, dans une propriété de votre choix (le modèle **Projet** l'appelle `effort`). Un pied de colonne la totalise ; un cumul l'additionne sur les tâches d'un projet.
- **Le temps réel** n'est *pas* enregistré. Il est lu depuis les rendez-vous que la tâche a bloqués, et reste donc juste quand vous déplacez ou redimensionnez le rendez-vous. Sans compte d'agenda, la colonne affiche un tiret plutôt qu'un zéro : « non mesuré » et « mesuré, et c'était rien » sont deux affirmations différentes.

## Où cette note a-t-elle sa place ? (contexte de base de données)

Quand vous ouvrez directement une entrée de base de données — depuis l'arborescence de fichiers, depuis la recherche ou via un `[[lien]]` — Plainva vous indique désormais de quoi elle fait partie :

- Au-dessus de la note se trouve une **ligne de contexte** : les bases de données auxquelles appartient la note, sous forme de puces cliquables (un clic ouvre la base de données), suivies du chemin `entrée parente / cette note` lorsque la base de données utilise des sous-éléments. Si la note appartient à **plusieurs** bases de données, elles apparaissent toutes — la ligne passe alors à la ligne plutôt que d'en omettre une.
- Dans la barre latérale droite, la section **Bases de données** est l'**inspecteur d'entrée** : elle montre la note telle que sa base de données la voit — les colonnes de la première vue, dans l'ordre de cette vue, avec les types et les couleurs d'options de la `.base`, et **modifiable** comme dans le tableau. Un statut peut ainsi être changé sans ouvrir la base de données. Au-dessus se trouve la position dans la vue (**12 / 34**) avec des flèches vers l'entrée précédente et suivante. Une note qui appartient à plusieurs bases de données obtient un bloc par base de données. En dessous suivent l'**entrée parente**, les **sous-éléments** (repliables) et les entrées **liées** par des relations — chacune cliquable.
- La position n'apparaît que lorsque la note **est** effectivement dans la vue : l'appartenance à une base de données ne dépend délibérément pas des filtres d'une vue, les deux peuvent donc légitimement diverger.
- Le panneau **Propriétés** reste utile à côté : il montre le frontmatter brut — tous les champs, sans l'ordre, les types ni les filtres de la base de données.
- Si une note n'appartient à aucune base de données, ni la ligne ni la section n'apparaissent. Rien de tout cela n'est écrit dans la note : le contexte est recalculé à partir de vos fichiers `.base` et de vos liens à chaque ouverture, et la note elle-même reste du Markdown ordinaire.

## Créer de nouveaux éléments

Le bouton **Entrée** en haut à gauche (auparavant **Nouveau** ; clairement distinct du **Nouveau** global de la barre latérale) crée un nouvel élément :

- Le nom du fichier suit le modèle `{nom de la base de données}_{numéro séquentiel}` (les espaces deviennent `_`) ; la note commence par un titre correspondant et hérite des sources de tags et des valeurs de filtre simples de la base de données afin d'apparaître immédiatement dans la vue. La fenêtre d'aperçu s'ouvre ensuite pour le remplissage.
- **Dossier de stockage** : les nouveaux éléments atterrissent toujours dans un dossier désigné. Si la base de données n'a pas de source de dossier, un dialogue vous guide une fois pour en créer un ; avec plusieurs sources de dossiers, vous choisissez une fois. Modifiez-le à tout moment via le menu flèche du bouton → **Changer de dossier de stockage…**.
- **Modèles** : le menu flèche (**Modèles et dossier de stockage**) liste les modèles du dossier de modèles de votre vault — utilisez-en un ponctuellement, marquez-en un d'une étoile via **Définir par défaut** (chaque clic sur **Entrée** de cette base de données l'utilise alors), ou **Créer un modèle** (un nouveau modèle commence par un titre `# {{title}}`, de sorte que les éléments créés à partir de lui héritent de leur nom de fichier comme titre H1). Le même menu propose aussi **Ouvrir le dossier des modèles**, qui affiche le dossier des modèles dans l'arborescence des fichiers — les modèles sont des notes ordinaires que vous pouvez y modifier, renommer ou supprimer.
- **Modèles par base de données** : des modèles peuvent être associés à des bases de données. Par défaut, le menu flèche n'affiche que les modèles associés à cette base de données (plus son modèle par défaut) ; tout le reste est accessible via **Afficher tous les modèles (n)**. Associez-les directement là — l'icône de base de données de chaque ligne indique **Associer à cette base de données** ou **Retirer l’association à cette base de données** — ou depuis le modèle lui-même : le menu **⋮** de l'éditeur propose **Bases de données cibles…**, une boîte de dialogue avec un champ de recherche où vous associez le modèle à un nombre quelconque de bases de données. Un modèle créé depuis une base de données via **Créer un modèle** lui est associé dès le départ. L'association est stockée comme une liste `plainva.templateFor` dans le frontmatter du modèle (voir la [Référence du format de fichier](File_Format_Reference.md)) ; elle n'est jamais copiée dans les éléments créés à partir du modèle, et renommer une `.base` conserve les associations. La commande slash **Insérer un modèle** reste volontairement non filtrée — elle insère du texte dans une note existante et n'a pas de contexte de base de données.
- **Listes de tâches** : si la base de données est une base de tâches et que vous avez connecté un compte calendrier/tâches, **Configurer → Source de données** affiche la ligne **Créer aussi les nouvelles tâches dans**. Choisissez-y une liste, et chaque tâche créée dans Plainva est aussi créée dans cette liste chez le fournisseur — depuis **+ Nouvelle tâche**, depuis une case à cocher déplacée et depuis un courrier capturé comme tâche, de la même manière ; sans ce choix, elle reste une simple note, comme avant. Le choix appartient à la base de données (stocké sous `plainva.taskList`, voir la [Référence du format de fichier](File_Format_Reference.md)), pas à la tâche individuelle, et la ligne n'apparaît que lorsqu'un compte propose effectivement une liste de tâches. Si la liste choisie disparaît ensuite (compte supprimé, liste supprimée), Plainva ne crée pas la tâche ailleurs — elle traite la base de données comme si rien n'avait été choisi. La nouvelle tâche retient quelle tâche chez le fournisseur lui appartient ; sans cette note, la prochaine synchronisation créerait une seconde note pour la même tâche. Si la création chez le fournisseur échoue, la note reste et Plainva le signale — la note est le livrable, la tâche chez le fournisseur l'ajout.
- **Espaces réservés des modèles** : les modèles interpolent `{{title}}`, `{{date}}` et `{{time}}`. Quand vous *insérez* un modèle dans une note (commande slash **Insérer un modèle** / `Mod+Alt+T`), deux autres sont résolus : `{{cursor}}` marque l'endroit où le curseur atterrit après l'insertion, et `{{prompt:Libellé}}` vous demande une valeur (intitulée *Libellé*) et insère votre réponse. Créer une *nouvelle* note à partir d'un modèle se comporte désormais de la même façon : Plainva demande en une seule fois toutes les valeurs `{{prompt:…}}` et place le curseur sur `{{cursor}}` à l'ouverture de la note. Seuls les chemins en arrière-plan (synchronisation des tâches, capture de courrier) ne sont jamais interrogés : là, les réponses restent vides. La liste complète des espaces réservés se trouve dans [Notes & Markdown](Notes_and_Markdown.md).
- **Renommer, dupliquer, supprimer** : un clic droit sur une entrée propose dans chaque vue (tableau, liste, cartes, tableau kanban, calendrier, chronologie) **Ouvrir**, **Ouvrir dans le volet**, **Renommer…**, **Dupliquer** et **Supprimer…** — la suppression passe par le dialogue en cascade habituel. Les mêmes actions figurent dans le menu ⋮ de la fenêtre d'aperçu, et un double-clic sur son titre renomme aussi. Si le titre reflète encore le nom du fichier (l'état d'une entrée `{nom de la base}_{numéro}` fraîche), il suit le renommage ; un titre que vous avez écrit n'est jamais modifié.

## Tableau d'affichage (notes autocollantes façon Google Keep)

Le type de vue **Tableau d'affichage** montre les notes de la base de données sous forme de cartes avec leur contenu rendu — un tableau plein de notes autocollantes. Les cartes affichent le texte, les listes et des cases à cocher cliquables (un clic coche la tâche directement dans la note), les images et la mise en forme ; les tableaux, formules et éléments intégrés apparaissent comme de discrets espaces réservés. Cliquer sur une carte ouvre la note dans la fenêtre d'aperçu.

- **Capture rapide** : le champ **Écrire une note…** au-dessus du tableau se déploie en une petite fenêtre pop-up avec un champ **Titre** et un texte de note multiligne — comme Google Keep. Un titre saisi devient le nom du fichier ET le premier titre de la note ; sans titre, le fichier reçoit un nom horodaté et la note n'a pas de titre. Le texte est le contenu dans les deux cas — pas de modèle, pas de détour (Ctrl/Cmd+Entrée enregistre).
- **Épingler** : le bouton d'épingle (en haut à droite au survol d'une carte) fait passer une carte dans la section **Épinglées**.
- **Organiser** : faites glisser les cartes pour les réordonner ; l'ordre vit dans le fichier `.base` et se synchronise avec lui. Les cartes pas encore organisées (capturées récemment ou créées en dehors de Plainva) apparaissent en haut, les plus récentes en premier. Si une règle de tri est définie sous **Configurer**, elle prend le dessus — le glisser-déposer est alors désactivé.
- **Libellés** : la barre de puces au-dessus du tableau filtre les cartes — par tags par défaut, commutable vers une propriété à sélection multiple (**Configurer** → **Source des libellés**). Plusieurs puces se combinent avec un ET logique ; la sélection est éphémère et n'est jamais écrite dans le fichier. Modifiez les libellés d'une carte via **Libellés** dans le menu contextuel de la carte.
- **Couleur** : le menu contextuel teinte la carte. La couleur est la couleur d'en-tête de la note (`plainva.header_color`) — elle s'applique partout où la note apparaît, y compris dans l'en-tête de l'éditeur.
- **Propriétés** : les propriétés cochées sous **Configurer** → **Propriétés** s'affichent sous forme de lignes compactes en bas de chaque carte — les dates suivent le format de date de la vue, les valeurs vides sont ignorées.
- **Mobile** : sur le téléphone, une pression simple ouvre la note, un appui long affiche les actions (épingler, libellés, couleur, supprimer), et faire glisser après un appui long réordonne. Astuce : pointez la base de données vers votre dossier de boîte de réception (**Paramètres** → **Dossiers**) et les notes rapides du ＋ ainsi que les textes partagés depuis d'autres applications atterrissent directement sur le tableau.

Remarque pour les vaults synchronisés : si deux appareils organisent le tableau en même temps, une copie `.CONFLICT` du fichier `.base` peut apparaître — seule l'organisation est affectée, jamais le contenu des notes ; supprimez ou fusionnez la copie.

## Utilisation au quotidien

- **Édition en ligne** : un simple clic dans une cellule (ou sur une valeur de carte) la rend modifiable — dans toutes les vues.
- **Ouvrir** : cliquer sur le titre d'un élément ouvre la note dans la fenêtre d'aperçu — une fenêtre flottante que vous pouvez déplacer par sa barre de titre et redimensionner depuis le coin. Elle conserve son propre historique **Retour**/**Avancer** pour les notes que vous y ouvrez, propose un bouton qui bascule l'affichage d'une colonne **Propriétés** pour la note affichée, et offre **Ouvrir en onglet** et **Ouvrir dans la vue scindée**. `Ctrl`+clic ouvre directement dans la vue scindée ; vous pouvez aussi faire glisser une carte sur la zone de dépôt **Déposer ici : ouvrir dans la vue scindée**. La colonne des propriétés se redimensionne en tirant son bord gauche (232 px minimum) ; en dessous de 280 px, l'étiquette passe au-dessus de la valeur, comme dans la barre latérale droite.
- **Glisser-déposer** : pendant le glissement de cartes (Kanban, Calendrier, Chronologie), une carte fantôme suit le pointeur. Dans un **Kanban**, vous pouvez aussi faire glisser un **en-tête de colonne** pour réordonner les colonnes — pour les boards **Sélection**/**Statut**, cela réordonne les options de la propriété (les listes déroulantes suivent partout) ; les boards de relation et de texte libre mémorisent l'ordre par vue.
- **Couleur du Kanban** : dans les paramètres **Vue** d'un Kanban, **Couleur de colonne** permet à une colonne de prendre la couleur de son groupe — soit **Colonne entière** (toute la colonne est teintée), soit **Puce seulement** (seulement la puce de l'en-tête, par défaut). S'applique aux groupes Sélection/Statut/Sélection multiple.
- **Intégration** : les bases de données peuvent être intégrées dans des notes (commande slash **Intégrer une base de données** ou `@` → **Bases de données**) et y être utilisées avec toutes leurs fonctionnalités.
- **Portée automatique dans un élément lié** : quand vous intégrez une base de données à l'intérieur d'un seul élément d'une base de données *liée*, elle se filtre automatiquement sur cet élément — intégrez la base de données des tâches dans la note d'un projet et vous ne voyez que les tâches de ce projet. Cela fonctionne dans les deux sens (intégrez le côté « plusieurs » pour voir les lignes qui pointent vers l'élément hôte, ou le côté « un » pour voir ce vers quoi l'hôte pointe) et pour les bases de données en auto-relation avec une hiérarchie parent/sous-éléments (l'intégrer à l'intérieur d'un élément affiche les sous-éléments de cet élément, imbriqués). Un petit badge **Filtre** dans l'en-tête de la base de données intégrée indique sur quoi porte la portée ; utilisez-le pour changer de relation ou choisir **Tout afficher**. La portée n'est jamais écrite dans le fichier `.base`, de sorte que la même base de données affiche les bonnes lignes dans chaque élément où elle est intégrée.
- **Les nouvelles entrées héritent du lien** : créer une entrée avec **Entrée** à l'intérieur d'une telle intégration à portée automatique la lie automatiquement à l'élément hôte (une tâche que vous créez dans la liste des tâches intégrée d'un projet appartient immédiatement à ce projet). Dans le sens inverse, c'est l'hôte qui est lié à la nouvelle entrée à la place ; une relation à valeur unique déjà définie reste inchangée.
- **Filtre explicite « Cette note » (comme le filtre « cette page » de Notion)** : plutôt que de compter sur la portée automatique, vous pouvez la rendre explicite et permanente. Dans **Configurer → Filtre**, ajoutez une règle sur une propriété de relation et choisissez la valeur **Cette note**. La base de données se filtre alors sur la note dans laquelle elle est intégrée, quelle qu'elle soit — idéal pour les **modèles** : intégrez la base de données des tâches dans un modèle de projet, et chaque projet créé à partir de celui-ci affiche ses propres tâches. Cela fonctionne pour toute propriété de lien wiki, pas seulement les relations détectées, et un filtre **Cette note** explicite prend le pas sur la portée automatique. Ce filtre ne vit que dans Plainva (il n'est pas écrit dans le fichier `.base` comme un filtre normal), de sorte qu'Obsidian et une ouverture autonome affichent toutes les lignes.
- **Commentaires sur une cellule** : lorsqu'une propriété porte des annotations, sa cellule affiche un petit point avec le nombre de fils ouverts — dans **Tableau**, **Tableau kanban** et **Galerie**. Un commentaire tient à la **note et à sa clé de propriété**, pas au `.base` : la même annotation apparaît donc dans chaque base de données qui montre la note, ainsi que dans le panneau **Propriétés** de la note elle-même. **Commenter cette propriété** dans le menu de la cellule ouvre un nouveau fil. Renommer une colonne emmène les commentaires ; si la propriété est supprimée, la carte reste lisible et nomme la valeur qu'elle avait enregistrée. Plus de détails sous [Sécurité et partage](Security_and_Sharing.md).

## Plusieurs éléments à la fois

Parfois, un changement ne concerne pas un élément, mais douze.

**Commentaires sur une propriété** : quand une cellule porte une petite bulle avec un chiffre, une remarque est attachée à cette propriété — un clic dessus ouvre l’entrée sur la carte correspondante. Vous en commencez une nouvelle par un clic droit sur la cellule, **Commenter la propriété** ; sur le téléphone, la même entrée se trouve au bas de la feuille qu’ouvre un appui sur la cellule. Elle est écrite sur la note, pas sur la base de données : la même remarque apparaît dans chaque vue qui montre cette propriété, et dans le panneau des propriétés de la note.

**Sélectionner (bureau)** : Dans le **tableau** et la **liste**, chaque ligne a une case à cocher devant elle. Elle reste discrète jusqu'à ce que vous en ayez besoin : elle apparaît quand le pointeur survole la ligne, quand le clavier l'atteint, et pour toutes les lignes dès qu'une sélection existe. `Shift`+clic sélectionne une plage, la case à cocher de l'en-tête sélectionne tout. Un clic dans une **cellule** continue de la modifier — la sélection ne lui retire pas ce clic. Un clic sur une case cochée désélectionne la ligne ; avec **Maj**, vous étendez la sélection jusqu’à la ligne cliquée.

**Sélectionner (téléphone)** : Maintenez une ligne appuyée et choisissez **Sélectionner plusieurs** — c'est le premier élément de la feuille. Ensuite, un tap sélectionne au lieu d'ouvrir, jusqu'à ce que vous effaciez la sélection.

Tant que quelque chose est sélectionné, une barre remplace la barre d'outils et indique le nombre d'éléments concernés.

- **Supprimer** : UNE seule question est posée, pas douze — et c'est la même question en cascade qu'une suppression individuelle (voir ci-dessous). Sur le bureau, la touche `Suppr` fait de même ; pendant que vous tapez dans un champ, la touche appartient au champ.
- **Définir une valeur** : **Définir une valeur…** demande une propriété, puis affiche l'éditeur correspondant à son type. Sur le téléphone, ce sont deux feuilles, et la liste des propriétés indique **actuellement mixte** là où les éléments sélectionnés divergent. Une valeur vide **retire** la propriété, exactement comme vider une cellule.

Pendant l'opération, vous voyez la progression (« 7 sur 24 ») et pouvez l'annuler — ce qui a déjà été écrit reste et est signalé. Un seul fichier en échec n'arrête pas l'opération : à la fin, on vous indique combien ont été modifiés et combien ne l'ont pas été. Si le changement touche une grande part de la vue, la même seconde question qu'à la suppression apparaît.

**La limite, délibérément** : définir une valeur fonctionne pour les propriétés à *une seule* valeur — texte, nombre, case à cocher, date, sélection, statut, e-mail, téléphone. **Pas** pour les tags, listes, sélections multiples et relations : là, « tout mettre à X » signifierait que chaque valeur existante disparaît. Cela nécessite ses propres opérations d'*ajout* et de *retrait*, et viendra plus tard.

## Supprimer avec des liens (suppression en cascade)

Lorsque vous supprimez quelque chose dont dépendent d'autres éléments, Plainva affiche un aperçu au lieu d'une simple question oui/non :

- **Élément avec des éléments associés** (par ex. un projet vers lequel pointent des tâches via une relation) : le dialogue liste les éléments associés — y compris leurs propres sous-éléments — regroupés par base de données d'origine, avec la question **Supprimer aussi les éléments associés**. Les éléments **partagés** (également associés à un autre élément) sont exclus par défaut et portent un badge du type « aussi « Campagne T3 » ».
- **Supprimer toute une base de données** : quand vous supprimez une `.base`, le dialogue demande si **tous les éléments** de la base de données doivent aussi disparaître (**Supprimer aussi tous les éléments**). Les éléments qui sont aussi des lignes d'une *autre* base de données sont exclus par défaut. Les vues d'ensemble de dossier (`index.md`) et les pièces jointes restent toujours.
- **Bases de données liées** : chaque base de données liée par une relation reçoit sa propre carte clairement nommée avec deux étapes — d'abord uniquement les éléments **associés**, éventuellement **toute** la base de données (fichier plus tous les éléments). Les deux étapes sont **désactivées** par défaut : rien d'une base de données liée n'est supprimé sans votre coche explicite.

**Afficher les éléments** ouvre une liste par groupe avec une case à cocher par élément, pour que vous puissiez conserver certains éléments. Le bouton rouge compte en direct (« Supprimer 15 fichiers »). **Nettoyer les références** (activé par défaut) retire des propriétés des notes restantes les références aux éléments supprimés ; les liens dans le corps du texte restent inchangés. Au-delà du seuil habituel de suppression en masse, la seconde confirmation de sécurité apparaît aussi, et avec la synchronisation active, la suppression atteint également le cloud. Chaque fichier supprimé conserve un instantané de version — récupérable via **Restaurer les fichiers supprimés**. Si la base de données définie comme **Base de tâches par défaut** est supprimée, Plainva réinitialise ce paramètre et retire les associations de modèles ; les tâches chez Google/Microsoft restent inchangées. Sur le téléphone, le même aperçu apparaît sous forme de feuille avec des cases à cocher par groupe et un compteur (sans désélection par élément).

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

## Le calendrier d'une base : mois, semaine, jour

La vue calendrier affiche trois périodes — **Mois**, **Semaine** et **Jour**. Le sélecteur se trouve en haut à côté d'**Aujourd'hui** ; ◀ et ▶ se déplacent toujours de la période affichée. Le changement conserve le jour que vous regardez : de **Mois** à **Semaine**, vous voyez la semaine qui contient ce jour.

Si la colonne de date porte une **heure**, celle-ci apparaît devant le titre et les entrées d'un jour sont triées par l'horloge — celles sans heure viennent ensuite. Le **début de semaine** suit votre réglage sous **Apparence**, exactement comme dans le vrai calendrier.

Si la vue possède aussi une **date de fin** (Configurer → Vue), une entrée sur plusieurs jours est dessinée comme **une barre** couvrant ses jours, et non comme une chaîne de cartes identiques. Là où elle quitte la semaine, la barre est coupée au bord et se poursuit sans répéter son titre.

## La chronologie : barres, bords, couleur

La chronologie affiche **une ligne par entrée** et, dedans, une **barre** de sa date de début à sa date de fin. En haut vous basculez entre **Semaine**, **3 semaines** et **Trimestre** ; une ligne verticale marque **aujourd'hui** sur toutes les lignes.

**Les bords d'une barre sont des poignées.** Tirez le bord droit et Plainva écrit la **date de fin** dans la note ; le bord gauche écrit la **date de début**. Tirez la barre elle-même et les deux dates se déplacent ensemble — sa longueur reste ce qu'elle était. Deux choses qu'aucun geste ne peut forcer : un bord ne franchit jamais l'autre (une fin avant son début serait un enregistrement cassé), et sans **date de fin** configurée aucune n'est inventée — seul le début peut alors bouger.

Une barre qui dépasse la période affichée est coupée au bord et n'y porte **aucune poignée** : ce que vous voyez est le bord de la fenêtre, pas la fin de l'entrée.

**Couleur selon une propriété :** dans Configurer → Vue, choisissez une propriété de type sélection, statut ou sélection multiple sous **Couleur selon**. Les barres prennent alors la couleur de leur valeur — la même qu'elle porte en pastille et sur le tableau. Sans ce choix, toutes les barres gardent la couleur d'accentuation.
