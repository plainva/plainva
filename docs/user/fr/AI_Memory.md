# Mémoire (Bêta)

Dernière mise à jour : 2026-10-09

La mémoire conserve ce que l'IA doit savoir sur vous et votre travail sans qu'on ait à le lui répéter : ce que vous faites, comment vous voulez qu'on vous réponde, qui sont vos clients. Elle se compose de deux fichiers dans votre vault. Rien n'y entre sans votre oui, et vous pouvez lire, modifier et supprimer chaque entrée.

## Deux emplacements

**Toujours inclus** accompagne chaque nouvelle conversation. Soyez bref : il y a de la place pour 2 000 caractères, et une barre montre à quel point il est rempli. Une entrée qui ne tient plus est marquée **Plus de place — non incluse** — elle est enregistrée, mais n'est pas envoyée avec la conversation. Les entrées sont incluses dans l'ordre où elles se suivent ; ce qui compte le plus doit donc figurer en haut, et vous changez l'ordre dans le fichier.

**À consulter** n'est pas envoyé avec la conversation. Quand une question peut dépendre de quelque chose que vous avez dit plus tôt à l'IA, celle-ci va y regarder, et la conversation affiche **Recherche dans la mémoire**. C'est l'emplacement de ce qui ne compte que parfois : les conditions d'un client, une décision et sa raison.

## Ouvrir la mémoire

Sur l'ordinateur, choisissez **Mémoire** dans l'onglet IA, à côté de **Compétences**. Sur le téléphone, c'est **Conversations → Mémoire**. **Paramètres → IA & automatisation** (la partie Vault) y mène aussi : **Ouvrir la mémoire** sous **Compétences et mémoire**.

## Ajouter une entrée soi-même

**Nouvelle entrée** demande trois choses : le texte — une seule chose par entrée, en une seule ligne de 500 caractères au plus —, l'emplacement (**Toujours inclus** ou **À consulter**) et si l'entrée est destinée à **Uniquement les modèles sur cet appareil**. Cochez cette case pour tout ce qu'aucun modèle cloud ne doit apprendre.

Le bouton ⋯ d'une entrée — sur le téléphone, un appui sur l'entrée — propose **Modifier**, le déplacement vers l'autre emplacement (**Toujours inclure** ou **Seulement à consulter**) et **Supprimer**.

## Laisser l'IA retenir quelque chose

Dites-le dans une conversation : « Retiens que je facture à la journée, pas à l'heure. » L'IA rédige un brouillon d'entrée ; elle n'écrit jamais d'entrée elle-même. Sous sa réponse, une carte **Brouillon · Entrée de la mémoire** montre le texte entier. Choisissez l'emplacement, puis **Retenir** — ou **Abandonner**. Un brouillon sur lequel vous n'avez pas encore tranché attend sous **En attente**, et la mémoire indique combien attendent.

« Oublie que … » fonctionne de la même façon : la carte indique **Brouillon · Retirer de la mémoire**, et **Retirer** enlève l'entrée. Quand vous dites à l'IA que quelque chose a changé, la carte montre sous **Remplace** l'entrée dont la nouvelle formulation prend la place.

Une conversation terminée peut elle aussi proposer des entrées : **Apprendre de cette conversation** la relit et laisse des brouillons, chacun avec sa preuve. Son fonctionnement, et ce qu'une telle relecture peut proposer, sont décrits dans [Compétences](AI_Skills.md).

## Une règle n'est pas un souvenir

« Réponds toujours en allemand » n'est pas une chose à savoir — c'est une chose à faire. Une règle de ce genre n'entre pas dans la mémoire : elle devient une ligne des **Instructions du vault** (`AGENTS.md`), que chaque modèle reçoit comme instruction. Ajoutez-en une avec **Ajouter une règle** sous **Règles pour l'IA**, ou demandez-le à l'IA ; sa carte indique alors **Brouillon · Règle pour l'IA**, avec le bouton **Ajouter comme règle**.

