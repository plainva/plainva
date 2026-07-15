# Référence du format de fichier

Dernière mise à jour : 2026-07-15

Cette page est le contrat précis, tel qu'il est stocké sur le disque, pour **chaque fichier d'un vault Plainva**. Elle est écrite pour qu'un outil — un autre programme, un script ou un assistant IA — puisse lire et modifier en toute sécurité les fichiers du vault directement, sans passer par l'interface de Plainva. Si vous utilisez seulement l'application, vous n'avez jamais besoin de cette page ; les [autres pages du guide](README.md) couvrent l'usage normal.

Tout ici est du texte UTF-8 pur. Les notes sont du Markdown avec un frontmatter YAML ; les bases de données sont du YAML. Rien n'est propriétaire, rien n'est caché.

## Règles d'or (à lire en premier)

1. **La note est la source de vérité. Une `.base` n'est qu'une vue.** Les *valeurs* des propriétés vivent dans le frontmatter des notes individuelles — jamais dans la `.base`. Pour changer une valeur, modifiez la note.
2. **Les notes restent natives d'Obsidian.** Dans le frontmatter d'une note, n'écrivez que des scalaires et des listes simples (chaîne, nombre, booléen, date ISO, liste YAML). N'écrivez jamais un objet imbriqué ou un indicateur « actif/sélectionné » dans une note.
3. **Une `.base` n'utilise que les quatre clés de premier niveau d'Obsidian** (`filters`, `formulas`, `properties`, `views`). Ajouter toute autre clé de premier niveau amène Obsidian à rejeter le fichier entier. Toutes les données propres à Plainva vont sous des sous-clés imbriquées `plainva:`.
4. **Préservez ce que vous ne comprenez pas.** Les clés inconnues doivent survivre inchangées à un cycle de lecture/écriture. Ne « nettoyez » pas les clés que vous ne reconnaissez pas.
5. **Écrivez en UTF-8 sans BOM, avec des fins de ligne LF.**

## Le vault en un coup d'œil

Un vault est un dossier ordinaire. Les types de fichiers que vous rencontrerez :

| Fichier | Ce que c'est | Modifiable comme texte |
|---|---|---|
| `*.md` | Une note : frontmatter YAML + corps Markdown | Oui |
| `*.base` | Une vue de base de données sur des notes (YAML) | Oui |
| `index.md` | La table des matières gérée d'un dossier (nom réservé) | Oui, avec précaution — voir [index.md](#indexmd-table-des-matières-dun-dossier) |
| `log.md` | Nom réservé, actuellement inutilisé | Ne pas toucher |
| images, PDF, … | Pièces jointes | Non (binaire) |
| `.plainva/` | Le dossier interne de Plainva (sauvegardes, état) | **Non — ne jamais toucher** |

Les noms réservés `index.md` et `log.md` ne sont jamais des notes ordinaires ; ne créez pas de contenu normal sous ces noms.

---

## Notes (`.md`)

Une note est un fichier Markdown. Un bloc de frontmatter YAML optionnel (entre deux lignes `---`) tout en haut contient ses propriétés ; le corps Markdown suit.

```markdown
---
type: Note
okf_version: "0.1"
tags: [project, active]
status: In progress
due: 2026-07-20
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# My Project

A **bold** thought that links to [[Another Note]].

- [ ] First task
```

### Champs de frontmatter OKF

Plainva suit OKF (Open Knowledge Format), une convention minimale. Deux champs de premier niveau :

| Champ | Type | Signification |
|---|---|---|
| `type` | chaîne | Quel genre de document c'est (`Note`, `Daily Note`, `Project`, …). Le seul champ qu'OKF exige réellement. |
| `okf_version` | chaîne | La version de la convention selon laquelle le fichier a été écrit, p. ex. `"0.1"`. Mettez-la entre guillemets pour que YAML la garde comme chaîne. |

Un fichier **sans** `type` s'ouvre quand même normalement ; il est simplement « non conforme à OKF ». Un `okf_version` manquant à lui seul n'est pas une infraction. Quand vous créez une nouvelle note, ajouter `type` (et `okf_version`) est une bonne pratique. Voir [OKF](OKF.md) pour la justification complète.

