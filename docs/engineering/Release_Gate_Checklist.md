# Release Gate Checklist

Last reviewed: 2026-08-14 (section 10 added — social posts carry hashtags; the practice had eroded twice with no decision recorded. Earlier: 2026-07-28, P3.2 added section 8 — the release dialog and the blog post are part of the cut, not of the communication afterwards)

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
- [x] macOS OS code-signing (Developer ID) and notarization wired. *(Done for v0.4.1.)*
- [x] Windows OS code-signing via Azure Artifact Signing wired: certificate profile `plainva` (account `plainva-signing`, North Europe), secrets `AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/`AZURE_TENANT_ID`, `tauri.signing.conf.json` loaded on the Windows leg. *(Set up 2026-08-11; first signed build still unproven — see section 1.)*
- [ ] **Two expiry dates that fail this pipeline silently and late:** the Entra client secret (**2028-08-11**) and the identity validation behind the certificate profile (**2028-10-23**). Renew before, not after.

## 1. Install smoke test on three operating systems

Per OS: install the installer from the release build, start the app, open a test vault, create/edit/delete a note, quit the app and restart it (the last vault loads, or the splash screen appears, depending on the opt-in).

- [ ] Windows 10/11 (`.msi`/`.exe`; Start menu entry is named "Plainva", taskbar icon correct)
- [ ] Windows signature present: right-click the installer → **Properties → Digital Signatures** shows a valid entry for "Marco Kammradt", and the UAC prompt names Plainva rather than an unknown publisher. SmartScreen may still warn until download reputation builds — that is expected, not a failure. What the warning must show is the identity: **More info** names "Marco Kammradt" and offers **Run anyway**; "Unknown publisher" there means the signature is missing, not merely unproven.
- [ ] **The signature carries a timestamp** — measure it, do not assume it. On the downloaded file:
      `powershell -c "$s=Get-AuthenticodeSignature '<installer>'; $s.Status; $s.SignerCertificate.NotAfter; [bool]$s.TimeStamperCertificate"`
      Expect `Valid`, a `NotAfter` that may already be **in the past**, and `True` for the timestamp. Azure Trusted Signing issues short-lived certificates (days), so the timestamp is the only thing keeping the signature valid after they lapse — an untimestamped build passes a same-day check and breaks for every user a few days later. Verified this way for 0.6.6 on 2026-08-18: signer `CN=Marco Kammradt`, issuer `Microsoft ID Verified CS EOC CA 03`, certificate expired 2026-08-17 16:06, status still `Valid`.
- [ ] The **installed** `plainva.exe` is signed too, not just the installer — otherwise SmartScreen warns a second time on first launch. Check after installing: `Get-AuthenticodeSignature "$env:LOCALAPPDATA\Programs\Plainva\plainva.exe"`. Still unverified as of 0.6.6.
- [ ] If this is the first signed Windows release: the "not code-signed / SmartScreen" wording in `README.md`, on the website landing pages (all ten languages) and in the user guide is corrected in the same release. Until a signed build ships, those texts are still true and must stay.
- [ ] macOS (`.dmg`; signed and notarized, so a plain double-click must work; window title "Plainva")
- [ ] Linux (`.AppImage`/`.deb`; note the keychain fallback hint, ADR 0005)

### 1a. The supported floor still says what it does

The window is drawn by the system's web engine, so the engine sets the floor: **Safari 16.4 /
WebKitGTK 2.40**, declared as macOS **13.3** — on macOS the WebView is a system component and moves
with OS updates, not with Safari, so the system version decides the engine (issue #46 was reported
twice from the same Mac to establish that; Monterey stops at Safari 15.6.1 however current its
Safari is, and Ventura reached 16.4 at 13.3). Three places carry that number and a ratchet holds
them together — but the ratchet cannot check the outside world.

- [ ] `minimumSystemVersion` in `tauri.conf.json`, `build.target` in `vite.config.ts` and the
      requirements in README / website / user guide still name the same floor.
- [ ] If the floor moved this release: the boot guard's message (`public/boot-guard.js`) moved with
      it. It is the only thing a user below the floor ever sees.
- [ ] `pnpm --filter desktop build && node apps/desktop/scripts/scan-engine-floor.mjs` reports no
      fatal finding in the startup chain. It finds known violations from a hand-maintained list — a
      clean run means "nothing known is wrong", not "verified".
- [ ] Ideally, once per floor change: start the build on a machine at the floor. Issue #46 was a
      blank window for exactly as long as nobody did.

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
- [ ] WebDriver smoke (B2/P8): build the app, then `pnpm --filter desktop test:native` (or dispatch `.github/workflows/native-smoke.yml`) — start → vault auto-opens → type → save → restart → content present. Windows/Linux/macOS as available. See `WebDriver_Smoke.md`.
- [ ] `cargo test` + `cargo clippy -- -D warnings` in `apps/desktop/src-tauri`.
- [ ] Performance: `node scripts/measure-performance.mjs` (one command — generates the vaults,
      measures, and rewrites its own block in `Performance_Notes.md`). It covers the harness
      paths only; the "Native measurements" table in that file still needs the running app, and
      the open 20k cold-index question (DoD 5) lives there.

## 8. Release notes the app itself shows

Two artefacts are part of the cut, not of the communication afterwards: without
them the release dialog announces the PREVIOUS release's highlights to everyone
who updates, in every language.

- [ ] `packages/ui/src/lib/whatsNew.ts`: a new catalog entry at the TOP with this
      version, its date, one `highlights` element per point (icon; `experimental`
      where it applies — the lead comes first) and the blog URL.
- [ ] `whatsNew.highlightNTitle` and `whatsNew.highlightN` in ALL ten locales,
      one headline and ONE sentence each; `localeParity.test.ts` fails if the
      catalog and the texts disagree.
- [ ] For a full release, publish the release blog post in all ten languages
      (the `blogUrl` above must resolve once the website is deployed). The
      explicitly approved minimal-hotfix exception is documented below.
- [ ] For an explicitly approved minimal hotfix, the catalog entry and one
      concise translated highlight remain mandatory so the app cannot announce
      the previous release again; `blogUrl`, blog and social material may be
      omitted when the maintainer explicitly waives the full release routine.
- [ ] **Does the landing page still tell the truth?** Only when the release adds
      or changes something user-visible. Docs and the blog are kept current by
      habit; the landing page is not, and it had drifted far enough that six
      shipped features — cloud accounts, calendar, tasks, email, the pinboard
      and the whole import — were missing from it. Check the feature grid, the
      second row, the "also built in" line and the landing FAQ, plus
      `/features`, in `plainva/website`.

### Coordinated app release

- [ ] A maintainer-triggered release covers every app variant unless an explicit
      exception says otherwise; do not cut a desktop-only release by default.
- [ ] Desktop and Android use the same three-part `X.Y.Z` version: desktop tag
      `vX.Y.Z`, Android tag `mobile-vX.Y.Z`, and both package manifests set to
      `X.Y.Z`.
- [ ] The coordinated cut includes a fresh iOS/TestFlight build. Keep the Apple
      marketing-version policy selected for that release and increase the build
      number monotonically.
- [ ] Android's `versionCode` is higher than every previously distributed build.
      Public Play/App Store production still requires its own explicit approval.

## 9. Encrypted workspace (P8-P11; hard blocker)

- [ ] Workspace unit, fuzz, provider-fault, desktop E2E, and mobile-background suites pass.
- [ ] Independent cryptographic review is attached with no open critical/high finding.
- [ ] Revocation is tested in future-only and full-rekey mode; a kill at every phase resumes without rollback.
- [ ] Sanitized publication contains no excluded property, link target, embed, attachment, catalog, or search metadata.
- [ ] Physical Android and iOS two-device runs reject revoked-device replay.
- [ ] Android internal and iOS TestFlight builds contain the tested security centre.

## 10. Social posts carry hashtags

Without them a post is effectively invisible to anyone who does not already
follow the account — which is precisely the audience a release announcement
exists for. This is a checkbox because the practice eroded twice unnoticed:
Bluesky lost its tags from 0.6.0, all three English channels from 0.6.3, and no
decision to that effect was recorded anywhere.

- [ ] Every social post carries a hashtag line: Bluesky, X and Mastodon
      (Plainva, English), Instagram/Threads and the YouTube community post
      (Verklickt, German).
- [ ] Baseline English `#opensource #markdown`, plus `#pkm` on Bluesky and
      Mastodon; baseline German `#opensource #markdown #notizen`. Mastodon
      usually has room for `#foss` or `#selfhosted`.
