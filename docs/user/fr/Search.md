# Recherche

Dernière mise à jour : 2026-10-01

Plainva propose trois façons de rechercher : la recherche en texte intégral dans tout le vault, le sélecteur rapide pour ouvrir des fichiers, et rechercher & remplacer dans une note.

## Recherche en texte intégral dans le vault

Le champ en haut de la barre latérale recherche les titres et les contenus dans tout le vault. Un index local en texte intégral (SQLite FTS5) est créé à son ouverture et actualisé lorsque les fichiers changent. La recherche fonctionne hors ligne.

La recherche réagit au fur et à mesure que vous tapez : les préfixes de mots correspondent déjà ("Proj" trouve "Projet plan") — pas besoin d'appuyer sur Entrée. Le **X** à droite du champ efface la recherche en cours (ou appuyez sur `Esc`) ; la barre latérale réaffiche alors l'arborescence de fichiers normale.

En chinois, en japonais, en thaï et dans d'autres écritures sans espaces entre les mots, la recherche trouve un terme n'importe où dans le texte : `議事録` trouve "今日は会議の議事録を書いた", `搜索` trouve "全文搜索". Les mots latins au milieu d'un tel texte sont trouvés aussi ("Plainva" dans "…でPlainvaを使った").

La recherche affiche chaque occurrence avec un extrait, le chemin des titres et le numéro de ligne. Ouvrir une ligne sélectionne cette occurrence précise ; les correspondances d’une même note sont présentées séparément. Le compteur ne comprend que les résultats déjà chargés. Vous pouvez charger d’autres occurrences. Les flèches déplacent la sélection et Entrée l’ouvre. Le chargement, les résultats vides et les erreurs sont indiqués ; une nouvelle saisie écarte les anciennes réponses. Si une modification empêche de retrouver une occurrence sans ambiguïté, un message le signale. Ces occurrences sont aussi disponibles dans le sélecteur rapide et la recherche mobile. Sur le téléphone, revenir à la recherche restaure la requête, les résultats chargés et la position dans la liste. Les résultats arrivent par **Pertinence**, sauf si tu choisis **Dernière modification**, **Titre** ou **Chemin** avec le bouton de tri à côté du champ de recherche (sur le téléphone : dans la barre de la recherche) ; le chargement suivant conserve l'ordre choisi. Sur le téléphone, la feuille de tri reste ouverte jusqu'à ce que tu touches **Terminé** : toucher à nouveau l'ordre choisi inverse le sens.

Le champ de recherche s'applique aussi aux autres vues de la barre latérale : dans **Tags**, il filtre la liste des tags, dans **Signets**, les signets.

### Opérateurs de recherche

- `"phrase exacte"` — les guillemets font correspondre la séquence de mots exactement. Cela sert aussi de recherche de mot entier pour un seul mot : `"plan"` trouve "plan" mais pas "planification". Dans les écritures sans espaces, les guillemets ne changent rien : un tel texte n'a pas de limites de mots.
- `-terme` — exclut les notes contenant le terme (fonctionne aussi avec les phrases : `-"ancienne version"`).
- `path:dossier` — uniquement les fichiers dont le chemin contient le texte (par ex. `path:Projets` ; avec des espaces : `path:"Mon Dossier"`).
- `tag:nom` — uniquement les notes portant ce tag, y compris les tags imbriqués : `tag:projet` trouve aussi `#projet/interne`. `tag:#projet` fonctionne également.
- Les opérateurs peuvent être niés (`-path:Archives`, `-tag:fait`) et combinés librement avec des termes de recherche : `plan tag:projet -brouillon`.
- Plusieurs termes sont combinés avec ET. Les caractères spéciaux comme `- ( ) : *` à l'intérieur des termes sont sans danger — Plainva traite la saisie littéralement.

## Recherche par le sens

Avec un modèle local, la recherche trouve aussi les notes d'après ce qu'elles signifient — pas seulement d'après leurs mots, et d'une langue à l'autre : une question en français trouve une note anglaise qui dit la même chose. Le modèle calcule sur cet appareil ; vos notes et les vecteurs calculés à partir d'elles ne le quittent jamais.

