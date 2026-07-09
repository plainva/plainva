# Sync Setup

Last reviewed: 2026-07-09

Plainva optionally syncs each vault with a storage of your choice — straight from the app, with no Plainva-run service in between: your data travels exclusively between your computer and your own account/server. This page walks through the setup per provider.

Which services work in general (also via WebDAV or the provider's desktop client) is covered in [Sync Compatibility](Sync_Compatibility.md).

## Basics

- Setup lives under **Settings → Vault Settings → Cloud Sync**. The **Sync Provider** is chosen per vault: **None (Local only)**, **WebDAV / Nextcloud**, **Google Drive**, **OneDrive**, **Dropbox** or **S3-compatible storage** — always exactly one per vault.
- Local saves are uploaded immediately; Plainva checks for remote changes at the configured **Sync Interval (seconds)**.
- Offline changes are queued and transferred on the next contact; the status bar shows **Online**/**Offline** and the sync indicator shows the state (**Sync now** on click). During a long or first-time sync the status bar shows the progress as a count (e.g. **Sync 123/540**), so you can see it working through the vault.
- The first time you connect an online vault, a one-time note reminds you that the initial sync can take a while depending on the vault size — you can keep working while it runs.
- If both sides change the same file, Plainva merges them automatically (3-way merge). If that is not possible, your version is safely preserved as a `.CONFLICT` file — nothing is ever lost (see [FAQ](FAQ.md)).
- **Resolving conflicts**: a banner in the affected note (and **Resolve conflict…** in the `.CONFLICT` file's right-click menu in the tree) opens the comparison dialog — the file's current state on the left, your preserved version on the right, editable with per-block take-over. **Save right side & resolve** writes the result into the file and cleans up the conflict copy; **Keep the other side** discards your copy (a version snapshot remains). The sync error dialog also lists existing conflict copies and takes you to the same comparison with one click.
- **Mass-deletion protection**: if an unusually large share of the synced files is about to be deleted in the cloud at once (for example because the local vault folder was emptied or moved), Plainva holds the deletions and asks first: **Delete in the cloud** executes them, **Don't delete (restore)** discards them and restores the files from the cloud on the next sync.
- Attachments (images etc.) are synced too.
- Credentials and tokens are stored in the operating system's keychain (status: **Settings → System diagnostics → OS keychain**), never in files inside the vault.
- **Disconnect** stops the vault's sync; no files are deleted anywhere by doing so.

## WebDAV / Nextcloud

The simplest route for self-hosted servers and most cloud storages:

1. Set the **Sync Provider** to **WebDAV / Nextcloud**.
2. Enter the **Server URL**, **Username** and **Password or App Token** — use an app password instead of your main password whenever possible (in Nextcloud: Settings → Security → App passwords).
3. Pick the target folder via **Browse Server**, then **Save**.

Typical server addresses (Nextcloud, Koofr, MagentaCLOUD, Storage Box and many more) are listed in [Sync Compatibility](Sync_Compatibility.md).

## Google Drive

Google Drive currently runs with your own credentials ("Bring Your Own"): you create a free Google Cloud project once, owned by you alone. The step-by-step guide: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Short version: enter the **Client ID** and **Client Secret** from your Google project, set the **Drive Folder (Name)** (default "Plainva"), then **Connect to Google** — the sign-in opens in your browser. Once connected, pick the folder via **Choose folder…** straight from your Drive (subfolders included) instead of typing the name. Note: while the Google project is in testing mode, the login expires after 7 days and must be renewed via **Reconnect**.

## OneDrive

Plainva ships its own app registration — you **no longer need your own ID**:

1. Set the **Sync Provider** to **OneDrive**; optionally set the **OneDrive Folder (Name)** (default "Plainva").
2. **Connect to Microsoft** and confirm the sign-in in the browser. Done — Plainva creates the folder and syncs its entire content, including externally added files.
3. Optional: once connected, pick the target folder via **Choose folder…** straight from your OneDrive (subfolders included) instead of typing the name.

Optional: via **Use your own app ID** you can instead supply a self-registered client ID (e.g. for corporate restrictions). Detailed guide: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Dropbox

Plainva ships its own Dropbox app — **no own app needed**:

1. Set the **Sync Provider** to **Dropbox**; optionally set the **Dropbox Folder (Path)** (default `/Plainva`).
2. **Connect to Dropbox** and confirm in the browser. Done.
3. Optional: once connected, pick the target folder via **Choose folder…** straight from your Dropbox (subfolders included) instead of typing the path.

Optional: via **Use your own app ID** you can instead supply a self-registered app key. Detailed guide: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## S3-compatible storage

For AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner and others — key-based, no browser sign-in at all:

| Field | Meaning |
|---|---|
| **Endpoint** | Base URL of the S3 API, e.g. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` or `http://127.0.0.1:9000` for local MinIO |
| **Bucket** | Bucket name |
| **Region** | SigV4 region; `us-east-1` works for most non-AWS stores, Cloudflare R2 uses `auto` |
| **Access Key ID** / **Secret Access Key** | An API key pair from the provider |
| **Key Prefix (optional)** | Subfolder inside the bucket for the vault; empty = bucket root |
| **Path-style URLs** | Recommended (MinIO, R2 and most compatibles); disable only for virtual-hosted AWS buckets |

You can also pick the **Key Prefix** via **Choose folder…** straight from the bucket — this already works before saving, as soon as the endpoint, bucket and keys are filled in.

After **Apply**, sync starts right away.

## See also

- [Sync Compatibility](Sync_Compatibility.md) — which services work and how, including the desktop-client route
- [FAQ & Troubleshooting](FAQ.md) — conflict files, offline behavior
