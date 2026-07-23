/**
 * Desktop content-E2E manifest + per-connection state (settings-sync plan §3.5,
 * P4/P5). Reads the remote `encryption.json` and persists what THIS device knows
 * about a sync connection's E2E status (locally, keyed by the connection
 * fingerprint), so the fail-closed guard can distinguish "never encrypted"
 * (trust-on-first-use plaintext) from "known encrypted" (missing manifest =
 * fatal). No key material is stored here — only the public fingerprint, the
 * known-encrypted flag, the last accepted generation and the expected key id.
 */
import {
  ENCRYPTION_MANIFEST_PATH,
  connectionFingerprint,
  signManifest,
  parseManifest,
  verifyManifest,
  type ConnectionE2EState,
  type ISyncTarget,
  type ManifestBody,
  type MasterKeyBundle,
} from "@plainva/core";
import { getSettingsStore } from "./settingsStore";

/** This app's guard version (must be >= manifest.minGuardVersion). */
export const GUARD_VERSION = 1;

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));
const stateKey = (connectionId: string) => `e2eState_${b64(connectionId)}`;

/** Loads this device's known E2E state for a connection (default: never encrypted). */
export async function loadConnectionState(connectionId: string): Promise<ConnectionE2EState> {
  const s = await getSettingsStore();
  const stored = await s.get<Partial<ConnectionE2EState>>(stateKey(connectionId));
  return {
    connectionId,
    knownEncrypted: stored?.knownEncrypted === true,
    lastGeneration: typeof stored?.lastGeneration === "number" ? stored.lastGeneration : undefined,
    expectedKeyId: typeof stored?.expectedKeyId === "string" ? stored.expectedKeyId : undefined,
  };
}

export async function saveConnectionState(state: ConnectionE2EState): Promise<void> {
  const s = await getSettingsStore();
  await s.set(stateKey(state.connectionId), state);
  await s.save();
}

/**
 * Drops this device's known E2E state for a connection. Used by the vault
 * teardown ("forget app data"): the pin is keyed by the connection fingerprint,
 * not the vault path, so the per-vault suffix sweep never reaches it. Removing
 * it means re-connecting the same provider+folder starts fresh (trust-on-first-
 * use) instead of reanimating a stale `knownEncrypted:true` that fails closed.
 */
export async function clearConnectionState(connectionId: string): Promise<void> {
  const s = await getSettingsStore();
  await s.delete(stateKey(connectionId));
  await s.save();
}

/** Reads the raw remote manifest text, or null when absent. */
export async function readRemoteManifest(target: ISyncTarget): Promise<string | null> {
  const bytes = await target.download(ENCRYPTION_MANIFEST_PATH);
  return bytes ? new TextDecoder().decode(bytes as BufferSource) : null;
}

/** The connection fingerprint for a provider + remote root (re-exported helper). */
export function connectionIdFor(provider: string, remoteRoot: string): string {
  return connectionFingerprint(provider, remoteRoot);
}

/** Writes the HMAC-signed encryption.json to the remote (sideband control path). */
export async function putManifest(target: ISyncTarget, mk: MasterKeyBundle, body: ManifestBody): Promise<void> {
  const manifest = signManifest(mk, body);
  const content = new TextEncoder().encode(JSON.stringify(manifest));
  await target.push({
    id: 0,
    file_path: ENCRYPTION_MANIFEST_PATH,
    operation: "write",
    content,
    retry_count: 0,
    next_retry_at: 0,
    queued_at: 0,
  });
}

/** Writes then downloads and authenticates the exact lifecycle transition. */
export async function putAndVerifyManifest(target: ISyncTarget, mk: MasterKeyBundle, body: ManifestBody): Promise<ManifestBody> {
  await putManifest(target, mk, body);
  const text = await readRemoteManifest(target);
  const parsed = text ? parseManifest(JSON.parse(text)) : null;
  if (!parsed) throw new Error("encryption manifest did not round-trip");
  const verified = verifyManifest(mk, parsed);
  if (verified.connectionId !== body.connectionId || verified.generation !== body.generation || verified.state !== body.state) {
    throw new Error("encryption manifest changed concurrently");
  }
  return verified;
}

