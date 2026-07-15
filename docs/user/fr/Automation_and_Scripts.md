# Automatisation & scripts

Dernière mise à jour : 2026-07-15

Plainva n'a pas de système de plugins qui exécute du code tiers. C'est le vault lui-même qui sert d'interface d'extension : vos notes sont du Markdown pur, les bases de données sont du YAML pur (`.base`), et les [conventions OKF](OKF.md) donnent à chaque fichier une structure prévisible. Tout ce qui peut lire et écrire des fichiers — un script shell, un programme Python, un outil CLI, une tâche planifiée ou un agent IA — peut étendre, générer ou réorganiser votre vault sans la moindre API propre à Plainva.

Cette page explique comment procéder **en toute sécurité**. Le format exact de chaque fichier, octet par octet, est documenté séparément dans la [Référence du format de fichier](File_Format_Reference.md) ; cette page en est le complément pratique : les règles, la démarche à suivre, et ce qu'il faut transmettre à un assistant IA.

## Pourquoi des fichiers plutôt qu'un bac à sable de plugins

- **Sécurité.** Un système de plugins qui exécute du code fait tourner le programme de quelqu'un d'autre dans votre éditeur, avec accès à vos notes. De simples fichiers n'exigent aucune confiance de ce genre : un script ne touche jamais qu'au dossier que vous lui indiquez, avec les permissions normales de votre système d'exploitation.
- **Longévité.** Le format survit à l'application. Un fichier Markdown généré par un script il y a cinq ans s'ouvre encore aujourd'hui — dans Plainva, dans Obsidian, dans n'importe quel éditeur de texte. Il n'y a pas d'API de plugin à rendre obsolète.
- **Le format est le contrat.** Comme le format sur le disque est ouvert et documenté, « l'API » est stable et vérifiable. Vous pouvez la comparer, la versionner dans Git, et raisonner à son sujet.

Si vous voulez que Plainva fasse quelque chose qu'il ne fait pas d'origine, vous n'attendez pas un plugin — vous écrivez un petit script qui agit directement sur les fichiers.

## Lire un vault en toute sécurité

Tout est du texte UTF-8 :

- **Notes (`.md`)** — un bloc de frontmatter YAML facultatif (entre deux lignes `---` tout en haut) contient les propriétés ; le corps Markdown suit. Analysez le frontmatter avec n'importe quelle bibliothèque YAML.
- **Bases de données (`.base`)** — du YAML pur décrivant des vues sur des notes. Les *valeurs* ne sont jamais dans la `.base` ; elles vivent dans le frontmatter des notes.
- **Structure** — les tags sont `#tag` dans le corps ou `tags:` dans le frontmatter ; les liens sont `[[Note]]` (liens wiki) ou `[text](path.md)`. Les tâches sont des éléments de liste `- [ ]` / `- [x]`.

Lire ne demande jamais de précaution particulière — un fichier texte ne peut pas être « corrompu » simplement en le lisant. Les règles ci-dessous concernent toutes l'*écriture*.

## Écrire dans un vault en toute sécurité

