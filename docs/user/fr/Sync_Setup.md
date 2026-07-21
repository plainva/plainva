# Configurer la synchronisation

Dernière mise à jour : 2026-07-20

Plainva synchronise facultativement chaque vault avec un stockage de votre choix — directement depuis l'application, sans aucun service intermédiaire géré par Plainva : vos données circulent exclusivement entre votre ordinateur et votre propre compte/serveur. Cette page vous guide dans la configuration selon le fournisseur.

Quels services fonctionnent en général (aussi via WebDAV ou le client de bureau du fournisseur) est couvert dans [Compatibilité de synchronisation](Sync_Compatibility.md).

## Notions de base

- La configuration se trouve sous **Paramètres → Vault → Comptes cloud** : **Connecter un compte…** ouvre l'assistant — choisissez d'abord le **fournisseur**, puis cochez les **services** (pour la synchronisation de fichiers : **Fichiers**), puis connectez-vous. La vue en tuiles liste les fournisseurs par popularité réelle ; **Rechercher un fournisseur…** permet aussi de trouver les fournisseurs de messagerie proposés en préréglage. **Un seul** compte par vault porte le service **Fichiers**. La zone **Synchronisation** affiche ensuite le compte connecté avec son **Dossier cloud** et gère le comportement (**Intervalle de synchronisation**, file d'attente) ; **Gérer le compte** ramène vers les comptes cloud.
- Pour le service **Fichiers**, outre **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Stockage objet (S3)** et le générique **WebDAV / CalDAV**, les tuiles incluent aussi **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** et **pCloud** : là, votre adresse e-mail plus un **mot de passe d'application** suffisent — les adresses de serveur sont déjà renseignées (basé sur WebDAV ; modifiable via **Avancé : définir les endpoints individuellement**).
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

1. Dans **Comptes cloud** → **Connecter un compte…**, choisissez la tuile **Nextcloud** (ou **WebDAV / CalDAV**).
2. Saisissez l'**Adresse du serveur**, le **Nom d'utilisateur** et le **Mot de passe ou jeton d'application** — utilisez un mot de passe d'application au lieu de votre mot de passe principal dès que possible (dans Nextcloud : Paramètres → Sécurité → Mots de passe d'application).
3. **Connecter** valide les identifiants ; choisissez ensuite le **Dossier cloud** via **Choisir un dossier…**.

Particularité **Nextcloud** : UN seul formulaire couvre les fichiers **et** le calendrier — Plainva déduit les endpoints WebDAV et CalDAV directement de l'adresse du serveur (les adresses déduites s'affichent dans l'assistant ; **Avancé : définir les endpoints individuellement** permet des URL séparées). Cochez les deux services et une seule connexion suffit pour les deux.

Les adresses de serveur typiques (Nextcloud, Koofr, MagentaCLOUD, Storage Box et bien d'autres) sont listées dans [Compatibilité de synchronisation](Sync_Compatibility.md).

## Google Drive

Google Drive fonctionne actuellement avec vos propres identifiants (« Bring Your Own ») : vous créez une fois un projet Google Cloud gratuit, qui vous appartient exclusivement. Le guide étape par étape : [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Version courte : dans **Comptes cloud** → **Connecter un compte…**, choisissez la tuile **Google**, cochez le service **Fichiers**, saisissez l'**ID client** et le **Secret client** de votre projet Google, puis **Se connecter avec Google…** — la connexion s'ouvre dans votre navigateur. Une fois connecté, choisissez le **Dossier cloud** via **Choisir un dossier…** directement depuis votre Drive (sous-dossiers inclus, par défaut « Plainva »). Remarque : tant que le projet Google est en mode test, la connexion expire au bout de 7 jours et doit être renouvelée via **Se reconnecter** dans les détails du compte.

## OneDrive

Plainva fournit sa propre inscription d'application — vous **n'avez plus besoin de votre propre ID** :

1. Dans **Comptes cloud** → **Connecter un compte…**, choisissez la tuile **Microsoft** et cochez le service **Fichiers** (OneDrive) — sur demande avec **Calendrier et tâches** et **E-mail** (un compte Microsoft peut porter les trois services).
2. **Se connecter avec Microsoft…** et confirmez la connexion dans le navigateur. Terminé — Plainva crée le dossier (par défaut « Plainva ») et synchronise tout son contenu, y compris les fichiers ajoutés depuis l'extérieur.
3. Facultatif : une fois connecté, choisissez le **Dossier cloud** via **Choisir un dossier…** directement depuis votre OneDrive (sous-dossiers inclus).

Facultatif : via **Utiliser votre propre ID d'application**, vous pouvez saisir à la place un ID client auto-enregistré (p. ex. en cas de restrictions d'entreprise). Guide détaillé : [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Dropbox

Plainva fournit sa propre application Dropbox — **aucune application personnelle nécessaire** :

1. Dans **Comptes cloud** → **Connecter un compte…**, choisissez la tuile **Dropbox** (elle ne porte que le service **Fichiers**).
2. **Se connecter avec Dropbox…** et confirmez dans le navigateur. Terminé (dossier par défaut `/Plainva`).
3. Facultatif : une fois connecté, choisissez le **Dossier cloud** via **Choisir un dossier…** directement depuis votre Dropbox (sous-dossiers inclus).

Facultatif : via **Utiliser votre propre ID d'application**, vous pouvez saisir à la place une clé d'application auto-enregistrée. Guide détaillé : [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Stockage compatible S3

Pour AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner et d'autres — par clés, sans aucune connexion via navigateur. Dans **Comptes cloud** → **Connecter un compte…**, choisissez la tuile **Stockage objet (S3)** et remplissez les champs :

| Champ | Signification |
|---|---|
| **Endpoint** | URL de base de l'API S3, p. ex. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` ou `http://127.0.0.1:9000` pour MinIO local |
| **Bucket** | Nom du bucket |
| **Région** | Région SigV4 ; `us-east-1` fonctionne pour la plupart des stockages non-AWS, Cloudflare R2 utilise `auto` |
| **Access Key ID** / **Secret Access Key** | Une paire de clés API du fournisseur |
| **Préfixe de clé (facultatif)** | Sous-dossier dans le bucket pour le vault ; vide = racine du bucket |
| **URL path-style** | Recommandé (MinIO, R2 et la plupart des services compatibles) ; à désactiver seulement pour les buckets AWS en mode virtual-hosted |

Vous pouvez choisir le **Préfixe de clé** (le dossier cloud) via **Choisir un dossier…** directement depuis le bucket une fois connecté.

Après **Connecter**, la synchronisation démarre immédiatement.

## Voir aussi

- [Compatibilité de synchronisation](Sync_Compatibility.md) — quels services fonctionnent et comment, y compris la voie du client de bureau
- [FAQ & dépannage](FAQ.md) — fichiers en conflit, comportement hors ligne

## Chiffrement de synchronisation (phrase de passe)

Plainva peut chiffrer ce qui quitte votre appareil vers le serveur de synchronisation, tandis que votre vault local reste toujours en Markdown brut, lisible par Obsidian.

Ouvrez **Paramètres → Synchronisation → Phrase de passe de synchronisation et chiffrement** :

1. **Définir une phrase de passe.** Cela crée une clé de chiffrement pour le vault et affiche un **code de récupération** à usage unique — conservez-le en lieu sûr ; c'est le seul moyen de revenir si vous oubliez la phrase de passe. À partir de là, les **paramètres** synchronisés du vault circulent chiffrés.
2. **Chiffrer le contenu du vault** (facultatif). Le bouton **Chiffrer** retéléverse chaque note vers le serveur de synchronisation sous forme de texte chiffré. Vos fichiers locaux restent en Markdown brut, un vault local n'est donc jamais en danger — essayez d'abord sur un vault jetable. Une fois le téléversement terminé, utilisez **Terminer la migration** pour n'accepter plus que du texte chiffré à partir de là.
3. **Sur un autre appareil**, ouvrez le même vault synchronisé. Plainva détecte que le vault est chiffré et demande la phrase de passe (ou le code de récupération). Une fois déverrouillé, les notes sont déchiffrées et apparaissent localement.

La clé déverrouillée est mise en cache sur chaque appareil. Activez **Exiger la phrase de passe à chaque démarrage** pour la ressaisir après chaque redémarrage à la place, et utilisez **Verrouiller** pour supprimer la clé mise en cache sur cet appareil.
