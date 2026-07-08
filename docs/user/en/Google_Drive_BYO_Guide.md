# Setting up Google Drive Sync (Bring Your Own Credentials)

To sync a local vault with your Google Drive in Plainva, you can use your own Google API credentials. Since Plainva has not (yet) gone through Google's central CASA verification, this **Bring Your Own Credentials (BYO)** approach offers a safe way to sync your private files.

You essentially set up your own little "developer project" at Google that belongs to you alone and that only you can access.

## Step-by-step guide

### 1. Create a project in the Google Cloud Console
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Sign in with your Google account.
3. At the top left (next to the Google Cloud logo), open the project dropdown and choose **New Project**.
4. Enter a name (e.g. "Plainva Sync") and click **Create**.

### 2. Enable the Google Drive API
1. Select your newly created project in the dropdown at the top.
2. Search for **Google Drive API** in the top search bar and pick the entry under "Marketplace".
3. Click **Enable**.

### 3. Configure the OAuth consent screen
For Plainva to use your credentials, a consent screen ("OAuth Consent Screen") must be set up. Since only you use the app, it stays in "testing" mode.

1. In the left side menu under **APIs & Services**, open **OAuth consent screen**.
2. Under "User Type" choose **External** (unless you use Google Workspace) and click **Create**.
3. **App information:**
   - App name: e.g. "Plainva"
   - User support email: your own email
   - Developer contact information: your own email
   - Click **Save and Continue**.
4. **Scopes:**
   - Click **Add or Remove Scopes**.
   - Search for `.../auth/drive` (Google Drive API, full access) and tick the box.
   - *Background: full access is needed so Plainva can also sync files that you drop into your sync folder via the Google Drive web interface.*
   - Click Update, then **Save and Continue**.
5. **Test users:**
   - Click **Add Users**.
   - Enter exactly the Google email address you will later use for sync in Plainva.
   - Click **Save and Continue**, then return to the dashboard.

*Important: leave the status on "Testing". You do NOT need to publish the app. In testing mode, tokens expire after 7 days — Plainva renews them automatically in the background, but after significant changes or scope switches you may need to sign in again.*

### 4. Create credentials (Client ID & Secret)
1. Open **Credentials** in the left menu.
2. Click **Create Credentials** at the top and choose **OAuth client ID**.
3. As the "Application type" choose **Desktop app** (or "Other UI").
4. Name: e.g. "Plainva Desktop Client".
5. Click **Create**.
6. A popup shows your **Client ID** and **Client Secret**.

### 5. Enter them in Plainva
1. Open Plainva and go to the vault settings (gear icon for the vault in question).
2. Open the **Cloud Sync** section.
3. Choose **Google Drive** as the provider.
4. Paste the copied **Client ID** and **Client Secret** into the corresponding fields.
5. Click **Connect to Google**.
6. A Google browser window opens. Sign in with the account you added under "Test users".
7. Google may warn that the app is unverified. Click **Advanced** and then **Continue to Plainva (unsafe)**.
8. Confirm the requested permissions.

Your vault now syncs safely with Google Drive through your own credentials.
