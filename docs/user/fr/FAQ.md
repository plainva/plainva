# FAQ & dépannage

Dernière mise à jour : 2026-07-07

Réponses aux questions les plus courantes — de la compatibilité Obsidian aux fichiers en conflit et aux sauvegardes.

## Fondamentaux

### Où vivent mes données ?

Exclusivement chez vous : un vault est un simple dossier de fichiers Markdown sur votre ordinateur. Plainva n'exécute aucun serveur propre et ne conserve de copies nulle part. Si vous synchronisez, cela se passe directement entre votre ordinateur et *votre* stockage (votre Nextcloud, votre OneDrive, votre bucket…). Les identifiants vivent dans le trousseau du système d'exploitation.

### Puis-je utiliser Plainva et Obsidian côte à côte ?

Oui — c'est une promesse fondamentale, avec une réserve honnête. Plainva écrit du Markdown pur avec un frontmatter standard ; tout ce qui est spécifique à Plainva est regroupé sous des clés `plainva:` (dans les notes et les fichiers `.base`), qu'Obsidian ignore simplement à l'ouverture des fichiers. Obsidian affiche la clé `plainva` comme un objet non modifiable dans ses propriétés — c'est sans conséquence. Les vues propres à Plainva comme Board ou Calendrier apparaissent dans Obsidian comme un simple tableau.

La réserve : **ouvrir est toujours sûr, modifier ne l'est pas toujours.** Un vault Obsidian existant peut être ouvert et modifié dans Plainva sans risque — rien n'est migré ni reformaté. Mais dès qu'un vault utilise des fonctionnalités Plainva (extensions de base de données comme les boards, les relations ou les colonnes inverses, des fichiers `index.md` gérés), modifier ces fichiers précis dans Obsidian peut casser la fonctionnalité Plainva, car Obsidian ne connaît pas les extensions `plainva:`. Les notes sans extension Plainva peuvent être modifiées partout, à tout moment. La première fois que vous utilisez une telle extension, un dialogue de rappel (**Extension Plainva**) le signale ; il peut être désactivé sous **Paramètres → Avertissements**.

### Plainva modifie-t-il mon vault existant ?

Pas sans vous demander. Les fichiers existants ne sont touchés que lorsque vous démarrez explicitement une action (p. ex. la [conversion OKF](OKF.md) — avec aperçu et sauvegardes). Seuls les fichiers nouvellement créés reçoivent automatiquement le petit en-tête frontmatter OKF.

## Fichiers & édition

### J'ai supprimé quelque chose — est-ce perdu ?

Non, à double titre : avant chaque suppression, Plainva enregistre le fichier comme instantané — un clic droit sur le nom du vault → **Restaurer les fichiers supprimés…** le ramène dans l'application. De plus, les fichiers et dossiers supprimés vont dans la corbeille du système d'exploitation (pour des dossiers entiers, la corbeille est le premier moyen de récupération). Détails : [Sauvegardes & historique des versions](Backups_and_Versioning.md).

### Existe-t-il d'anciennes versions de mes notes ?

Oui : Plainva crée automatiquement des versions de fichiers pendant que vous éditez. Un clic droit sur un fichier → **Historique des versions…** affiche tous les instantanés avec une vue de comparaison et **Restaurer**. De plus, Plainva sauvegarde tout le vault une fois par jour sous forme de ZIP en dehors du dossier du vault. Détails : [Sauvegardes & historique des versions](Backups_and_Versioning.md).

### Pourquoi mon index.md est-il en lecture seule ?

Il a été généré par Plainva et est maintenu à jour automatiquement (reconnaissable à la bannière « Cet index.md est géré par Plainva… »). **Modifier quand même** vous le confie durablement pour une gestion manuelle — il ne se mettra plus à jour automatiquement. Détails : [OKF](OKF.md).

### Que se passe-t-il quand je renomme une propriété dans une base de données ?

Le nouveau nom est écrit dans le frontmatter de **chaque note correspondante** (après confirmation, avec un indicateur de progression). Le même principe s'applique à la suppression : la case à cocher **Aussi la retirer du frontmatter des notes** nettoie également les notes sources. Les deux actions agissent donc sur vos fichiers — c'est exactement leur raison d'être.

