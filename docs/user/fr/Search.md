# Recherche

Dernière mise à jour : 2026-09-19

Plainva propose trois façons de rechercher : la recherche en texte intégral dans tout le vault, le sélecteur rapide pour ouvrir des fichiers, et rechercher & remplacer dans une note.

## Recherche en texte intégral dans le vault

Le champ en haut de la barre latérale recherche les titres et les contenus dans tout le vault. Un index local en texte intégral (SQLite FTS5) est créé à son ouverture et actualisé lorsque les fichiers changent. La recherche fonctionne hors ligne.

La recherche réagit au fur et à mesure que vous tapez : les préfixes de mots correspondent déjà ("Proj" trouve "Projet plan") — pas besoin d'appuyer sur Entrée. Le **X** à droite du champ efface la recherche en cours (ou appuyez sur `Esc`) ; la barre latérale réaffiche alors l'arborescence de fichiers normale.

La recherche affiche chaque occurrence avec un extrait, le chemin des titres et le numéro de ligne. Ouvrir une ligne sélectionne cette occurrence précise ; les correspondances d’une même note sont présentées séparément. Le compteur ne comprend que les résultats déjà chargés. Vous pouvez charger d’autres occurrences. Les flèches déplacent la sélection et Entrée l’ouvre. Le chargement, les résultats vides et les erreurs sont indiqués ; une nouvelle saisie écarte les anciennes réponses. Si une modification empêche de retrouver une occurrence sans ambiguïté, un message le signale. Ces occurrences sont aussi disponibles dans le sélecteur rapide et la recherche mobile. Sur le téléphone, revenir à la recherche restaure la requête, les résultats chargés et la position dans la liste. Les résultats arrivent par **Pertinence**, sauf si tu choisis **Dernière modification**, **Titre** ou **Chemin** avec le bouton de tri à côté du champ de recherche (sur le téléphone : dans la barre de la recherche) ; le chargement suivant conserve l'ordre choisi.

Le champ de recherche s'applique aussi aux autres vues de la barre latérale : dans **Tags**, il filtre la liste des tags, dans **Signets**, les signets.

### Opérateurs de recherche

- `"phrase exacte"` — les guillemets font correspondre la séquence de mots exactement. Cela sert aussi de recherche de mot entier pour un seul mot : `"plan"` trouve "plan" mais pas "planification".
- `-terme` — exclut les notes contenant le terme (fonctionne aussi avec les phrases : `-"ancienne version"`).
- `path:dossier` — uniquement les fichiers dont le chemin contient le texte (par ex. `path:Projets` ; avec des espaces : `path:"Mon Dossier"`).
- `tag:nom` — uniquement les notes portant ce tag, y compris les tags imbriqués : `tag:projet` trouve aussi `#projet/interne`. `tag:#projet` fonctionne également.
- Les opérateurs peuvent être niés (`-path:Archives`, `-tag:fait`) et combinés librement avec des termes de recherche : `plan tag:projet -brouillon`.
- Plusieurs termes sont combinés avec ET. Les caractères spéciaux comme `- ( ) : *` à l'intérieur des termes sont sans danger — Plainva traite la saisie littéralement.

## Sélecteur rapide

`Ctrl+O` ou `Ctrl+K` ouvre le sélecteur rapide : tapez, naviguez avec les flèches, ouvrez avec `Entrée`. Sans saisie, il affiche la liste **Fichiers récents** — le moyen le plus rapide de passer d'une note actuelle à l'autre. Les résultats peuvent aussi être ouverts directement dans un nouvel onglet (le pied de page du dialogue montre les touches correspondantes).

La correspondance est floue : `prjplan` trouve aussi « Project Plan » — les lettres doivent seulement apparaître dans l'ordre, et les débuts de mots comptent davantage. Et lorsque la note n'existe pas encore, la liste affiche **Créer '…'** : `Entrée` la crée immédiatement (à la racine du vault) et l'ouvre — tapez un nom, appuyez sur Entrée, commencez à écrire.

