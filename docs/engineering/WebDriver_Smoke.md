# Native WebDriver Smoke (hardening P8.2)

Last reviewed: 2026-07-11

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

## Setup sketch (first implementation session)

```bash
pnpm add -D -w @wdio/cli @wdio/tauri-service @wdio/mocha-framework
# apps/desktop/wdio.conf.ts: services: [["tauri", { tauriApp: "<path to binary>" }]]
# spec: apps/desktop/wdio/smoke.e2e.ts implementing the flow above
pnpm exec wdio run apps/desktop/wdio.conf.ts
```

Notes for the implementer:
- The app must be BUILT first (`pnpm tauri build --debug` is fine); the
  service launches the produced binary, not the dev server.
- Point the app at a THROWAWAY vault directory (env var or CLI arg) so the
  smoke never touches a real vault; delete it between runs.
- Windows needs Edge WebDriver matching the installed WebView2 when falling
  back to bare `tauri-driver`; the embedded-server route avoids that.
- CI: run as a MANUAL/nightly job, not per-push (a native build per push is
  too slow); macOS needs a `macos-latest` runner.

## Status

- [x] Tooling decided and documented (this file), checklist §7 references it.
- [ ] First local spike on Windows (implementer session — needs a native build).
- [ ] Linux run (CI runner or VM).
- [ ] macOS run (`macos-latest` CI runner; no local device exists).
