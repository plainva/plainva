# Tâches

Dernière mise à jour : 2026-09-20

La vue Tâches réunit en un seul endroit chaque case à cocher de votre vault : tous les éléments de liste `- [ ]` et `- [x]` de toutes vos notes, regroupés par la note où ils se trouvent. C'est la vue « qu'est-ce qu'il me reste à faire ? » sur du Markdown pur — aucun plugin, aucun fichier spécial.

## Pourquoi une vue séparée (et pas une `.base`)

Une [base de données (`.base`)](Databases_Base.md) fonctionne sur des notes entières — une ligne par note. Une case à cocher n'est qu'une seule *ligne* à l'intérieur d'une note, et une note peut en contenir plusieurs, donc une `.base` ne peut pas les lister. La vue Tâches est basée sur les lignes : elle lit directement les lignes de tâches, si bien qu'une seule note de projet avec dix sous-tâches en affiche bien dix.

## Ouvrir la vue Tâches

- Cliquez sur l'**icône de liste de tâches** dans la barre d'actions tout à gauche, ou
- ouvrez la **palette de commandes** (`Ctrl/Cmd+P`) et exécutez **Ouvrir les tâches**.

Elle s'ouvre comme un onglet, comme n'importe quelle note.

## Sur le téléphone

La vue Tâches existe aussi sur mobile. Vous l'ouvrez via le **▾** à côté du titre dans la barre supérieure, et vous pouvez la placer dans la barre de navigation (**Paramètres** → **Barre de navigation**).

Elle affiche les deux mêmes sections qu'au bureau : la **Base de tâches** en haut, la liste de cases à cocher **Depuis les notes** en dessous, avec les filtres **Ouvertes**/**Terminées**/**Toutes** et la recherche en texte libre. Cocher, **Changer le statut**, déplacer une case à cocher **vers la base de données**, **+ Nouvelle tâche**, **Bloquer du temps** et la **Répétition** fonctionnent comme décrit ci-dessus et écrivent les mêmes fichiers : la même note avec son frontmatter, le même `[[lien wiki]]` dans la ligne d'origine, la même règle sous `plainva.repeat`.

Quelle base de données votre vault utilise comme base de tâches se règle sur le téléphone, sous **Paramètres** → **Contenu et structure**. Le réglage voyage via la [synchronisation des paramètres](Sync_Setup.md), vous ne le choisissez donc qu'une seule fois, sur l'appareil de votre choix.

Les quatre filtres de la barre de bureau apparaissent sur le téléphone sous forme de puces au-dessus de la liste : **Dossier**, **Étiquette**, **Avec échéance** et **Afficher les masqués**. Des puces plutôt que des menus déroulants, car une barre de filtres au-dessus d'une liste déjà étroite coûte plus de place qu'elle n'en fait gagner — un appui ouvre le choix, un second l'efface à nouveau.

## Lire la liste

Les tâches sont regroupées par note ; le titre de la note est un en-tête sur lequel vous pouvez cliquer pour ouvrir la note. Chaque tâche affiche sa case à cocher et son texte, barré une fois qu'elle est terminée. Une **date d'échéance** écrite sous la forme `📅 2026-08-01` dans la ligne de tâche apparaît comme un petit badge.

## Filtrer

La barre en haut restreint la liste :

- **Ouvertes / Terminées / Toutes** — selon l'état de la case à cocher (commence sur **Ouvertes**). Ce filtre appartient à la liste **Toutes** ; les listes du planificateur **Aujourd'hui**, **À venir**, **Boîte de réception** et **Terminées** répondent à cette question par elles-mêmes.
- **Filtrer les tâches…** — texte libre ; correspond au texte de la tâche.
- **Tous les dossiers** — uniquement les tâches du dossier choisi (et de ses sous-dossiers).
- **Toutes les étiquettes** — uniquement les tâches portant un `#tag` en ligne choisi.
- **Avec échéance** — uniquement les tâches ayant une date `📅`.

Les étiquettes et les dates d'échéance sont lues directement dans la ligne de tâche — par exemple `- [ ] Payer la facture #finance 📅 2026-08-01`.

## Cocher des tâches

