# Configurer la synchronisation Google Drive (avec vos propres identifiants)

Dernière mise à jour : 2026-10-26

Plainva se connecte à Google avec **Connexion sur cet appareil**. Lorsque votre version inclut la **Connexion standard** pour Google, vous ne saisissez rien et cette page ne vous est pas nécessaire. Sinon — ou si vous préférez un projet qui vous appartient —, vous utilisez vos propres identifiants API Google : cette approche **Bring Your Own Credentials (BYO)** offre un moyen sûr de synchroniser vos fichiers privés.

Vous mettez en place ici, en quelque sorte, votre propre petit « projet de développeur » chez Google, qui vous appartient exclusivement et auquel vous seul avez accès.

## Guide étape par étape

### 1. Créer un projet dans la Google Cloud Console
1. Allez sur la [Google Cloud Console](https://console.cloud.google.com/).
2. Connectez-vous avec votre compte Google.
3. En haut à gauche (à côté du logo Google Cloud), ouvrez le menu déroulant des projets et choisissez **Nouveau projet**.
4. Saisissez un nom (p. ex. « Plainva Sync ») et cliquez sur **Créer**.

### 2. Activer l'API Google Drive
1. Sélectionnez votre projet nouvellement créé dans le menu déroulant en haut.
2. Recherchez **Google Drive API** dans la barre de recherche en haut et choisissez l'entrée sous « Marketplace ».
3. Cliquez sur **Activer**.

### 3. Configurer l'écran de consentement OAuth
Pour que Plainva puisse utiliser vos identifiants, un écran de consentement (« OAuth Consent Screen ») doit être configuré. Comme seul vous utilisez l'application, il reste en mode « test ».

1. Dans le menu latéral gauche sous **APIs & Services**, ouvrez **OAuth consent screen**.
2. Sous « User Type », choisissez **External** (sauf si vous utilisez Google Workspace) et cliquez sur **Create**.
3. **Informations sur l'application :**
   - Nom de l'application : p. ex. « Plainva »
   - E-mail d'assistance utilisateur : votre propre e-mail
   - Coordonnées du développeur : votre propre e-mail
   - Cliquez sur **Save and Continue**.
4. **Scopes (champs d'application) :**
   - Cliquez sur **Add or Remove Scopes**.
   - Recherchez `.../auth/drive` (Google Drive API, accès complet) et cochez la case.
   - *Contexte : l'accès complet est nécessaire pour que Plainva puisse aussi synchroniser les fichiers que vous déposez dans votre dossier de synchronisation via l'interface web de Google Drive.*
   - Cliquez sur Update, puis sur **Save and Continue**.
5. **Utilisateurs de test :**
   - Cliquez sur **Add Users**.
   - Saisissez exactement l'adresse e-mail Google que vous utiliserez plus tard pour la synchronisation dans Plainva.
   - Cliquez sur **Save and Continue**, puis revenez au tableau de bord.

*Important : vous n'avez PAS besoin de publier l'application — elle fonctionne pleinement en statut « Testing ». Attendez-vous alors à ce que Google fasse expirer la connexion au bout de **7 jours**, et définitivement : dans ce mode, le jeton de renouvellement expire aussi, donc Plainva ne peut pas le rafraîchir en arrière-plan. Plainva vous le dit en clair (« connexion expirée »), et **Se reconnecter** dans les détails du compte la rétablit en un aller-retour pour tous les services de ce compte.*

**En production** supprime l’expiration fixe du mode test. Cela ne garantit pas une connexion permanente : Google peut toujours faire expirer ou révoquer l’accès. Les exigences de publication et de vérification dépendent de l’usage et des autorisations demandées. [Google : expiration des jetons de renouvellement](https://developers.google.com/identity/protocols/oauth2#expiration).

### 4. Créer des identifiants (Client ID & Secret)
1. Ouvrez **Credentials** dans le menu de gauche.
2. Cliquez sur **Create Credentials** en haut et choisissez **OAuth client ID**.
3. Comme « Application type », choisissez **Desktop app** pour Plainva sur un ordinateur. Pour le téléphone (Android et iPhone), créez plutôt un client de type **iOS** — voir la fin de cette page.
4. Nom : p. ex. « Plainva Desktop Client ».
5. Cliquez sur **Create**.
6. Une fenêtre pop-up affiche votre **Client ID** et votre **Client Secret**.

### 5. Les saisir dans Plainva
1. Ouvrez **Paramètres → votre vault → Comptes cloud**.
2. Pour un nouveau compte, choisissez **Connecter un compte…** → la tuile **Google** et cochez les services ; pour un compte que vous avez déjà, ouvrez-le et choisissez **Modifier** sous **Connexion sur cet appareil**.
3. Choisissez **ID client personnel** et collez l'**ID client** et le **Secret client** copiés — sur le téléphone uniquement l'**ID client** du client iOS ; il n'a pas de secret. Puis **Enregistrer**.
4. Cliquez sur **Se connecter avec Google…** (pour un compte que vous avez déjà : **Se reconnecter**).
5. Une fenêtre de navigateur Google s'ouvre. Connectez-vous avec le compte que vous avez ajouté sous « Test users ».
6. Google peut avertir que l'application n'est pas vérifiée. Cliquez sur **Advanced** puis sur **Continue to Plainva (unsafe)**.
7. Confirmez les autorisations demandées — un seul consentement couvre tous les services que vous avez cochés.
8. L'ID client personnel ne vaut que pour cet appareil ; les autres appareils gardent leur réglage. Saisissez-le sur chaque appareil qui doit utiliser votre projet.

Votre vault se synchronise désormais en toute sécurité avec Google Drive via vos propres identifiants.

<!-- accounts-tasks-2026-09-11 -->
## Google OAuth — Desktop / Android / iOS

Les instructions pour ordinateur ci-dessus nécessitent un client de bureau avec son ID client et son secret. Sur le téléphone, sous Android comme sous iOS, Plainva se connecte à Google dans le navigateur : crée dans ton projet Google un client OAuth de type **iOS**, y compris pour Android, avec l’ID de bundle `com.plainva.app`. Plainva revient par `com.plainva.app:/oauth2redirect` ; il n’y a pas de secret client. Saisis l’ID client sur le téléphone sous **Connexion sur cet appareil** → **ID client personnel**. Ne crée pas de client de type Android : Google n’accepte le nom de package et l’empreinte du certificat de la version Play que dans un seul projet au monde et refuse tous les autres (« le nom de package Android et l’empreinte sont déjà utilisés »). Un client Android configuré pour Plainva 0.8.3 ou 0.8.4 ne fonctionne pas pour une nouvelle connexion ; les comptes déjà connectés continuent de fonctionner. Un client de bureau ne remplace pas l’enregistrement mobile. Pour les agendas, active aussi Google Calendar API et Google Tasks API. Si Google affiche « Erreur 400 : redirect_uri_mismatch » sur le téléphone, l’ID client est de type « Application de bureau » : crée un client de type **iOS** comme décrit ici et saisis son ID client à la place. Sous le champ de l’ID client, **Ouvrir le guide de Google** mène à cette section.

[Google: iOS / Desktop](https://developers.google.com/identity/protocols/oauth2/native-app) · [Google: Android](https://developer.android.com/identity/authorization)



Ajoute des fichiers, un calendrier ou une messagerie directement au compte qui doit les porter. Pour Google et Microsoft, cela représente un seul consentement pour tout ce que le compte porte plus le nouveau service.

L’inscription Google ne correspond pas au retour sur cet appareil. Vérifie le type de client et la configuration mobile dans le guide Google.

<!-- account-grants-destination-2026-09-14 -->
Une erreur générique ne révèle ni l’état de publication ni la liste des utilisateurs de test de votre projet Google. Vérifiez ces réglages dans Google Cloud et lisez le message précis du fournisseur. Le client de bureau nécessite son identifiant et son secret correspondant ; l’inscription mobile dépend de la plateforme et de la version installée.