### Sérialisation des valeurs de propriété

Chaque clé de frontmatter est une propriété. Écrivez la valeur dans la forme YAML native de son type :

| Type de propriété | Forme YAML | Exemple |
|---|---|---|
| Texte | chaîne scalaire | `title: Hello` |
| Nombre | nombre | `priority: 3` |
| Case à cocher | booléen | `done: true` |
| Date | chaîne de date ISO | `due: 2026-07-20` |
| Date & heure | chaîne de date-heure ISO | `at: 2026-07-20T14:30:00` |
| Liste | liste YAML de chaînes | `authors: [Ada, Alan]` |
| Tags | liste YAML de chaînes | `tags: [project, active]` |
| Sélection / Statut | chaîne scalaire unique | `status: Done` |
| Sélection multiple | liste YAML de chaînes | `labels: [urgent, later]` |
| URL / E-mail / Téléphone | chaîne scalaire | `site: https://example.org` |
| Relation (simple) | **chaîne** de lien wiki | `project: "[[Project Alpha]]"` |
| Relation (multiple) | liste YAML de chaînes de liens wiki | `related: ["[[A]]", "[[B]]"]` |

La valeur « active » d'une propriété Sélection/Statut est simplement ce scalaire brut. La *palette des options autorisées* et leurs couleurs ne vivent **pas** dans la note — elles vivent dans la `.base` qui la régit (voir [Options et couleurs](#options-et-couleurs)). Cela garde la note 100 % native d'Obsidian.

> Mettez les valeurs de lien wiki entre guillemets (`"[[X]]"`). Un `[[X]]` sans guillemets est une séquence de flux YAML et ne sera pas analysé comme vous le souhaitez.

### L'espace de noms `plainva:` dans les notes

Les extras de note propres à Plainva sont regroupés sous une seule clé `plainva:` afin que les autres éditeurs puissent les ignorer :

