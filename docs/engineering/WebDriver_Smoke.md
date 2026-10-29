# Native WebDriver Smoke (hardening P8.2)

Last reviewed: 2026-10-29

The Playwright suites run against a mocked `__TAURI_INTERNALS__` and prove UI
logic, not the native app. The macOS print bug (issue #6) showed exactly what
that gap costs. This document describes the automated native smoke that
closes part of it.

## Tooling decision

**Use `@wdio/tauri-service` (WebdriverIO).** On **Windows and Linux** with its
`external` driver: the service starts a cargo-installed `tauri-driver` in front
of the platform's WebDriver (WebKitWebDriver on Linux, the Edge WebDriver on
Windows) and drives the unchanged debug binary. On **macOS** with its
`embedded` driver — a WebDriver server INSIDE the app
(`tauri-plugin-wdio-webdriver`), the only way to reach WKWebView. That server
is compiled in only by the cargo feature `webdriver-smoke` of the smoke build;
no release carries it (section "macOS" below). The first run of the
native-smoke workflow (2026-09-29) had asked for the embedded driver without
the plugin and failed; Linux and Windows have used the external driver since.

## Scope of the smoke (keep it small and boring)

One session, the cases in order, `apps/desktop/wdio/smoke.e2e.ts`:

1. **S1** — the binary starts and opens a prepared throwaway vault.
2. **S2** — a new note, a typed marker, the marker in the file on disk.
3. **S3** — spell checking: the editor is handed to the platform's checker
   (`spellcheck="true"` with the device switch on); on macOS also the
   WebView's own setting (issue #135).
