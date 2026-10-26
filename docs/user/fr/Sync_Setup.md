# Configurer la synchronisation

Dernière mise à jour : 2026-10-26

Plainva synchronise facultativement chaque vault avec un stockage de votre choix — directement depuis l'application, sans aucun service intermédiaire géré par Plainva : vos données circulent exclusivement entre votre ordinateur et votre propre compte/serveur. Cette page vous guide dans la configuration selon le fournisseur.

Quels services fonctionnent en général (aussi via WebDAV ou le client de bureau du fournisseur) est couvert dans [Compatibilité de synchronisation](Sync_Compatibility.md).

## Comparer les versions conservées

Lorsqu’un conflit de texte ne peut pas être fusionné automatiquement, une seule copie de travail locale reste ouverte par original. Les modifications suivantes sont enregistrées dans cette même copie, même après la réouverture de la note ou le redémarrage. Le bandeau indique : **Vous modifiez votre copie en conflit. Elle sera synchronisée après la fusion.**

Dans la comparaison, **Comparer les versions conservées** affiche la version initiale enregistrée, si elle existe. Si la copie de travail est modifiée en dehors de cette session, cette autre version est aussi conservée et peut y être comparée. L’adoption, la conservation des deux versions et l’abandon vérifient à nouveau les fichiers ; rechargez une comparaison devenue obsolète. Résolvez le conflit avant de déplacer ou supprimer le fichier concerné ou son dossier. Les anciennes copies en conflit restent listées séparément.

Tant qu’un conflit est ouvert, le reste de l’application continue de travailler avec la note. Une modification faite en dehors de l’éditeur — une cellule de base de données, une tâche cochée, une entrée du journal, un lien qui suit une note renommée — est écrite dans la note et aussi dans votre copie en conflit ; elle est donc conservée quelle que soit la version que vous gardez. Si votre copie ne contient plus l’endroit auquel la modification appartient (par exemple une tâche que vous y avez reformulée), la copie reste telle que vous l’avez laissée et la comparaison montre la différence. Si un autre appareil modifie le même endroit de la note elle-même avant que votre appareil ne l’ait envoyée, le texte propre de la note n’est pas perdu : il est conservé comme une copie de conflit supplémentaire à côté de la note.

L’export de diagnostic inclut aussi les conflits récents : type de stockage, origine de l’écriture, comparaison des empreintes et différences de fins de ligne, de BOM ou de saut de ligne final. Ces données ne contiennent ni texte des notes ni noms de fichiers. L’export est toujours en anglais, quelle que soit la langue de l’app, pour que vous puissiez le coller tel quel dans un ticket sur GitHub.

## Notions de base