| Clé | Valeur | Signification |
|---|---|---|
| `icon` | grapheme emoji, ou `lucide:<nom-kebab>` | Icône du document (façon Notion) |
| `icon_color` | couleur hex (`#rgb` / `#rrggbb` / `#rrggbbaa`) | Teinte pour une icône `lucide:` (les emojis l'ignorent) |
| `header_color` | couleur hex | Bandeau d'en-tête pleine largeur |
| `tasks` | `false` | Exclut les cases à cocher de cette note de la [vue Tâches](Tasks.md) |

Toutes sont facultatives. Si vous n'en écrivez aucune, omettez entièrement la clé `plainva:`. Les valeurs invalides sont ignorées à la lecture, jamais traitées comme une erreur.

### Liens

- **Lien wiki :** `[[Nom de la note]]` — résolu par nom de note à travers tout le vault. Avec une ancre de titre : `[[Note#Section]]`. Avec un texte d'affichage : `[[Note|texte affiché]]`.
- **Lien Markdown :** `[texte](chemin/relatif.md)` fonctionne aussi.
- **Les backlinks** sont dérivés automatiquement, y compris depuis les liens wiki du frontmatter (c'est ce qui fait apparaître les relations comme des backlinks).

---

## Bases de données (`.base`)

Un fichier `.base` est du YAML. Il stocke une *vue* sur des notes — quelles notes (sources), comment les afficher (vues), comment filtrer et trier, et le schéma des colonnes. Il ne stocke **aucune valeur de note**. Le format est compatible avec le plugin Bases d'Obsidian.

### Règles strictes — en enfreindre une fait rejeter le fichier entier par Obsidian

- **Seulement ces clés de premier niveau :** `filters`, `formulas`, `properties`, `views`. N'ajoutez jamais une autre clé de premier niveau. (Historiquement, une clé `columns:` de premier niveau cassait chaque fichier — ne réintroduisez pas ce motif.)
- **Chaque vue a besoin d'un `name` en chaîne non vide.**
- **Un objet `filters` porte exactement un de `and` / `or` / `not` à chaque niveau** — jamais deux côte à côte.

Plainva lui-même répare les anciens fichiers qui enfreignent les deux dernières règles la prochaine fois qu'il les enregistre, mais un outil qui écrit directement doit les respecter dès le départ.

### Identifiants de propriété : quand utiliser le préfixe `note.`

C'est ce qui trompe le plus, donc c'est explicite :

| Où | Forme | Exemple |
|---|---|---|
| Clés de la map `properties:` | préfixée | `note.status`, `file.name` |
| Liste `order:` d'une vue | préfixée | `[file.name, note.status]` |
| `sort[].property` d'une vue | préfixée | `note.due` |
| À l'intérieur des expressions de **filtre** | **nue (bare)** | `status == "Done"` |
| À l'intérieur des sous-clés `plainva` (`groupBy`, `dateField`, `endField`, `subItemsProperty`) | **nue (bare)** | `groupBy: status` |

Règle empirique : les champs structurels *tournés vers Obsidian* utilisent `note.<key>` (et `file.<x>` pour les champs intégrés comme `file.name`, `file.folder`, `file.mtime`) ; tout ce qui est à l'intérieur d'une **formule de filtre** ou d'un **bloc `plainva`** utilise la clé de frontmatter nue.

### Clés de premier niveau

- **`filters`** — quelles notes appartiennent à cette base de données. Dans Plainva, cette clé ne contient que les **sources** (dossier/tag) ; les conditions de propriété sont stockées par vue, sous `views[i].filters`. Voir [Filtres](#filtres).
- **`properties`** — le schéma des colonnes, indexé par identifiant de propriété. Les sous-clés natives d'Obsidian comme `displayName` (l'étiquette d'en-tête de colonne) sont autorisées et préservées ; toute la richesse de Plainva vit sous `properties[id].plainva`.
- **`views`** — une liste ordonnée de vues. Chacune a besoin d'un `name` et d'un `type`.
- **`formulas`** — une fonctionnalité d'Obsidian. Plainva ne les crée pas mais les préserve sans les modifier.

### La carte des sous-clés `plainva:`

Tout ce qui est spécifique à Plainva est namespacé. Trois emplacements :

**`properties[<note.key>].plainva`** — par colonne :

| Clé | Valeur | Signification |
|---|---|---|
| `input` | un des types de saisie ci-dessous | Le type de champ de la colonne |
| `options` | liste d'objets d'option | Valeurs sélectionnées pour sélection/statut/sélection multiple |
| `relationBase` | chemin `.base` relatif au vault | Base de données cible de la relation (voir [Relations](#relations-le-contrat-à-deux-faces)) |
| `relationLimit` | `one` | Cardinalité : lien unique. Omettre pour illimité. |
| `reverseOf` | `{ base, property }` | Marque une colonne de **relation inverse calculée** (pas d'`input`) |

**`views[i].plainva`** — par vue :

| Clé | Valeur | Signification |
|---|---|---|
| `render` | `board` / `calendar` / `timeline` | Type de vue exclusif à Plainva (voir ci-dessous) |
| `groupBy` | clé de propriété nue | Colonne de regroupement du board |
| `dateField` | clé de propriété nue | Date de début du calendrier/de la chronologie |
| `endField` | clé de propriété nue | Date de fin de la chronologie |
| `coverImage` | clé de propriété nue | Propriété d'image de couverture de la galerie |
| `subItemsProperty` | clé de propriété nue | Colonne parente de l'auto-relation pour l'imbrication des sous-éléments |
| `widths` | map id → px | Largeurs de colonnes |
| `dateFormat` | chaîne | Format de date par vue (`default` est implicite — l'omettre) |

Outre le bloc `plainva`, une vue peut porter un objet natif **`views[i].filters`** — les **conditions de propriété par vue** (même grammaire à racine unique `and`/`or`/`not` que le `filters` de premier niveau). Plainva y stocke les conditions de propriété, un ensemble par vue, de sorte que chaque vue filtre indépendamment ; le `filters` de premier niveau ne conserve alors que les sources. Obsidian applique `views[i].filters` par vue nativement.

**`views[0].plainva`** — clés valables pour tout le fichier, autorisées **seulement sur la première vue** :

| Clé | Valeur | Signification |
|---|---|---|
| `fileIconColor` | couleur hex | Teinte de l'icône de la base de données (arborescence/onglets/en-tête) |
| `newItemFolder` | dossier relatif au vault | Où le bouton « Nouveau » stocke les nouveaux éléments |
| `newItemTemplate` | chemin `.md` relatif au vault | Modèle par défaut pour les nouveaux éléments |
| `contextFilters` | liste de clés de propriété nues | Filtres d'auto-référence (« cette note ») — voir plus bas |

`contextFilters` est l'équivalent, chez Plainva, du filtre « cette page » de Notion. Chaque entrée est une clé de propriété ; quand la base de données est intégrée dans une note, ses lignes sont filtrées sur cette note hôte via cette propriété (la portée est résolue via l'index des liens : une propriété porteuse de lien — relation ou simple lien wiki — fait correspondre les lignes qui pointent vers l'hôte, une colonne de relation inverse calculée fait correspondre ce vers quoi l'hôte pointe). Il n'est délibérément **pas** écrit dans les `filters` natifs, de sorte qu'Obsidian l'ignore et affiche toutes les lignes ; ouvert de façon autonome dans Plainva, il est également abandonné (faute d'hôte) et affiche toutes les lignes. Plusieurs entrées se combinent avec un ET logique.

### Types de saisie

`plainva.input` est un des suivants :

```
text  number  checkbox  date  datetime
select  status  multiselect
list  tags  url  email  phone
relation
```

Une colonne **inverse** calculée n'a **pas** d'`input` — elle est identifiée uniquement par `reverseOf`.

### Options et couleurs

Les colonnes Sélection/Statut/Sélection multiple peuvent porter une liste d'options sélectionnées. Chaque option :

```yaml
options:
  - value: Open          # required
    color: amber         # optional palette name (see below)
    group: Active        # optional; STATUS only — orders options into stages
  - value: Done
    color: green
    group: Closed
```

`color` est un **nom de palette**, pas une couleur CSS. Noms valides : `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink`. Une couleur inconnue retombe sur une couleur dérivée de la valeur.

### Types de vue

`views[i].type` sur le disque est un type natif d'Obsidian. Les rendus exclusifs à Plainva sont écrits comme `type: table` plus un indice `plainva.render`, de sorte qu'Obsidian les dégrade en simple tableau :

| Vous voulez | `type` sur le disque | `plainva.render` |
|---|---|---|
| Tableau | `table` | — |
| Liste | `list` | — |
| Galerie | `cards` | — |
| Board | `table` | `board` |
| Calendrier | `table` | `calendar` |
| Chronologie | `table` | `timeline` |

### Filtres

`filters` sélectionne quelles notes sont dans la base de données et les restreint.

**Les conditions de source** décident de l'appartenance :

- Dossier : `file.folder == "Path/To/Folder"` (relatif au vault ; le dossier racine est `""`).
- Tag : `file.hasTag("project")` (sans `#` en tête).

Plusieurs sources sont simplement plusieurs entrées. Aucun `filters` du tout = toutes les notes du vault.

**Où vivent les conditions de propriété :** au niveau du fichier, `filters` s'applique à toutes les vues. Plainva stocke au contraire les conditions de propriété **par vue** dans `views[i].filters` (même structure à racine unique) et ne conserve que les sources au niveau du fichier, de sorte que chaque vue puisse filtrer indépendamment. Les deux formes sont valides pour Obsidian ; un outil peut écrire l'une ou l'autre. Un ancien fichier avec des conditions de propriété au niveau du fichier fonctionne toujours — Plainva les répartit dans chaque vue au prochain enregistrement.

**Les conditions de propriété** utilisent des noms de propriété nus et ces opérateurs :

| Opérateur | Expression |
|---|---|
| égal à | `status == "Done"` |
| différent de | `status != "Done"` |
| contient | `contains(labels, "urgent")` |
| ne contient pas | `!contains(labels, "urgent")` |
| supérieur / inférieur | `priority > "2"`, `priority < "5"` |
| au moins / au plus | `priority >= "2"`, `priority <= "5"` |
| est vide | `status == ""` |
| n'est pas vide | `status != ""` |

**Structure (à racine unique !) :** un de `and` / `or` / `not`, dont les entrées sont des chaînes de condition — ou un niveau d'objets de groupe imbriqués `{and:[...]}` / `{or:[...]}` (groupes façon Notion). Exemple combinant une source, une condition et un groupe OR :

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
    - 'status != "Done"'
    - or:
        - 'priority == "1"'
        - 'priority == "2"'
```

### Une `.base` complète et annotée

```yaml
filters:
  and:
    - 'file.folder == "Projects"'          # source: notes in the Projects folder
properties:
  note.status:                             # column id is note.-prefixed
    displayName: Status                    # optional Obsidian column label
    plainva:
      input: status
      options:
        - value: Open
          color: amber
          group: Active
        - value: Done
          color: green
          group: Closed
views:
  - type: table                            # first view: also carries file-wide keys
    name: All projects                     # every view needs a name
    order: [file.name, note.status]        # order uses note.-prefixed ids
    plainva:
      fileIconColor: "#2f6f6f"
      newItemFolder: Projects
  - type: table                            # a board is a native table + render hint
    name: Board
    plainva:
      render: board
      groupBy: status                      # groupBy uses the BARE key
```

---

## Relations (le contrat à deux faces)

Une relation lie des notes entre elles. C'est la chose la plus sujette aux erreurs à écrire à la main, car elle s'étend sur **trois** endroits. Gardez ces trois cohérents.

1. **La valeur vit dans le frontmatter de la note source**, comme un lien wiki (ou une liste de liens wiki) :

   ```markdown
   ---
   type: Task
   project: "[[Project Alpha]]"
   ---
   ```

2. **La `.base` source déclare la colonne de relation** (`relationBase` = la base de données cible ; `relationLimit: one` pour un lien unique) :

   ```yaml
   properties:
     note.project:
       plainva:
         input: relation
         relationBase: Projects.base
         relationLimit: one
   ```

3. **La `.base` cible peut montrer l'inverse** avec une colonne **calculée**. Ses valeurs ne sont stockées **nulle part** — elles sont dérivées des liens des notes source :

   ```yaml
   properties:
     note.tasks:
       plainva:
         reverseOf:
           base: Tasks.base       # the source .base (vault-relative path)
           property: project      # the BARE source property key
   ```

### Exemple détaillé : Tâches ↔ Projets

**`Tasks.base`**

```yaml
filters:
  and:
    - 'file.folder == "Tasks"'
properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Open
          color: amber
        - value: Done
          color: green
  note.project:
    plainva:
      input: relation
      relationBase: Projects.base
      relationLimit: one
views:
  - type: table
    name: All tasks
    order: [file.name, note.status, note.project]
```

**`Projects.base`**

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
properties:
  note.tasks:
    plainva:
      reverseOf:
        base: Tasks.base
        property: project
views:
  - type: table
    name: All projects
    order: [file.name, note.tasks]
```

**`Tasks/Write proposal.md`**

```markdown
---
type: Task
okf_version: "0.1"
status: Open
project: "[[Project Alpha]]"
---
# Write proposal
```

**`Projects/Project Alpha.md`**

```markdown
---
type: Project
okf_version: "0.1"
---
# Project Alpha
```

Résultat : dans `Projects.base`, la colonne calculée `tasks` de **Project Alpha** liste « Write proposal », parce que le `project` de cette tâche renvoie vers elle. Notez que `Project Alpha.md` n'a **aucune** clé `tasks:` — le côté inverse est calculé, jamais stocké.

### À NE PAS FAIRE avec les relations

- **N'écrivez pas de valeurs inverses dans les notes.** Une colonne `reverseOf` est calculée. Écrire une clé `tasks:` dans `Project Alpha.md` est incorrect et ne survivra pas à un aller-retour.
- **Assurez-vous que les cibles des liens se résolvent.** `"[[Project Alpha]]"` doit correspondre à un nom de note existant, sinon le lien apparaît comme rompu.
- **Gardez les chemins relatifs au vault**, avec des barres obliques et sans `./` en tête (`Projects.base`, `DB/Projects.base`).
- **`reverseOf.property` est la clé source nue** (`project`), pas `note.project`.

### Auto-relations et sous-éléments

Pour une relation dont la cible est la même base de données, faites pointer `relationBase` vers cette même `.base`. Pour imbriquer des enfants sous des parents dans une vue tableau, définissez `views[i].plainva.subItemsProperty` sur la clé nue de relation parente. Les cycles sont gérés ; sous-éléments désactivés, les lignes restent plates et les valeurs sont conservées.

---

## `index.md` (table des matières d'un dossier)

`index.md` est un nom réservé pour la table des matières d'un dossier.

- **Seule la `index.md` racine peut porter un frontmatter**, et seulement `okf_version` (il marque le vault comme actif pour OKF). Une `index.md` non racine doit être **sans frontmatter** — un frontmatter là-bas est une infraction au nom réservé.
- Une `index.md` **gérée** par Plainva se termine par le marqueur `<!-- plainva:index generated -->` (un commentaire HTML, invisible en mode lecture). Sa présence signifie que Plainva garde le fichier à jour automatiquement. Si vous modifiez un tel fichier à la main, préservez le marqueur (et gardez la forme générée) ou retirez-le délibérément pour reprendre le fichier de façon permanente.
- Les listings générés sont des sections de liens sous la forme `* [Titre](url/relative) - description`.

Si vous générez un aperçu de dossier à la main, le choix sûr est de **ne pas** ajouter le marqueur — alors Plainva ne l'écrasera jamais.

---

### Vues graphe (`plainva.render: "graph"`)

Une vue graphe est stockée comme toute vue non native : `type: table` plus l'indice de rendu. Ses options vivent dans le MÊME espace de noms `views[i].plainva` :

```yaml
views:
  - type: table
    name: Net
    plainva:
      render: graph
      graphEdges: [projekt]        # clés de propriété de relation dessinées comme arêtes
      graphColorBy: status         # propriété sélection/statut -> couleur du nœud
      graphSizeBy: prio            # propriété nombre -> taille du nœud
      graphShowExternal: true      # inclure les cibles de relation hors de la vue
      graphShowIncoming: true      # inclure les relations d'AUTRES bases de données pointant vers celle-ci (p. ex. les tâches d'un projet)
```

Toutes les clés d'option du graphe sont facultatives ; omettez-les entièrement si elles ne sont pas définies. Obsidian affiche le même fichier comme un simple tableau et ne doit pas produire d'erreur.

Une vue **Board** (`plainva.render: "board"`) peut en outre porter `views[i].plainva.boardColumnOrder` — une liste de clés de colonnes de groupe (`__UNGROUPED__` marque la colonne sans valeur) qui mémorise un ordre de colonnes manuel. Les boards Sélection/Statut réordonnent à la place les `options` de la propriété. Omettez la clé si elle n'est pas définie.

## Ne pas toucher et sécurité

- **`.plainva/`** contient les sauvegardes et l'état interne. N'y lisez jamais de logique de programme et n'y écrivez jamais.
- **Les clés inconnues sont sacrées.** Quand vous réécrivez une `.base` ou une note, reportez chaque clé que vous n'aviez pas l'intention de changer. Plainva lui-même préserve les clés `.base` inconnues via une copie brute interne ; un rédacteur tiers devrait faire de même (analyser → ne changer que ce que vous voulez → sérialiser).
- **Les valeurs changent dans la note, pas dans la `.base`.** Pour définir une cellule, modifiez le frontmatter de la note. La `.base` décide seulement quelles notes et colonnes sont affichées.
- **N'ajoutez pas de clés `.base` de premier niveau** au-delà de `filters` / `formulas` / `properties` / `views`.
- **Encodage :** UTF-8 sans BOM, fins de ligne LF, partout.

## Voir aussi

- [Notes & Markdown](Notes_and_Markdown.md) — la même matière sous l'angle de l'écriture à la main dans l'application
- [Bases de données (.base)](Databases_Base.md) — les bases de données expliquées pour l'usage quotidien
- [OKF](OKF.md) — `type`, `okf_version`, index.md et la conversion du vault