- [ ] **When a character limit is tight, the prose gives way — never the
      hashtag line.**
- [ ] The length recorded in the communication file INCLUDES the hashtags, and
      is measured rather than estimated: count graphemes
      (`Intl.Segmenter`), not UTF-16 units, or the emoji in a Mastodon post are
      counted twice. Bluesky counts the full URL; X counts any link as 23.

## 11. Desktop/mobile parity of what shipped

Plainva is one product with two shells, and a release is the moment an
asymmetry becomes visible to users: the phone updates and its owner reads a
highlight about something the phone does not have. `featureParity.test.ts`
keeps the recorded differences honest, but it cannot notice a feature nobody
recorded — that is what this checkbox is for.

- [ ] Walk this release's highlights (`packages/ui/src/lib/whatsNew.ts`) and ask
      per point: does it work on BOTH shells? A point that is desktop-only needs
      either a mobile follow-up or a `featureParity.ts` entry — not silence.
- [ ] Every fix in this release reached both shells, or the one-sided ones are
      in the catalog with a reason.
- [ ] Re-read `PARITY_FEATURES`: entries whose gap closed in this cycle are
      DELETED, and the `verified` date is current for anything touched.
- [ ] Where a highlight is deliberately desktop-only, the release notes say so
      plainly rather than letting phone users hunt for it.

## Results

| Date | Build/Tag | OS/Provider | Item | Result |
|---|---|---|---|---|
| | | | | |
