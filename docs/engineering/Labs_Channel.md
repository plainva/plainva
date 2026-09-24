# Labs channel

Plainva Labs is a third app identity next to the release app and the isolated dev build. It is built from a feature branch, installs side by side with the other two, and keeps its own data. Its purpose is to test a long-running branch (first the AI harness, branch `feature/ai-harness`) on real devices while `main` keeps its own development and release rhythm, and without a branch build ever reaching the store app.

Nothing about it is specific to one branch: any feature branch can be built into Labs. On one device, one Labs build is installed at a time.

## Identities

| Shell | Release | Dev build | Labs |
|---|---|---|---|
| Desktop | `com.plainva.desktop`, "Plainva" | `com.plainva.desktop.dev`, "Plainva Dev" (`tauri.dev.conf.json`) | `com.plainva.desktop.labs`, "Plainva Labs" (`tauri.labs.conf.json`) |
| Android | `com.plainva.app` | – | `com.plainva.app.labs`, "Plainva Labs" (build type `labs`) |
| iOS | `com.plainva.app` (+ `.widgets`, `.share`, App Group `group.com.plainva.app`) | – | `com.plainva.app.labs` (+ `.labs.widgets`, `.labs.share`, App Group `group.com.plainva.app.labs`), "Plainva Labs" |

The Tauri identifier already separates app data, the WebView profile and the single-instance lock. Two things did not follow it and now do:

- **Keychain.** The keychain service used to be a fixed `"plainva"`, so every installation that opened the same vault read and rotated the same sync and OAuth tokens without a cross-process lock (against ADR 0015). `src-tauri/src/app_identity.rs` derives the service from the identifier: the release app keeps `"plainva"` so no entry is lost on update, every other installation uses `"plainva:<identifier>"` and signs in on its own, like a second device. After this change the dev build signs in once.
- **Product name.** Autostart entries, the MSI upgrade code and the NSIS install folder derive from `productName`. The dev overlay now says "Plainva Dev", the Labs overlay "Plainva Labs", so neither can take over the release app's entries.

Dev and Labs builds never offer the public release as an update: their overlays clear the updater endpoints, and `services/appUpdate.ts` checks only when the identifier is the release one. Their windows are titled "Plainva (Dev)" and "Plainva Labs".

## Build info

Every build carries `__PLAINVA_BUILD__` — channel, branch or tag, commit, CI run — defined by both Vite configs from `scripts/build-info.mjs`. It appears in the desktop About line, under the logo in the mobile About screen and in the diagnostics export. The release workflows set `PLAINVA_BUILD_CHANNEL=release`; a local build says `local`. The variables are part of the turbo build cache key.

## Running Labs on the desktop

From a checkout (or git worktree) of the branch:

```bash
pnpm --filter desktop tauri:labs
```

Vite serves the Labs build on port 1450 (`dev:labs`); the dev build keeps 1440, and 1420 stays free for the pre-push E2E. Release, dev build and Labs run at the same time. Only one of them can use the fixed Dropbox loopback port 41953 or the global quick capture shortcut at a time.

## Guards on main

- **CI for feature branches.** `ci.yml` and `codeql.yml` run on pushes to `main` and `feature/**`, so a long-lived branch gets the same checks on every push without a standing pull request.
- **No branch uploads into the store app.** `release-mobile.yml` (Play internal track) and the TestFlight job of `ios.yml` refuse any commit that is not on `main` (GitHub compare API: `identical` or `behind`). Before, any ref could upload into `com.plainva.app`.
- **Conflict-poor anchors.** Every locale file starts with an `"ai": {}` section, and the parity catalog has the area `ai`, which sorts first. A branch adds its keys and entries there instead of at the ends of the files, where `main` appends.

## Mobile Labs builds

Dispatch the workflow on the branch:

```bash
gh workflow run labs-mobile.yml --ref feature/ai-harness
```

- **Android** — the build type `labs` in `android/app/build.gradle` (`applicationIdSuffix '.labs'`, `versionNameSuffix '-labs'`). `src/labs/res` overrides the app name and carries a copy of the launcher shortcuts with the Labs id written in, because resource XML takes no placeholders; `launcherShortcuts.test.ts` fails when the copy drifts from `src/main`. The workflow signs the APK with the upload key and attaches it as `plainva-labs.apk` to the draft release `labs-android`, so the download link stays the same from build to build. It never goes to Play. The package name is registered for the Android developer verification with the first Labs APK.
- **iOS** — one Xcode project for both identities. The project-level build settings `PLAINVA_BUNDLE_BASE`, `PLAINVA_APP_GROUP` and `PLAINVA_DISPLAY_NAME` default to the store app; every bundle id is the base plus a fixed suffix, the entitlements take the group, and the Info.plists carry `PlainvaAppGroup` and `PlainvaURLScheme`, which the Swift code reads instead of literals. The workflow overrides the three settings on the `xcodebuild` command line, signs with the Labs profiles (secrets `IOS_LABS_*`) and uploads into the separate App Store Connect app "Plainva Labs", whose internal group receives every build. `install-ios-profiles.py`, `verify-ios-share-archive.py` and `testflight-what-to-test.mjs` read the same variables.

**The scheme is the id.** Deep links, OAuth redirects, launcher shortcuts and widget taps ride the app's URL scheme, which is its application or bundle id: Android writes `${applicationId}` into the manifest and builds widget URLs from `getPackageName()`, iOS reads `PlainvaURLScheme`, the web layer reads `APP_URL` from `apps/mobile/src/services/appScheme.ts` (set by `VITE_PLAINVA_APP_ID`). `appIdentity.test.ts` fails the next hand-written `"com.plainva.app://"`.

**Sign-ins.** To every OAuth provider, Labs is a separate app. Until its ids are registered — an Android and an iOS Google client for `com.plainva.app.labs`, the redirect `com.plainva.app.labs://oauth` at Dropbox and in the Entra app — Google, Dropbox and OneDrive sign-ins fail in Labs; WebDAV, local folders and every provider on the desktop are unaffected. The Labs workflow leaves the Google test client variables out, so Labs reports "not configured" instead of a provider error.

**App Store Connect.** `filter[bundleId]` matches by prefix: a query for `com.plainva.app` also returns `com.plainva.app.labs`, and first. Scripts pick their app by the exact bundle id (`iosSigningChain.test.ts` checks both TestFlight scripts).

## Working with two trees

- Always push with `CI=1 git push`. Without `CI`, Playwright reuses a server it finds on 1420, 4173 or 4174 — possibly the other tree's — and tests the wrong code; with `CI=1` it fails loudly instead. Push the two trees one after the other.
- A new worktree has no git hooks until `pnpm install` has run in it (`core.hooksPath=.husky/_`).
- Bring `main` into a long-lived branch by merge, never by rebase, so logged commit hashes stay valid.
