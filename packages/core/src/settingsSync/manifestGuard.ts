/**
 * Pure fail-closed content-E2E guard evaluation (settings-sync plan §3.5, P4/P5).
 * Given the remote `encryption.json` bytes, this device's known state for the
 * connection, and (optionally) the unlocked master key, it decides what the
 * pre-pull guard must do: proceed in plaintext, proceed encrypted (strict/mixed),
 * or throw `FatalSyncProtocolError`. Kept pure so every branch is unit-testable;
 * the shell wires it into `SettingsSyncRunner.guardBeforeCycle`.
 *
 * Trust-on-first-use: with NO locally stored fingerprint, a missing manifest or an
 * authenticated `plain` is accepted as unprotected (TOFU). Once a connection is
 * known to be E2E, a missing/invalid/downgraded manifest fails closed.
 */
import type { MasterKeyBundle } from "../crypto/keyfile.js";
import { FatalSyncProtocolError } from "./errors.js";
import { allowsMixed, isEncryptedState, isStrict, parseManifest, verifyManifest, type EncryptionState } from "./manifest.js";

/** What this device remembers about a sync connection's E2E status (persisted locally). */
export interface ConnectionE2EState {
  /** Stable fingerprint (provider + remote root). */
  connectionId: string;
  /** True once this device has seen this connection as E2E-protected (TOFU pinned). */
  knownEncrypted: boolean;
  /** Last authenticated generation this device accepted (rollback awareness). */
  lastGeneration?: number;
  /** Active keyId this device expects (mismatch = fatal). */
  expectedKeyId?: string;
}

/** The guard's decision for the upcoming cycle. */
export interface GuardDecision {
  /** "plain" = sync unencrypted; "strict"/"mixed" = wrap the target in the decorator. */
  mode: "plain" | "strict" | "mixed";
  /** The manifest state (for status UI), when a valid manifest was present. */
  state?: EncryptionState;
  /** True when the caller should persist a newly-pinned encrypted connection. */
  pinEncrypted?: boolean;
}

export interface GuardContext {
  /** Raw remote `encryption.json` text, or null if absent. */
  manifestText: string | null;
  /** This device's stored state for the connection. */
  known: ConnectionE2EState;
  /** The unlocked master key, or null if the vault is locked / has no key. */
  masterKey: MasterKeyBundle | null;
  /** Additional unlocked keys kept only for a resumable key rotation. */
  masterKeys?: ReadonlyMap<string, MasterKeyBundle>;
  /** This app's guard version (must be >= manifest.minGuardVersion). */
  guardVersion: number;
}

/**
 * Evaluates the guard. Throws FatalSyncProtocolError on any violation, otherwise
 * returns how the cycle should proceed. Deterministic and side-effect-free.
 */
export function evaluateManifestGuard(ctx: GuardContext): GuardDecision {
  const { manifestText, known, masterKey, masterKeys, guardVersion } = ctx;

  // No manifest present.
  if (!manifestText) {
    if (known.knownEncrypted) {
      // A connection we know as E2E must not silently lose its manifest.
      throw new FatalSyncProtocolError("manifest-invalid", `E2E connection ${known.connectionId} is missing its manifest`);
    }
    return { mode: "plain" }; // TOFU: never seen as encrypted -> unprotected
  }

  const parsed = parseManifest((() => {
    try {
      return JSON.parse(manifestText);
    } catch {
      return null;
    }
  })());
  if (!parsed) {
    if (known.knownEncrypted)
      throw new FatalSyncProtocolError("manifest-invalid", `malformed manifest for E2E connection ${known.connectionId}`);
    // An unparseable manifest on an unknown connection is safest treated as fatal
    // too — it is a protocol document, not vault data.
    throw new FatalSyncProtocolError("manifest-invalid", "manifest is present but malformed");
  }

  if (parsed.connectionId !== known.connectionId) {
    throw new FatalSyncProtocolError("manifest-invalid", `manifest connectionId ${parsed.connectionId} != ${known.connectionId}`);
  }
  if (guardVersion < parsed.minGuardVersion) {
    throw new FatalSyncProtocolError("guard-too-old", `app guard ${guardVersion} < required ${parsed.minGuardVersion}`);
  }

  // Verify the MAC and read the authenticated body (needs the MK).
  if (!masterKey) {
    if (isEncryptedState(parsed.state)) {
      // Locked: an encrypting/strict connection we cannot decrypt -> fatal (the
      // A3 magic guard also catches sealed content, but stop the cycle up front).
      throw new FatalSyncProtocolError("encrypted-without-key", `connection ${known.connectionId} is encrypted and this device is locked`);
    }
    // state === plain/decrypting without a key: cannot authenticate the tombstone.
    if (known.knownEncrypted) {
      throw new FatalSyncProtocolError("encrypted-without-key", `cannot authenticate deactivation for ${known.connectionId} without the key`);
    }
    return { mode: "plain" }; // unknown connection, plain manifest, no key -> TOFU plain
  }

  const verificationKey = masterKeys?.get(parsed.keyId)
    ?? (masterKey.keyId === parsed.keyId ? masterKey : undefined);
  if (!verificationKey) {
    throw new FatalSyncProtocolError("key-mismatch", `manifest signing key ${parsed.keyId} is not held by this device`);
  }
  let body;
  try {
    body = verifyManifest(verificationKey, parsed);
  } catch {
    throw new FatalSyncProtocolError("manifest-invalid", `manifest MAC does not verify for ${known.connectionId}`);
  }

  if (known.expectedKeyId && body.keyId !== known.expectedKeyId && body.newKeyId !== known.expectedKeyId) {
    // A key switch outside a rotation we know about.
    throw new FatalSyncProtocolError("key-mismatch", `manifest keyId ${body.keyId} != expected ${known.expectedKeyId}`);
  }
  if (body.keyId !== masterKey.keyId && body.newKeyId !== masterKey.keyId && !masterKeys?.has(body.keyId)) {
    throw new FatalSyncProtocolError("key-mismatch", `manifest key ${body.keyId} not held by this device (${masterKey.keyId})`);
  }

  if (body.state === "plain") {
    // Authenticated deactivation tombstone: plaintext sync is allowed again.
    return { mode: "plain", state: body.state };
  }
  const mode = isStrict(body.state) ? "strict" : allowsMixed(body.state) ? "mixed" : "strict";
  return { mode, state: body.state, pinEncrypted: !known.knownEncrypted };
}
