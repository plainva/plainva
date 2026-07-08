# Release Gate Checklist

Last reviewed: 2026-07-06 (follow-up package, item P5.12 of the Optimization & Go-Public master plan of 2026-07-05; internal planning document, maintainer workspace)

Work through this completely and check off every item before EVERY public release (including the first). All items are maintainer-native — they require real operating systems, real cloud accounts, and a real signing key. Record results with date/build in the table below.

## Prerequisites (one-time, before the first release)

- [ ] Updater key pair generated (`pnpm tauri signer generate`, offline) and the PUBLIC key entered in `apps/desktop/src-tauri/tauri.conf.json` under `plugins.updater.pubkey` (replaces `UPDATE_ME`).
- [ ] GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`) set; the private key is kept OFFLINE only.
- [ ] `release.yml` builds signed artifacts including `latest.json`.

## 1. Install smoke test on three operating systems

Per OS: install the installer from the release build, start the app, open a test vault, create/edit/delete a note, quit the app and restart it (the last vault loads, or the splash screen appears, depending on the opt-in).

- [ ] Windows 10/11 (`.msi`/`.exe`; Start menu entry is named "Plainva", taskbar icon correct)
- [ ] macOS (`.dmg`; note Gatekeeper behavior, window title "Plainva")
- [ ] Linux (`.AppImage`/`.deb`; note the keychain fallback hint, ADR 0005)

## 2. Update round trip

- [ ] Install version N, publish version N+1 as a release, wait/trigger it in the app: the update toast appears, Settings → Updates installs it, the app relaunches as N+1.
- [ ] Signature counter-check: a tampered artifact (or wrong pubkey) is REJECTED.

## 3. Sync round trip

Per provider, a file round trip (create → appears on device B → change on B → back on A) plus a provoked conflict (change the same file on both sides → `.CONFLICT` copy + merge UI):

- [ ] WebDAV/Nextcloud
- [ ] Google Drive (BYO credentials)
- [ ] OneDrive (central app registration, observe token rotation)
- [ ] Dropbox (central app registration, fixed loopback port 41953)
- [ ] S3-compatible (R2/MinIO, including folder rename)

## 4. Backup & Restore

- [ ] Auto-ZIP: after opening the vault, the status bar segment appears, the ZIP is in the target folder, rotation keeps 7.
- [ ] ZIP restore: unpack a ZIP and open it as a vault — contents complete, the index builds itself.
- [ ] Version history: change a file → restore an older version (the open editor picks it up) → "Restore deleted files…" with a deleted file.
- [ ] The trash stays empty after an editing session (rotation-spam fix).

## Results

| Date | Build/Tag | OS/Provider | Item | Result |
|---|---|---|---|---|
| | | | | |