export async function readVerifiedManifest(target: ISyncTarget, mk: MasterKeyBundle): Promise<ManifestBody | null> {
  const text = await readRemoteManifest(target);
  if (!text) return null;
  const parsed = parseManifest(JSON.parse(text));
  if (!parsed) throw new Error("invalid encryption manifest");
  return verifyManifest(mk, parsed);
}

/** Verifies a manifest with the key named by its authenticated keyId. */
export async function readVerifiedManifestWithKeys(
  target: ISyncTarget,
  keys: ReadonlyMap<string, MasterKeyBundle>
): Promise<ManifestBody | null> {
  const text = await readRemoteManifest(target);
  if (!text) return null;
  const parsed = parseManifest(JSON.parse(text));
  if (!parsed) throw new Error("invalid encryption manifest");
  const signingKey = keys.get(parsed.keyId);
  if (!signingKey) throw new Error(`manifest signing key ${parsed.keyId} is not unlocked`);
  return verifyManifest(signingKey, parsed);
}

export async function writeLifecycleManifest(
  target: ISyncTarget,
  signingKey: MasterKeyBundle,
  body: ManifestBody
): Promise<void> {
  await putAndVerifyManifest(target, signingKey, body);
}

/**
 * Activates content-E2E for a connection: writes a `migrating` (mixed) manifest at
 * generation 1. Mixed mode accepts both plaintext and ciphertext, so a half-swept
 * connection never trips the fatal guard. The MK signs it with the manifest subkey.
 */
export async function writeMigratingManifest(
  target: ISyncTarget,
  mk: MasterKeyBundle,
  connectionId: string,
  deviceId: string,
  generation = 1,
  createdAt = new Date().toISOString()
): Promise<void> {
  const now = new Date().toISOString();
  await putAndVerifyManifest(target, mk, {
    formatVersion: 1,
    minGuardVersion: GUARD_VERSION,
    connectionId,
    keyId: mk.keyId,
    state: "migrating",
    ownerDeviceId: deviceId,
    ownerLeaseUntil: Date.now() + 24 * 60 * 60 * 1000,
    generation,
    createdAt,
    updatedAt: now,
  });
}

export async function writePreparingManifest(
  target: ISyncTarget,
  mk: MasterKeyBundle,
  connectionId: string,
  deviceId: string,
  generation: number,
  createdAt: string
): Promise<void> {
  await putAndVerifyManifest(target, mk, {
    formatVersion: 1,
    minGuardVersion: GUARD_VERSION,
    connectionId,
    keyId: mk.keyId,
    state: "preparing",
    ownerDeviceId: deviceId,
    ownerLeaseUntil: Date.now() + 24 * 60 * 60 * 1000,
    generation,
    createdAt,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Completes the migration: reads and verifies the current manifest (throws on a
 * bad MAC), then rewrites it as `strict` — after which a plaintext download is a
 * fatal protocol violation. Generation + createdAt are preserved from the
 * existing manifest; the owner lease is cleared (steady state).
 */
export async function writeStrictManifest(
  target: ISyncTarget,
  mk: MasterKeyBundle,
  connectionId: string
): Promise<void> {
  const text = await readRemoteManifest(target);
  const existing = text ? parseManifest(JSON.parse(text)) : null;
  const verified = existing ? verifyManifest(mk, existing) : null; // throws on tamper
  const now = new Date().toISOString();
  await putAndVerifyManifest(target, mk, {
    formatVersion: 1,
    minGuardVersion: GUARD_VERSION,
    connectionId,
    keyId: mk.keyId,
    state: "strict",
    ownerDeviceId: "",
    ownerLeaseUntil: 0,
    generation: verified?.generation ?? 1,
    createdAt: verified?.createdAt ?? now,
    updatedAt: now,
  });
}
