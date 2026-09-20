# Journal

Dernière mise à jour : 2026-09-20

Le journal est le moyen le plus rapide de noter quelque chose sans ouvrir de note : une pensée, un appel téléphonique, une ligne sur la journée. Chaque entrée est une simple ligne de liste avec une heure — `- 14:05 Le routeur est au sous-sol` — sous un titre de la **note quotidienne d'aujourd'hui**. Il n'y a ni nouveau format de fichier ni base de données : les entrées vivent dans vos notes quotidiennes, lisibles dans n'importe quel éditeur et compatibles avec les plugins de journal d'Obsidian (Thino, Knomo).

## Écrire une entrée

Un champ, une touche **Entrée**. Plainva horodate l'entrée ; vous ne tapez que le texte. Les tags, les liens et une seconde ligne se tapent simplement — le texte est du Markdown ordinaire.

- **Sur le bureau :** `Ctrl+Shift+J` ouvre le champ **Entrée de journal** depuis n'importe où dans Plainva. Le même champ se trouve dans le menu **＋** de la barre latérale, dans la palette de commandes et dans le menu de la zone de notification (**Entrée de journal**). `Entrée` enregistre, `Shift+Entrée` commence une nouvelle ligne, `Esc` annule.
- **Sur le téléphone :** le bouton **＋** propose **Entrée de journal** ; l'écran du journal a son propre bouton crayon. Un appui long sur l'icône de l'application propose aussi **Entrée de journal** — comme raccourci d'application sous Android, comme action rapide sous iOS. `Entrée` y reste un saut de ligne ; **Enregistrer l'entrée** enregistre.
- **Depuis la feuille de partage (téléphone) :** choisissez Plainva et cochez **Vers le journal** — le texte et le lien deviennent l'entrée, les fichiers partagés atterrissent dans le dossier des pièces jointes et sont intégrés.
- **Avec une image :** le champ du téléphone a **Ajouter une photo** ; sur le bureau, vous collez une image depuis le presse-papiers dans le champ. L'image va là où vont les pièces jointes et s'intègre dans l'entrée.

Si la note quotidienne d'aujourd'hui n'existe pas encore, elle est créée au passage — à partir de votre modèle de note quotidienne, sans poser ses questions. Après l'enregistrement, un avis indique **Entrée enregistrée** et propose **Annuler**.

Le champ propose deux types, **Tâche** et **Journal**. **Tâche** transmet ce que vous avez tapé à la [vue Tâches](Tasks.md), où une tâche se crée de la façon habituelle. La puce **Comme tâche** est autre chose : elle garde l'entrée dans le journal et lui donne une case à cocher (`- [ ] 14:05 Commander la pièce de rechange`), si bien qu'elle apparaît aussi dans la vue Tâches sous **Depuis les notes**.

## La vue du journal

**Ouvrir le journal** (barre d'actions sur le bureau, **Rubriques** sur le téléphone, ou la palette de commandes) affiche tous les jours comme un seul flux : le jour le plus récent en haut, et au sein d'un jour l'entrée la plus récente en premier. Les liens s'ouvrent, les tags sont des pastilles, une image intégrée s'affiche en aperçu, et une longue entrée est repliée — **Plus** l'ouvre.

- **Rechercher et filtrer :** le champ de recherche parcourt les jours chargés ; les puces **Toutes**, **Tâches uniquement** et les tags les plus fréquents restreignent le flux. Un clic sur un tag dans une entrée filtre par ce tag.
- **Jours plus anciens :** Plainva charge les 14 derniers jours qui ont des entrées. **Charger les précédents** récupère le lot suivant ; **Aller à un jour** ouvre le sélecteur de date, où les jours avec des entrées sont marqués, et charge jusqu'au jour que vous choisissez.
- **Ouvrir la note** dans le titre d'un jour ouvre cette note quotidienne ; un clic sur une entrée ouvre la note à cette ligne.
- Les **cases à cocher** des entrées de tâche peuvent être cochées directement dans le flux. Elles se comportent comme dans la vue Tâches, y compris la date d'achèvement et la prochaine occurrence d'une tâche récurrente.

Chaque entrée a un menu (clic droit ou **⋯** sur le bureau ; **⋯**, un appui long ou un balayage sur le téléphone) : **Modifier** change le texte sur place et garde l'heure, **Copier** copie le texte, **Transformer en tâche** ajoute la case à cocher et **Retransformer en entrée** la retire, **Afficher dans la note** saute à la ligne, **Supprimer** retire l'entrée — avec **Annuler** dans l'avis qui suit.

Les entrées d'un seul jour apparaissent aussi là où vous regardez ce jour : sous le calendrier dans la barre latérale droite du bureau (pour le jour de la note quotidienne ouverte, sinon aujourd'hui), et sur l'écran **Aujourd'hui** du téléphone pour le jour choisi. Les deux ont un petit champ qui écrit exactement dans ce jour, et **Tous les jours** mène au flux.

