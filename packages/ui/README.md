# @plainva/ui

Shell-independent UI layer shared by the Plainva app shells (desktop today, mobile next):

- `src/lib/` — pure helpers and view-models (no React host, no shell APIs)
- `src/components/ui/` — React primitives (Button, Modal, Menu, …)
- `src/hooks/` — shared React hooks

The package is consumed as TypeScript source through the workspace (no build
step), the same pattern as `@plainva/core`.

**Purity rule (ADR 0011):** code in this package must never import
`@tauri-apps/*` or `@capacitor/*`. Platform capabilities are injected by the
consuming shell. `apps/desktop/src/sharedUiPurity.test.ts` enforces the ban.
