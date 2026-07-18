# Notes & Markdown

Dernière mise à jour : 2026-07-18

Chaque note dans Plainva est un fichier Markdown ordinaire (`.md`). Cette page explique comment écrire confortablement et ce qui se retrouve réellement dans le fichier — car c'est exactement ce qui rend vos notes portables : n'importe quel éditeur de texte, Obsidian ou un diff git peut les lire.

## Le principe fondamental : tout est texte

Tout ce que vous voyez dans Plainva — texte mis en forme, tableaux, propriétés, icônes — est stocké comme du texte ouvert :

```markdown
---
type: Note
okf_version: "0.1"
tags: [projet]
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# Mon projet

Une pensée en **gras** avec un lien vers [[Autre note]].

- [ ] Première tâche
```

Le bloc entre les lignes `---` est le **frontmatter** (YAML) : c'est là que résident les propriétés de la note. En dessous vient le texte Markdown normal. La présentation propre à Plainva (icône, couleur d'en-tête) est regroupée sous la seule clé `plainva:` — les autres programmes l'ignorent simplement.

## Écrire en aperçu en direct

L'**aperçu en direct** est le mode par défaut : le Markdown se rend au fur et à mesure que vous tapez tout en restant modifiable à tout moment.

### Le menu slash

Tapez `/` en début de ligne pour ouvrir le menu d'insertion. Il est organisé en sections :

- **Blocs de base** — Texte, Titre 1–6, Liste à puces, Liste numérotée, Liste de tâches, Citation, Bloc de code, Tableau, Séparateur, **Formule (LaTeX)**, **Diagramme Mermaid**
- **Mise en forme** — Gras, Italique, Barré, Code en ligne, Surlignage, **Emoji**
- **Liens & médias** — Lien, Lien interne, Image (web), Image interne, Intégration, Intégrer une base de données, Créer une base de données intégrée
- **Document** — Icône du document, Couleur d'en-tête, Insérer un modèle
- **Callouts** — 13 variantes (Note, Info, À faire, Résumé, Conseil, Succès, Question, Avertissement, Échec, Danger, Bug, Exemple, Citation)

### Autres aides à l'écriture