## Comment une entrée est enregistrée

```markdown
## Journal

- 09:12 Appelé l'atelier #client
- [ ] 10:30 Commander la pièce de rechange
- 14:05 Le routeur est au sous-sol
  La clé est chez Mme Berger.
```

- Les entrées sont ajoutées à la fin de la section, si bien que le fichier se lit chronologiquement ; la vue affiche la plus récente en haut.
- Le titre est **Journal** par défaut et peut être changé par vault sous **Paramètres → Vault → Contenu et structure** (**Titre du journal** ; sur le téléphone sous **Paramètres → Contenu et structure**). Son niveau n'a pas d'importance. Si le titre manque, Plainva ajoute `## Journal` à la fin de la note. Changer le réglage ne renomme pas les titres existants.
- Plainva lit aussi `- 14:05:30 Texte` (avec les secondes) et les entrées avec une case à cocher, et il poursuit la liste de la façon dont votre note l'écrit (`-`, `*` ou `+`, avec ou sans lignes vides entre les entrées). Les lignes existantes ne sont jamais reformatées.
- Une modification qui ne peut pas être placée en toute sécurité — par exemple parce qu'un bloc de code de la section n'a jamais été refermé — est refusée avec un message, et le champ garde votre texte.

Le format exact se trouve dans la [Référence du format de fichier](File_Format_Reference.md).

## Deux appareils en même temps

Si deux appareils ajoutent des entrées à la même note quotidienne avant de s'être synchronisés, ce **n'est pas un conflit** : Plainva fusionne les entrées par heure et conserve chaque ligne des deux appareils. Cela vaut aussi quand les deux appareils ont créé la note du jour indépendamment l'un de l'autre. Tout autre changement simultané apporté à la note est traité avec autant de précaution qu'avant (voir [Compatibilité de synchronisation](Sync_Compatibility.md)).

## Capture rapide globale (bureau, optionnel)

Sous **Paramètres → Démarrage et comportement → Capture rapide globale**, vous pouvez activer **Capturer de partout avec un raccourci à l'échelle du système**. Le raccourci — `Ctrl+Alt+J` par défaut (`Cmd+Option+J` sur macOS) — ouvre alors une petite fenêtre avec le champ de saisie, même quand une autre application est au premier plan, tant que Plainva fonctionne (aussi depuis la zone de notification). `Entrée` écrit l'entrée dans la note quotidienne d'aujourd'hui du vault ouvert dans Plainva et ferme la fenêtre ; `Esc` annule.

- **Modifier** enregistre un nouveau raccourci : appuyez sur la combinaison voulue, avec `Ctrl`, `Alt` ou la touche Windows/Commande. **Rétablir la valeur par défaut** ramène le raccourci par défaut.
- Si une autre application utilise déjà le raccourci, ou si le système ne l'accepte pas, Plainva le signale sous l'interrupteur au lieu de laisser un raccourci qui ne fait rien.
- Sous **Wayland** (Linux), le système ne donne aux applications aucun raccourci à l'échelle du système ; Plainva le signale et n'enregistre rien. L'entrée de la zone de notification et `Ctrl+Shift+J` mènent au même champ.
- Le raccourci appartient à l'appareil et ne fait pas partie du profil des paramètres.