Cliquez sur la **case à cocher** d'une tâche pour basculer entre ouverte et terminée. La modification est réécrite directement dans la note (comme une écriture de fichier normale et sûre — seul le caractère `[ ]`/`[x]` change), si bien que la note, Obsidian et toute synchronisation restent en phase. Cliquez plutôt sur le **texte** de la tâche pour ouvrir la note et sauter à cette ligne.

Si une note a changé depuis la construction de la liste, un basculement obsolète est ignoré et la liste s'actualise — utilisez le bouton **actualiser** en haut à droite pour recharger à tout moment.

## Base de tâches par défaut

Les cases à cocher permettent de noter rapidement, mais parfois une ligne devient une « vraie » tâche — avec un statut, une échéance et sa propre note. Pour cela, choisissez une **Base de tâches par défaut** dans les paramètres, sous **Contenu et structure** : une [base de données (`.base`)](Databases_Base.md) où ces tâches vivent comme leurs propres notes. **Créer une base…** en prépare une toute faite (un dossier de stockage plus une `.base` avec une **colonne de case à cocher terminé** (`fait`), une colonne de statut, une colonne d'échéance, ainsi qu'une vue tableau, une vue kanban et une vue chronologie — la chronologie place chaque tâche à son jour d'échéance) ; vous pouvez tout aussi bien choisir une base de données existante. La propriété de case à cocher fait foi de l'achèvement d'une tâche (activée/désactivée, comme chez les fournisseurs) ; la colonne de statut reste cohérente lorsque vous la cochez. Une base de données sans colonne de case à cocher revient à la convention de statut : première option = ouvert, dernière = terminé.

Une fois définie, la vue Tâches affiche deux sections : les entrées de la **Base de tâches** en haut, et **Depuis les notes** en dessous — la liste de cases à cocher habituelle. Le statut est modifiable directement dans l'aperçu : la case à cocher est la propriété de case à cocher terminé de la note et la bascule (la colonne de statut suit), et cliquer sur la puce de statut ouvre un menu avec toutes les options (**Changer le statut**). Les filtres **Ouvertes**/**Terminées**/**Toutes** s'appliquent aux deux sections, et **Ouvrir comme base** saute vers la vue complète de la base de données avec son kanban et ses filtres. **Actualiser** déclenche en plus une véritable synchronisation avec le fournisseur quand des comptes sont connectés.

## Transformer une case à cocher en tâche de base de données

Chaque ligne de case à cocher porte une icône de base de données : **Déplacer vers la base de tâches**. Un clic

- crée une nouvelle note dans le dossier de stockage de la base de données (en utilisant son modèle par défaut, s'il y en a un),
- transfère une date `📅` dans la colonne d'échéance, définit la première option de statut pour les tâches ouvertes et enregistre les `#tags` de la ligne comme tags de la note,
- relie la nouvelle note à sa note d'origine via une propriété `source`, et
- remplace la ligne de case à cocher dans la note d'origine par un lien wiki vers la nouvelle note de tâche — l'élément reste lisible là où il a été écrit, et la tâche vit désormais dans la base de données.

**Clic droit** sur l'icône pour choisir une autre base de données comme cible à la place ; sans base de tâches par défaut, le clic ouvre directement ce sélecteur. Tout reste du Markdown pur : la nouvelle tâche est une note ordinaire avec un frontmatter, et le lien dans la note d'origine est un `[[lien wiki]]` normal.

**+ Nouvelle tâche** dans l'en-tête de la section place le curseur dans le champ de saisie au-dessus des listes (voir *Planificateur, saisie rapide, priorité et états* plus bas). La tâche est créée directement dans la base de tâches — même dossier de stockage, même modèle et mêmes valeurs par défaut qu'une case à cocher promue — et une notification propose **Ouvrir**. Les cases à cocher écrites dans une note restent dans cette note — elles ne deviennent des tâches de la base de données que lorsque vous les déplacez.

## Bloquer du temps pour une tâche

Une tâche a une date d'échéance et peut porter une **heure de la journée** (`2026-09-21T14:00`) — c'est à ce moment-là que Plainva vous le rappelle. Une heure est un instant, pas une durée. Lorsque vous voulez réserver un créneau pour l'une d'elles, Plainva crée un **événement** — c'est l'objet qui possède une plage horaire, s'affiche avec ses chevauchements dans la grille et se synchronise avec votre compte d'agenda.

L'icône d'agenda sur une ligne de tâche ouvre **Bloquer du temps** : la date (préremplie avec l'échéance), le début et la **Durée** (15 min, 30 min, 1 h, 2 h ou **Personnalisée**), plus un sélecteur d'agenda si plusieurs agendas acceptent l'écriture. L'événement reprend le titre de la tâche et renvoie vers la note. Un **clic droit** sur la ligne affiche les mêmes actions que la feuille sur le téléphone : terminée/ouverte, déplacer vers la base, répétition, bloquer du temps.

Pour une tâche issue de la base de données, la note mémorise aussi le blocage dans son frontmatter (`plainva.blocks`), de sorte que le lien est visible des deux côtés. Une ligne à cocher n'a pas de note propre — seul l'événement est créé, pointant vers la note qui contient la ligne. L'icône n'apparaît que si un compte d'agenda est connecté.

## Tâches récurrentes

Une tâche qui revient régulièrement reçoit une **répétition** via l'icône de répétition dans la section **Base de tâches**. Plainva ne crée pas de **série** : cocher la tâche crée la **suivante** comme sa propre note à côté de celle qui est terminée, avec la nouvelle échéance. Ainsi, il n'y a jamais qu'une seule tâche ouverte à la fois, celle qui est terminée reste comme trace de ce qui a été fait, et il n'existe pas de série invisible dont on pourrait tout supprimer par accident — supprimez une tâche et la chaîne s'arrête.

La boîte de dialogue propose trois choses :

- **Rythme** — Quotidienne, Hebdomadaire, Mensuelle ou Annuelle, plus l'intervalle sous **Tous les** (par exemple « Tous les 3 » + « Quotidienne » = tous les trois jours).
- **Compté à partir de : L'échéance** — une cadence fixe (« tous les lundis »). Cochez tardivement une tâche en retard et Plainva saute à la prochaine échéance **à venir** au lieu de remplir la liste avec celles que vous avez manquées.
- **Compté à partir de : L'achèvement** — le rythme démarre le jour où vous la cochez (« tous les trois jours après avoir arrosé les plantes »).

**Ne pas répéter** retire à nouveau la répétition. Les tâches mensuelles ne dépassent jamais la fin d'un mois : le 31 janvier plus un mois donne le 28 ou le 29 février, pas le 3 mars.

Dans le **calendrier**, une tâche récurrente n'apparaît donc qu'**une fois**, à sa date d'échéance actuelle, avec un symbole de répétition sur la ligne. Ce n'est pas un défaut, mais le revers du générateur : il n'existe pas de série dont le calendrier pourrait tirer d'autres occurrences, et des lignes sans note derrière elles ne pourraient pas s'ouvrir. Régler la répétition sur l'**événement lié** à la place (via **Bloquer du temps**) crée une véritable série d'événements : votre fournisseur la développe et vous voyez de nombreuses occurrences — mais cela ne crée **aucune tâche**, seulement des événements.

La règle vit dans le frontmatter de la note (`plainva.repeat`) et voyage donc avec votre synchronisation — pas dans un réglage caché de l'application, ni non plus comme colonne de la base de données, car elle appartient à **cette** tâche, et non à chaque entrée de la base de données. Les tâches reflétées depuis une liste de tâches de votre fournisseur n'offrent pas la répétition : elles se répètent là-bas, et un second rythme en plus renverrait des doublons vers le fournisseur.

## Masquer des notes de la vue Tâches

Certaines notes contiennent des cases à cocher qui ne sont jamais de « vraies » tâches — les **modèles** en premier lieu. Pour les tenir à l'écart de la liste, une note peut s'exclure elle-même. La vérité reste dans le fichier : l'exclusion est un champ de frontmatter dans la note, pas un réglage caché de l'application. Elle se synchronise, est visible dans Obsidian et peut être vérifiée avec n'importe quel éditeur de texte :

```yaml
---
plainva:
  tasks: false
---
```

Vous n'avez pas besoin d'écrire ce champ à la main :

- **Masquer des tâches** — une icône en forme d'œil se trouve à droite de la ligne d'en-tête de chaque note ; un clic écrit le marqueur dans cette note et la masque.
- **Afficher les masqués** — cette option dans la barre de filtres fait réapparaître les notes masquées (estompées), chacune avec une icône **Réafficher dans les tâches** qui retire le marqueur.
- **Masquer les modèles** — si votre dossier de modèles contient des notes avec des cases à cocher, un bouton **Masquer les modèles** apparaît en haut à droite et appose le marqueur sur toutes en une fois.

Les modèles nouvellement créés portent le marqueur automatiquement. Quand vous créez une note **à partir** d'un modèle, il est retiré à nouveau — la nouvelle note est du contenu réel et affiche normalement ses tâches.

## Compatibilité Obsidian

Les tâches sont des cases à cocher GFM (GitHub-Flavored Markdown) ordinaires. Plainva n'ajoute jamais de syntaxe spéciale : les mêmes lignes `- [ ]` se rendent comme des cases à cocher dans Obsidian et se lisent proprement dans n'importe quel éditeur. Les conventions `📅 date` et `#tag` correspondent au style courant d'Obsidian-Tasks, mais ce ne sont que du texte dans votre note.

## Voir aussi

- [Notes & Markdown](Notes_and_Markdown.md) — écrire des listes de tâches dans l'éditeur
- [Recherche](Search.md) — recherche en texte intégral dans tout le vault
- [Bases de données (.base)](Databases_Base.md) — bases de données au niveau des notes

## Terminer depuis la vue d’ensemble

Cocher une tâche dans la vue d’ensemble écrit la case dans la note source et actualise cette note dans l’index de recherche avant de relire la liste. La tâche quitte donc immédiatement **Ouvert** sans réapparaître depuis un ancien index.

<!-- accounts-tasks-2026-09-11 -->
## Séparer les tâches de même titre

Les tâches du fournisseur sont associées selon leur identité. Les occurrences distinctes ont leurs propres fichiers. Les faux conflits existants peuvent être conservés comme tâches séparées.

Ces fichiers correspondent à des tâches différentes. Des tâches récurrentes de même titre peuvent être des occurrences distinctes. Les deux contenus sont conservés séparément.

**Conserver comme tâches séparées** — Ce fichier reste inchangé : Fichier actuel  La copie en conflit est conservée dans un fichier séparé : copie de conflit

<!-- tasks-jex-2026-09-14 -->
## Métadonnées Tasks et répétition

Sur ordinateur, mobile et en aperçu direct : ➕ création, ✅ fin, 📅 échéance, ⏳ planification, 🛫 début, 🆔 ID et 🔁 répétition. Les dates utilisent YYYY-MM-DD. Les ID existants suivent les déplacements de lignes ; les données inconnues restent dans le Markdown.

Seules les règles anglaises `every [N] day/week/month/year[s] [when done]` (N : 1–999) sont automatiques. La fin avance d’une période, même encore en retard ; `when done` part du jour de fin. Les écarts entre dates sont conservés et les fins de mois limitées. Sans date, la suite reste sans date. Règles complexes, dépendances, ID de bloc ou en double, dates invalides, contenu indenté, répétition native et tâches de fournisseur désactivent cette génération.

Cocher ajoute la date de fin aux tâches avec métadonnées. Une répétition prise en charge ajoute si nécessaire un ID et donne à la suite un ID `pv-…`. Tout forme une seule modification Markdown, annulable dans l’éditeur. Rouvrir puis recocher conserve la suite existante et ses modifications.

Les tâches natives de base de données sautent toujours les périodes manquées. Un plan de destination enregistré empêche les doublons. Si la suite n’est pas confirmée, vérifiez le dossier ; rouvrir et recocher peut reprendre après une erreur d’écriture. Si la source a changé, aucune copie différente n’est produite : vérifiez les notes et créez la suite manuellement si nécessaire. Une suite confirmée puis supprimée n’est pas recréée.

## Retrouver les filtres des tâches

Le statut, le texte recherché, le dossier, l’étiquette, les tâches avec échéance et l’affichage des tâches masquées sont mémorisés par coffre sur cet appareil, même après ouverture d’une note ou redémarrage. « Réinitialiser les filtres » revient aux tâches ouvertes sans autre filtre. Les dossiers et étiquettes indisponibles restent visibles et peuvent être retirés dans leur sélecteur. Oublier le coffre efface cet état. La base de tâches par défaut reste le réglage du coffre ; les filtres ne sont pas synchronisés.

<!-- planner-capture-2026-09-20 -->
## Planificateur, saisie rapide, priorité et états

La vue Tâches s'ouvre sur **Aujourd'hui**. Les listes — une barre à gauche sur le bureau, un segment au-dessus de la liste sur le téléphone — sont **Aujourd'hui** (ce qui est dû aujourd'hui, avec **En retard** en haut), **À venir** (les 14 prochains jours, par jour), **Boîte de réception** (tâches ouvertes sans date), **Toutes** (les deux sections décrites ci-dessus, avec le filtre **Ouvertes**/**Terminées**/**Toutes**) et **Terminées**. Chaque liste puise dans les deux sources, la base de tâches et les cases à cocher de vos notes, triées par priorité, puis par heure, puis par titre. Les autres filtres s'appliquent à chaque liste, et la liste choisie est mémorisée par vault. Sur le bureau, la barre liste aussi les tags les plus fréquents comme filtres en un clic ; sur le téléphone, l'écran **Aujourd'hui** mène à l'**Aujourd'hui** du planificateur.

Au-dessus des listes se trouve le champ de saisie ; sur le téléphone, **+ Nouvelle tâche** et le bouton **＋** l'ouvrent sous forme de feuille. Tapez une ligne — `Envoyer offre demain 14h !!! #client chaque semaine` — et appuyez sur Entrée : Plainva crée la tâche dans la base de tâches. Il comprend aujourd'hui, demain, après-demain, les jours de la semaine, « dans 3 jours », « la semaine prochaine », les dates en chiffres, une heure (`14:30`, `14h`), un rythme (quotidien, hebdomadaire, mensuel, annuel, « chaque lundi », « toutes les 2 semaines »), `!`, `!!` et `!!!` pour une priorité basse, moyenne et haute, et `#tags` — les mots dans la langue de l'application, les chiffres et les signes dans n'importe quelle langue. Tout ce qui est reconnu est marqué dans le champ et listé en dessous sous la forme d'un bloc amovible **avant** que quoi que ce soit ne soit enregistré ; retirez un bloc et ses mots recomptent simplement comme titre. Sur le téléphone, des boutons rapides écrivent les mêmes mots pour vous. Si la base de tâches désigne une liste d'un fournisseur, une puce décide si la tâche y est créée aussi.

**Définir la priorité** dans le menu d'une ligne (clic droit sur le bureau, appui long sur le téléphone) propose **haute**, **moyenne**, **basse** et **aucune** ; un drapeau devant le titre l'indique. Dans la base de tâches, la priorité est une colonne à sélection : une base créée maintenant l'a déjà, une plus ancienne l'obtient la première fois que vous définissez une priorité — jamais par simple ouverture. Une case à cocher porte la marque du plugin Obsidian Tasks sur sa ligne : Plainva lit 🔺 et ⏫ comme haute, 🔼 comme moyenne, 🔽 et ⏬ comme basse, et écrit ⏫, 🔼 ou 🔽.

`- [/]` (**En cours**) et `- [-]` (**Annulée**) sont aussi des tâches. Elles reçoivent leur propre case dans l'éditeur, en mode lecture et dans chaque liste ; en cours compte comme ouverte, annulée comme fermée. Un clic continue de basculer seulement entre ouverte et terminée — il termine une tâche en cours et rouvre une tâche annulée. **Définir l'état** dans le menu de la ligne fixe les deux états ; Plainva ne les écrit jamais de lui-même.

D'autres façons d'y entrer : **Nouvelle tâche** dans le menu de la zone de notification sur le bureau (quand Plainva continue de tourner en arrière-plan), sur Android le raccourci du lanceur **Nouvelle tâche** (appui long sur l'icône de l'application), et sur le téléphone **Créer comme tâche** quand vous partagez quelque chose vers Plainva — le texte et les pièces jointes finissent dans la note de la tâche. La façon dont une tâche avec une heure vous le rappelle est décrite dans [Calendrier et tâches externes](Calendar_and_Tasks.md).