4. **S4a** — the global quick capture is switched on and a shortcut recorded
   (issue #123). **S4b** (macOS) — the recorded shortcut, pressed with the
   Finder in front, opens the capture window.
5. **S5** (Linux, macOS) — the note moves into a second window, which shows it
   and writes to the file (#86).

The spec switches to the main window explicitly once at the start: without
that the service looks for the active window before every find and click,
through a helper plugin (`tauri-plugin-wdio`) this app does not carry, and
waits five seconds for it each time.

Together that exercises window creation, the real fs plugin, the atomic write
command, the SQLite index, the global-shortcut plugin and the multi-window
write path. The proof of a write is the FILE, read by the test process — not
the window after a restart (see "State on 2026-10-06"). OS dialogs (print,
keychain prompts, folder pickers) can NOT be driven by WebDriver — those stay
in the manual §6 of the Release Gate Checklist.

## How to run it

From the repository root, build the app once, then run the smoke:

```bash
# Linux / Windows (Windows adds --config src-tauri/tauri.smoke.conf.json)
pnpm --filter desktop exec tauri build --debug --no-bundle
# macOS: the app bundle, with the embedded WebDriver server
pnpm --filter desktop exec tauri build --debug --bundles app --features webdriver-smoke --config src-tauri/tauri.smoke.macos.conf.json

pnpm --filter desktop test:native           # wdio run ./wdio.conf.ts
```

Files:
- `apps/desktop/wdio.conf.ts` — `@wdio/tauri-service`: `embedded` on macOS
  (the executable inside `Plainva.app`), `external` with
  `autoInstallTauriDriver` elsewhere; mocha; the binary path (override with
  `PLAINVA_TAURI_BINARY`; `PLAINVA_TAURI_PROFILE` picks debug/release).
  `onPrepare` creates a THROWAWAY vault and writes the Tauri store
  (`<appData>/plainva-settings.json` — the store plugin resolves against the
  app DATA dir, which on Linux is not the config dir) with `lastVaultPath`,
  `autoOpenLastVault: true` and the spell checking switch on, so the app opens
  the vault on launch without the OS folder picker; `onComplete` deletes the
  vault. A failed case leaves a screenshot and the page source in
  `wdio-logs/`, on macOS also the whole screen and the app's unified log.
- `apps/desktop/wdio/smoke.e2e.ts` — the cases above; `wdio/macos.ts` — real
  input on macOS.
- `.github/workflows/native-smoke.yml` — jobs `linux`, `windows`, `macos`
  (triggers in "macOS" below).
- `apps/desktop/scripts/check-webdriver-server.sh` — is the embedded server in
  a built binary.

Notes:
- `tauri-driver` is installed with cargo on first use (the workflow sets up
  Rust), the Edge WebDriver is managed by the service on Windows, Linux needs
  `webkit2gtk-driver`.
- Not run in the mocked Vitest/Playwright harness (no native build there).

## Status

- [x] Tooling decided and documented (this file); checklist §7 references it.
- [x] Scaffold committed (B2): `wdio.conf.ts`, `wdio/smoke.e2e.ts`, `test:native`
  script, `@wdio/tauri-service` devDep, `native-smoke.yml` dispatch workflow.
- [x] First dispatch (2026-09-29): both jobs failed before the smoke itself —
  first on mismatched Tauri halves (`tauri-plugin-http` 2.7 vs
  `@tauri-apps/plugin-http` 2.6; fixed, and `tauriVersionPairs.test.ts` now
  compares every pair in the regular CI), then on the embedded driver the
  scaffold asked for without its plugin (now the external driver).
- [x] First green run on Windows and Linux (2026-10-06, below).
- [x] macOS: the embedded driver in a smoke-only build and a `macos-latest`
  job (2026-10-29, section "macOS").
- [ ] macOS probation: five green runs in a row, then the release blocks on
  it like on Linux and Windows (`macos_may_fail` out of `release.yml`).

## State on 2026-10-06: green on Linux and Windows

Run 37462811787 was the first in which both jobs passed. Six dispatches got there, and each one answered one question:

- **The spec addresses the ribbon by test id.** "New note" was the only ribbon entry without one and was searched by its label; it now carries `data-testid="ribbon-new"`.
- **A fresh profile opens with a dialog over the ribbon.** The click was intercepted; the spec closes dialogs with Escape before it starts.
- **"New note" asks for the name first**, in a field in the file tree. The spec names the note; before that no editor ever appeared.
- **On WebKitGTK, global key actions do not reach the editor.** The note file was created and stayed empty while the same steps passed on Windows. The marker is sent to the editor element (`addValue`).
- **The proof is the file on disk, not the window after a restart.** `browser.reloadSession()` never came back on the first run that reached it. The cause is not established — a second launch meeting the first one's single-instance lock is a suspicion. The spec asserts what only a native run can show, that the typed bytes are in the vault; session restore stays with the mocked suites.
- **Windows needs a smoke build.** `session not created: DevToolsActivePort file doesn't exist` had one cause, measured by starting the binary the way the driver does and printing the WebView's command line: the WebView library (wry) always sets the browser arguments itself, so the `--remote-debugging-port` the Edge driver passes through `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` never reached the browser process (its user data folder, passed the same way, did). The Windows job therefore builds with `src-tauri/tauri.smoke.conf.json`, which puts the port into the window's `additionalBrowserArgs`. No release build uses that overlay, and it must stay that way: a release binary with an open debugging port would hand the WebView to any local process.

Still in the workflow: a step that starts the Windows binary on its own and reports what it finds (never fails the job), a screenshot and the page source of a failed step, and the driver log — all uploaded when a run fails.

**macOS:** not covered then. Only the embedded driver reaches WKWebView and it needs `tauri-plugin-wdio-webdriver` in the binary; decided on 2026-10-06 not to add that until this workflow had been green for a while — done on 2026-10-29, next section.

## macOS: the embedded driver in a smoke-only build (since 2026-10-29)

No external driver reaches WKWebView, so the macOS job uses the service's
**embedded** driver: a W3C WebDriver server inside the app,
`tauri-plugin-wdio-webdriver`, from the same repository as
`@wdio/tauri-service` and on the same version (1.5.1; both pinned exactly,
`src/tauriVersionPairs.test.ts` keeps them together).

That server is a full remote control of the app on `127.0.0.1:4445`, so it is
in exactly one build:

- **Cargo feature `webdriver-smoke`** (`src-tauri/Cargo.toml`): the crate is an
  optional dependency, and `lib.rs` registers the plugin under
  `#[cfg(feature = "webdriver-smoke")]` only — never under `debug_assertions`,
  so a developer build (`tauri:isolated`) opens no port.
- **Smoke build** (`native-smoke.yml`, job `macos`): `tauri build --debug
  --bundles app --features webdriver-smoke --config
  src-tauri/tauri.smoke.macos.conf.json`. The overlay empties the update
  sources and builds no updater artefacts; windows and identifier stay the
  release ones. The plugin needs no capability (it registers no commands).
- **The app bundle, not the bare binary**: only inside `Plainva.app` does the
  process run with the bundle identifier `com.plainva.desktop`, and with it
  the defaults domain the spell checking of issue #135 is stored in. The
  service starts the path it is given as a process, so `wdio.conf.ts` points
  it at `Plainva.app/Contents/MacOS/<binary>`.
- **Two locks**: `src/webdriverSmokeIsolation.test.ts` (runs with the desktop
  unit tests) fails a default feature, an ungated registration, a capability,
  a configuration or a release workflow that names the server.
  `scripts/check-webdriver-server.sh` reads what was built: every release leg
  runs it on the binary it ships and stops the release if it finds the
  server; the smoke build runs it with `--expect-present` as the positive
  control, the Linux and Windows smoke builds (no feature) as the negative one.

### Synthetic and real input

The embedded driver's input is **synthetic**: a click is `el.click()` followed
by `el.focus()`, keys are `KeyboardEvent`s handed to `dispatchEvent`, text goes
in through `execCommand('insertText')` or the native value setter. That proves
what the page does with an event — not that a person's event arrives. Issue
#123 (a clicked button gets no focus in WebKit on macOS, so the shortcut
recorder heard nothing) would have passed it unseen, and a system-wide
shortcut is no page event at all.

Where only a real event proves something, the spec goes through the system
(`wdio/macos.ts`, built into macOS, nothing installed): a mouse click posted as
a CoreGraphics HID event from JavaScript for Automation, keys and window order
through System Events. On GitHub's macOS runners `/usr/bin/osascript` holds the
Accessibility and Automation rights for that in the runner image; if an image
takes them away, the case fails with the system's words ("not allowed
assistive access") and a pointer here. The fallback would be Appium Mac2 — a
new dependency, decided separately.

### What the cases prove

| Case | Linux | Windows | macOS | Proves |
|---|---|---|---|---|
| S1 start, vault opens | yes | yes | yes | start, store, index |
| S2 note typed, marker in the file | yes | yes | yes (real Return and typing) | the write path down to the disk |
| S3 spell checking | attribute | attribute | attribute + `defaults read … WebContinuousSpellCheckingEnabled` = 1 | #135 at its cause, not at the attribute |
| S4a quick capture on, shortcut recorded | driver input | driver input | real click, real keys | #123 with real focus behaviour; the system accepts the key |
| S4b shortcut from the Finder opens the capture window | — | — | yes | the system-wide key reaches the app |
| S5 note in a second window writes to the file | yes | — (see below) | yes (real typing) | #86, the second window's write path |

S5 does not run on Windows, and not because of the app: the Windows smoke
build gives the main window a WebView2 debugging port in its browser
arguments (`tauri.smoke.conf.json` — the Edge driver reaches the WebView no
other way), and WebView2 refuses a second WebView with different arguments in
the same data folder. A window opened at run time has the default arguments,
so in that build the second window is never created (measured 2026-10-29: the
app's own window list held `main` alone). Release builds give every window the
same arguments.

On macOS the embedded driver's synthetic input fell short twice more
(2026-10-29), so the spec uses real input there for every step a person's
keyboard decides: its Enter reaches a field's key handlers but never submits
the field's form (implicit submission is for trusted keys only), so S2 names
the new note with a real Return; and its text (`execCommand('insertText')`)
reached CodeMirror in one run and not in the next, so S2 and S5 click into the
editor, go to the end of the note with Cmd+Down and type through System
Events. What still goes through the driver on macOS — opening the settings,
the switch, the menu, reading the page — is page logic, not input behaviour.

Not proven: that WebKit actually draws the red line (only on a screenshot),
printing, keychain and folder picker (OS dialogs, §6 of the Release Gate
Checklist), macOS versions older than the runner's, and session restore after
a restart.

### When it runs, and what blocks

`native-smoke.yml` runs on demand, every Monday, on a push to `main` that
touches `src-tauri/`, `wdio/`, `wdio.conf.ts`, the binary check or the
workflow, and from `release.yml` for every release — parallel to the build
legs. A red Linux or Windows smoke turns the release run red. macOS is on
**probation** until it has been green five runs in a row: the release calls
it with `macos_may_fail`, the job runs and its result goes into the release
record, but it does not stop the release. It is not a required check for
`main`.
