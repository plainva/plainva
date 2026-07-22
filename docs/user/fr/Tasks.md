# Tâches

Dernière mise à jour : 2026-07-22

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

## Base de tâches par défaut

Les cases à cocher permettent de noter rapidement, mais parfois une ligne devient une « vraie » tâche — avec un statut, une échéance et sa propre note. Pour cela, choisissez une **Base de tâches par défaut** dans les paramètres, sous **Contenu et structure** : une [base de données (`.base`)](Databases_Base.md) où ces tâches vivent comme leurs propres notes. **Créer une base…** en prépare une toute faite (un dossier de stockage plus une `.base` avec une **colonne de case à cocher terminé** (`fait`), une colonne de statut, une colonne d'échéance, une vue tableau et une vue kanban) ; vous pouvez tout aussi bien choisir une base de données existante. La propriété de case à cocher fait foi de l'achèvement d'une tâche (activée/désactivée, comme chez les fournisseurs) ; la colonne de statut reste cohérente lorsque vous la cochez. Une base de données sans colonne de case à cocher revient à la convention de statut : première option = ouvert, dernière = terminé.

Une fois définie, la vue Tâches affiche deux sections : les entrées de la **Base de tâches** en haut, et **Depuis les notes** en dessous — la liste de cases à cocher habituelle. Le statut est modifiable directement dans l'aperçu : la case à cocher est la propriété de case à cocher terminé de la note et la bascule (la colonne de statut suit), et cliquer sur la puce de statut ouvre un menu avec toutes les options (**Changer le statut**). Les filtres **Ouvertes**/**Terminées**/**Toutes** s'appliquent aux deux sections, et **Ouvrir comme base** saute vers la vue complète de la base de données avec son kanban et ses filtres. **Actualiser** déclenche en plus une véritable synchronisation avec le fournisseur quand des comptes sont connectés.

## Transformer une case à cocher en tâche de base de données

Chaque ligne de case à cocher porte une icône de base de données : **Déplacer vers la base de tâches**. Un clic

- crée une nouvelle note dans le dossier de stockage de la base de données (en utilisant son modèle par défaut, s'il y en a un),
- transfère une date `📅` dans la colonne d'échéance, définit la première option de statut pour les tâches ouvertes et enregistre les `#tags` de la ligne comme tags de la note,
- relie la nouvelle note à sa note d'origine via une propriété `source`, et
- remplace la ligne de case à cocher dans la note d'origine par un lien wiki vers la nouvelle note de tâche — l'élément reste lisible là où il a été écrit, et la tâche vit désormais dans la base de données.

**Clic droit** sur l'icône pour choisir une autre base de données comme cible à la place ; sans base de tâches par défaut, le clic ouvre directement ce sélecteur. Tout reste du Markdown pur : la nouvelle tâche est une note ordinaire avec un frontmatter, et le lien dans la note d'origine est un `[[lien wiki]]` normal.

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