### Puis-je annuler la conversion OKF ?

Avant toute modification, l'assistant sauvegarde le fichier dans `.plainva/backups/okf-conversion-<horodatage>/`. Le rapport final indique le dossier exact ; vous pouvez y recopier des fichiers individuels. Utilisez aussi l'**Aperçu (sans modifications)** avant de convertir.

## Synchronisation

### Qu'est-ce qu'un fichier .CONFLICT ?

Si le même fichier a été modifié ici et sur un autre appareil en même temps, Plainva essaie d'abord de fusionner automatiquement les deux versions. Si ce n'est pas possible, **votre** version est enregistrée en sécurité comme fichier `.CONFLICT` à côté de l'original — rien n'est jamais perdu. Les fichiers en conflit sont signalés dans l'arborescence de fichiers ; un clic droit permet de choisir **Conserver cette version** (la version en conflit remplace l'original) ou **Rejeter le conflit**.

### Ma connexion Google expire sans cesse

Avec la configuration « Bring Your Own », votre projet Google reste en mode test ; Google met alors fin à la session au bout de 7 jours. Plainva renouvelle les jetons automatiquement en arrière-plan, mais une fois expirée, utilisez **Se reconnecter** dans les paramètres de synchronisation. Détails : [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

### Mon vault vit dans un dossier OneDrive/Dropbox/iCloud et Plainva se comporte étrangement

Réglez le dossier du vault sur « toujours conserver sur cet appareil » / « disponible hors ligne » dans le client de synchronisation du fournisseur. Les fichiers d'espace réservé en ligne uniquement (Files On-Demand, « en ligne uniquement ») perturbent l'indexation et la synchronisation. Détails : [Compatibilité de synchronisation](Sync_Compatibility.md).

### Je suis hors ligne — qu'advient-il de mes modifications ?

Elles sont enregistrées localement comme d'habitude et rassemblées dans une file d'attente ; dès que la connexion revient, Plainva les transfère automatiquement. La barre d'état affiche **En ligne**/**Hors ligne**.

### La barre d'état indique Hors ligne alors que j'ai internet

Alors c'est la connexion de synchronisation elle-même qui est rompue — souvent parce que la connexion a expiré ou que les identifiants ont changé (p. ex. avec Google Drive). Cliquez sur **Hors ligne** dans la barre d'état ou sur le triangle d'avertissement à côté du nom du vault : le dialogue affiche le message d'erreur exact, et **Ouvrir les paramètres de synchronisation** vous amène directement au formulaire du fournisseur concerné où vous rétablissez la connexion (p. ex. **Se reconnecter**). Chaque clic déclenche aussi immédiatement une nouvelle tentative de synchronisation.

## Application

### Pourquoi F5 ne recharge-t-il pas, et où est le menu contextuel du navigateur ?

Plainva est une application de bureau, pas une page web. Les touches de rechargement (F5, Ctrl+R) sont désactivées volontairement — un rechargement supprimerait vos onglets ouverts et vos modifications non enregistrées. Le menu contextuel intégré de la WebView est également masqué ; un clic droit sur du texte sélectionné propose toujours **Copier**, et l'arborescence des fichiers, les onglets et les tableaux conservent leurs propres menus contextuels.

### Comment changer la langue ?

**Paramètres → Général → Langue** (actuellement allemand et anglais).

### « Rechercher des mises à jour » ne trouve rien

Tant qu'il n'y a pas encore de releases publiques, la vérification des mises à jour signale : « Aucune mise à jour publique (release) n'est encore disponible. » Ce n'est pas une erreur.

### Y a-t-il des fonctionnalités cachées ?

Starfleet ne commente jamais les rumeurs. Mais il paraît que le logo dans la barre de titre réagit à des coups persistants — et que quiconque connaît ensuite les mots justes verra Plainva sous un tout autre jour. Certains disent : au nombre de quatre.

## Voir aussi

- [Configurer la synchronisation](Sync_Setup.md) et [Compatibilité de synchronisation](Sync_Compatibility.md)
- [OKF](OKF.md) — conversion, index.md, champs système
