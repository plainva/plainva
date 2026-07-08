# Plainva Core

Shared TypeScript domain logic and early risk-spike tests.

Current scope (Phase 1 & 2 completed):

- 100% loss-less Markdown roundtrip parsing via `remark`
- Obsidian-syntax preservation (`[[Wikilinks]]`, `![[Embeds]]`, `==Highlights==`)
- Zod schemas for Open Knowledge Format (OKF) frontmatter and Markdown AST
- AST manipulation utilities (task toggling, link renaming)
- High-performance SQLite (`sqlite3`) local database adapter for storing files, links, tags, and properties
- `VaultIndexer` that syncs a Markdown folder structure into a fast SQLite cache
- FTS5 full-text search and backlink queries via `VaultQueryService`
- `SyncQueue` for offline-first architecture tracking changes (`local_ahead`, `synced`)

## Dependencies: why `sqlite`/`sqlite3` appear twice

`sqlite` and `sqlite3` are listed both as **optional peerDependencies** and as **devDependencies** — that is intentional, not a leftover:

- **peerDependencies (optional):** `SqliteDatabaseAdapter` is part of the public API but only useful in Node environments. Consumers who use it bring their own driver; consumers on other adapters (e.g. the Tauri desktop app with `TauriDatabaseAdapter` via `@tauri-apps/plugin-sql`) never install it.
- **devDependencies:** the package's own tests and the recovery drill exercise `SqliteDatabaseAdapter` against a real in-process SQLite, so the driver must be installed inside this workspace.
- `better-sqlite3` is dev-only for `scripts/benchmark.ts` and not part of any runtime path.

## Package Status

`@plainva/core` is currently a private workspace-internal package. It is not published on npm and should be consumed only through the pnpm monorepo workspace.

A later npm preflight must be completed before publication:

- Build distributable `dist` output.
- Point `exports`, `main` and `types` at generated artifacts instead of `src`.
- Verify generated type declarations.
- Run `npm pack --dry-run`.
- Decide SemVer/versioning and Changesets or an equivalent release workflow.

Run the current package tests:

```powershell
pnpm --filter @plainva/core test
pnpm --filter @plainva/core typecheck
```
