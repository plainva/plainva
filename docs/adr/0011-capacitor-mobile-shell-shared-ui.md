# ADR 0011: Capacitor Mobile Shell and a Shell-Independent Shared UI Package

Status: Accepted (2026-07-10)

## Context

The mobile app will be built inside this monorepo while the desktop app keeps
shipping on its own cadence. `@plainva/core` already isolates the entire domain
layer (Markdown/OKF, indexing, queries, sync with three-way merge) behind three
interfaces — `IVaultAdapter`, `IDatabaseAdapter`, `ISyncTarget` — and is
consumed as plain TypeScript source. The desktop app, however, mixes portable
UI code (pure helpers, React primitives, the CodeMirror editor session) with
Tauri-bound shell code (`@tauri-apps/*` imports across ~45 files), so nothing
above the core could be reused by a second shell.

## Decision

1. **Mobile shell = Capacitor** (iOS + Android), reusing the same React/
   CodeMirror web UI. The mobile vault lives in the app sandbox and syncs
   through the existing `ISyncTarget` providers (sync-first model).
2. **Shared UI lives in `packages/ui`** (`@plainva/ui`), consumed as
   TypeScript source exactly like `@plainva/core` (private, `exports` →
   `./src/index.ts`, no build step).
3. **Purity rule:** code in `packages/ui` (and `packages/core`) must never
   import `@tauri-apps/*` or `@capacitor/*`. Platform capabilities are
   injected by each app shell through explicit interfaces or props ("platform
   services", generalising the editor session's injected `deps` pattern).
   `apps/desktop/src/sharedUiPurity.test.ts` enforces the import ban and
   rejects relative imports that escape the package.
4. **Extraction is incremental.** Pure helpers and primitives move first.
   Settings and credential access move behind `ISettingsStore` /
   `ICredentialStore` interfaces before the store- and keychain-touching
   modules follow. Desktop-only shell code (window chrome, split panes,
   updater, native pickers) stays in `apps/desktop`. Every step must keep the
   full desktop CI green.
5. **Releases stay independent.** Desktop releases keep their tag namespace;
   mobile releases will use a separate tag namespace and workflow, so neither
   app's release ever blocks the other.

## Consequences

- The mobile app reuses the entire domain layer and a growing UI layer;
  cross-cutting changes stay atomic in one repository with one lockfile.
- Desktop behavior is unchanged during extraction; the shared code is covered
  by the existing desktop test suite until `packages/ui` grows its own.
- Both host apps must keep dependency versions aligned (the single lockfile
  makes drift visible at install time).
- Service-bound components (`DialogHost`, `ToastHost`) remain in the desktop
  app until their stores are platform-neutral.

## Alternatives

- **React Native / Flutter shells:** no reuse of the CodeMirror/web editor;
  a second UI implementation to maintain.
- **Copying UI code into the mobile app:** guaranteed drift and double
  maintenance for every fix.
- **A separate mobile repository:** loses atomic cross-cutting changes, the
  shared lockfile and the shared CI.

## Links

- ADR 0001 (pnpm/Turborepo monorepo), ADR 0002 (app stack baseline).
