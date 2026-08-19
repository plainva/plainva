# Configurer la synchronisation

Dernière mise à jour : 2026-08-19
Plainva synchronise facultativement chaque vault avec un stockage de votre choix — directement depuis l'application, sans aucun service intermédiaire géré par Plainva : vos données circulent exclusivement entre votre ordinateur et votre propre compte/serveur. Cette page vous guide dans la configuration selon le fournisseur.

Quels services fonctionnent en général (aussi via WebDAV ou le client de bureau du fournisseur) est couvert dans [Compatibilité de synchronisation](Sync_Compatibility.md).

## Notions de base

- La configuration se trouve sous **Paramètres → Vault → Comptes cloud** : **Connecter un compte…** ouvre l'assistant — choisissez d'abord le **fournisseur**, puis cochez les **services** (pour la synchronisation de fichiers : **Fichiers**), puis connectez-vous. La vue en tuiles liste les fournisseurs par popularité réelle ; **Rechercher un fournisseur…** permet aussi de trouver les fournisseurs de messagerie proposés en préréglage. **Un seul** compte par vault porte le service **Fichiers**. La zone **Synchronisation** affiche ensuite le compte connecté avec son **Dossier cloud** et gère le comportement (**Intervalle de synchronisation**, file d'attente) ; **Gérer le compte** ramène vers les comptes cloud.
- Pour le service **Fichiers**, outre **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Stockage objet (S3)** et le générique **WebDAV / CalDAV**, les tuiles incluent aussi **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** et **pCloud** : là, votre adresse e-mail plus un **mot de passe d'application** suffisent — les adresses de serveur sont déjà renseignées (basé sur WebDAV ; modifiable via **Avancé : définir les endpoints individuellement**).
- **Ouvrir un vault en ligne existant depuis l'écran d'accueil** : **Ouvrir un vault** → **Vault en ligne** vous guide, pour chaque fournisseur, par les mêmes trois étapes — **1. Se connecter** (s'identifier ou saisir les identifiants), **2. Choisir le dossier dans le cloud** (un nouveau dossier peut aussi y être créé via **Nouveau dossier**), **3. Choisir ou créer le dossier local**. Vous pouvez aussi configurer la synchronisation à tout moment pour un vault déjà ouvert, depuis les Paramètres.
- **Créer un nouveau vault dans le cloud** : **Nouveau vault** → **Chez un service en ligne** — choisissez d'abord la structure de départ (vide ou un modèle comme PARA), puis connectez-vous et choisissez le dossier cible dans le cloud ou créez-le via **Nouveau dossier**, enfin le dossier local. La structure est créée dans le dossier local et envoyée automatiquement lors de la première synchronisation.
- Les enregistrements locaux sont téléversés immédiatement ; Plainva vérifie les modifications distantes selon l'**Intervalle de synchronisation (secondes)** configuré.
- Les modifications hors ligne sont mises en file d'attente et transférées au prochain contact ; la barre d'état affiche **En ligne**/**Hors ligne** et l'indicateur de synchronisation montre l'état (**Synchroniser maintenant** au clic). Lors d'une synchronisation longue ou initiale, la barre d'état affiche la progression sous forme de compteur (p. ex. **Sync 123/540**), pour que vous puissiez voir qu'elle parcourt le vault.
- Si les deux côtés modifient le même fichier, Plainva les fusionne automatiquement (fusion à 3 voies). Si ce n'est pas possible, votre version est préservée en sécurité comme fichier `.CONFLICT` — rien n'est jamais perdu (voir [FAQ](FAQ.md)).
- **Résoudre les conflits** : une bannière dans la note concernée (et **Résoudre le conflit…** dans le menu contextuel du fichier `.CONFLICT` dans l'arborescence) ouvre la boîte de dialogue de comparaison — l'état actuel du fichier à gauche, votre version conservée à droite, modifiable avec reprise par bloc. **Enregistrer la version de droite et résoudre** écrit le résultat dans le fichier et supprime la copie de conflit ; **Garder l'autre côté** abandonne votre copie (un instantané de version subsiste). La boîte de dialogue d'erreur de synchronisation liste elle aussi les copies de conflit existantes et vous mène à la même comparaison en un clic.
- **Protection contre les suppressions en masse** : si une part inhabituellement grande des fichiers synchronisés est sur le point d'être supprimée d'un coup dans le cloud (par exemple parce que le dossier local du vault a été vidé ou déplacé), Plainva suspend les suppressions et demande d'abord confirmation : **Supprimer dans le cloud** les exécute, **Ne pas supprimer (restaurer)** les abandonne et restaure les fichiers depuis le cloud lors de la prochaine synchronisation. Les suppressions que vous avez confirmées vous-même dans Plainva ne sont pas retenues — pour les suppressions importantes (plus de 10 fichiers ou plus de 20 % du vault), Plainva demande plutôt une seconde confirmation avant de supprimer.
- Les pièces jointes (images etc.) sont également synchronisées.
- Les **dossiers vides** sont également synchronisés : un dossier créé dans Plainva apparaît immédiatement dans le cloud, et les dossiers vides du cloud apparaissent sur vos autres appareils au plus tard lors du prochain inventaire complet.
- Les identifiants et jetons sont stockés dans le trousseau du système d'exploitation (statut : **Paramètres → App → À propos et diagnostic → Trousseau du système**), jamais dans des fichiers à l'intérieur du vault.
- **Accès enregistrés** (**Réglages → Vault → Synchronisation**) montre ce que Plainva a déposé dans le trousseau — y compris des entrées de vaults que tu n'ouvres plus depuis longtemps. Chaque ligne nomme le service et le vault ; **Supprimer** demande confirmation. Plainva n'y supprime jamais rien de lui-même.
- Les entrées du trousseau portent des **noms lisibles** — `plainva · <vault> · <service> · <id de compte> · #<empreinte>` au lieu d'une chaîne base64. Plainva renomme une seule fois les entrées existantes, à la première ouverture d'un vault ; si un renommage ne peut pas aboutir en toute sécurité, l'ancienne entrée reste en place et Plainva réessaie à l'ouverture suivante.
- **Déconnecter** arrête la synchronisation du vault ; aucun fichier n'est supprimé nulle part par cette action.
- **`http://` est autorisé, `https://` est la recommandation.** Un serveur que vous exploitez vous-même sur votre propre réseau parle généralement `http` en clair — cela fonctionne aussi sur le téléphone. Sur Internet, vous ne devriez pas le faire : WebDAV envoie votre mot de passe à **chaque** requête, en clair via `http`. Si vous saisissez une adresse non chiffrée en dehors de votre propre réseau, Plainva vous le signale dans le formulaire — sans vous en empêcher.

## WebDAV / Nextcloud

La voie la plus simple pour les serveurs auto-hébergés et la plupart des stockages cloud :

1. Dans **Comptes cloud** → **Connecter un compte…**, choisissez la tuile **Nextcloud** (ou **WebDAV / CalDAV**).
2. Saisissez l'**Adresse du serveur**, le **Nom d'utilisateur** et le **Mot de passe ou jeton d'application** — utilisez un mot de passe d'application au lieu de votre mot de passe principal dès que possible (dans Nextcloud : Paramètres → Sécurité → Mots de passe d'application).
3. **Connecter** valide les identifiants ; choisissez ensuite le **Dossier cloud** via **Choisir un dossier…**.

Particularité **Nextcloud** : UN seul formulaire couvre les fichiers **et** le calendrier — Plainva déduit les endpoints WebDAV et CalDAV directement de l'adresse du serveur (les adresses déduites s'affichent dans l'assistant ; **Avancé : définir les endpoints individuellement** permet des URL séparées). Cochez les deux services et une seule connexion suffit pour les deux.

Les adresses de serveur typiques (Nextcloud, Koofr, MagentaCLOUD, Storage Box et bien d'autres) sont listées dans [Compatibilité de synchronisation](Sync_Compatibility.md).

Si le mot de passe d'application change plus tard, saisissez-le **une seule fois** dans les détails du compte sous **Identifiants** : Plainva le vérifie sur chaque service de ce compte et ne l'enregistre que si tous l'acceptent — aucun service ne reste ainsi sur un ancien mot de passe.

## Google Drive

Google Drive fonctionne actuellement avec vos propres identifiants (« Bring Your Own ») : vous créez une fois un projet Google Cloud gratuit, qui vous appartient exclusivement. Le guide étape par étape : [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Version courte : dans **Comptes cloud** → **Connecter un compte…**, choisissez la tuile **Google**, cochez le service **Fichiers**, saisissez l'**ID client** et le **Secret client** de votre projet Google, puis **Se connecter avec Google…** — la connexion s'ouvre dans votre navigateur. Une fois connecté, choisissez le **Dossier cloud** via **Choisir un dossier…** directement depuis votre Drive (sous-dossiers inclus, par défaut « Plainva »). Remarque : tant que votre projet Google reste en mode **Testing**, la connexion expire au bout de **7 jours** — définitivement, car dans ce mode Google laisse aussi expirer le jeton de renouvellement, et Plainva ne peut donc pas la rafraîchir en arrière-plan. La synchronisation vous indique alors que la connexion a expiré, et **Se reconnecter** dans les détails du compte la rétablit — un aller-retour pour **tous** les services de ce compte. Si vous préférez ne pas faire cela chaque semaine, faites passer le projet Google **en production** dans la console : la connexion reste alors valide durablement (pour une application non vérifiée, Google affiche une fois un écran d'avertissement que vous pouvez confirmer en tant que propriétaire).

Si vous cochez **Fichiers** et **Agenda** ensemble lors de la connexion, Google ne demande votre consentement qu'**une seule fois**, en réclamant exactement les droits des services choisis. Ajouter un service plus tard donne lieu à un second consentement complémentaire.

## OneDrive

Plainva fournit sa propre inscription d'application — vous **n'avez plus besoin de votre propre ID** :

1. Dans **Comptes cloud** → **Connecter un compte…**, choisissez la tuile **Microsoft** et cochez le service **Fichiers** (OneDrive) — sur demande avec **Calendrier et tâches** et **E-mail** (un compte Microsoft peut porter les trois services).
2. **Se connecter avec Microsoft…** et confirmez la connexion dans le navigateur. Terminé — Plainva crée le dossier (par défaut « Plainva ») et synchronise tout son contenu, y compris les fichiers ajoutés depuis l'extérieur.
3. Facultatif : une fois connecté, choisissez le **Dossier cloud** via **Choisir un dossier…** directement depuis votre OneDrive (sous-dossiers inclus).

Facultatif : via **Utiliser votre propre ID d'application**, vous pouvez saisir à la place un ID client auto-enregistré (p. ex. en cas de restrictions d'entreprise). Guide détaillé : [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

Si vous connectez plusieurs services d'un même compte ensemble — par exemple **Fichiers** et **Calendrier** —, le fournisseur ne demande votre consentement qu'**une seule fois**, et Plainva conserve une connexion unique pour tout le compte. Cela vaut pour **Microsoft** (fichiers, calendrier, e-mail) comme pour **Google** (fichiers et calendrier ; une boîte Gmail reste en dehors, car elle fonctionne via IMAP avec un mot de passe d'application et ne nécessite aucun consentement).

Les comptes encore connectés service par service portent la mention **Ancienne connexion** dans la liste des comptes et proposent **Une connexion pour tous les services** — dans la liste des comptes et dans les détails du compte, aussi bien sur l'ordinateur que dans l'[application mobile](Mobile_App.md). Un aller-retour, et ensuite tous les services partagent la même connexion. C'est plus qu'une simple commodité : des connexions séparées pouvaient diverger, laissant un service continuer à fonctionner pendant qu'un autre du même compte avait discrètement expiré. Pour ces comptes, **Se reconnecter** renouvelle désormais tout le compte au lieu d'un seul service. La proposition reste également affichée lorsqu'une connexion partagée existe déjà mais ne couvre pas tous les services du compte — parce que vous avez laissé une case décochée sur l'écran de consentement, par exemple ; Google ne peut pas élargir un consentement déjà accordé.

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

> **Remplacé en P3 :** Les instructions suivantes ne s’appliquent plus au contenu. Utilisez [Sécurité et partage](Security_and_Sharing.md). La phrase restante ici protège seulement les paramètres et secrets facultatifs.

Plainva peut chiffrer ce qui quitte votre appareil vers le serveur de synchronisation, tandis que votre vault local reste toujours en Markdown brut, lisible par Obsidian.

Ouvrez **Paramètres → Synchronisation → Phrase de passe de synchronisation et chiffrement** :

1. **Définir une phrase de passe.** Cela crée une clé de chiffrement pour le vault et affiche un **code de récupération** à usage unique — conservez-le en lieu sûr ; c'est le seul moyen de revenir si vous oubliez la phrase de passe. À partir de là, les **paramètres** synchronisés du vault circulent chiffrés.
2. **Chiffrer le contenu du vault** (facultatif). Le bouton **Chiffrer** retéléverse chaque note vers le serveur de synchronisation sous forme de texte chiffré. Vos fichiers locaux restent en Markdown brut, un vault local n'est donc jamais en danger — essayez d'abord sur un vault jetable. Une fois le téléversement terminé, utilisez **Terminer la migration** pour n'accepter plus que du texte chiffré à partir de là.
3. **Sur un autre appareil**, ouvrez le même vault synchronisé. Plainva détecte que le vault est chiffré et demande la phrase de passe (ou le code de récupération). Une fois déverrouillé, les notes sont déchiffrées et apparaissent localement.

La clé déverrouillée est mise en cache sur chaque appareil. Activez **Exiger la phrase de passe à chaque démarrage** pour la ressaisir après chaque redémarrage à la place, et utilisez **Verrouiller** pour supprimer la clé mise en cache sur cet appareil.

**Comptes sur tous vos appareils** se compose de trois étapes. **1 · Réglages et comptes** : place les réglages du coffre *et vos comptes* (agendas, boîtes mail, sélection d’agendas) dans un petit fichier du coffre — tant qu'aucune phrase de passe n'est configurée, cela n'en nécessite **aucune** ; dès qu'il en existe une, chaque appareil doit la saisir avant que les réglages ne circulent depuis lui. **2 · Phrase de passe de synchronisation** (facultatif) : nécessaire seulement si les connexions doivent voyager elles aussi ; elle chiffre en plus les réglages de l’étape 1. **3 · Emporter les connexions** : emporte en plus les mots de passe IMAP et CalDAV statiques, chiffrés, et ne peut être activé qu’une fois l’étape 1 en marche et la phrase de passe déverrouillée — un mot de passe ne peut rejoindre qu’un compte que l’appareil connaît déjà. Ne sont pas emportés : les chemins propres à l’appareil et les connexions OAuth (Microsoft, Google) ; leurs jetons sont liés à l’appareil, le compte apparaît donc sur le nouvel appareil et y demande une fois **Se connecter**.

Sur le **téléphone**, la même chaîne figure sur la page du coffre — mêmes trois étapes, même verrouillage. Les comptes venant d’un autre appareil y sont créés ; vous ne les ressaisissez plus. **Récupérer depuis un autre appareil** les obtient immédiatement, sans attendre la synchronisation suivante.

Si Plainva signale qu’une **ancienne version publie encore des données de compte retirées**, mettez Plainva à jour sur chaque appareil qui utilise ce coffre. L’appareil actuel ignore les anciens identifiants client Google et conserve sa connexion locale fonctionnelle. Ne confirmez la suppression des anciennes données distantes qu’une fois tous les appareils participants mis à jour. Plainva propose le bouton dans l'avis sous **Réglages → Vault → Synchronisation → Diagnostic** : **Supprimer les entrées retirées** — la question posée est précisément cette confirmation.

L'endroit de cette **connexion** dépend du service : une boîte aux lettres affiche le bouton **Se connecter sur cet appareil** sur sa propre ligne dans la zone **E-mail**, un compte d'agenda ou de fichiers le fait dans **Comptes cloud**. Une boîte Microsoft mène toujours à **Comptes cloud**, car sa connexion se déroule dans le navigateur.

Si vous mettez le chiffrement en place **pour la première fois**, l'étape 3 est active d'emblée — sinon chaque appareil supplémentaire resterait durablement sans connexions. Pour un coffre que vous utilisez déjà, rien ne change en silence : Plainva pose la question une fois et retient votre réponse.

Si un compte apparaît sous forme de **deux fiches**, c'est que Plainva n'a pas pu récupérer l'identité auprès du fournisseur — et il ne doit pas deviner. Ouvrez l'une des deux dans **Comptes cloud** et indiquez avec **Fusionner** qu'il s'agit du même compte ; Plainva affiche au préalable ce qui sera repris.

Si **Calendrier** affiche deux lignes pour le même agenda, Plainva le signale et ne les fusionne **pas** de lui-même : une fusion ferait perdre la sélection de l'agenda et le lien vers les tâches reflétées. Vérifiez quelle ligne porte votre sélection et supprimez l'autre.

Un compte que vous supprimez reste supprimé : la suppression se propage via la synchronisation des réglages vers vos autres appareils, au lieu d'en revenir au cycle suivant.

## Ce qui voyage et ce qui reste ici

Si **Examiner les comptes en double** apparaît sous **Comptes cloud**, Plainva ne se fie volontairement pas au nom. Choisissez **Conserver ce compte** sur la bonne carte. La confirmation indique la cible, les sources et les services concernés, puis crée d’abord une sauvegarde sur cet appareil. **Annuler** ne modifie rien. La fusion supprime uniquement les comptes locaux, caches et identifiants orphelins — rien n’est supprimé chez le fournisseur.

<!-- plainva:profile-areas accounts content calendar mail backup sync layout -->

| Voyage avec le coffre | Reste sur cet appareil |
| --- | --- |
| Comptes — calendriers, boîtes aux lettres, comptes cloud, signets | Chemins absolus — emplacement du coffre, destination des sauvegardes |
| Dossiers et modèles — notes du jour, dossier de modèles, dossier de la boîte de réception, dossier des pièces jointes, base de tâches | Jetons de connexion Microsoft et Google |
| Paramètres du calendrier — dossier des réunions, calendrier par défaut | La boîte aux lettres et le dossier ouverts en dernier |
| Paramètres de messagerie — dossier de classement, images distantes | La disposition de départ de cet appareil pour les nouveaux coffres |
| Règles de sauvegarde — intervalle d'instantanés, conservation, archives | Mots de passe statiques — sauf si l'étape 3 est activée |
| Intervalle de synchronisation |  |
| Disposition des barres (ordinateur) |  |

Le téléphone en transporte un peu moins : la disposition des quatre barres de **bureau** reste sur l'ordinateur — sa propre barre de navigation voyage bel et bien, tout comme le dossier des réunions. Sa propre chaîne sur la page du coffre indique ce qu'il transporte, et les deux appareils indiquent en dessous ce que la synchronisation a réellement fait en dernier — en nommant les paramètres qui ont voyagé et, lors d'une réception, ceux qui ont changé. Le message « Paramètres reçus d'un autre appareil » n'apparaît qu'une fois par session, et seulement en cas de changement réel — ensuite, ce sont ces lignes qui l'indiquent. Nouveau depuis cette version : le téléphone reprend aussi le format de nom des notes du jour, le type OKF des nouvelles notes et vos signets — auparavant, un coffre configuré avec un autre format de date obtenait une deuxième note du jour pour le même jour dès que le téléphone y touchait.

Le diagnostic distingue désormais **dernière vérification** (champs de profil locaux), **dernier téléchargement**, **dernière application** et **dernier envoi réel**. « Envoyé » ne change qu’après une écriture cloud réussie ; les cycles inchangés actualisent donc la vérification et le téléchargement, pas l’heure d’envoi. Les résultats des secrets sont affichés séparément sous forme de nombres importés, inchangés, refusés, obsolètes, en erreur ou en attente d’un compte. Ils ne contiennent que des codes de motif stables — jamais d’identifiant de compte, mot de passe, jeton ou erreur brute. Un avertissement d’ancien client signifie qu’il faut mettre Plainva à jour sur tous les appareils participants ; cet appareil ignore les anciennes données client Google.

## Erreurs et nouvelle tentative automatique

La boîte de dialogue conserve l’erreur exacte même si une nouvelle tentative automatique a déjà modifié l’état en direct. Elle indique si la tentative est en cours ou a réussi. Une reconnexion n’est conseillée que pour une erreur d’authentification ; les erreurs réseau, délai et fournisseur gardent leurs détails et sont retentées automatiquement.

## Noms qui ne diffèrent que par l'orthographe

Google Drive ignore la casse lors de ses recherches, et Windows comme macOS enregistrent `Note.md` et `note.md` dans le même fichier. Lorsqu'un dossier contient deux notes dont les noms ne diffèrent que par là — ou seulement par l'écriture d'une lettre accentuée (`ü` en un seul caractère ou `u` suivi d'un tréma) —, Plainva ne peut pas les distinguer côté distant. La synchronisation ne modifie et ne supprime alors rien : elle signale une erreur mentionnant les deux fichiers. Renomme l'une des deux notes et la synchronisation reprend.
