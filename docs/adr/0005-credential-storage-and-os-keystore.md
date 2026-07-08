# ADR 0005: Credential Storage and OS Keystore Integration

Status: Accepted

Date: 2026-06-25

> Sequencing update (2026-06-25): At the request of Phase 8, native OS keychain
> integration is moved forward to **Phase 5.1 (A6)**. The concrete implementation
> plan and the native verification prerequisite (maintainer) below remain
> unchanged and valid; only the timing changes.
>
> Implementation update (2026-06-25, A6): The implementation plan has been carried
> out on the code side: the `keyring` crate in `Cargo.toml`, the three Tauri
> commands `keychain_set/get/delete` in `lib.rs` (registered via `invoke_handler`,
> `NoEntry` -> `Ok(None)`/`Ok(())`), and `CredentialManager` now uses the commands
> with a **store fallback** + **migration** of existing `credentials.bin` entries
> on first read. **Not verified in the harness** (no Cargo available): the native
> keychain functionality on macOS/Windows/Linux (especially Linux Secret
> Service/DBus + keyring feature flags) remains a maintainer task. App-own
> commands do not need a capability entry in Tauri v2 (capabilities apply to
> plugin/core commands), so there is no change to `capabilities/default.json`.

## Context

Phase 5 introduces the first real cloud adapter (WebDAV/Nextcloud). This
requires persisting credentials (URL, user, password or app token). The
master-plan MVP plan requires, in Phase 5, an "OS keystore integration —
tokens/credentials in the OS keychain (not in the vault), via Rust/Tauri".

Current state of implementation:

- Credentials are stored in `apps/desktop/src/services/CredentialManager.ts` via
  `@tauri-apps/plugin-store` in the file `credentials.bin`.
- This file lives in Tauri's OS-specific app-data directory, i.e. **outside the
  vault**. This already fulfills the security-critical core goal ("not in the
  vault, so credentials are never accidentally synced along or made visible in
  Obsidian").
- The key per vault is `webdav_credentials_<base64(vaultPath)>`.

A real OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret
Service/`libsecret`) requires native Rust code (e.g. the `keyring` crate with
Tauri commands) as well as additional capabilities. This code **cannot be
compiled or verified** in the current AI harness (Cargo is not available; the
native app has never been demonstrably built in the harness). In particular,
the Linux backend path (`secret-service`/`libsecret`, DBus) brings build and CI
system dependencies whose feature flags can only be reliably validated
natively. Blindly adding a native crate would risk breaking the maintainer's
native build — with no way to check this before the commit.

## Decision

1. **At-rest storage for now:** WebDAV credentials remain for the time being in
   the app-data `tauri-plugin-store` (`credentials.bin`), i.e. outside the
   vault. This satisfies the security-critical vault separation. `.plainva`
   paths and the store are kept separate; credentials are never written into
   the vault and are not picked up by the WebDAV push (`.CONFLICT` and
   `.plainva` exclusion).
2. **Real OS keychain integration is deferred until after Phase 8 (native
   hardening).** Rationale: it is purely native Rust/Tauri work that can only
   be safely implemented with a working Cargo toolchain and a native re-test.
   Phase 8 ("security hardening", including CSP/asset/FS scope and a native
   re-test) is the natural place for this, since it is verified natively
   anyway.
3. **Concrete implementation plan (Phase 8) recorded** so the step can be
   completed in a single verified pass:
   - Add the `keyring` crate to `apps/desktop/src-tauri/Cargo.toml`
     (platform-native backends: macOS Keychain, Windows Credential Manager,
     Linux Secret Service).
   - Register three Tauri commands `keychain_set` / `keychain_get` /
     `keychain_delete` in `lib.rs` (`invoke_handler`), treating `NoEntry` as
     `Ok(None)`/`Ok(())`.
   - Switch `CredentialManager` over to these commands, with a **fallback** to
     the existing store if the command fails (robustness on systems without a
     reachable secret service).
   - Migration: move existing `credentials.bin` entries into the keychain on
     first launch and then remove them from the store.
   - Document the Linux build/CI dependencies (`libsecret`/DBus) and provide
     them in the CI image.

## Consequences

- **Now:** Phase 5 is functionally complete (WebDAV sync stable) without
  putting the native build at risk through unverifiable Rust code. The vault
  separation of credentials is in place.
- **Open (pre-alpha risk):** Credentials currently sit unencrypted in the
  app-data store (protected by OS file permissions, but not in the keychain).
  This is tracked as a known pre-alpha risk in the internal status
  documentation (maintainer workspace) and will be closed in Phase 8.
- **Later:** The real keychain integration is clearly specified and tied to
  the Phase 8 hardening, where it is tested natively anyway.

## Alternatives

- **Implementing the native keychain blindly now:** rejected — cannot be
  compiled/verified in the harness, high risk of breaking the native build
  (especially Linux).
- **Custom encryption of the store without a secret backend:** rejected — the
  key would have to sit somewhere unencrypted anyway (security theater), no
  real security gain over the file-permission-protected app-data store.
- **`tauri-plugin-stronghold`:** also native code with a master-password UX;
  too heavyweight for the MVP and not verifiable in the harness.

## Links

- MVP_Desktop_Plan (Phase 5, step 3; Phase 8, step 1 — internal planning document, maintainer workspace)
- apps/desktop/src/services/CredentialManager.ts
- ADR 0004 (BYO Credentials & WebDAV Prioritization)
