# Graphe

Dernière mise à jour : 2026-07-10

Le graphe de Plainva est un outil de travail, pas une affiche : il vous montre où vous en êtes, ce qui est connecté, ce qui manque — et vous pouvez agir directement dessus. Il y a UN seul moteur de graphe avec trois visages.

## Graphe contextuel (barre latérale droite)

Ouvrez la section **Graphe** dans la barre latérale droite. Elle affiche la note active au centre, la structure des dossiers au-dessus, pour les aperçus de dossier (index.md) les notes contenues en dessous, les références entrantes à gauche et les références sortantes à droite. Les relations issues des bases de données portent leur nom de propriété comme étiquette.

- Cliquer sur un nœud ouvre la note (le focus tourne avec vous).
- Ctrl/Cmd+clic ouvre dans un split, le clic central dans un nouvel onglet.
- Faites glisser un nœud ailleurs et il reste épinglé (petit point), mémorisé par note — rouvrez cette note et retrouvez votre disposition. La note active reste toujours au centre. L'**aiguille d'épingle** en haut à droite active ou désactive la mémorisation ; la désactiver efface la disposition mémorisée de cette note.
- En dessous apparaissent jusqu'à trois **suggestions** : des notes qui mentionnent votre note active (sans la lier), sont souvent liées ensemble avec elle, partagent un voisinage commun ou partagent un tag rare. Lorsque le titre apparaît sous forme de texte dans la note en cours d'édition, la suggestion affiche un **aperçu du passage** qui serait lié ; **Lier** transforme exactement ce passage en lien wiki (sous la forme `[[Cible|texte]]` lorsque le texte visible diffère de la cible). S'il n'y a pas de passage correspondant, le lien est ajouté à la fin de la note (l'aperçu l'indique). **Ignorer la suggestion** mémorise votre décision.

## Carte du coffre (son propre onglet)

Ouvrez la carte avec **Ctrl/Cmd+Shift+G**, via l'icône de graphe dans la **barre d'actions** tout à gauche, ou via la palette de commandes (**Ouvrir le graphe**). Elle s'ouvre dans son propre onglet. Au lieu d'un enchevêtrement, vous voyez votre véritable structure de dossiers sous forme de bulles — double-cliquez sur une bulle pour déplier ses notes, **Replier tous les dossiers** revient en arrière. La disposition est déterministe : la même carte a toujours le même aspect à chaque ouverture. **Déplacez la carte** avec le bouton central de la souris ou Ctrl/Cmd+glisser, et **zoomez** avec la molette de la souris. Faites glisser un nœud et il reste épinglé (petit point). En haut à droite, l'**aiguille d'épingle** active ou désactive la mémorisation : la désactiver efface la disposition mémorisée de cette carte et fait revenir la disposition automatique (comme **Réinitialiser la disposition** dans le menu du clic droit). Les épingles sont stockées par appareil.

Outils dans la barre d'en-tête :

- Styles d'arête en un coup d'œil (légende, en bas à gauche) : les **relations** sont des lignes d'accent pleines avec une étiquette, les **liens** sont en tirets, les **intégrations** en pointillés.
- **Rechercher** atténue tout ce qui ne correspond pas. Filtrez par **type** (OKF) et **tag** ; les types d'arêtes (**Liens**, **Relations**, **Intégrations**) se basculent individuellement.
- **Focus sur la sélection** réduit la carte à une note sélectionnée plus 1 à 3 sauts de voisinage.
- **Carte de chaleur** met en lumière les notes modifiées récemment (7/30/90 jours) — « sur quoi je travaillais ? ».
- **Voyage dans le temps** affiche les notes selon leur date de création ; le curseur rejoue la croissance de votre coffre. La date provient d'une propriété `date`/`datum`, sinon de la date de création du fichier (une approximation pour les coffres uniquement dans le cloud).

Travailler sur la carte :

- Faites glisser un nœud **sur** un autre : Plainva propose d'écrire un lien texte — ou directement une **relation** correspondante de vos bases de données (si la relation n'autorise qu'une seule entrée, Plainva demande confirmation avant de remplacer).
- Clic droit sur un nœud : Ouvrir, Aperçu, Ouvrir dans le split, **Nouvelle note liée**, Renommer (avec mise à jour des liens dans tout le coffre), Signet, Supprimer.
- Clic droit sur un espace vide : **Nouvelle note**, Réinitialiser la disposition, **Exporter en PNG/SVG**.
- Cliquer sur un faisceau d'arêtes entre des dossiers liste les liens individuels ; survoler une arête montre la phrase où vit le lien.
- **Glisser sur un espace vide** trace un rectangle de sélection et marque plusieurs notes (Maj+glisser étend une sélection existante) ; faites ensuite glisser un des nœuds marqués et ils se déplacent tous ensemble. Le pied de page propose signet/suppression pour la sélection.

## Nettoyage

Le bouton **Nettoyer** ouvre une liste de travail avec trois onglets : **Orphelines** (notes sans connexions), **Liens cassés** (cibles qui n'existent pas — **Créer la note** les crée) et **Mentions** (**Analyser le coffre** trouve les endroits où une note est nommée mais non liée ; **Lier** transforme l'occurrence en lien wiki). Le pied de page de la carte affiche le nombre d'orphelines — cliquer dessus ouvre le panneau.

## Le graphe comme vue de base de données

Chaque base de données `.base` peut obtenir une vue **Graphe** (ajouter une vue → **Graphe**) : les lignes de la base de données deviennent des nœuds, vos **relations** deviennent des arêtes étiquetées. Dans la barre d'en-tête, vous choisissez les propriétés d'arêtes, **Couleur selon** une propriété de sélection, **Taille selon** un nombre, et si les **cibles externes** (relations pointant hors de la base de données) ou les **relations entrantes** (relations d'autres bases de données qui pointent vers ces éléments — p. ex. les tâches d'un projet) apparaissent. La vue est enregistrée de manière compatible avec Obsidian — Obsidian affiche le même fichier comme un tableau.

## Limites

- Le graphe montre des notes (fichiers), pas des paragraphes individuels.
- Les épingles et suggestions ignorées se trouvent sous `.plainva/` et ne voyagent pas avec la synchronisation — la disposition de base est identique sur chaque appareil.
- Les suggestions sont de pures analyses du coffre ; rien ne quitte votre machine.
