# Native WebDriver Smoke (hardening P8.2)

Last reviewed: 2026-09-30

The Playwright suites run against a mocked `__TAURI_INTERNALS__` and prove UI
logic, not the native app. The macOS print bug (issue #6) showed exactly what
that gap costs. This document describes the automated native smoke that
closes part of it.

## Tooling decision

**Use `@wdio/tauri-service` (WebdriverIO), with its `external` driver.** The
service starts a cargo-installed `tauri-driver` in front of the platform's
WebDriver (WebKitWebDriver on Linux, the Edge WebDriver on Windows) and drives
the unchanged binary. That covers **Windows and Linux**.

The service's default is the `embedded` driver — a WebDriver server INSIDE the
app, and the only way to reach the WKWebView build on macOS. It needs the crate
`tauri-plugin-wdio-webdriver` compiled into the binary and registered in
`lib.rs`. The first run of the native-smoke workflow (2026-09-29) failed on
exactly that: the scaffold asked for the embedded driver without the plugin.
Shipping a WebDriver server is not a test-only change — at the least it would
live behind a cargo feature that only the smoke build enables — so it is left
as a decision; until then macOS is not covered by this smoke.

## Scope of the smoke (keep it tiny and boring)

1. Launch the release (or debug) binary.
2. Open a prepared test vault.
3. Create a note, type a marker string.
4. Wait for the autosave, restart the app.
5. Assert the marker string is present again.

That single flow exercises: window creation, the real fs plugin, the atomic
write command, the SQLite index, and session restore. OS dialogs (print,
keychain prompts, folder pickers) can NOT be driven by WebDriver — those stay
in the manual §6 of the Release Gate Checklist.

## How to run it (B2 scaffold)

The scaffold is committed. From `apps/desktop`, build the binary once, then run:

```bash
pnpm --filter desktop tauri build --debug   # produces target/debug/plainva-desktop(.exe)
pnpm --filter desktop test:native           # wdio run ./wdio.conf.ts
```

Files:
- `apps/desktop/wdio.conf.ts` — `@wdio/tauri-service` with
  `driverProvider: "external"` and `autoInstallTauriDriver: true`, mocha, the
  binary path (override with `PLAINVA_TAURI_BINARY`; `PLAINVA_TAURI_PROFILE`
  picks debug/release). `onPrepare` creates a THROWAWAY vault and writes the
  Tauri store (`<appData>/plainva-settings.json` — the store plugin resolves
  against the app DATA dir, which on Linux is not the config dir) with `lastVaultPath` +
  `autoOpenLastVault: true`, so the app opens it on launch without the OS folder
  picker; `onComplete` deletes the vault.
- `apps/desktop/wdio/smoke.e2e.ts` — the single flow above.
- `.github/workflows/native-smoke.yml` — `workflow_dispatch`, builds the debug
  binary and runs `test:native` on Windows and Linux (Linux installs
  `webkit2gtk-driver`).

Notes:
- The service uses the `external` driver: `tauri-driver` is installed with
  cargo on first use (the workflow sets up Rust), the Edge WebDriver is managed
  by the service on Windows, Linux needs `webkit2gtk-driver`. macOS would need
  the embedded driver and with it `tauri-plugin-wdio-webdriver` in the app — not
  done (see "Tooling decision").
- Not run in the mocked Vitest/Playwright harness (no native build there).
- OS dialogs (print, keychain, folder picker) stay in §6 of the Release Gate
  Checklist — WebDriver cannot drive them.

## Status

- [x] Tooling decided and documented (this file); checklist §7 references it.
- [x] Scaffold committed (B2): `wdio.conf.ts`, `wdio/smoke.e2e.ts`, `test:native`
  script, `@wdio/tauri-service` devDep, `native-smoke.yml` dispatch workflow.
- [x] First dispatch (2026-09-29): both jobs failed before the smoke itself —
  first on mismatched Tauri halves (`tauri-plugin-http` 2.7 vs
  `@tauri-apps/plugin-http` 2.6; fixed, and `tauriVersionPairs.test.ts` now
  compares every pair in the regular CI), then on the embedded driver the
  scaffold asked for without its plugin (now the external driver).
- [ ] First green run on Windows and Linux — verify the selectors and the
  "restart reopens the note" assumption on it.
- [ ] macOS — needs the embedded driver, i.e. `tauri-plugin-wdio-webdriver` in
  a smoke-only build (a decision, see "Tooling decision"), and a `macos-latest`
  job in the workflow.
