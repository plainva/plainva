# Sync Setup

Last reviewed: 2026-07-20

Plainva optionally syncs each vault with a storage of your choice — straight from the app, with no Plainva-run service in between: your data travels exclusively between your computer and your own account/server. This page walks through the setup per provider.

Which services work in general (also via WebDAV or the provider's desktop client) is covered in [Sync Compatibility](Sync_Compatibility.md).

## Basics

- Setup lives under **Settings → your vault → Cloud accounts**: **Connect account…** opens the assistant — pick the **provider** first (**Microsoft**, **Google**, **Nextcloud**, **Dropbox**, **Object storage (S3)** or **WebDAV / CalDAV**), then tick the **services** (for file sync: **Files**), then sign in. Exactly **one** account per vault carries the **Files** service. The **Sync** area then shows the connected account with its **Cloud folder** and holds the behavior (**Sync interval**, queue); **Manage account** leads back to the cloud accounts.
- **Open an existing online vault from the start screen**: **Open Vault** → **Online vault** walks you through the same three steps for every provider — **1. Connect** (sign in or enter credentials), **2. Choose the folder in the cloud** (a fresh folder can also be created there via **New folder**), **3. Choose or create the local folder**. Alternatively you can set up sync for an already-open vault any time under Settings.
- **Create a new vault in the cloud**: **New Vault** → **With an online service** — first pick the starter structure (empty or a template like PARA), then connect and choose the target folder in the cloud or create it via **New folder**, finally the local folder. The structure is created in the local folder and uploaded automatically by the first sync.
- Local saves are uploaded immediately; Plainva checks for remote changes at the configured **Sync Interval (seconds)**.
- Offline changes are queued and transferred on the next contact; the status bar shows **Online**/**Offline** and the sync indicator shows the state (**Sync now** on click). During a long or first-time sync the status bar shows the progress as a count (e.g. **Sync 123/540**), so you can see it working through the vault.
- The first time you connect an online vault, a one-time note reminds you that the initial sync can take a while depending on the vault size — you can keep working while it runs.
- If both sides change the same file, Plainva merges them automatically (3-way merge). If that is not possible, your version is safely preserved as a `.CONFLICT` file — nothing is ever lost (see [FAQ](FAQ.md)).
- **Resolving conflicts**: a banner in the affected note (and **Resolve conflict…** in the `.CONFLICT` file's right-click menu in the tree) opens the comparison dialog — the file's current state on the left, your preserved version on the right, editable with per-block take-over. **Save right side & resolve** writes the result into the file and cleans up the conflict copy; **Keep the other side** discards your copy (a version snapshot remains). The sync error dialog also lists existing conflict copies and takes you to the same comparison with one click.
- **Mass-deletion protection**: if an unusually large share of the synced files is about to be deleted in the cloud at once (for example because the local vault folder was emptied or moved), Plainva holds the deletions and asks first: **Delete in the cloud** executes them, **Don't delete (restore)** discards them and restores the files from the cloud on the next sync. Deletions you confirmed in Plainva yourself are not held — for large deletions (more than 10 files or more than 20% of the vault) Plainva instead asks a second time before deleting.
- Attachments (images etc.) are synced too.
- **Empty folders** sync as well: a folder created in Plainva appears in the cloud right away, and empty cloud folders appear on your other devices with the next full listing at the latest.
- Credentials and tokens are stored in the operating system's keychain (status: **Settings → App → About & diagnostics → OS keychain**), never in files inside the vault.
- **Disconnect** stops the vault's sync; no files are deleted anywhere by doing so.

## WebDAV / Nextcloud

The simplest route for self-hosted servers and most cloud storages:

1. In **Cloud accounts** → **Connect account…** pick the **Nextcloud** tile (or **WebDAV / CalDAV**).
2. Enter the **Server address**, **Username** and **Password or App Token** — use an app password instead of your main password whenever possible (in Nextcloud: Settings → Security → App passwords).
3. **Sign in** validates the credentials; afterwards pick the **Cloud folder** via **Choose folder…**.

**Nextcloud** special: ONE form covers files **and** calendar — Plainva derives the WebDAV and CalDAV endpoints from the server address itself (the derived addresses are shown in the assistant; **Advanced: set endpoints individually** allows separate URLs). Tick both services and a single pass connects both.

Typical server addresses (Nextcloud, Koofr, MagentaCLOUD, Storage Box and many more) are listed in [Sync Compatibility](Sync_Compatibility.md).

## Google Drive

Google Drive currently runs with your own credentials ("Bring Your Own"): you create a free Google Cloud project once, owned by you alone. The step-by-step guide: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Short version: in **Cloud accounts** → **Connect account…** pick the **Google** tile, tick the **Files** service, enter the **Client ID** and **Client Secret** from your Google project, then **Sign in with Google…** — the sign-in opens in your browser. Once connected, pick the **Cloud folder** via **Choose folder…** straight from your Drive (subfolders included, default "Plainva"). Note: while the Google project is in testing mode, the login expires after 7 days and must be renewed via **Sign in again** in the account details.

## OneDrive

Plainva ships its own app registration — you **no longer need your own ID**:

1. In **Cloud accounts** → **Connect account…** pick the **Microsoft** tile and tick the **Files** service (OneDrive) — on request together with **Calendar & tasks** and **Email** (one Microsoft account can carry all three services).
2. **Sign in with Microsoft…** and confirm the sign-in in the browser. Done — Plainva creates the folder (default "Plainva") and syncs its entire content, including externally added files.
3. Optional: once connected, pick the **Cloud folder** via **Choose folder…** straight from your OneDrive (subfolders included).

Optional: via **Use your own app ID** you can instead supply a self-registered client ID (e.g. for corporate restrictions). Detailed guide: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Dropbox

Plainva ships its own Dropbox app — **no own app needed**:

1. In **Cloud accounts** → **Connect account…** pick the **Dropbox** tile (it carries only the **Files** service).
2. **Sign in with Dropbox…** and confirm in the browser. Done (default folder `/Plainva`).
3. Optional: once connected, pick the **Cloud folder** via **Choose folder…** straight from your Dropbox (subfolders included).

Optional: via **Use your own app ID** you can instead supply a self-registered app key. Detailed guide: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## S3-compatible storage

For AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner and others — key-based, no browser sign-in at all. In **Cloud accounts** → **Connect account…** pick the **Object storage (S3)** tile and fill in the fields:

| Field | Meaning |
|---|---|
| **Endpoint** | Base URL of the S3 API, e.g. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` or `http://127.0.0.1:9000` for local MinIO |
| **Bucket** | Bucket name |
| **Region** | SigV4 region; `us-east-1` works for most non-AWS stores, Cloudflare R2 uses `auto` |
| **Access Key ID** / **Secret Access Key** | An API key pair from the provider |
| **Key Prefix (optional)** | Subfolder inside the bucket for the vault; empty = bucket root |
| **Path-style URLs** | Recommended (MinIO, R2 and most compatibles); disable only for virtual-hosted AWS buckets |

You can pick the **Key Prefix** (the cloud folder) via **Choose folder…** straight from the bucket once connected.

After **Sign in**, sync starts right away.

## See also

- [Sync Compatibility](Sync_Compatibility.md) — which services work and how, including the desktop-client route
- [FAQ & Troubleshooting](FAQ.md) — conflict files, offline behavior
