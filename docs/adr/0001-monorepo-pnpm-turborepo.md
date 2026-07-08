# ADR 0001: Monorepo With pnpm and Turborepo

Status: Accepted

Date: 2026-06-22

## Context

Plainva is planned as a multi-surface product with shared TypeScript logic:

- `apps/desktop` for the Tauri desktop app
- `apps/mobile` for the Capacitor mobile app
- `packages/core` for shared domain logic
- `packages/ui` for shared UI code
- `plugins` for future plugin packages and scaffolding

The first repository skeleton already contains this workspace shape. The root `package.json` declares `pnpm@10.0.0`, root scripts delegate to Turborepo and `pnpm-lock.yaml` has been generated.

This ADR documents that already implemented foundation. It does not decide the detailed desktop, mobile, editor, parser, storage or sync implementation.

## Decision

Plainva uses a pnpm workspace monorepo with Turborepo for root task orchestration.

The workspace globs are:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "plugins/*"
```

Root scripts use Turborepo for `build`, `dev`, `lint`, `test` and `typecheck`.

## Consequences

- Shared code can live in packages and be consumed by multiple apps.
- The repo can grow from placeholders into desktop, mobile, core, UI and plugin workspaces without changing the top-level shape.
- A single lockfile controls dependency resolution.
- Turborepo can later coordinate cached builds, tests and type checks across workspaces.
- Contributors need pnpm in addition to Node.js and npm.
- Actual app/package implementations still need their own focused follow-up decisions and setup.

## Alternatives

- Single package: simpler initially, but a poor fit for planned desktop, mobile, shared core, UI and plugin boundaries.
- npm workspaces without Turborepo: fewer tools, but weaker task orchestration once packages and apps multiply.
- Nx: powerful, but heavier than needed for the current skeleton and early risk-spike phase.
- Separate repositories: clearer isolation, but too much coordination overhead before the core boundaries are validated.

## Links

- `package.json`
- `pnpm-workspace.yaml`
- `turbo.json`
- `pnpm-lock.yaml`
- Master project plan, section 16 (internal planning document, maintainer workspace)
