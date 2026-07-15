# Native WebDriver Smoke (hardening P8.2)

Last reviewed: 2026-07-15

The Playwright suites run against a mocked `__TAURI_INTERNALS__` and prove UI
logic, not the native app. The macOS print bug (issue #6) showed exactly what
that gap costs. This document describes the automated native smoke that
closes part of it.

## Tooling decision

**Use `@wdio/tauri-service` (WebdriverIO), not bare `tauri-driver`.** The
current Tauri documentation recommends it: the service runs an embedded
WebDriver server inside the app, which is how **Windows, Linux AND macOS**
are supported — bare `tauri-driver` remains Windows/Linux-only ("macOS has no
WKWebView driver tool available"). This is the only automated way to exercise
the WKWebView build at all.

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
- `apps/desktop/wdio.conf.ts` — `services: ["@wdio/tauri-service"]`, mocha, the
  binary path (override with `PLAINVA_TAURI_BINARY`; `PLAINVA_TAURI_PROFILE`
  picks debug/release). `onPrepare` creates a THROWAWAY vault and writes the
  Tauri store (`<appConfig>/plainva-settings.json`) with `lastVaultPath` +
  `autoOpenLastVault: true`, so the app opens it on launch without the OS folder
  picker; `onComplete` deletes the vault.
- `apps/desktop/wdio/smoke.e2e.ts` — the single flow above.
- `.github/workflows/native-smoke.yml` — `workflow_dispatch`, builds the debug
  binary and runs `test:native` on Windows and Linux (Linux installs
  `webkit2gtk-driver`).

Notes:
- The service uses the `embedded` driver (WebDriver inside the app) on all
  platforms — the only way to exercise the WKWebView build on macOS.
- Not run in the mocked Vitest/Playwright harness (no native build there).
- OS dialogs (print, keychain, folder picker) stay in §6 of the Release Gate
  Checklist — WebDriver cannot drive them.

## Status

- [x] Tooling decided and documented (this file); checklist §7 references it.
- [x] Scaffold committed (B2): `wdio.conf.ts`, `wdio/smoke.e2e.ts`, `test:native`
  script, `@wdio/tauri-service` devDep, `native-smoke.yml` dispatch workflow.
- [ ] First green run on Windows (native build required) — dispatch the workflow
  or run the two commands above locally. Verify the selectors and the
  "restart reopens the note" assumption on the first real run.
- [ ] Linux run (the workflow's ubuntu job, or a VM).
- [ ] macOS run (`macos-latest` runner via the workflow; no local device exists).
