# Mobile Release Gate

Last reviewed: 2026-07-12

Checklist before the FIRST public mobile release (store or public TestFlight).
It consolidates the parity plan's P8 gate and the M3E plan's package K —
every unchecked box blocks the release. Copy a filled-out version into the
maintainer workspace per release.

## Product gates (maintainer, on real devices)

- [ ] Security centre pass on physical Android and iPhone: overview, devices, team, slices, recovery, QR request/scan/fingerprint approval, background/pause/force-stop recovery, 44px targets, TalkBack, and VoiceOver.
- [ ] Encrypted two-device pass on each platform: pair, edit offline, revoke, reject replay, run full rekey, resume after force-stop, and restore with a renewed recovery set.

- [ ] Full feature pass on a physical Android device (fresh debug APK):
      home head, theme catalog incl. LCARS/Win95 pendants, note context
      sheet (properties/backlinks/outline/versions), draft recovery banner,
      board card drag + column color, filter groups, schema authoring,
      embeds, share target, launcher shortcuts, vault export.
- [ ] Same pass on a physical iPhone via TestFlight (keyboard bar, safe
      areas, share sheet, haptics).
- [ ] 2+ weeks of daily personal use without data loss.
- [ ] Desktop has been public for 6–8 weeks and no open sync data-loss bug.
- [ ] One real sync round-trip per provider on device (WebDAV, Drive,
      OneDrive, Dropbox, S3) including a forced conflict and its resolution.
- [ ] Kill drill on device: force-stop while typing → reopen → note intact
      AND the draft banner offers the unsaved state.

## Store plumbing

- [ ] Play Console: app created, internal testing track, data-safety form,
      release keystore generated and backed up OFFLINE.
- [ ] `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` /
      `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` set as repo secrets
      (release-mobile.yml signs only when present).
- [ ] App Store Connect: listing, screenshots, privacy nutrition labels;
      TestFlight internal testers verified (ios.yml).
- [ ] Version bump: `apps/mobile/package.json`, Android `versionName`/
      `versionCode` (build.gradle), iOS `MARKETING_VERSION`.
- [ ] Annotated tag `mobile-v<version>` pushed → release-mobile.yml drafts
      the AAB/APK; publish manually after the smoke pass.

## Docs and comms

- [ ] User guide `docs/user/<lang>/Mobile_App.md` current in ALL languages
      (docsParity enforces the file list; content parity is a work duty).
- [ ] Store listing texts + release notes drafted (maintainer workspace).
- [ ] Website download/badge section updated after the store listing is live.

## Known intentional limits at first release

- Relation SCHEMA authoring (targets, cardinality, reverse columns) stays
  desktop-only; mobile edits relation VALUES.
- Graph views fall back to tables on mobile until package F lands.
- Daily-note file names are fixed to ISO (`YYYY-MM-DD.md`) on mobile.
- Snapshot retention is a global mobile setting (desktop: per vault).