Comme toutes les instructions, le fichier doit être approuvé sur chaque appareil avant de s'y appliquer (voir [Compétences](AI_Skills.md)). Une règle que vous ajoutez sur un appareil où le fichier a déjà été approuvé s'y applique aussitôt ; vos autres appareils vous demandent d'abord.

## Ranger

Une mémoire qui a grandi se répète. Sous **Ranger**, la vue de la mémoire signale ce que cet appareil a remarqué de lui-même, sans interroger de modèle : deux entrées qui disent presque la même chose, une entrée vieille de plus d'un an et des entrées de **Toujours inclus** qui ne tiennent plus. **Comparer** montre les deux entrées ensemble, chacune avec tout ce que son menu permet de faire.

Pour y regarder de plus près, il existe une compétence. **Entretenir la mémoire** lit les entrées avec le modèle d'une conversation et prépare des brouillons de ce qui peut être regroupé et de ce qui peut disparaître ; la ligne **Faire examiner la mémoire** la lance. Ce qu'elle propose, ce sont des brouillons comme les autres : rien ne change avant que vous ne les acceptiez, et lorsque deux entrées se contredisent, elle pose la question au lieu de trancher.

## Confidentialité

- Une entrée peut porter sa propre règle : **Pas aux modèles cloud**, **Pas dans les conversations avec Internet**. Un modèle sur cet appareil reçoit toutes les entrées.
- Une entrée que l'IA a rédigée dans une conversation qui a lu des notes soumises à une règle de confidentialité reçoit les mêmes règles — la carte indique **L'entrée reçoit les règles de confidentialité des notes sur lesquelles reposait cette conversation.** Ce qui vient d'une note qui doit rester sur cet appareil n'atteint pas un cloud par le biais de la mémoire.
- Vos [règles de confidentialité](AI_Assistant.md) valent aussi pour les deux fichiers : une règle de dossier pour `.agent/` tient toute la mémoire à l'écart du cloud.
- L'aperçu d'envoi comporte une ligne **Mémoire** — combien d'entrées accompagnent la demande — et compte sous **Retenu** les entrées que vos règles retiennent. Il ne nomme jamais une entrée.
- Pour l'IA, une entrée est une information, pas une instruction : une phrase dans la mémoire ne lui donne aucun droit.
- Une conversation garde la mémoire avec laquelle elle a commencé. Une entrée que vous supprimez ne part dans aucune nouvelle conversation ; les conversations déjà commencées gardent ce qu'elles ont reçu.

## Désactiver la mémoire

**Utiliser la mémoire sur cet appareil** est activé jusqu'à ce que vous le désactiviez. Désactivé, une conversation sur cet appareil ne reçoit rien de la mémoire et n'y ajoute rien. Les fichiers restent tels quels, et chaque appareil décide pour lui-même.

## Les deux fichiers

`.agent/active_memory.md` (toujours inclus) et `.agent/MEMORY.md` (à consulter) sont du Markdown pur. Chaque entrée est un élément de liste, et les titres regroupent les entrées. Ce que Plainva sait d'une entrée figure dans un commentaire placé derrière elle :

```markdown
## Clients

- Harbour Studio pays within 14 days.
- I bill per day, not per hour. <!-- plainva: added=2026-10-09; by=assistant; source=Offer for Harbour Studio; deny=cloud -->
```

`added` et `by` indiquent quand l'entrée a été ajoutée et si vous l'avez écrite ou si vous avez accepté un brouillon, `source` nomme la conversation d'où vient un brouillon, et `deny` contient ses règles (`cloud`, `web`). Vous pouvez modifier les fichiers dans n'importe quel éditeur. Dans Plainva, **Ouvrir le fichier** ouvre l'un ou l'autre.

Plainva ne devine pas. Une entrée dont le commentaire est endommagé est marquée **Règles illisibles — ne part vers aucun modèle** jusqu'à ce que vous répariez le commentaire ou ajoutiez de nouveau l'entrée. Un texte caché dans un commentaire ou dans des caractères invisibles n'est jamais envoyé ; l'entrée indique alors combien de parties cachées ont été laissées de côté. Un fichier contient au plus 2 000 entrées et 256 Ko.
