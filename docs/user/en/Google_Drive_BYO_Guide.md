# Setting up Google Drive Sync (Bring Your Own Credentials)

Last updated: 2026-10-09

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

*Important: you do NOT need to publish the app — it works fully in "Testing" status. Expect Google to expire the sign-in after **7 days** in that case, and for good: in this mode the refresh token expires too, so Plainva cannot renew it in the background. Plainva says so in plain words ("sign-in expired"), and **Sign in again** in the account details restores it in one round trip for every service of that account.*

**In production** removes the fixed expiry of testing mode. It does not guarantee a permanent sign-in: Google can still expire or revoke access. Publishing and verification requirements depend on the use and requested permissions. [Google: refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

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

<!-- accounts-tasks-2026-09-11 -->
## Google OAuth — Desktop / Android / iOS

The desktop instructions above require a Desktop client ID and its matching client secret. On the phone, Android and iOS alike, Plainva signs in to Google in the browser: create an OAuth client of type **iOS** in your Google project, also for Android, with the bundle ID `com.plainva.app`. Plainva returns through `com.plainva.app:/oauth2redirect`; there is no client secret. Enter the client ID in Plainva's Google form. Do not create a client of type Android: Google accepts the package name and certificate fingerprint of the Play build in one single project worldwide and refuses every other one (“the Android package name and fingerprint are already in use”). An Android client that was set up for Plainva 0.8.3 or 0.8.4 does not work for a new sign-in; accounts that are already signed in keep working. A desktop client cannot replace the mobile registration. For calendars, also enable Google Calendar API and Google Tasks API.

[Google: iOS / Desktop](https://developers.google.com/identity/protocols/oauth2/native-app) · [Google: Android](https://developer.android.com/identity/authorization)



Add files, calendar or email directly to the appropriate account. Plainva checks the selected sign-in and requests any missing permissions.

The Google registration does not match this device’s return path. Check the client type and mobile setup in the Google guide.

<!-- account-grants-destination-2026-09-14 -->
A generic sign-in error cannot tell Plainva your Google project’s publishing status or test-user list. Check those settings in Google Cloud and read the specific provider message. A desktop client needs its client ID and matching client secret value; mobile registration depends on the platform and installed build.
