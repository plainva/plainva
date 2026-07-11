# Configurer la synchronisation Google Drive (avec vos propres identifiants)

Pour synchroniser un vault local avec votre Google Drive dans Plainva, vous pouvez utiliser vos propres identifiants API Google. Comme Plainva n'a pas (encore) subi la vérification CASA centrale de Google, cette approche **Bring Your Own Credentials (BYO)** offre un moyen sûr de synchroniser vos fichiers privés.

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

*Important : laissez le statut sur « Testing ». Vous n'avez PAS besoin de publier l'application. En mode test, les jetons expirent après 7 jours — Plainva les renouvelle automatiquement en arrière-plan, mais après des changements importants ou des changements de scope, vous devrez peut-être vous reconnecter.*

### 4. Créer des identifiants (Client ID & Secret)
1. Ouvrez **Credentials** dans le menu de gauche.
2. Cliquez sur **Create Credentials** en haut et choisissez **OAuth client ID**.
3. Comme « Application type », choisissez **Desktop app** (ou « Other UI »).
4. Nom : p. ex. « Plainva Desktop Client ».
5. Cliquez sur **Create**.
6. Une fenêtre pop-up affiche votre **Client ID** et votre **Client Secret**.

### 5. Les saisir dans Plainva
1. Ouvrez Plainva et accédez aux paramètres du vault (icône d'engrenage pour le vault concerné).
2. Ouvrez la section **Synchronisation**.
3. Choisissez **Google Drive** comme fournisseur.
4. Collez l'**ID client** et le **Secret client** copiés dans les champs correspondants.
5. Cliquez sur **Se connecter à Google**.
6. Une fenêtre de navigateur Google s'ouvre. Connectez-vous avec le compte que vous avez ajouté sous « Test users ».
7. Google peut avertir que l'application n'est pas vérifiée. Cliquez sur **Advanced** puis sur **Continue to Plainva (unsafe)**.
8. Confirmez les autorisations demandées.

Votre vault se synchronise désormais en toute sécurité avec Google Drive via vos propres identifiants.
