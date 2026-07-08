# ADR 0007: Broad Desktop Filesystem and Asset Scope (No Vault Sandboxing)

Status: Accepted

Date: 2026-06-27

> Verification note: This decision concerns the Tauri security
> configuration of the desktop app (`tauri.conf.json`, capabilities). The
> native re-test (app startup, vault switching across drive boundaries)
> remains a maintainer task. This ADR is revisable if a later sandbox/
> permission model (e.g., dynamic scope grants) is introduced.

## Context

Tauri v2 allows restricting the app's file access via `assetProtocol.scope` and
the FS capabilities (e.g., to a fixed folder). The roadmap
(`MVP_Desktop_Plan.md`, Phase 8) originally planned to restrict the
currently broad scope (`**` + platform roots) to the respective vault path
before release.

However, Plainva is a **Markdown vault editor**: users open, create, and
switch vaults at **arbitrary locations in the filesystem** — local folders,
different drives, externally mounted directories — just like Obsidian.
This free folder choice is a core feature, not a peripheral constraint.

Statically restricting the scope to a fixed path would either break this
core feature or force renewed permission grants on every vault switch —
with poor UX and no real security benefit, since the app is installed by
the user anyway and used for exactly this purpose.

## Decision

The `assetProtocol` scope and the FS capabilities remain **deliberately
broad** (`**` plus platform roots). There is **no** static vault-path sandboxing.

Hardening instead happens at the layers where it is actually effective:

- **CSP** is set (instead of `null`) and limits what the WebView is allowed
  to load/connect to.
- **Path traversal guards** (Phase 4.1) prevent write paths from escaping
  the addressed vault.
- **Pre-merge backups** (`.plainva/backups/`) protect vault data against
  accidental loss.

The trust model is explicitly "local, user-installed desktop app" — not
"sandboxed browser application".

## Consequences

- (+) Users can open/place vaults anywhere and use multiple vaults and
  external folders — without friction or repeated permission dialogs.
- (+) No special cases for drive/platform roots; behavior matches the
  Obsidian expectations of the target users.
- (−) Within the scope of its Tauri commands, the app can access the
  filesystem broadly. This is a documented, deliberately accepted residual
  risk that is addressed via CSP, path guards, and backups (not via FS
  sandboxing).
- The hardening assumption from `MVP_Desktop_Plan.md` Phase 8, item 1
  ("restrict scope to the vault path") is thereby superseded: only the CSP
  hardening was necessary, the FS scope remains open.

## Alternatives considered

1. **Vault-restricted scope** (scope = current vault path): rejected —
   breaks multi-vault and opening arbitrary locations; contradicts the core
   UX.
2. **Dynamic per-vault scope grants** (runtime extension of the scope on
   open): rejected for the MVP — Tauri v2 runtime scope extension is
   costly and the UX suffers on vault switching. Can be reevaluated as
   post-MVP hardening if a stricter permission model is desired.

## Links

- Qualifies: MVP_Desktop_Plan, Phase 8, item 1 (security baseline; internal planning document, maintainer workspace).
- Related: ADR 0005 (credential storage outside the vault).
