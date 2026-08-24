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
      Since 0.6.7 the release workflow itself asserts this on the Windows leg ("Verify Windows signatures carry a timestamp"): every installer *and* the application binary must be `Valid` and timestamped, or the cut fails before anything is published. The manual measurement below stays — it is the only one that looks at the file a user actually downloads — but a forgotten check can no longer ship. Confirmed again for 0.6.7 on 2026-08-20: the signer expired **the day after the cut** (`NotAfter 2026-08-21 15:50`), and the signature is `Valid` solely because of the timestamp.
- [x] The **application binary is signed too**, not just the installer — this had been open since 0.6.6 and is now settled. Proven at 0.6.7 by extracting the NSIS archive (`7z x` — the file sits flat at the archive root, which is what the 2026-08-18 attempt got wrong) and measuring: `plainva-desktop.exe`, `Valid`, `CN=Marco Kammradt`, timestamped. The build log confirms the mechanism — Tauri signs the binary *before* packaging it into both the MSI and the NSIS installer, so the same signed bytes land on disk. Since 0.6.7 the release workflow asserts this on every build rather than leaving it to a post-hoc check.
- [ ] Note the file **name**: the binary is `plainva-desktop.exe` (the Cargo bin name — `mainBinaryName` is not set, `productName` only affects the display name). The old command in this list named `plainva.exe`, which would have failed with "file not found" and could easily be misread as "not signed". At the next real installation, confirm the installed path — likely `$env:LOCALAPPDATA\Programs\Plainva\plainva-desktop.exe`: `Get-ChildItem "$env:LOCALAPPDATA\Programs\Plainva" -Filter *.exe | ForEach-Object { Get-AuthenticodeSignature $_.FullName }`. Renaming does not invalidate an Authenticode signature, so this is about finding the file, not about validity.
- [ ] If this is the first signed Windows release: the "not code-signed / SmartScreen" wording in `README.md`, on the website landing pages (all ten languages) and in the user guide is corrected in the same release. Until a signed build ships, those texts are still true and must stay.
- [ ] macOS (`.dmg`; signed and notarized, so a plain double-click must work; window title "Plainva")
- [ ] Linux (`.AppImage`/`.deb`; note the keychain fallback hint, ADR 0005)

### 1a. The supported floor still says what it does

The window is drawn by the system's web engine, so the engine sets the floor: **Safari 16.4 /
WebKitGTK 2.40**, declared as macOS **13.3** — on macOS the WebView is a system component and moves
with OS updates, not with Safari, so the system version decides the engine (issue #46 was reported
twice from the same Mac to establish that; Monterey stops at Safari 15.6.1 however current its
Safari is, and Ventura reached 16.4 at 13.3). Several places carry that number and a ratchet holds
them together — but the ratchet cannot check the outside world.

The phone carries the SAME bar, because it ships the same shared packages: **iOS 16.4**, which on
iOS is the whole answer — the engine ships with the system and no separately installable browser
can run ahead of it. Android has no version to declare: its WebView is an updatable component, so
the boot guard is the only thing that can tell a user below the floor, and the only fix it can name
is "update Android System WebView".

- [ ] `minimumSystemVersion` in `tauri.conf.json`, `build.target` in `vite.config.ts` and the
      requirements in README / website / user guide still name the same floor.
- [ ] `IPHONEOS_DEPLOYMENT_TARGET` in `apps/mobile/ios/App/App.xcodeproj/project.pbxproj` names the
      iOS floor in EVERY build configuration, and the mobile page of the user guide names it too. Both are ratcheted (`floorConsistency.test.ts`); the App Store listing is
      not — it takes the number from the deployment target, so check the listing once after a move.
- [ ] If the floor moved this release: BOTH boot guards (`apps/desktop/public/boot-guard.js`,
      `apps/mobile/public/boot-guard.js`) moved with it. They are the only thing a user below the
      floor ever sees.
- [ ] `pnpm --filter desktop build && node apps/desktop/scripts/scan-engine-floor.mjs` reports no
      fatal finding in the startup chain. It finds known violations from a hand-maintained list — a
      clean run means "nothing known is wrong", not "verified".
