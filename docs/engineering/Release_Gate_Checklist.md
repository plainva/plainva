# Release Gate Checklist

Last reviewed: 2026-07-10 (hardening plan P0.6: prerequisites checked off, a11y/native sections merged in from the retired Native Acceptance Protocol, process rule added)

Work through this completely and check off every item before EVERY public release (including the first). All items are maintainer-native — they require real operating systems, real cloud accounts, and a real signing key. **Process rule: for each release, fill in a COPY of this checklist and archive it (maintainer workspace, `docs/releases/Release_Gate_v<version>.md`); this file stays the blank master.**

> Historical note: v0.1.0–v0.1.2 shipped before this process rule existed; their
> gates were exercised ad hoc (install smokes on Windows/Linux, updater
> round-trip verified via the public `latest.json`, macOS untested for lack of
> a device — which is exactly how the macOS print bug in issue #6 slipped
> through). Starting with the next release the filled-in copy is mandatory.

## Prerequisites (one-time, before the first release)

- [x] Updater key pair generated (`pnpm tauri signer generate`, offline) and the PUBLIC key entered in `apps/desktop/src-tauri/tauri.conf.json` under `plugins.updater.pubkey` (replaces `UPDATE_ME`). *(Done for v0.1.0, 2026-07-08.)*
- [x] GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`) set; the private key is kept OFFLINE only. *(Done for v0.1.0.)*
- [x] `release.yml` builds signed artifacts including `latest.json`. *(Verified live: updater endpoint returns HTTP 200 since v0.1.0.)*

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

## 5. Crash safety (atomic writes — hardening plan P2)

- [ ] Kill drill on Windows: run the documented write-loop + `taskkill` drill against a test vault — afterwards no 0-byte or partial files; every note is either the old or the new state.
- [ ] Same drill once against a network-share vault (SMB rename semantics differ).
- [ ] Draft recovery: kill the app mid-typing → on reopen the draft banner offers the unsaved revision.

## 6. OS-dialog smokes (manual on every platform — no WebDriver covers these)

- [ ] Print / save as PDF opens the OS dialog and produces correct pages (macOS goes through the native path — the issue #6 lesson; Windows/Linux use `window.print()`).
- [ ] Keychain: connect a provider, restart, the secret is still there (macOS Keychain, Windows Credential Manager, Linux secret service or the documented fallback).
- [ ] OS trash: deleting a note lands in the recycle bin/trash.
- [ ] File watcher: an external edit shows up in the tree/editor within ~2 s.
- [ ] Focus behavior: modals trap Tab/Shift+Tab and close on Escape.

## 7. Automated coverage (run, do not skip)

- [ ] Full local CI (`CI=1 git push` runs lint + typecheck + unit + Playwright E2E incl. axe a11y checks at zero violations).
- [ ] WebDriver smoke (`@wdio/tauri-service`, hardening plan P8): start → open vault → type → save → restart → content present. Windows/Linux/macOS as available.
- [ ] `cargo test` + `cargo clippy -- -D warnings` in `apps/desktop/src-tauri`.

## Results

| Date | Build/Tag | OS/Provider | Item | Result |
|---|---|---|---|---|
| | | | | |