- La configuration se trouve sous **Paramètres → Vault → Comptes cloud** : **Connecter un compte…** ouvre l'assistant — choisissez d'abord le **fournisseur**, puis cochez les **services** (pour la synchronisation de fichiers : **Fichiers**), puis connectez-vous. La vue en tuiles liste les fournisseurs par popularité réelle ; **Rechercher un fournisseur…** permet aussi de trouver les fournisseurs de messagerie proposés en préréglage. **Un seul** compte par vault porte le service **Fichiers**. La zone **Synchronisation** affiche ensuite le compte connecté et garde ce qui vaut pour tout le vault (chiffrement, synchronisation des réglages, file d'attente, diagnostics) ; **Dossier cloud et intervalle de ce compte** mène à la page **Fichiers** du compte avec le **Dossier cloud**, l'**Intervalle de synchronisation (secondes)**, l'état de la synchronisation et **Suspendre la synchronisation**. Dès que le service **Fichiers** est connecté, l'assistant demande une fois le **dossier cloud** — pour chaque fournisseur, avec **Nouveau dossier** directement dans le sélecteur ; **Parcourir** reste le chemin de retour. Avec WebDAV, le dossier fait partie de l'adresse du serveur, il n'y a donc pas de sélecteur.
- Pour le service **Fichiers**, outre **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Stockage objet (S3)** et le générique **WebDAV / CalDAV**, les tuiles incluent aussi **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** et **pCloud** : là, votre adresse e-mail plus un **mot de passe d'application** suffisent — les adresses de serveur sont déjà renseignées (basé sur WebDAV ; modifiable via **Avancé : définir les endpoints individuellement**).
- **Ouvrir un vault en ligne existant depuis l'écran d'accueil** : **Ouvrir un vault** → **Vault en ligne** vous guide, pour chaque fournisseur, par les mêmes trois étapes — **1. Se connecter** (s'identifier ou saisir les identifiants), **2. Choisir le dossier dans le cloud** (un nouveau dossier peut aussi y être créé via **Nouveau dossier**), **3. Choisir ou créer le dossier local**. Vous pouvez aussi configurer la synchronisation à tout moment pour un vault déjà ouvert, depuis les Paramètres. Avec Google Drive et OneDrive, l'étape 1 vous connecte avec la **Connexion sur cet appareil** — la même que dans **Comptes cloud** — et le vault y reçoit aussitôt son compte.
- **Créer un nouveau vault dans le cloud** : **Nouveau vault** → **Chez un service en ligne** — choisissez d'abord la structure de départ (vide ou un modèle comme PARA), puis connectez-vous et choisissez le dossier cible dans le cloud ou créez-le via **Nouveau dossier**, enfin le dossier local. La structure est créée dans le dossier local et envoyée automatiquement lors de la première synchronisation.
- Les enregistrements locaux sont téléversés immédiatement ; Plainva vérifie les modifications distantes selon l'**Intervalle de synchronisation (secondes)** configuré.
- Les modifications hors ligne sont mises en file d'attente et transférées au prochain contact ; la barre d'état affiche **En ligne**/**Hors ligne** et l'indicateur de synchronisation montre l'état (**Synchroniser maintenant** au clic). Lors d'une synchronisation longue ou initiale, la barre d'état affiche la progression sous forme de compteur (p. ex. **Sync 123/540**), pour que vous puissiez voir qu'elle parcourt le vault.
- Si les deux côtés modifient le même fichier, Plainva les fusionne automatiquement (fusion à 3 voies). Si ce n'est pas possible, votre version est préservée en sécurité comme fichier `.CONFLICT` — rien n'est jamais perdu (voir [FAQ](FAQ.md)).
- **Résoudre les conflits** : une bannière dans la note concernée (et **Résoudre le conflit…** dans le menu contextuel du fichier `.CONFLICT` dans l'arborescence) ouvre la boîte de dialogue de comparaison — l'état actuel du fichier à gauche, votre version conservée à droite, modifiable avec reprise par bloc. **Enregistrer la version de droite et résoudre** écrit le résultat dans le fichier et supprime la copie de conflit ; **Garder l'autre côté** abandonne votre copie (un instantané de version subsiste). La boîte de dialogue d'erreur de synchronisation liste elle aussi les copies de conflit existantes et vous mène à la même comparaison en un clic.
- **Protection contre les suppressions en masse** : si une part inhabituellement grande des fichiers synchronisés est sur le point d'être supprimée d'un coup dans le cloud (par exemple parce que le dossier local du vault a été vidé ou déplacé), Plainva suspend les suppressions et demande d'abord confirmation : **Supprimer dans le cloud** les exécute, **Ne pas supprimer (restaurer)** les abandonne et restaure les fichiers depuis le cloud lors de la prochaine synchronisation. Les suppressions que vous avez confirmées vous-même dans Plainva ne sont pas retenues — pour les suppressions importantes (plus de 10 fichiers ou plus de 20 % du vault), Plainva demande plutôt une seconde confirmation avant de supprimer.
- **Supprimé dans le cloud, modifié ici** : si un autre appareil a supprimé un fichier dans le cloud alors que cet appareil avait encore des modifications pas encore envoyées, Plainva ne le supprime pas. Il conserve le fichier, l'envoie à nouveau comme nouveau fichier et vous indique une fois de quel fichier il s'agit. Si vous voulez vraiment le supprimer, supprimez-le à nouveau ici. Cela vaut sur ordinateur et sur mobile.
- Les pièces jointes (images etc.) sont également synchronisées.
- Les **dossiers vides** sont également synchronisés : un dossier créé dans Plainva apparaît immédiatement dans le cloud, et les dossiers vides du cloud apparaissent sur vos autres appareils au plus tard lors du prochain inventaire complet.
- Les identifiants et jetons sont stockés dans le trousseau du système d'exploitation (statut : **Paramètres → App → À propos et diagnostic → Trousseau du système**), jamais dans des fichiers à l'intérieur du vault.
- **Accès enregistrés** (**Paramètres → Vault → Synchronisation**) montre ce que Plainva a déposé dans le trousseau — y compris des entrées de vaults que tu n'ouvres plus depuis longtemps. Chaque ligne nomme le service et le vault ; **Supprimer** demande confirmation. Plainva n'y supprime jamais rien de lui-même.
- Les entrées du trousseau portent des **noms lisibles** — `plainva · <vault> · <service> · <id de compte> · #<empreinte>` au lieu d'une chaîne base64. Plainva renomme une seule fois les entrées existantes, à la première ouverture d'un vault ; si un renommage ne peut pas aboutir en toute sécurité, l'ancienne entrée reste en place et Plainva réessaie à l'ouverture suivante.
- **Suspendre la synchronisation** (sur la page **Fichiers** du compte) arrête la synchronisation du vault sur cet appareil ; aucun fichier n'est supprimé nulle part par cette action, et une fois réactivée elle reprend là où elle s'était arrêtée.
- **`http://` est autorisé, `https://` est la recommandation.** Un serveur que vous exploitez vous-même sur votre propre réseau parle généralement `http` en clair — cela fonctionne aussi sur le téléphone. Sur Internet, vous ne devriez pas le faire : WebDAV envoie votre mot de passe à **chaque** requête, en clair via `http`. Si vous saisissez une adresse non chiffrée en dehors de votre propre réseau, Plainva vous le signale dans le formulaire — sans vous en empêcher.

## WebDAV / Nextcloud

La voie la plus simple pour les serveurs auto-hébergés et la plupart des stockages cloud :

1. Dans **Comptes cloud** → **Connecter un compte…**, choisissez la tuile **Nextcloud** (ou **WebDAV / CalDAV**).
2. Saisissez l'**Adresse du serveur**, le **Nom d'utilisateur** et le **Mot de passe ou jeton d'application** — utilisez un mot de passe d'application au lieu de votre mot de passe principal dès que possible (dans Nextcloud : Paramètres → Sécurité → Mots de passe d'application).
3. **Connecter** valide les identifiants ; choisissez ensuite le **Dossier cloud** via **Choisir un dossier…**. Ici aussi, on peut créer un **nouveau dossier** — comme partout où Plainva choisit un dossier cloud, y compris sur le téléphone sous **Changer le dossier cloud**.

Particularité **Nextcloud** : UN seul formulaire couvre les fichiers **et** le calendrier — Plainva déduit les endpoints WebDAV et CalDAV directement de l'adresse du serveur (les adresses déduites s'affichent dans l'assistant ; **Avancé : définir les endpoints individuellement** permet des URL séparées). Cochez les deux services et une seule connexion suffit pour les deux.

Les adresses de serveur typiques (Nextcloud, Koofr, MagentaCLOUD, Storage Box et bien d'autres) sont listées dans [Compatibilité de synchronisation](Sync_Compatibility.md).

**L'adresse pointe sur le dossier du vault lui-même.** Tout ce qui se trouve en dessous appartient au vault ; une adresse un niveau trop haut y entraîne donc aussi les dossiers voisins. Avec WebDAV, le dossier fait partie de l'adresse du serveur : pour déplacer le vault plus tard, reconnectez le compte.

Les changements de mot de passe sont d’abord vérifiés auprès de tous les services concernés protégés par mot de passe. Si l’enregistrement est interrompu, les modifications confirmées sont conservées. Rouvre le compte et choisis **Poursuivre l’enregistrement**. L’opération protégée reste disponible après un redémarrage. Si le rattachement du compte ou les identifiants ont changé, choisis **Vérifier à nouveau le mot de passe** pour vérifier le mot de passe actuel auprès des services désormais rattachés. Les identifiants manquants ne sont pas ignorés. Une nouvelle connexion au calendrier est aussi utilisée lors de la prochaine ouverture d’un vault précédemment fermé.

Une nouvelle connexion de calendrier reste liée au vault dans lequel tu l’as démarrée. Si tu le fermes ou changes de vault pendant la vérification, relance la connexion dans ce vault. Si les identifiants existants ne peuvent pas être lus, le regroupement s’arrête et préserve les comptes existants.

## Google Drive

Google Drive se connecte avec **Connexion sur cet appareil**. Par défaut, c'est la **Connexion standard** : si votre version l'inclut, vous ne saisissez rien. Si ce n'est pas le cas, Plainva vous le dit et vous demande votre **ID client personnel** — celui d'un client issu d'un projet Google Cloud gratuit qui vous appartient exclusivement (« Bring Your Own »). Le guide étape par étape : [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Version courte : dans **Comptes cloud** → **Connecter un compte…**, choisissez la tuile **Google**, cochez le service **Fichiers**, puis **Se connecter avec Google…** — la connexion s'ouvre dans votre navigateur. Avec un ID client personnel, vous le saisissez d'abord sous **Autre connexion** dans l'assistant : sur l'ordinateur, l'**ID client** et le **Secret client** d'un client de type « Application de bureau », sur le téléphone uniquement l'**ID client** d'un client de type « iOS ». Une fois connecté, choisissez le **Dossier cloud** via **Choisir un dossier…** directement depuis votre Drive (sous-dossiers inclus, par défaut « Plainva »). Remarque : tant que votre propre projet Google reste en mode **Testing**, la connexion expire au bout de **7 jours** — définitivement, car dans ce mode Google laisse aussi expirer le jeton de renouvellement, et Plainva ne peut donc pas la rafraîchir en arrière-plan. La synchronisation vous indique alors que la connexion a expiré, et **Se reconnecter** dans les détails du compte la rétablit — un aller-retour pour **tous** les services de ce compte. **En production** supprime l’expiration fixe du mode test. Cela ne garantit pas une connexion permanente : Google peut toujours faire expirer ou révoquer l’accès. Les exigences de publication et de vérification dépendent de l’usage et des autorisations demandées. [Google : expiration des jetons de renouvellement](https://developers.google.com/identity/protocols/oauth2#expiration).

Si vous cochez **Fichiers** et **Calendrier et tâches** ensemble lors de la connexion, Google ne demande votre consentement qu'**une seule fois**, en réclamant exactement les droits des services choisis. Ajouter un autre service plus tard redemande un consentement, une fois de plus, pour tout ce que le compte porte plus le nouveau service.

## OneDrive

Plainva fournit sa propre connexion pour Microsoft (**Connexion standard**) — vous **n'avez besoin d'aucun ID personnel** :

1. Dans **Comptes cloud** → **Connecter un compte…**, choisissez la tuile **Microsoft** et cochez le service **Fichiers** (OneDrive) — sur demande avec **Calendrier et tâches** et **E-mail** (un compte Microsoft peut porter les trois services).
2. **Se connecter avec Microsoft…** et confirmez la connexion dans le navigateur. Terminé — Plainva crée le dossier (par défaut « Plainva ») et synchronise tout son contenu, y compris les fichiers ajoutés depuis l'extérieur.
3. Facultatif : une fois connecté, choisissez le **Dossier cloud** via **Choisir un dossier…** directement depuis votre OneDrive (sous-dossiers inclus).

Facultatif : sous **Connexion sur cet appareil** → **Modifier** → **ID client personnel**, vous pouvez saisir à la place l'ID (client) de l'application d'une inscription d'application personnelle (p. ex. en cas de restrictions d'entreprise) — pour cet appareil uniquement. Guide détaillé : [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

**Une connexion pour tous les services.** Pour **Microsoft** et **Google**, connecter un compte, activer un autre service sur ce compte et **Se reconnecter** sont une seule et même étape : le fournisseur ne demande votre consentement qu'**une seule fois**, pour tout ce que le compte porte plus ce que vous ajoutez, et Plainva conserve une connexion unique pour tout le compte. Ensuite, chaque service affiche son propre résultat — actif, ou **Non autorisé : case non cochée lors de la connexion. Reconnectez-vous et cochez le service.** si vous avez décoché sa case sur l'écran de consentement du fournisseur ; se reconnecter et la cocher y remédie. Un service qui échoue ne retarde pas les autres. Si vous connectez un compte que le vault possède déjà, Plainva ajoute les services à ce compte au lieu d'en créer un second, et vous le signale. L'étape de connexion de l'assistant n'affiche que ce dont ce fournisseur a besoin pour les services choisis : pour Google et Microsoft un seul bouton, **Se connecter avec Google…** ou **Se connecter avec Microsoft…**, avec la connexion standard ; votre propre ID client — et, pour Google, uniquement lorsque **E-mail** est choisi, **E-mail par mot de passe d’application** — se trouvent repliés sous **Autre connexion**. Pour une boîte e-mail, les serveurs se trouvent derrière **Avancé : définir les endpoints individuellement** dès que l'adresse désigne un fournisseur connu ; pour Dropbox, la clé d'application personnelle se trouve sous **Autre connexion**. **Se reconnecter** avec un autre compte que celui affiché est refusé, et rien ne change.

L'assistant conserve le fournisseur choisi **à chaque étape** : les étapes 2 et 3 ouvrent directement le bon formulaire (le formulaire d'agenda Google au lieu d'un choix de fournisseur, Gmail au lieu d'un formulaire IMAP générique) et ne redemandent jamais qui vous vouliez connecter. Ce qu'une étape a déjà recueilli est présent dans la suivante : pour Nextcloud, Plainva déduit l'adresse CalDAV de l'adresse du serveur de l'étape 1, et un mot de passe de suite se saisit une seule fois au lieu de trois. Ces informations ne vivent en mémoire que le temps du parcours ; elles ne sont enregistrées nulle part et disparaissent dès qu'il se termine — y compris lorsque vous l'arrêtez via **Quitter l’assistant**.

Les comptes qui conservent encore une connexion par service depuis une version antérieure le signalent sur leur page. **Se reconnecter** couvre tous les services du compte — aussi bien sur l'ordinateur que dans l'[application mobile](Mobile_App.md) : un aller-retour, et ensuite tous les services partagent la même connexion. C'est plus qu'une simple commodité : des connexions séparées pouvaient diverger, laissant un service continuer à fonctionner pendant qu'un autre du même compte avait discrètement expiré.

**Gmail sur le compte Google.** Lorsque la connexion sur cet appareil autorise la messagerie, Gmail fait partie du même consentement et la boîte est liée au compte Google. Lorsque ce n'est pas le cas — **Connexion standard** sans l'approbation de Google pour la messagerie —, activer **E-mail** sur le compte Google demande tout de suite un **Mot de passe d’application**, sous **Gmail avec mot de passe d’application** : sur le même compte, jamais sur un second. Se reconnecter à Google conserve un tel mot de passe d’application. Outlook sépare les accès enregistrés et les connexions de chaque vault, même si le même profil de compte existe dans plusieurs vaults. Cela vaut sur ordinateur et sur mobile.

Les fichiers, le calendrier et la messagerie Outlook nécessitent chacun leurs propres autorisations. Une synchronisation de fichiers qui fonctionne ne signifie donc pas que le calendrier ou la boîte mail sont également autorisés. Plainva vérifie les droits de chaque service ; si une autorisation manque, reconnecte-toi et accorde l’accès nécessaire. Les noms équivalents des autorisations Google sont reconnus.

**Connexion sur cet appareil.** La connexion qu'un appareil utilise pour Google ou Microsoft se règle par appareil, pas pour tout le compte — les autres appareils gardent leur réglage. Vous la voyez et la modifiez sur la page du compte (ordinateur : **Paramètres → votre vault → Comptes cloud** → le compte → **Connexion sur cet appareil** → **Modifier** ; téléphone : le compte dans **Comptes cloud** → la ligne **Connexion sur cet appareil**) ainsi que dans l'assistant sous **Autre connexion**. La **Connexion standard** est la valeur par défaut dès que votre version l'inclut ; vous ne saisissez alors rien. L'**ID client personnel** prend, pour Google sur l'ordinateur, l'**ID client** et le **Secret client** d'un client de type « Application de bureau » ; sur le téléphone (Android et iPhone), l'**ID client** d'un client de type « iOS » avec l'ID de bundle `com.plainva.app`, sans secret ; pour Microsoft, l'ID (client) de l'application de votre inscription d'application. Si votre version n'a pas de connexion standard pour Google, Plainva le dit et demande votre propre ID client. Se reconnecter utilise le réglage de cet appareil. La ligne indique avec quoi cet appareil se connecte : **Connexion standard** ou **ID client personnel** avec les six derniers caractères de l'ID client, par exemple « (…a1b2c3) ».

**Vérifier la connexion.** Chaque page de compte propose **Vérifier la connexion** — une boîte de dialogue sur l'ordinateur, une feuille sur le téléphone. Chaque service lit quelque chose de minime et affiche **Fonctionne**, **Non connecté**, **Connexion expirée – reconnectez-vous**, **Non autorisé – reconnectez-vous et cochez le service** ou l'erreur en toutes lettres. Chaque ligne qui ne fonctionne pas porte son action : **Se connecter**, **Se reconnecter** (pour un compte avec mot de passe, cela ouvre le mot de passe) ou **Accorder l’autorisation**. Lorsque Google refuse Gmail — l'autorisation n'a pas été accordée, l'application n'est pas vérifiée ou le projet a atteint sa limite d'utilisateurs —, la ligne e-mail propose aussi **Connecter avec un mot de passe d’application** : Gmail passe alors par IMAP avec un mot de passe d'application, sur le même compte, et la boîte refusée lui cède la place. Si le fournisseur refuse l'ID client personnel de cet appareil, parce qu'il a été supprimé ou n'est pas autorisé, la ligne le dit et propose **Utiliser la connexion standard** lorsque votre version inclut la connexion standard. Le résultat est noté dans les diagnostics.

**Connexion requise, déconnexion, suppression.** Un compte Google ou Microsoft affiche, dans la liste et sur sa page, l'état de son unique connexion sur cet appareil. **Connexion requise** signifie que cet appareil n'est pas connecté pour le compte ; **Se connecter** se trouve à côté. Si la ligne indique **connexion expirée**, la connexion ne fonctionne plus ; **Se reconnecter** se trouve à côté. **Se déconnecter sur cet appareil** supprime la connexion de cet appareil — pour un compte à mot de passe, le mot de passe enregistré ici — le compte, ses services et ses réglages restent, les autres appareils restent connectés, et rien n'est révoqué chez le fournisseur ; ensuite le compte affiche **Connexion requise**, et **Se connecter** redemande le mot de passe. **Supprimer le compte…** retire le compte avec tous ses services du vault, sur tous les appareils, après une confirmation — la question dit ce qui part (les services de ce compte, les connexions sur tous les appareils, son cache de calendrier) et ce qui reste (chaque note, y compris les e-mails classés et les notes d'événement ; rien n'est supprimé chez le fournisseur). Le vault et ses notes restent.

**La page du compte.** Chaque compte — Google, Microsoft, Dropbox, iCloud, Nextcloud/WebDAV, S3, une boîte e-mail ou **Sur cet appareil** — a la même page dans le même ordre, sur l'ordinateur comme sur le téléphone : (1) l'**en-tête** avec l'unique état du compte, **Connecté**, **Connexion requise** ou **Expiré**, et seulement quand il en faut un son bouton **Se connecter** ou **Se reconnecter** ; (2) les **services** **Fichiers**, **Calendrier et tâches** et **E-mail**, chacun avec un interrupteur, une ligne d'état et une flèche vers la page de ce compte pour ce service ; (3) **Accès sur cet appareil** — la connexion pour Google et Microsoft, la clé d'application pour Dropbox, serveur, utilisateur et mot de passe pour un compte à mot de passe, les clés pour S3, l'autorisation système pour **Sur cet appareil** ; (4) **Vérifier la connexion** ; (5) la fin avec **Se déconnecter sur cet appareil** et **Supprimer le compte…**. Ce qu'un fournisseur ne sait pas faire manque, sans jamais être déplacé ailleurs. Un interrupteur désactivé arrête le service pour le vault sur tous les appareils ; la connexion, le cache du calendrier et les e-mails classés restent, et une fois réactivé il reprend là où il s'était arrêté.

**La page d'un service d'un compte.** La flèche à côté d'un service ouvre ce qui appartient à ce compte : pour **Fichiers**, le **Dossier cloud**, l'**Intervalle de synchronisation (secondes)**, l'état de la synchronisation et **Suspendre la synchronisation** (cet appareil seulement) ; pour **Calendrier et tâches**, les calendriers et listes de tâches du compte avec leurs interrupteurs, la couleur propre d'un calendrier (elle ne colore que ce vault ; le fournisseur garde la sienne) et l'**Agenda par défaut** ; pour **E-mail**, les dossiers, les expéditeurs et la signature. Chaque page mène aux réglages que tous les comptes partagent : **Synchronisation**, **Calendrier** et **E-mail** sous votre vault gardent ce qui vaut pour tous les comptes — rappels, dossier des réunions, règles, réponse d'absence, dossier de classement.

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

**Comptes sur tous vos appareils** se compose de trois étapes. **1 · Réglages et comptes** : place les réglages du coffre *et vos comptes* (agendas, boîtes mail, sélection d’agendas) dans un petit fichier du coffre — tant qu'aucune phrase de passe n'est configurée, cela n'en nécessite **aucune** ; dès qu'il en existe une, chaque appareil doit la saisir avant que les réglages ne circulent depuis lui. Cette étape est **activée par défaut** — les réglages et les comptes ne sont pas des secrets ; vous pouvez la désactiver par coffre à tout moment. **2 · Phrase de passe de synchronisation** (facultatif) : nécessaire seulement si les connexions doivent voyager elles aussi ; elle chiffre en plus les réglages de l’étape 1. **3 · Emporter les connexions** : emporte en plus les mots de passe IMAP et CalDAV statiques, chiffrés, et ne peut être activé qu’une fois l’étape 1 en marche et la phrase de passe déverrouillée — un mot de passe ne peut rejoindre qu’un compte que l’appareil connaît déjà. Ne sont pas emportés : les chemins propres à l’appareil et les connexions OAuth (Microsoft, Google) ; leurs jetons sont liés à l’appareil, le compte apparaît donc sur le nouvel appareil et y demande une fois **Se connecter**.

Sur le **téléphone**, la même chaîne figure sur la page du coffre — mêmes trois étapes, même verrouillage. Les comptes venant d’un autre appareil y sont créés ; vous ne les ressaisissez plus. **Récupérer depuis un autre appareil** les obtient immédiatement, sans attendre la synchronisation suivante.

Si Plainva signale qu’une **ancienne version publie encore des données de compte retirées**, mettez Plainva à jour sur chaque appareil qui utilise ce coffre. L’appareil actuel ignore les anciens identifiants client Google et conserve sa connexion locale fonctionnelle. Ne confirmez la suppression des anciennes données distantes qu’une fois tous les appareils participants mis à jour. Plainva propose le bouton dans l'avis sous **Paramètres → Vault → Synchronisation → Diagnostic** : **Supprimer les entrées retirées** — la question posée est précisément cette confirmation.

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

**Les suppressions voyagent.** Une suppression que vous avez confirmée reste 90 jours dans un journal (`.plainva/sync/deletions.json`) et est reproduite sur chaque autre appareil sans question — même après un redémarrage, et même si beaucoup de fichiers y manquent d’un coup. Si beaucoup de fichiers manquent dans le cloud sans que le journal les explique, Plainva suspend la réplication et demande : **appliquer les suppressions** ou **les garder localement** (il renvoie alors les fichiers comme nouveaux). Il en va de même pour les listes de tâches : une suppression effectuée chez le fournisseur retire aussi la note de tâche sur l’autre appareil, tant qu’elle n’y a pas été modifiée. Avant de poser la question — et avant de retirer ici le moindre fichier —, Plainva vérifie directement auprès du cloud : il demande un par un un échantillon des fichiers manquants. Si un seul d’entre eux s’y trouve, la liste du cloud était incomplète : rien n’est supprimé, personne n’est interrogé, et l’état de la synchronisation affiche **Le cloud a répondu de façon incomplète — rien n’a été supprimé** avec **Vérifier à nouveau**. Une entrée du journal n’est écrite qu’après qu’un fichier a été constaté absent puis retiré ici, et une entrée dont le fichier réapparaît dans le cloud est retirée ; **Vérifier le journal des suppressions**, sous **À propos et diagnostic**, le fait à la demande. Si le dossier cloud d’un vault déjà synchronisé est introuvable, Plainva ne crée plus de remplaçant vide mais le signale — vous choisissez alors le dossier existant.

## Erreurs et nouvelle tentative automatique

La boîte de dialogue conserve l’erreur exacte même si une nouvelle tentative automatique a déjà modifié l’état en direct. Elle indique si la tentative est en cours ou a réussi. Une reconnexion n’est conseillée que pour une erreur d’authentification ; les erreurs réseau, délai et fournisseur gardent leurs détails et sont retentées automatiquement. La synchronisation des paramètres attend elle aussi les erreurs passagères : un délai dépassé apparaît d'abord comme une note discrète avec un compteur et ne devient un message rouge qu'après le troisième échec consécutif — une connexion expirée, en revanche, immédiatement.

## Noms qui ne diffèrent que par l'orthographe

Google Drive ne distingue pas les majuscules des minuscules lors de ses recherches, et Windows et macOS enregistrent `Note.md` et `note.md` dans le même fichier. Un même caractère peut en outre être enregistré de deux façons : `ü` comme un seul caractère, ou comme `u` suivi d'un tréma. Pour cette **écriture**, Plainva considère désormais qu'il s'agit du même fichier et poursuit la synchronisation normalement, tant qu'il n'y a qu'une seule correspondance.

En revanche, si deux noms diffèrent par la **casse**, ce sont deux fichiers. Plainva ne modifie ni ne supprime alors rien et affiche la carte **Deux écritures, un seul fichier** avec les deux noms — sur mobile sur la page du coffre, sur l'ordinateur dans les paramètres de synchronisation. Tous les autres fichiers continuent d'être synchronisés. Renommez l'une des deux notes et la carte disparaît d'elle-même.

La nouvelle connexion ne couvre pas tous les services. Tes accès précédents sont conservés. Reconnecte-toi et autorise tous les services indiqués. Le rattachement du compte a changé. Ouvre les réglages actuels du compte et reconnecte-toi.

## Google Drive : téléchargements incomplets

Lorsque Google Drive limite temporairement les requêtes, Plainva réessaie le téléchargement après un délai. Un téléchargement échoué ne signifie ni fichier absent ni modification terminée. Le contenu local et le dernier état de synchronisation confirmé sont conservés ; le cycle suivant réessaie la modification en attente. Les autres fichiers téléchargés restent disponibles. Les autorisations manquantes et les refus permanents apparaissent comme des erreurs avec le chemin du fichier et la cause. Cela vaut sur ordinateur et sur mobile.

## Transferts de fichiers interrompus

Les délais couvrent aussi la réception des fichiers depuis WebDAV, Dropbox, OneDrive, S3 et Google Drive. Si une réponse reçue par morceaux ne fournit plus de données, Plainva termine cette tentative et répète les lectures un nombre limité de fois avec une nouvelle requête. La progression maintient ce téléchargement actif même si le fichier prend plus longtemps que le délai de base. Les requêtes mobiles natives ont aussi leurs propres limites. Un téléchargement incomplet ne remplace jamais le fichier local existant et ne confirme aucune progression de synchronisation. Les envois volumineux conservent un délai adapté à leur taille ; un résultat incertain est traité par la reprise normale de la synchronisation, sans renvoi aveugle.

<!-- accounts-tasks-2026-09-11 -->
## Compléter les comptes existants

Ajoute des fichiers, un calendrier ou une messagerie directement au compte qui doit les porter. Pour Google et Microsoft, cela représente un seul consentement pour tout ce que le compte porte plus le nouveau service.

Ouvre **Comptes cloud**, choisis le compte existant et active le service manquant (sur le téléphone : **Ajouter**). Les services existants restent connectés, et un service qui échoue n'arrête pas les autres. Gmail rejoint la connexion Google lorsque la connexion sur cet appareil autorise la messagerie ; sinon Plainva demande un mot de passe d’application sur le même compte. Annuler l’assistant ne déconnecte pas les services terminés. Le transfert mobile conserve le vault source et tient compte d’un vault cible correspondant ou prépare un conteneur séparé. Les fichiers en collision sont comparés individuellement et les deux contenus sont conservés. Les destinations chiffrées s’ouvrent par le parcours de jumelage existant.

Lors de l’ajout de fichiers sur mobile, Plainva affiche la source, la destination et les collisions avant le transfert. Les contenus et services existants sont conservés ; un transfert interrompu peut être relancé.

<!-- http-platform-trust-2026-09-14 -->
## Certificats des serveurs auto-hébergés

Android fait également confiance aux autorités de certification installées dans les paramètres système. Cela concerne toutes les connexions Plainva utilisant cette configuration, pas seulement un serveur WebDAV. Sur ordinateur, les connexions HTTP utilisent les autorités système et les racines publiques ; iOS utilise ses réglages de confiance système. La validité et le nom du serveur restent vérifiés. Corrigez un certificat expiré, pas encore valide ou destiné à un autre serveur. Plainva ne propose jamais d’accepter tous les certificats. Si le système ne précise pas la cause, Plainva indique simplement que la vérification a échoué. L’export de diagnostic des erreurs HTTP mobiles contient la méthode et le code d’erreur, sans identifiants, noms de certificats ni chemins privés.

<!-- workspace-retry-2026-09-14 -->
## Nouvelles tentatives automatiques et historique manquant

La connexion est temporairement indisponible. Plainva réessaiera automatiquement ; les modifications en attente restent sur cet appareil.

Reconnectez-vous au compte de synchronisation. Les modifications en attente restent sur cet appareil jusqu’au rétablissement de l’accès.

Plainva ne peut pas vérifier le coffre chiffré. La synchronisation est suspendue ; les données locales et les modifications en attente sont conservées. Ouvrez Sécurité et partage, restaurez une copie vérifiable si elle existe, puis vérifiez à nouveau.

Sur un appareil disposant encore de l’historique complet et vérifiable, choisissez Synchroniser maintenant. Plainva peut restaurer les opérations signées manquantes depuis cette copie. Vérifiez ensuite à nouveau sur Plainva. Sans copie valide, conservez ou exportez les données locales ; la vérification n’est jamais réinitialisée pour contourner la lacune.

Les fichiers de remarques non chiffrés d’autres appareils restent sur le serveur. Seul l’appareil d’origine peut terminer leur conversion. Plainva ne supprime pas les fichiers d’autres appareils.

<!-- account-grants-destination-2026-09-14 -->
Une connexion n’est reprise qu’après vérification de l’identité, des autorisations réellement accordées et du stockage sécurisé. Ajouter un service connecte le compte une seule fois pour tous ses services ; si aucun d’eux n’est autorisé, les connexions qui fonctionnent restent telles qu’elles étaient. Un autre appareil nécessite sa propre connexion.

Dans les réglages de synchronisation, le sélecteur Google Drive affiche la destination actuelle et un aperçu du dossier choisi. Ouvrez les dossiers homonymes et comparez fichiers et dates. « Utiliser cette destination » conserve l’identifiant unique du dossier. Si celui-ci devient inaccessible, Plainva signale l’erreur sans créer de remplacement. Les autres dossiers ne sont ni déplacés ni supprimés.