- [ ] Same scan for the phone: `pnpm --filter mobile build && node apps/desktop/scripts/scan-engine-floor.mjs mobile`.
      The phone ships the same shared packages, so it carries the same bar — and it is the shell
      where the bar bit: lookbehind sits in ITS startup chain, which is what iOS 16.4 enforces.
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

## 12. Multiple windows (desktop only)

Auxiliary windows are the one surface where the automated suites are blind by
construction: Playwright drives a single browser page, so it never sees a real
second OS window, a monitor that was unplugged, or a taskbar entry. Everything
below needs a human at a real desktop.

- [ ] Pop out a note (tab context menu, "Open in new window"): the tab LEAVES the
      main window, the new window carries its own title bar, and typing plus
      saving works there.
- [ ] Open the same note again from the main window: the existing window comes
      forward instead of a second editor appearing. Same check for a view
      (calendar/mail/graph/tasks) through the ribbon context menu.
- [ ] Command palette, "Open communications window": ONE window comes up already
      split, mail beside the calendar.
- [ ] The pin keeps a window above the main window while you work in the latter.
- [ ] Restart with two auxiliary windows open: both come back where they were
      (Settings → Startup & behavior → Windows, on by default). Turn the switch
      off, restart again: only the main window comes up.
- [ ] **Unplug the second monitor, then restart.** A window that used to live
      there must come up on a monitor you can actually reach, not off-screen.
- [ ] Pop out a composer with text in it, then close that window: the message is
      NOT restored on the next start — it lives in memory, and a window claiming
      to have kept it would be worse than no window.
- [ ] Send from a popped-out composer: the message leaves, the composer window
      closes, and the undo notice appears in the MAIN window.
- [ ] Close the main window while auxiliary windows are open: they close too, and
      no orphaned process stays behind in the task manager.
- [ ] Start the app a second time while it is running: the existing instance
      comes forward instead of a second process opening the same vault.

A **full second window** (command palette, "Open a second window") is the same
shell again, in client mode. What it adds is a surface where "who owns the
writes" becomes visible, so the checks below are about the seam rather than
about the widgets:

- [ ] Open a second window: it comes up with sidebars, ribbon, tabs and status
      bar — and with the SAME vault. Editing and saving a note there works.
- [ ] The status bar in the second window shows the sync state of the vault, not
      "local". Trigger "Sync now" there: the central window's worker runs.
- [ ] Click the gear in the second window: the CENTRAL window comes forward and
      opens settings there. Same for the import wizard.
- [ ] Delete a note in the second window: it is gone in both, and no
      mass-deletion warning appears in the central window.
- [ ] Collapse a sidebar in the second window: the central window keeps its own.
      Close the second window, open a new one — it starts clean rather than with
      the closed window's sidebar.
- [ ] Open a note that is already open in the other window: the window holding
      it comes forward, no second editor appears.

Stage D gives every window its own vault. The checks below need two windows and
two DISTINCT vault folders; the automated suites hold at most one runtime
because they hold at most one window.

- [ ] Switch the vault in the second window: the central window keeps its own.
      Tree, search and status bar in each window belong to that window's vault.
- [ ] Edit and save in both windows within the same minute: each note lands in
      its own vault, and neither status bar reports the other's sync.
- [ ] Two vaults on the SAME cloud account (both on OneDrive, say): both sync and
      neither signs the other out. Leave them open long enough for a real token
      renewal — an hour is the usual window.
- [ ] Try to open a vault that lies INSIDE an open one, and one that CONTAINS an
      open one: Plainva refuses both with a named reason instead of opening them.
      Repeat after a restart with the nesting already in place — the restore is
      the one door folders can move behind between sessions.
- [ ] Point the second window back at the central window's vault: both show it,
      nothing is torn down, and a note still only opens in one of them.
- [ ] Close the second window while it holds the ONLY view of vault B: the
      central window keeps working on A, and B's pending push arrives when B is
      opened again.
- [ ] A reminder due in vault B fires exactly ONCE while both are open, and the
      tray's "next" line names the vault it belongs to.
- [ ] Restart with two vaults open: both come back, each in its own window.
- [ ] Close the vault in the central window while the second window shows a
      different one: the second window keeps working.

## Results

| Date | Build/Tag | OS/Provider | Item | Result |
|---|---|---|---|---|
| | | | | |
