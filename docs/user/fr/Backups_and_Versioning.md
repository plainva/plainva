# Sauvegardes & historique des versions

Dernière mise à jour : 2026-07-11

Plainva protège votre travail à deux niveaux : les **versions de fichiers** (instantanés automatiques de chaque fichier lors de l'édition et de la suppression) et les **sauvegardes du vault** (archives ZIP régulières de tout le vault, stockées en dehors du dossier du vault). Les deux fonctionnent en arrière-plan sans aucune configuration et peuvent être ajustés dans les paramètres sous **Sauvegarde & historique des versions**.

## Versions de fichiers (instantanés)

Avant chaque enregistrement, Plainva stocke un instantané de l'état précédent — sous forme de copie texte ordinaire dans `.plainva/backups/` à l'intérieur du vault (ce dossier est masqué dans l'arborescence de fichiers, la recherche et la synchronisation). Pour éviter des centaines de copies pendant que vous tapez, un **Intervalle des instantanés** s'applique (par défaut : au plus une nouvelle version toutes les 2 minutes). **La suppression crée toujours un instantané**, quel que soit l'intervalle.

Conservation (configurable par vault) :

- **Intervalle des instantanés** : À chaque modification / 30 s / 2 min / 5 min / 10 min
- **Versions par fichier** : par défaut 100 — au-delà, les plus anciennes sont supprimées
- **Âge maximal** : par défaut 90 jours — les versions plus anciennes sont supprimées **définitivement** par un nettoyage quotidien (« Illimité » désactive cette limite)

Lorsque vous renommez ou déplacez un fichier, son historique de versions le suit.

## Consulter et restaurer des versions

Un clic droit sur un fichier dans l'arborescence (ou sur son onglet), ou le menu **⋮** en haut à droite de l'éditeur → **Historique des versions…** ouvre la liste des versions :

- À gauche : tous les instantanés, groupés par jour, avec l'heure et la taille.
- À droite : un aperçu ; pour les fichiers texte, **Comparer avec la version actuelle** affiche la version sélectionnée côte à côte avec le contenu actuel (l'ancienne version à gauche, l'état actuel à droite).
- **Restaurer** remplace le contenu actuel par la version sélectionnée. Ne vous inquiétez pas : l'état actuel est lui-même d'abord enregistré comme instantané — une restauration peut donc toujours être annulée.
- **Restaurer en tant que copie** crée la version sous forme de nouveau fichier à côté de l'original (`Name (Version 2026-07-05 14-30).md`) sans toucher à celui-ci.

Les images ont aussi des versions (avec aperçu) ; les autres fichiers binaires peuvent être restaurés sans aperçu.

## Restaurer des fichiers supprimés

Comme chaque suppression crée d'abord un instantané du fichier, Plainva peut ramener des fichiers supprimés : un clic droit sur le nom du vault en haut de l'arborescence → **Restaurer les fichiers supprimés…** (également accessible depuis les paramètres). La liste affiche tous les fichiers dont les instantanés existent encore alors que l'original a disparu — **Restaurer** recrée l'état le plus récent à l'emplacement d'origine (les dossiers sont recréés si nécessaire), **Versions…** ouvre l'historique complet du fichier supprimé.

Remarque : la suppression de tout un **dossier** le déplace vers la corbeille du système d'exploitation — dans ce cas, la corbeille du système est le premier moyen de récupération ; dans Plainva, vous ne trouverez éventuellement que d'anciens instantanés des fichiers qu'il contenait.

## Sauvegardes automatiques du vault (ZIP)

De plus, Plainva sauvegarde tout le vault sous forme de fichier ZIP — par défaut **une fois par jour** en arrière-plan (à l'ouverture du vault, si la dernière sauvegarde date de plus de 24 heures). Cela vous protège même si le dossier du vault lui-même est perdu ou endommagé, car les ZIP se trouvent **en dehors** du vault :

- La destination par défaut est le dossier de données de l'application (affiché sous **Dossier de destination** dans les paramètres ; **Ouvrir le dossier** vous y mène directement).
- Via **Choisir un dossier…**, vous pouvez à la place choisir un disque externe ou un NAS ; **Par défaut** revient au dossier de données de l'application. Si la destination est actuellement inaccessible (NAS éteint), la barre d'état le signale discrètement et Plainva réessaiera plus tard.
- **Sauvegardes à conserver** (par défaut : 7) limite le nombre ; les ZIP les plus anciens du même vault sont supprimés automatiquement. Les fichiers étrangers dans le dossier de destination ne sont jamais touchés.
- **Sauvegarder maintenant** démarre une sauvegarde manuellement à tout moment ; la barre d'état affiche l'exécution et son résultat.

Les fichiers ZIP sont nommés `VaultName_2026-07-05_14-30-00.zip` et contiennent toutes les notes, les pièces jointes et votre configuration `.obsidian` — ils ne contiennent **pas** le dossier interne `.plainva` (l'index de recherche est reconstruit à la prochaine ouverture ; les versions de fichiers ne font délibérément pas partie du ZIP).

**Restaurer à partir d'un ZIP :** le ZIP est une archive tout à fait normale. Extrayez-la où vous voulez et ouvrez le dossier extrait dans Plainva comme vault — c'est terminé.

## Paramètres en un coup d'œil

Paramètres → **Vault** → **Sauvegarde & historique des versions** :

| Paramètre | Par défaut | Signification |
|---|---|---|
| **Sauvegarde automatique du vault (ZIP)** | Activé | ZIP quotidien en arrière-plan |
| **Dossier de destination** | Dossier de données de l'application | Emplacement de stockage des ZIP, librement modifiable |
| **Sauvegardes à conserver** | 7 | Nombre de ZIP conservés |
| **Intervalle des instantanés** | 2 min | Fréquence maximale de création d'une nouvelle version de fichier pendant la frappe |
| **Versions par fichier** | 100 | Limite supérieure par fichier |
| **Âge maximal** | 90 jours | Les versions plus anciennes sont supprimées définitivement |

## Bon à savoir

- Les versions de fichiers sont de simples copies dans `.plainva/backups/` — en cas de besoin, vous pouvez les ouvrir sans Plainva dans n'importe quel gestionnaire de fichiers.
- La synchronisation propre de Plainva ne transfère jamais `.plainva`. Si vous synchronisez le dossier du vault avec un client tiers (p. ex. l'application Nextcloud), les instantanés voyagent avec lui — cela coûte un peu d'espace de stockage, mais ne cause aucun dommage.
- Les conflits de synchronisation sont en plus protégés via des fichiers `.CONFLICT` (voir la [FAQ](FAQ.md)) ; l'historique des versions complète cela avec la chronologie de chaque fichier.
