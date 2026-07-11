# Setting up OneDrive & Dropbox (your own app registration)

Last reviewed: 2026-07-11

**You normally don't need this page:** Plainva ships its own app IDs for OneDrive and Dropbox — you pick the provider, click **Connect** and sign in. This guide is only for the **optional** case where you want to use your own (free) app registration (e.g. for corporate restrictions). In the sync settings you reveal the ID fields via **Use your own app ID**, then enter a single public value:

- **OneDrive** → a **Client ID** (format `00000000-0000-0000-0000-000000000000`)
- **Dropbox** → an **App Key** (a short string)

Both registrations are free, need no credit card and no paid subscription. You do **not** need a secret password (client secret) — the values above are public and safe to store.

This page is the detailed companion to the short versions under [Sync Setup](Sync_Setup.md).

> Plainva's bundled IDs are already pre-filled — you only need Parts A/B below for your **own** registration.

---

## Part A — OneDrive (Microsoft Entra)

**Prerequisite:** a Microsoft account (the same one whose OneDrive you want to sync). On first sign-in Microsoft automatically creates a free directory for you — no Azure subscription is needed.

### 1. Open the portal

1. Go to **[entra.microsoft.com](https://entra.microsoft.com)** (`portal.azure.com` also works).
2. Sign in with your Microsoft account.

### 2. Create a new app registration

1. Menu **Identity → Applications → App registrations**, then **+ New registration**.
2. **Name:** free choice, e.g. `Plainva` (display only).
3. **Supported account types:** choose **"Accounts in any organizational directory … and personal Microsoft accounts"**. Only this option matches Plainva's sign-in endpoint; "this directory only" makes personal OneDrive accounts fail.
4. **Redirect URI** — do this right here:
   - Platform: **"Public client/native (mobile & desktop)"**.
   - Value: `http://localhost` (exactly like this — no port, no trailing slash).

   > ⚠️ Do not pick "Web" or "SPA". "Web" requires a client secret and sign-in will fail.
5. **Register**.

### 3. Copy the Client ID

On the app's **Overview**, copy the **"Application (client) ID"** — that is your value for Plainva. (You do not need the "Directory (tenant) ID".)

### 4. Allow public client flows

1. Menu **Authentication**.
2. At the very bottom, set **"Allow public client flows"** to **Yes**.
3. **Save**.

### 5. Set the permissions

1. Menu **API permissions → + Add a permission → Microsoft Graph → Delegated permissions**.
2. Tick both:
   - `Files.ReadWrite`
   - `offline_access` (provides the long-lived sign-in token — **without it** Plainva refuses to connect)
3. **Add**. Admin consent is not needed for personal accounts; you consent yourself at sign-in.

### Enter it in Plainva

1. **Settings → Vault → Sync**.
2. Set the **Sync Provider** to **OneDrive**.
3. Paste the copied Application ID into the **Client ID** field; optionally set the **OneDrive Folder (Name)** (default `Plainva`).
4. **Connect to Microsoft** → sign in in the browser and confirm access. The browser then tells you that you can close the window.

---

## Part B — Dropbox

**Prerequisite:** a Dropbox account.

### 1. Open the app console

1. Go to **[dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)** and sign in.
2. Click **Create app**.

### 2. Choose the app type

1. **Choose an API:** **Scoped access**.
2. **Type of access:** **Full Dropbox** — not "App folder".

   > ⚠️ **Full Dropbox** is required: "App folder" only sees an isolated subfolder and won't find existing vaults elsewhere in your Dropbox.
3. **Name:** a globally unique name, e.g. `Plainva-Sync-<yourname>` (technical only, nobody else sees it).
4. **Create app**.

### 3. Register the redirect URI

Tab **Settings → OAuth 2 → Redirect URIs**: enter **exactly** `http://127.0.0.1:41953` and click **Add**.

> ⚠️ It must match character for character: `127.0.0.1` (not `localhost`), port `41953`, no trailing slash. Plainva binds this exact port; any deviation aborts sign-in.

### 4. Set the permissions

Tab **Permissions** — tick the following and click **Submit** at the bottom:

- `files.metadata.read`
- `files.content.read`
- `files.content.write`

> ⚠️ If you change the permissions later, you must **Reconnect** in Plainva, otherwise the old rights still apply.

### 5. Copy the App key

Tab **Settings**: copy the **App key** value — that is your value for Plainva. (You do not need the "App secret".)

> Your app stays in "Development" status. That is enough for private use; "Apply for production" is only needed if many other people use the same App key.

### Enter it in Plainva

1. **Settings → Vault → Sync**.
2. Set the **Sync Provider** to **Dropbox**.
3. Paste the copied App key into the **App Key** field; optionally set the **Dropbox Folder (Path)** (default `/Plainva`).
4. **Connect to Dropbox** → sign in in the browser and confirm access.

---

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| OneDrive: "Microsoft returned no refresh_token" | `offline_access` missing | Step A5: add `offline_access`, then **Reconnect** |
| OneDrive: login asks for a secret / fails | Platform "Web" instead of "Mobile and desktop" | Step A2: platform **Public client/native**, redirect `http://localhost` |
| OneDrive: personal account is rejected | Wrong account type | Step A2: choose "… and personal Microsoft accounts" |
| Dropbox: sign-in hangs / "redirect_uri mismatch" | Redirect not exact | Step B3: exactly `http://127.0.0.1:41953` |
| Dropbox: "Port 41953 is in use" | Another program blocks the port | Close the blocking application, try again |
| Dropbox: can't find the vault / missing rights | "App folder" instead of "Full Dropbox", or permissions not **Submit**ted | Check step B2 / B4, then **Reconnect** |

## See also

- [Sync Setup](Sync_Setup.md) — short version and the other providers
- [Sync Compatibility](Sync_Compatibility.md) — which services work and how
- [FAQ & Troubleshooting](FAQ.md)