Activez-la dans **Paramètres → IA & automatisation → Recherche sémantique** (l'IA doit être activée). Choisissez un modèle — **Granite Embedding Multilingual R2 (97M)** est recommandé — et Plainva affiche sa taille, sa source, sa licence et une durée estimée avant tout téléchargement. Chaque fichier provient d'une version fixe sur huggingface.co et est vérifié par son SHA-256 ; aucune connexion n'est nécessaire. Avant d'intégrer la première note, Plainva vérifie que le modèle calcule correctement sur cet appareil.

Au lieu d'un paquet, vous pouvez choisir **Fournisseur personnel** : le modèle du profil **Embeddings** calcule alors les vecteurs — tout modèle d'embeddings que propose votre fournisseur, par exemple `text-embedding-3-small` chez OpenAI, `gemini-embedding-001` chez Gemini ou `nomic-embed-text` dans Ollama. Avec Ollama ou LM Studio, rien ne quitte votre ordinateur. Avec un cloud, l'aperçu montre une fois ce qui y part — chaque note que vos règles de confidentialité laissent passer, maintenant et à chaque modification, ainsi que vos questions de recherche —, et **Approuver durablement** le démarre ; **Retirer l'approbation** dans les paramètres l'arrête. Les notes que vos règles tiennent à l'écart du cloud restent dehors, et dans un espace chiffré seul un paquet ou un serveur sur cet ordinateur calcule. Si un autre modèle répond sous le même nom — un nouveau `ollama pull`, un serveur déplacé —, Plainva le remarque avant la note suivante et recalcule les vecteurs au lieu de mélanger deux modèles. Si le fournisseur est injoignable, la recherche répond par les mots et le signale. **Inutilisé sur cet appareil** liste les paquets et les vecteurs de modèles que vous n'utilisez plus ; **Supprimer** les efface.

**Mesurer cet appareil** (à côté de **Mettre en pause** pendant qu'un modèle calcule) vérifie cet appareil par rapport aux budgets que Plainva s'impose : le premier passage sur 5 000 sections, une note modifiée retrouvée, une recherche sur 20 000 sections, la mémoire de l'app à son pic et le téléchargement. La mesure se fait avec un texte d'exemple, jamais avec vos notes, et l'intégration attend pendant ce temps ; **Copier les résultats** met les chiffres dans le presse-papiers — par exemple pour vos retours sur la bêta.

Tant qu'un modèle est actif, l'en-tête des résultats propose **Mots**, **Sens** et **Les deux** :

- **Mots** est la recherche en texte intégral décrite plus haut.
- **Sens** liste les notes dont les sections se rapprochent le plus de votre question ; ouvrir un résultat mène à cette section.
- **Les deux** (par défaut) classe ensemble les résultats des mots et du sens.

Avec **Sens** et **Les deux**, chaque note apparaît une fois, et une petite étiquette indique ce qui l'a trouvée : **Mots**, **Sens** ou **Mots et sens**. Les opérateurs de recherche (`path:`, `tag:`, `-terme`) limitent aussi les résultats par le sens. Le choix s'applique à cet appareil.

Plainva intègre les notes en arrière-plan, les plus récemment modifiées d'abord ; une note que vous modifiez suit quelques secondes après la fin de la saisie. D'ici là, elle n'est trouvée que par ses mots — un résultat par le sens ne provient jamais de l'ancien texte d'une note. Une ligne sous les résultats indique l'avancement et propose **Mettre en pause**. Sur téléphone, l'intégration ne s'effectue que lorsque Plainva est ouvert. **Retirer (avec ses vecteurs)** dans les paramètres supprime le modèle et tout ce qu'il a calculé.

### Notes connexes

À côté de la note ouverte, Plainva affiche jusqu'à trois notes proches d'elle par le sens mais pas encore liées à elle — sur l'ordinateur dans la section **Connexes** de la barre latérale droite, après **Backlinks** ; sur le téléphone dans l'onglet **Connexes** de la feuille de la note. Elles viennent des vecteurs que la recherche par le sens conserve déjà sur cet appareil : rien n'est envoyé, pas même à un fournisseur personnel. Une suggestion n'apparaît que si une note se distingue nettement du reste du vault ; les copies et le texte commun d'un modèle ne comptent pas. La plupart des notes n'ont donc aucune suggestion, et la section disparaît alors.

Chaque suggestion nomme les deux sections les plus proches — par exemple « Production ↔ Jours de tournage › Répartition » — et les notes vers lesquelles les deux renvoient. **Pourquoi cette suggestion ?** montre le début des deux sections (un clic y mène) ; **Pas utile** masque exactement cette paire sur cet appareil et ne change pas la recherche. **Mettre en pause pour cette note** et **Mettre en pause dans ce vault** se trouvent dans le menu de la section, sur le téléphone sous la liste. **Afficher les notes connexes** dans **Paramètres → IA & automatisation → Recherche sémantique** désactive les suggestions sur cet appareil ; c'est là aussi que vous reprenez un vault ou des notes en pause et rétablissez les suggestions masquées.

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

Dans la note, un tag s'affiche comme une petite pastille — à l'écriture comme à la lecture ; le texte lui-même reste `#projet/site`. Un clic sur la pastille (sur le téléphone : un appui en mode lecture) ouvre les notes qui portent le tag. Ce qui compte comme tag est identique partout — dans la liste des tags, dans une tâche et lors du renommage : un `#` en début de ligne ou après une espace, suivi de lettres, de chiffres, de `_`, `-` ou `/`. Des chiffres seuls ne sont pas un tag (`#42` reste un numéro), pas plus que ce qui se trouve dans du code ou dans un lien. **Colorer les tags** sous **Paramètres → App → Apparence** donne à chaque tag une couleur qui découle de son nom ; les tags imbriqués partagent la couleur de leur tag de premier niveau. Le réglage appartient à cet appareil et n'enregistre rien dans vos notes.

**Renommer un tag** dans tout le vault : faites un clic droit sur un tag dans la vue **Tags** et saisissez un nouveau nom. Plainva réécrit le tag partout — dans le corps des notes (`#tag` et ses sous-tags `#tag/child`) et dans le frontmatter (`tags:`) — en réécrivant chaque note concernée par le même chemin sûr. Les tags sans rapport qui contiennent simplement le nom (par exemple `#area/tag`) restent inchangés.

## Naviguer dans une note

Le **Plan** dans la barre latérale droite liste tous les titres de la note active — un clic saute à l'endroit correspondant. Pour sauter entre les notes, **Backlinks** (qui renvoie ici) et les boutons **Retour**/**Avancer** de l'éditeur aident également.

## Voir aussi

- [Raccourcis clavier](Keyboard_Shortcuts.md)
- [Bases de données (.base)](Databases_Base.md) — requêtes structurées sur les propriétés plutôt que sur le texte intégral