Suivez ces règles et Plainva (ainsi qu'Obsidian) acceptera vos modifications sans accroc. Plainva surveille le dossier du vault : une écriture externe est détectée et réindexée automatiquement, généralement en moins d'une seconde.

1. **Écrivez en UTF-8 sans BOM, avec des fins de ligne LF.** Les outils Windows qui utilisent par défaut l'UTF-16 ou le CRLF produisent des fichiers que Plainva considère comme modifiés à chaque synchronisation.
2. **Écrivez de manière atomique.** Écrivez dans un fichier temporaire situé dans le même dossier, puis renommez-le par-dessus la cible. Une note à moitié écrite (par exemple après un plantage) est pire que l'absence de modification. Plainva lui-même écrit chaque note de cette façon.
3. **Préservez le frontmatter OKF et les clés inconnues.** Conservez `type` et `okf_version` quand vous réécrivez une note, et ne supprimez jamais de clés de frontmatter que vous ne reconnaissez pas — faites-les survivre inchangées à un cycle de lecture/écriture. Ne « nettoyez » pas des clés que vous ne comprenez pas.
4. **Ne touchez jamais à `.plainva/`.** Ce dossier contient l'index de Plainva propre à l'appareil, ainsi que les sauvegardes, les épingles du graphe et l'état de synchronisation. Il ne fait pas partie de votre contenu et ne doit jamais être écrit, synchronisé ni committé dans Git par vos scripts.
5. **Respectez les règles des `.base`.** Une `.base` n'utilise que les quatre clés de premier niveau d'Obsidian (`filters`, `formulas`, `properties`, `views`) ; chaque vue a besoin d'un `name` ; les filtres sont à racine unique. Toutes les données propres à Plainva vont sous des sous-clés imbriquées `plainva:`. La [Référence du format de fichier](File_Format_Reference.md#databases-base) contient le contrat complet, y compris un exemple de relations à deux faces.
6. **Ne vous battez pas contre l'éditeur.** Si une note est ouverte *et* a des modifications non enregistrées dans Plainva, évitez de la réécrire depuis un script au même moment. Plainva dispose d'un résolveur de conflits comme filet de sécurité, mais la voie la plus propre est de laisser l'application enregistrer en premier (ou de modifier des notes qui ne sont pas actuellement ouvertes).

## Cas d'usage courants

Quelques tâches courantes, qui ne sont toutes que des opérations sur des fichiers :

- **Créer des notes en masse** — générer des fichiers `.md` avec un bloc de frontmatter OKF (`type`, `okf_version`, plus vos propres propriétés) et un corps Markdown. Plainva les indexe au fur et à mesure qu'elles apparaissent.
- **Générateurs de notes quotidiennes ou de rapports** — un script planifié qui écrit une note datée dans votre dossier de notes quotidiennes, remplie à partir d'une autre source.
- **Balayages de propriétés** — lire le frontmatter de chaque note, transformer un champ, le réécrire (de manière atomique, en préservant les clés inconnues).
- **Export / publication** — lire le vault et le restituer en HTML, en site statique ou en PDF. Lecture seule — aucune règle à respecter.
- **Maintenance des liens** — rebalayer les liens `[[Note]]` et les `tags:`, produire un rapport, ou les corriger directement.

Gardez vos scripts idempotents autant que possible : les exécuter deux fois ne doit pas dupliquer le contenu.

## Confier le vault à un assistant IA

Un agent IA disposant d'un accès en lecture/écriture à un dossier de vault est exactement le cas pour lequel cette conception a été pensée. Pour qu'il fonctionne correctement :

1. **Donnez-lui la [Référence du format de fichier](File_Format_Reference.md).** Elle est écrite pour un lecteur machine : le contrat de frontmatter OKF, la sérialisation propriété→YAML, le schéma complet des `.base` avec ses règles strictes d'Obsidian, le contrat `index.md` et les règles de sécurité — tout ce dont un agent a besoin pour modifier des fichiers sans les casser.
2. **Pointez-le vers le dossier du vault, pas vers le dossier `.plainva/`.** Précisez clairement que `.plainva/` est hors limites.
3. **Demandez des modifications atomiques et minimales.** Un agent qui réécrit toute une note pour changer une seule propriété devrait préserver le reste du frontmatter et du corps mot pour mot.

Comme le contrat est un document et non une API en direct, les mêmes instructions fonctionnent avec n'importe quel assistant, hors ligne comme en ligne.

## Récapitulatif de sécurité

- UTF-8, sans BOM, LF.
- Écrire de manière atomique (fichier temporaire + renommage).
- Préserver `type`, `okf_version` et les clés inconnues.
- Ne jamais écrire dans `.plainva/`.
- `.base` : quatre clés de premier niveau, vues nommées, filtres à racine unique, sous-clés `plainva:` pour tout le reste.
- Le vault est surveillé — les changements externes apparaissent automatiquement dans Plainva.

## Voir aussi

- [Référence du format de fichier](File_Format_Reference.md) — le format exact sur le disque de chaque fichier
- [OKF](OKF.md) — l'Open Knowledge Format qui donne aux fichiers leur structure prévisible
- [Bases de données (.base)](Databases_Base.md) — comment fonctionnent les vues `.base`