Sous les résultats de nom apparaît en plus le groupe **Contenu** : les notes dont le texte correspond à la saisie, avec un extrait de la correspondance mis en évidence ; l'ouverture saute directement à l'endroit trouvé — comme pour la recherche de la barre latérale.

## Rechercher & remplacer dans une note

`Ctrl+F` ouvre la barre de recherche de l'éditeur (en aperçu en direct et en mode source) :

- **Rechercher** avec `Entrée`/**suivant** et **précédent** à travers les résultats ; **tout** met en évidence chaque occurrence.
- Options : **respecter la casse**, **mot entier**, **regex**.
- **Remplacer** : remplacer des résultats individuels (**remplacer**) ou **tout remplacer**.

### Dans tout le vault

`Ctrl/Cmd+Shift+F` (ou **Rechercher et remplacer dans le vault** dans la palette de commandes) recherche dans toutes les notes à la fois. Saisissez un terme, appuyez sur **Rechercher**, et les résultats apparaissent regroupés par note avec une ligne de contexte chacune. Tapez un remplacement, décochez les notes que vous souhaitez exclure, puis **Remplacer dans N notes** réécrit le reste — chaque note est réécrite de manière sûre (écriture atomique + un instantané de version), de sorte qu'un aperçu obsolète ne peut jamais écraser un contenu plus récent. Respecter la casse, mot entier et regex fonctionnent aussi ici ; en mode regex, les références arrière `$1`/`$2` sont disponibles dans le remplacement.

Chaque occurrence affiche deux lignes : **avant** avec la correspondance et **après** avec le résultat — avec une expression régulière, les références `$1` sont résolues, pour vérifier le changement avant d’écrire quoi que ce soit. Une expression non valide est signalée au niveau du champ au lieu d’une liste vide ; sans résultat, l’état vide indique quoi vérifier. Pendant le remplacement, vous voyez la progression et pouvez **Annuler** — les notes déjà écrites le restent et sont nommées. Sur le téléphone, chaque occurrence affiche les deux mêmes lignes.

**Sur le téléphone**, la même chose passe par la loupe dans l’en-tête, puis `>` et **Rechercher et remplacer dans le vault** : les occurrences sont regroupées par note et repliées, pour qu’un terme à quarante occurrences n’enterre pas l’action ; touchez une note pour l’ouvrir, décochez celles à laisser de côté, et le bouton annonce sa propre portée (**Remplacer dans 2 notes**). Si vous quittez l’application, un remplacement en cours s’arrête à la note suivante — les notes déjà écrites le restent et sont nommées.

## Tags

La vue **Tags** de la barre latérale liste tous les `#tags` du vault avec un nombre de résultats ; un clic affiche les **Fichiers avec #tag**. Les tags fonctionnent dans le texte (`#projet`) et dans le frontmatter (`tags: [projet]`). Le champ de recherche de la barre latérale filtre aussi la liste des tags.

**Renommer un tag** dans tout le vault : faites un clic droit sur un tag dans la vue **Tags** et saisissez un nouveau nom. Plainva réécrit le tag partout — dans le corps des notes (`#tag` et ses sous-tags `#tag/child`) et dans le frontmatter (`tags:`) — en réécrivant chaque note concernée par le même chemin sûr. Les tags sans rapport qui contiennent simplement le nom (par exemple `#area/tag`) restent inchangés.

## Naviguer dans une note

Le **Plan** dans la barre latérale droite liste tous les titres de la note active — un clic saute à l'endroit correspondant. Pour sauter entre les notes, **Backlinks** (qui renvoie ici) et les boutons **Retour**/**Avancer** de l'éditeur aident également.

## Voir aussi

- [Raccourcis clavier](Keyboard_Shortcuts.md)
- [Bases de données (.base)](Databases_Base.md) — requêtes structurées sur les propriétés plutôt que sur le texte intégral
