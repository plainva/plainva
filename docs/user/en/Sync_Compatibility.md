# Plainva Sync Compatibility

Last reviewed: 2026-07-04 (updated after the OneDrive, Dropbox and S3 integrations)

Plainva syncs vaults through interchangeable sync adapters. This page shows which services you can use today — directly integrated, via the WebDAV protocol, or via the provider's own desktop sync client.

## Directly integrated

| Provider | Status | Notes |
|---|---|---|
| Local folder | Available | No setup needed; external changes (e.g. by other sync tools) are detected automatically. |
| WebDAV / Nextcloud | Available, verified with Nextcloud | Server URL, username and (recommended) an app password. |
| Google Drive | Available (BYO credentials) | Requires your own Google Cloud project, see the [Google Drive BYO guide](Google_Drive_BYO_Guide.md). |
| OneDrive | Available (new 2026-07-04, native acceptance pending) | Sign-in via browser (PKCE, no secret). Until Plainva ships its own app registration, you need your own (free) Entra app registration: type "Mobile and desktop applications", redirect URI `http://localhost`. |
| Dropbox | Available (new 2026-07-04, native acceptance pending) | Sign-in via browser (PKCE, no secret). Until Plainva ships its own app, you need your own (free) Dropbox app: full-Dropbox access, redirect URI exactly `http://127.0.0.1:41953`. |
| S3-compatible object storage | Available (new 2026-07-04, native acceptance pending) | AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner and others — just an endpoint, bucket, region and an API key pair; no browser sign-in. |

## Services usable via WebDAV

The WebDAV adapter speaks standard WebDAV, so the following services should work, among others. They have not been verified individually yet — feedback is welcome. The addresses are typical patterns; double-check them in your provider's documentation and use an app password instead of your main password whenever possible.

| Service | Typical WebDAV address |
|---|---|
| Nextcloud (self-hosted or with a provider) | `https://<server>/remote.php/dav/files/<user>/` |
| ownCloud | `https://<server>/remote.php/dav/files/<user>/` |
| Koofr | `https://app.koofr.net/dav/Koofr` |
| Strato HiDrive | `https://webdav.hidrive.strato.com` |
| MagentaCLOUD (Telekom) | `https://magentacloud.de/remote.php/dav/files/<user>/` |
| GMX Mediacenter | `https://webdav.mc.gmx.net` |
| WEB.DE online storage | `https://webdav.smartdrive.web.de` |
| Hetzner Storage Box | `https://<user>.your-storagebox.de` |
| Synology NAS | Enable the WebDAV Server package, then `https://<nas>:5006` |
| QNAP NAS | Enable WebDAV in the system; address per QNAP docs |
| Seafile | Enable SeafDAV, then `https://<server>/seafdav` |

## Via the provider's desktop sync client (local folder)

Until native integrations arrive, you can use any service whose desktop client keeps a local folder in sync. Plainva then treats the vault as a local folder and detects external changes automatically.

**Important:** Set the vault folder to "always keep on this device" / "available offline". Online-only placeholder files (Files On-Demand, online-only, streaming mode) can interfere with indexing and sync.

- **OneDrive** (Explorer integration; disable Files On-Demand for the vault folder)
- **Dropbox** (desktop client; avoid "online-only" for the vault folder)
- **Google Drive for Desktop** ("Mirror" mode instead of "Stream" for the vault folder)
- **iCloud Drive** (iCloud for Windows or macOS; set the folder to "Keep Downloaded")
- **Syncthing / Resilio Sync** (P2P, no cloud provider at all)

## Note on the new integrations (2026-07-04)

OneDrive, Dropbox and S3-compatible storage have been directly integrated since 2026-07-04 (see the table above) — earlier than planned in the master plan's staging (§13.3). Once Plainva ships central app registrations for OneDrive and Dropbox, the step with your own client ID or app key disappears; the fields will come pre-filled. The desktop-sync-client route (see above) remains available as an alternative.

## Deliberately not planned

- **iCloud as an API integration:** Apple offers no official third-party API for iCloud Drive. Use the local iCloud folder instead (see above).
- **Proton Drive / Mega:** no official or only hard-to-integrate APIs (E2E encryption, C++ SDK). Kept under observation.
- **Watchlist** (on demand): pCloud, Box, Filen, SFTP.
