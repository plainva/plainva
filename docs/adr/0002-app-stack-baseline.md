# ADR 0002: App Stack Baseline

Status: Accepted

Date: 2026-06-22

## Context

Plainva is planned as a multi-surface Markdown vault editor:

- Desktop app
- Mobile app
- Shared application/domain logic
- Later browser/PWA-compatible paths where possible

The project needs a stack baseline that maximizes shared TypeScript code while still allowing native desktop and mobile capabilities for file access, secure storage, OS integration and performance-sensitive work.

This ADR documents the baseline already set in the master plan. It does not implement an app shell and does not decide editor integration, Markdown parsing, storage adapter APIs, sync implementation or concrete native command surfaces.

## Decision

Plainva uses this app-stack baseline:

- Desktop: Tauri 2
- Mobile: Capacitor
- Shared application/domain logic: TypeScript-first
- Native/security/performance-critical work: Rust, used deliberately and narrowly

The shared TypeScript layer is the default home for domain logic such as vault abstractions, parser orchestration, indexing boundaries, sync coordination and AI-harness boundaries.

Rust is reserved for native capabilities and performance/security-sensitive pieces such as file watching, OS keystore access, cryptography and selected indexing or parsing work if profiling justifies it.

## Consequences

- Desktop and mobile can share the same web/editor-facing TypeScript foundations.
- The project keeps a plausible path toward browser/PWA compatibility where native capabilities are not required.
- Rust remains available for native integration without turning the whole core into a Rust-first architecture.
- Contributors mostly work in TypeScript, lowering contribution friction.
- Native boundaries must be explicit and documented as the implementation grows.
- Future app-shell work still needs focused setup steps for Tauri, Capacitor and workspace packages.

## Alternatives

- Electron for desktop: mature, but heavier than Tauri and less aligned with the planned native/security boundary.
- Flutter for all platforms: strong cross-platform story, but would reduce direct reuse of the web editor ecosystem and TypeScript packages.
- React Native for mobile: valid alternative for native mobile access, but weaker for sharing the exact web-editor stack planned for Plainva.
- Rust-first shared core: strong safety/performance story, but worse for PWA compatibility and community maintainability.

## Links

- Master project plan, sections 3.3, 15 and 16 (internal planning document, maintainer workspace)
- `docs/adr/0001-monorepo-pnpm-turborepo.md`
