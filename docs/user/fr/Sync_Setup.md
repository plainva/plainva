# Configurer la synchronisation

Dernière mise à jour : 2026-07-17

Plainva synchronise facultativement chaque vault avec un stockage de votre choix — directement depuis l'application, sans aucun service intermédiaire géré par Plainva : vos données circulent exclusivement entre votre ordinateur et votre propre compte/serveur. Cette page vous guide dans la configuration selon le fournisseur.

Quels services fonctionnent en général (aussi via WebDAV ou le client de bureau du fournisseur) est couvert dans [Compatibilité de synchronisation](Sync_Compatibility.md).

## Notions de base

- La configuration se trouve sous **Paramètres → Vault → Synchronisation**. Le **Fournisseur de synchronisation** est choisi par vault : **Aucun (local uniquement)**, **WebDAV / Nextcloud**, **Google Drive**, **OneDrive**, **Dropbox** ou **Stockage compatible S3** — toujours exactement un par vault.
- **Ouvrir un vault en ligne existant depuis l'écran d'accueil** : **Ouvrir un vault** → **Vault en ligne** vous guide, pour chaque fournisseur, par les mêmes trois étapes — **1. Se connecter** (s'identifier ou saisir les identifiants), **2. Choisir le dossier dans le cloud** (un nouveau dossier peut aussi y être créé via **Nouveau dossier**), **3. Choisir ou créer le dossier local**. Vous pouvez aussi configurer la synchronisation à tout moment pour un vault déjà ouvert, depuis les Paramètres.
- **Créer un nouveau vault dans le cloud** : **Nouveau vault** → **Chez un service en ligne** — choisissez d'abord la structure de départ (vide ou un modèle comme PARA), puis connectez-vous et choisissez le dossier cible dans le cloud ou créez-le via **Nouveau dossier**, enfin le dossier local. La structure est créée dans le dossier local et envoyée automatiquement lors de la première synchronisation.
- Les enregistrements locaux sont téléversés immédiatement ; Plainva vérifie les modifications distantes selon l'**Intervalle de synchronisation (secondes)** configuré.
- Les modifications hors ligne sont mises en file d'attente et transférées au prochain contact ; la barre d'état affiche **En ligne**/**Hors ligne** et l'indicateur de synchronisation montre l'état (**Synchroniser maintenant** au clic). Lors d'une synchronisation longue ou initiale, la barre d'état affiche la progression sous forme de compteur (p. ex. **Sync 123/540**), pour que vous puissiez voir qu'elle parcourt le vault.
- La première fois que vous connectez un vault en ligne, une note ponctuelle vous rappelle que la synchronisation initiale peut prendre du temps selon la taille du vault — vous pouvez continuer à travailler pendant ce temps.
- Si les deux côtés modifient le même fichier, Plainva les fusionne automatiquement (fusion à 3 voies). Si ce n'est pas possible, votre version est préservée en sécurité comme fichier `.CONFLICT` — rien n'est jamais perdu (voir [FAQ](FAQ.md)).
- **Résoudre les conflits** : une bannière dans la note concernée (et **Résoudre le conflit…** dans le menu contextuel du fichier `.CONFLICT` dans l'arborescence) ouvre la boîte de dialogue de comparaison — l'état actuel du fichier à gauche, votre version conservée à droite, modifiable avec reprise par bloc. **Enregistrer la version de droite et résoudre** écrit le résultat dans le fichier et supprime la copie de conflit ; **Garder l'autre côté** abandonne votre copie (un instantané de version subsiste). La boîte de dialogue d'erreur de synchronisation liste elle aussi les copies de conflit existantes et vous mène à la même comparaison en un clic.
- **Protection contre les suppressions en masse** : si une part inhabituellement grande des fichiers synchronisés est sur le point d'être supprimée d'un coup dans le cloud (par exemple parce que le dossier local du vault a été vidé ou déplacé), Plainva suspend les suppressions et demande d'abord confirmation : **Supprimer dans le cloud** les exécute, **Ne pas supprimer (restaurer)** les abandonne et restaure les fichiers depuis le cloud lors de la prochaine synchronisation. Les suppressions que vous avez confirmées vous-même dans Plainva ne sont pas retenues — pour les suppressions importantes (plus de 10 fichiers ou plus de 20 % du vault), Plainva demande plutôt une seconde confirmation avant de supprimer.
- Les pièces jointes (images etc.) sont également synchronisées.
- Les **dossiers vides** sont également synchronisés : un dossier créé dans Plainva apparaît immédiatement dans le cloud, et les dossiers vides du cloud apparaissent sur vos autres appareils au plus tard lors du prochain inventaire complet.
- Les identifiants et jetons sont stockés dans le trousseau du système d'exploitation (statut : **Paramètres → App → À propos et diagnostic → Trousseau du système**), jamais dans des fichiers à l'intérieur du vault.
- **Déconnecter** arrête la synchronisation du vault ; aucun fichier n'est supprimé nulle part par cette action.

## WebDAV / Nextcloud

La voie la plus simple pour les serveurs auto-hébergés et la plupart des stockages cloud :

1. Réglez le **Fournisseur de synchronisation** sur **WebDAV / Nextcloud**.
2. Saisissez l'**URL du serveur**, le **Nom d'utilisateur** et le **Mot de passe ou jeton d'application** — utilisez un mot de passe d'application au lieu de votre mot de passe principal dès que possible (dans Nextcloud : Paramètres → Sécurité → Mots de passe d'application).
3. Choisissez le dossier cible via **Parcourir le serveur**, puis **Enregistrer**.

Les adresses de serveur typiques (Nextcloud, Koofr, MagentaCLOUD, Storage Box et bien d'autres) sont listées dans [Compatibilité de synchronisation](Sync_Compatibility.md).

## Google Drive

Google Drive fonctionne actuellement avec vos propres identifiants (« Bring Your Own ») : vous créez une fois un projet Google Cloud gratuit, qui vous appartient exclusivement. Le guide étape par étape : [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Version courte : saisissez l'**ID client** et le **Secret client** de votre projet Google, définissez le **Dossier Drive (nom)** (par défaut « Plainva »), puis **Se connecter à Google** — la connexion s'ouvre dans votre navigateur. Une fois connecté, choisissez le dossier via **Choisir un dossier…** directement depuis votre Drive (sous-dossiers inclus) au lieu de saisir son nom. Remarque : tant que le projet Google est en mode test, la connexion expire au bout de 7 jours et doit être renouvelée via **Se reconnecter**.

## OneDrive

Plainva fournit sa propre inscription d'application — vous **n'avez plus besoin de votre propre ID** :

1. Réglez le **Fournisseur de synchronisation** sur **OneDrive** ; définissez éventuellement le **Dossier OneDrive (nom)** (par défaut « Plainva »).
2. **Se connecter à Microsoft** et confirmez la connexion dans le navigateur. Terminé — Plainva crée le dossier et synchronise tout son contenu, y compris les fichiers ajoutés depuis l'extérieur.
3. Facultatif : une fois connecté, choisissez le dossier cible via **Choisir un dossier…** directement depuis votre OneDrive (sous-dossiers inclus) au lieu de saisir son nom.

Facultatif : via **Utiliser votre propre ID d'application**, vous pouvez saisir à la place un ID client auto-enregistré (p. ex. en cas de restrictions d'entreprise). Guide détaillé : [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Dropbox

Plainva fournit sa propre application Dropbox — **aucune application personnelle nécessaire** :

1. Réglez le **Fournisseur de synchronisation** sur **Dropbox** ; définissez éventuellement le **Dossier Dropbox (chemin)** (par défaut `/Plainva`).
2. **Se connecter à Dropbox** et confirmez dans le navigateur. Terminé.
3. Facultatif : une fois connecté, choisissez le dossier cible via **Choisir un dossier…** directement depuis votre Dropbox (sous-dossiers inclus) au lieu de saisir son chemin.

Facultatif : via **Utiliser votre propre ID d'application**, vous pouvez saisir à la place une clé d'application auto-enregistrée. Guide détaillé : [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Stockage compatible S3

Pour AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner et d'autres — par clés, sans aucune connexion via navigateur :

| Champ | Signification |
|---|---|
| **Endpoint** | URL de base de l'API S3, p. ex. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` ou `http://127.0.0.1:9000` pour MinIO local |
| **Bucket** | Nom du bucket |
| **Région** | Région SigV4 ; `us-east-1` fonctionne pour la plupart des stockages non-AWS, Cloudflare R2 utilise `auto` |
| **Access Key ID** / **Secret Access Key** | Une paire de clés API du fournisseur |
| **Préfixe de clé (facultatif)** | Sous-dossier dans le bucket pour le vault ; vide = racine du bucket |
| **URL path-style** | Recommandé (MinIO, R2 et la plupart des services compatibles) ; à désactiver seulement pour les buckets AWS en mode virtual-hosted |

Vous pouvez aussi choisir le **Préfixe de clé** via **Choisir un dossier…** directement depuis le bucket — cela fonctionne déjà avant l'enregistrement, dès que l'endpoint, le bucket et les clés sont renseignés.

Après **Appliquer**, la synchronisation démarre immédiatement.

## Voir aussi

- [Compatibilité de synchronisation](Sync_Compatibility.md) — quels services fonctionnent et comment, y compris la voie du client de bureau
- [FAQ & dépannage](FAQ.md) — fichiers en conflit, comportement hors ligne