- **Barre d'outils de sélection** — sélectionnez du texte et une petite barre propose **Gras**, **Italique**, **Barré**, **Code en ligne**, **Surlignage** et **Lien**.
- **Mentions `@`** — tapez `@` n'importe où dans le texte pour insérer une **Date** (Aujourd'hui, Demain, Hier, ou **Choisir une date…**, stockée comme date ISO), un lien vers une **Note**, ou une intégration de **Base de données**.
- **Emoji** — la commande slash **Emoji** (`/emoji`) ouvre un sélecteur d'emoji à l'endroit du curseur ; ou tapez `:name` (par exemple `:rocket`) pour des suggestions en ligne. Dans les deux cas, Plainva insère le **caractère** emoji réel (Unicode portable), jamais un `:shortcode:` — la note reste ainsi lisible dans Obsidian, sur GitHub et partout ailleurs. (Ceci est distinct de l'**icône du document** de la note, qui est stockée dans le frontmatter.)
- **Poignées de bloc** — une poignée apparaît à gauche de chaque paragraphe au survol : glissez-la pour déplacer le bloc, cliquez dessus pour ouvrir les **Actions de bloc** (**Transformer en** Texte/Titre/Liste/À faire/Citation/Bloc de code, **Dupliquer**, **Monter**/**Descendre**, **Supprimer le bloc**). Si vous glissez une liste à côté d'une autre liste du même type, Plainva insère une ligne de séparation invisible `<!-- -->` pour que les deux listes restent distinctes — en Markdown, des listes de même style fusionneraient sinon malgré la ligne vide (aussi dans Obsidian).
- **Tableaux** — rendus comme un widget avec des cellules éditables en un clic. L'affichage des cellules rend la mise en forme (**gras**, *italique*, `code`, surlignage), les liens cliquables (`[[Lien interne]]`, adresses web) et `<br>` comme un saut de ligne ; en édition, vous voyez le texte brut. Le menu du tableau propose l'insertion/suppression de lignes et de colonnes ainsi que l'alignement (**Aligner à gauche**/**Centrer**/**Aligner à droite**).
- **Les listes se poursuivent d'elles-mêmes** (Entrée insère la marque de liste suivante), les blocs de code bénéficient d'une coloration syntaxique selon le langage (aussi en mode lecture), le contenu collé est converti en Markdown (collage intelligent), et les titres peuvent être repliés.
- **Rechercher & remplacer** dans la note actuelle : `Ctrl+F` (voir [Recherche](Search.md)).

## Liens et backlinks

- **Liens internes** : `[[Nom de la note]]` (lien wiki) — via le menu slash ou `@` avec recherche de notes intégrée. Les liens Markdown classiques `[texte](chemin.md)` fonctionnent également.
- **Cibles qui n'existent pas encore** : un lien wiki vers une note qui n'a pas encore été créée s'affiche **atténué, avec un soulignement en tirets** (aussi bien en aperçu en direct qu'en mode lecture). **Cliquer dessus crée la note** et l'ouvre — elle est placée dans le dossier de la note actuelle (ou au chemin indiqué si le lien en contient un, par exemple `[[Dossier/Nouvelle note]]`). Pour être invité au préalable, activez **Paramètres → App → Éditeur et notes → Demander avant de créer des liens vides**.
- **Backlinks** : la section **Backlinks** dans la barre latérale droite montre quelles notes renvoient à la note active — regroupées par fichier source, avec un compteur pour les occurrences multiples.
- **Renommer avec soin des liens** : quand vous renommez un fichier dans l'arborescence de fichiers, Plainva met à jour tous les liens qui pointent vers lui dans tout le vault (les ancres comme `#Section` sont conservées) et signale : « N lien(s) dans M fichier(s) ont été mis à jour vers le nouveau nom. »

## Propriétés (frontmatter)

La section **Propriétés** dans la barre latérale droite montre le frontmatter de la note sous forme de formulaire. **Ajouter une propriété** en crée de nouvelles ; chaque propriété a un **type de champ** :

| Groupe | Types |
|---|---|
| **Essentiels** | Texte, Nombre, Case à cocher, Date, Date & heure |
| **Choix** | Sélection, Statut, Sélection multiple |
| **Listes & relations** | Liste, Tags, Relation |
| **Web & contact** | URL, E-mail, Téléphone |

Les types à choix peuvent porter des options fixes avec une **Couleur** et (pour **Statut**) un **Groupe**/une étape — ces listes d'options se gèrent dans les bases de données (`.base`), voir [Bases de données (.base)](Databases_Base.md).

Deux champs sont protégés : `type` et `okf_version` sont des **champs système OKF** gérés par Plainva — la valeur de `type` se choisit dans une liste déroulante de types connus, tandis que le nom/type de champ/suppression sont verrouillés (contexte : [OKF](OKF.md)).

## Icône du document et couleur d'en-tête

Chaque note peut porter une icône (façon Notion au-dessus du titre, visible aussi dans les onglets et l'arborescence de fichiers) et une bande de couleur pleine largeur :

- En aperçu en direct, survolez au-dessus du titre : **Ajouter une icône** / **Ajouter une couleur d'en-tête** (plus tard : **Changer l'icône** / **Changer la couleur d'en-tête**) — ou utilisez les commandes slash **Icône du document** et **Couleur d'en-tête**.
- Le sélecteur d'icônes a deux modes : **Emoji** et **Icônes** (le jeu d'icônes Lucide, avec une couleur sélectionnable).
- Les deux sont stockés dans le frontmatter sous `plainva:` (`icon`, `icon_color`, `header_color`) — pure présentation qui n'affecte pas les autres programmes.

## Modèles

Définissez un **Dossier de modèles** sous **Paramètres → Vault → Contenu et structure** (**Choisir un dossier…** à côté du champ permet de choisir le dossier directement dans le vault). Insérez ensuite des modèles via `Ctrl+Alt+T` ou la commande slash **Insérer un modèle**. Les modèles définissent entièrement le contenu des nouveaux fichiers — frontmatter compris : si un modèle apporte son propre `type`, le modèle l'emporte. Lors de l'insertion dans une note existante, le frontmatter du modèle est omis — seul le contenu est inséré.

**Espaces réservés** : les modèles interpolent `{{title}}` (le titre de la note), `{{date}}` et `{{time}}`. Lorsque vous *insérez* un modèle, deux de plus se résolvent : `{{cursor}}` indique où le curseur atterrit ensuite, et `{{prompt:Label}}` vous demande une valeur (affichée comme *Label*) et insère votre réponse. Créer une *nouvelle* note à partir d'un modèle supprime `{{cursor}}`, et `{{prompt:…}}` reste vide.

La création de modèles se fait depuis n'importe où : la palette de commandes (`Ctrl+P`) propose **Créer un modèle** (un nouveau modèle s'ouvre pour être modifié) et **Enregistrer la note actuelle comme modèle** (copie la note ouverte dans le dossier de modèles). Les modèles sont des fichiers Markdown ordinaires — modifiez-les, renommez-les ou supprimez-les directement dans l'arborescence de fichiers.

## Notes quotidiennes

**Ouvrir la note quotidienne** (barre latérale) ou un clic dans le **Calendrier** crée la note du jour selon votre format de date dans le dossier de notes quotidiennes configuré, éventuellement à partir d'un modèle.

## Tâches, formules, diagrammes et notes de bas de page

- **Cases à cocher de tâches** : `- [ ] tâche` se rend comme une case à cocher partout — et en **mode lecture**, vous pouvez cliquer dessus : Plainva réécrit `[x]` ou `[ ]` dans le fichier.
- **Formules mathématiques (LaTeX)** : `$E = mc^2$` en ligne et `$$…$$` en bloc se rendent comme des formules en mode lecture ET dans l'aperçu en direct (KaTeX). Quand le curseur se trouve dans une formule, la syntaxe est visible ; cliquer sur une formule rendue l'ouvre pour la modifier. Seul le mode source affiche toujours la syntaxe brute. Inutile de retenir par cœur le bloc `$$…$$` — la commande slash **Formule (LaTeX)** (`/katex`) l'insère et y place le curseur.
- **Diagrammes Mermaid** : un bloc de code avec le langage `mermaid` (le plus rapide via la commande slash **Diagramme Mermaid**, `/mermaid`) se dessine comme un diagramme en mode lecture et dans l'aperçu en direct — cliquer sur le diagramme affiche le code pour le modifier :

  ````markdown
  ```mermaid
  graph TD
    Idea --> Note --> Knowledge
  ```
  ````

- **Notes de bas de page** : `Texte[^1]` plus `[^1] : La note de bas de page.` à la fin — le mode lecture rend la référence et l'appareil de notes avec des marques de saut. Le plus rapide est la commande slash **Note de bas de page** (`/footnote`) : elle insère la prochaine référence libre et saute directement dans la définition à la fin de la note.

## Imprimer et enregistrer en PDF

Le menu **⋮** de l'éditeur et la palette de commandes (`Ctrl+P`) proposent **Imprimer / Enregistrer en PDF…** : l'impression utilise toujours la vue de lecture (depuis l'aperçu en direct/source, Plainva y bascule d'abord). Dans la boîte de dialogue système, vous pouvez choisir « Enregistrer en PDF » au lieu d'une imprimante.

## Exporter une note

- **Exporter en Markdown…** (menu **⋮** de l'éditeur ou palette de commandes) : enregistre une copie de la note n'importe où via la boîte de dialogue système — par exemple pour la transmettre à un autre programme. Les pièces jointes liées (images) ne sont pas copiées ; si la note en référence, Plainva affiche un bref avis.
- **PDF** : utilisez **Imprimer / Enregistrer en PDF…** (ci-dessus) et choisissez « Enregistrer en PDF » dans la boîte de dialogue système.

## Ouvrir une note dans un autre éditeur

Vos notes sont de simples fichiers `.md`, donc n'importe quel éditeur Markdown peut les ouvrir. Le menu **⋮** de l'éditeur propose **Ouvrir dans l'application par défaut**, qui transmet la note actuelle au programme que votre système utilise pour les fichiers Markdown (Byword, MacDown, VS Code, etc.). Plainva continue de surveiller le fichier, donc les modifications que vous y apportez apparaissent ici automatiquement.

## Images et pièces jointes

- **Insérer** : commandes slash **Image interne** (rechercher & intégrer depuis le vault) ou **Image (web)** (par URL). Vous pouvez aussi simplement **coller** une image depuis le presse-papiers (Ctrl+V) — elle est enregistrée à côté de la note et intégrée. Et vous pouvez **glisser des fichiers depuis l'explorateur de fichiers dans l'éditeur** : les images s'intègrent (`![[…]]`), les autres fichiers sont copiés et liés (`[[…]]`).
- **Visualiser** : les fichiers image (PNG, JPG, GIF, WebP, SVG, BMP, AVIF) s'ouvrent dans la visionneuse d'images intégrée avec **Zoom avant**/**Zoom arrière**, **Ajuster** et **Taille réelle (1:1)**.
- **Modifier** : le bouton **Modifier** ouvre l'éditeur d'image avec **Rogner**, pivoter/retourner, **Redimensionner**, des outils de dessin (**Crayon**, **Flèche**, **Rectangle**, **Texte**) plus **Annuler**/**Rétablir**. Enregistrez sur place ou **Enregistrer comme copie…**. Les formats modifiables sont PNG, JPG et WebP ; les autres formats s'ouvrent en lecture seule.
- Les autres pièces jointes s'ouvrent dans le programme par défaut du système lors d'un double-clic.

## Et Obsidian ?

Tout reste du Markdown standard avec un frontmatter standard. Obsidian ouvre les fichiers entièrement ; il affiche la clé regroupée `plainva:` comme un objet non modifiable dans son panneau de propriétés — c'est voulu et sans conséquence.

## Voir aussi

- [Bases de données (.base)](Databases_Base.md) — les notes en tableau, board ou calendrier
- [OKF](OKF.md) — ce que signifient `type` et `okf_version`
- [Recherche](Search.md) et [Raccourcis clavier](Keyboard_Shortcuts.md)
