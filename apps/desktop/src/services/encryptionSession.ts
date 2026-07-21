/**
 * Desktop master-key lifecycle for settings-sync + encryption (plan §3.2, P3).
 * Owns the vault's passphrase-wrapped `keyfile.json` (created here, transported by
 * the core KeyfileSyncStep), unlocks the master key (MK) with the passphrase or a
 * recovery code, and caches the unlocked MK per device.
 *
 * MK cache: kept in memory for the running session and, unless "passphrase every
 * start" is on for this vault, mirrored into the OS keychain (CredentialManager)
 * so a restart does not re-prompt. Locking clears both. No passphrase, MK or
 * recovery code is ever logged.
 *
 * The keyfile is read/written LOCALLY through the raw adapter passed in (never the
 * conflict-aware app adapter — same rule as the profile sideband).
 */
import {
  createKeyfile,
  unlockKeyfile,
  unlockAllKeys,
  changePassphrase as coreChangePassphrase,
  addRotationKey,
  dropKey,
  exportRecoveryCode,
  parseRecoveryCode,
  isKeyfile,
  toBase64,
  fromBase64,
  KEYFILE_SYNC_PATH,
  type Keyfile,
  type MasterKeyBundle,
} from "@plainva/core";
import { credentialManager } from "./CredentialManager";
import { getSettingsStore } from "./settingsStore";

/** Minimal adapter surface the keyfile needs (the raw/backup adapter provides it). */
export interface RawFileAccess {
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
}

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));
const mkCacheKey = (vaultPath: string) => `mkcache_${b64(vaultPath)}`;
/** Per-vault opt-in: require the passphrase on every start (no persistent MK cache). */
export const passphraseEveryStartKey = (vaultPath: string) => `passphraseEveryStart_${b64(vaultPath)}`;

/** In-memory unlocked MK per vault for the running session. */
const memoryCache = new Map<string, MasterKeyBundle>();
const memoryKeyrings = new Map<string, Map<string, MasterKeyBundle>>();

interface CachedMk {
  keyId: string;
  mk: string; // base64 master key
  /** v2 cache: includes temporary old keys while a rotation is resumable. */
  keys?: Array<{ keyId: string; mk: string }>;
}

/** Whether "passphrase every start" is enabled for this vault. */
export async function isPassphraseEveryStart(vaultPath: string): Promise<boolean> {
  const s = await getSettingsStore();
  return (await s.get<boolean>(passphraseEveryStartKey(vaultPath))) === true;
}

export async function setPassphraseEveryStart(vaultPath: string, on: boolean): Promise<void> {
  const s = await getSettingsStore();
  await s.set(passphraseEveryStartKey(vaultPath), on);
  await s.save();
  if (on) await credentialManager.removeSecret(mkCacheKey(vaultPath));
}

/** Reads and validates the local keyfile, or null if none/invalid. (The keyfile
 * path is fixed and the adapter is vault-rooted, so no vaultPath is needed.) */
export async function readLocalKeyfile(raw: RawFileAccess): Promise<Keyfile | null> {
  if (!(await raw.exists(KEYFILE_SYNC_PATH))) return null;
  try {
    const parsed: unknown = JSON.parse(await raw.readTextFile(KEYFILE_SYNC_PATH));
    return isKeyfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** True when a keyfile exists locally (a device that already participates). */
export async function hasLocalKeyfile(raw: RawFileAccess): Promise<boolean> {
  return (await readLocalKeyfile(raw)) !== null;
}

/** The in-memory MK for the running session, if unlocked. */
export function getMemoryMasterKey(vaultPath: string): MasterKeyBundle | null {
  return memoryCache.get(vaultPath) ?? null;
}

/** Restores the MK from the keychain cache (unless "passphrase every start"). */
export async function loadCachedMasterKey(vaultPath: string): Promise<MasterKeyBundle | null> {
  const inMem = memoryCache.get(vaultPath);
  if (inMem) return inMem;
  if (await isPassphraseEveryStart(vaultPath)) return null;
  const cached = await credentialManager.readSecret<CachedMk>(mkCacheKey(vaultPath));
  if (!cached || typeof cached.keyId !== "string" || typeof cached.mk !== "string") return null;
  const bundle: MasterKeyBundle = { keyId: cached.keyId, masterKey: fromBase64(cached.mk) };
  memoryCache.set(vaultPath, bundle);
  const ring = new Map<string, MasterKeyBundle>();
  for (const item of cached.keys ?? [cached]) {
    if (typeof item.keyId === "string" && typeof item.mk === "string") {
      ring.set(item.keyId, { keyId: item.keyId, masterKey: fromBase64(item.mk) });
    }
  }
  ring.set(bundle.keyId, bundle);
  memoryKeyrings.set(vaultPath, ring);
  return bundle;
}

async function cacheMasterKeys(vaultPath: string, active: MasterKeyBundle, keys: Map<string, MasterKeyBundle>): Promise<void> {
  const ring = new Map(keys);
  ring.set(active.keyId, active);
  memoryKeyrings.set(vaultPath, ring);
  memoryCache.set(vaultPath, active);
  if (!(await isPassphraseEveryStart(vaultPath))) {
    await credentialManager.writeSecret<CachedMk>(mkCacheKey(vaultPath), {
      keyId: active.keyId,
      mk: toBase64(active.masterKey),
      keys: [...ring.values()].map((key) => ({ keyId: key.keyId, mk: toBase64(key.masterKey) })),
    });
  }
}

async function cacheMasterKey(vaultPath: string, bundle: MasterKeyBundle): Promise<void> {
  await cacheMasterKeys(vaultPath, bundle, new Map([[bundle.keyId, bundle]]));
}

/** All unlocked content keys. Usually one; two while a rotation is in progress. */
export async function loadCachedMasterKeys(vaultPath: string): Promise<Map<string, MasterKeyBundle>> {
  if (!memoryCache.has(vaultPath)) await loadCachedMasterKey(vaultPath);
  return new Map(memoryKeyrings.get(vaultPath) ?? []);
}

/** Clears the unlocked MK (memory + keychain cache) — the vault relocks. */
export async function lockVault(vaultPath: string): Promise<void> {
  memoryCache.delete(vaultPath);
  memoryKeyrings.delete(vaultPath);
  await credentialManager.removeSecret(mkCacheKey(vaultPath));
}

/**
 * Creates a fresh keyfile for a new passphrase (device 1). Writes it locally (the
 * sideband uploads it), caches the MK, and returns the one-time recovery code.
 */
export async function createEncryptionSession(
  vaultPath: string,
  raw: RawFileAccess,
  passphrase: string
): Promise<{ bundle: MasterKeyBundle; recoveryCode: string }> {
  const { keyfile, bundle } = await createKeyfile(passphrase);
  await raw.writeTextFile(KEYFILE_SYNC_PATH, JSON.stringify(keyfile, null, 2));
  await cacheMasterKeys(vaultPath, bundle, new Map([[bundle.keyId, bundle]]));
  return { bundle, recoveryCode: exportRecoveryCode(bundle) };
}

/** Unlocks the MK from the local keyfile with a passphrase (throws WrongPassphraseError). */
export async function unlockWithPassphrase(vaultPath: string, raw: RawFileAccess, passphrase: string): Promise<MasterKeyBundle> {
  const keyfile = await readLocalKeyfile(raw);
  if (!keyfile) throw new Error("no keyfile present for this vault yet");
  const keys = await unlockAllKeys(keyfile, passphrase);
  const bundle = keys.get(keyfile.activeKeyId) ?? await unlockKeyfile(keyfile, passphrase);
  await cacheMasterKeys(vaultPath, bundle, keys);
  return bundle;
}

/** Unlocks via the recovery code; the code's keyId must match the active keyfile. */
export async function unlockWithRecoveryCode(vaultPath: string, raw: RawFileAccess, code: string): Promise<MasterKeyBundle> {
  const keyfile = await readLocalKeyfile(raw);
  const bundle = parseRecoveryCode(code);
  if (keyfile && keyfile.activeKeyId !== bundle.keyId) {
    throw new Error("recovery code does not match this vault's active key");
  }
  await cacheMasterKey(vaultPath, bundle);
  return bundle;
}

/** Re-wraps the same MK under a new passphrase (not a key rotation). */
export async function changeSessionPassphrase(vaultPath: string, raw: RawFileAccess, oldPass: string, newPass: string): Promise<void> {
  const keyfile = await readLocalKeyfile(raw);
  if (!keyfile) throw new Error("no keyfile present for this vault");
  // Re-wrap all keys under the new passphrase (same MK, no data re-encryption).
  const next = await coreChangePassphrase(keyfile, oldPass, newPass);
  await raw.writeTextFile(KEYFILE_SYNC_PATH, JSON.stringify(next, null, 2));
  // The active MK is unchanged; refresh the cache from the re-wrapped keyfile.
  await cacheMasterKey(vaultPath, await unlockKeyfile(next, newPass));
}

/** Creates and persists a second key for a resumable content-key rotation. */
export async function prepareSessionRotation(
  vaultPath: string,
  raw: RawFileAccess,
  passphrase: string
): Promise<{ previousKeyfile: Keyfile; keyfile: Keyfile; oldBundle: MasterKeyBundle; newBundle: MasterKeyBundle; keys: Map<string, MasterKeyBundle> }> {
  const previousKeyfile = await readLocalKeyfile(raw);
  if (!previousKeyfile) throw new Error("no keyfile present for this vault");
  const oldKeys = await unlockAllKeys(previousKeyfile, passphrase);
  const oldBundle = oldKeys.get(previousKeyfile.activeKeyId);
  if (!oldBundle) throw new Error("active key is missing from keyfile");
  const { keyfile, newBundle } = await addRotationKey(previousKeyfile, passphrase);
  const keys = new Map(oldKeys);
  keys.set(newBundle.keyId, newBundle);
  await raw.writeTextFile(KEYFILE_SYNC_PATH, JSON.stringify(keyfile, null, 2));
  await cacheMasterKeys(vaultPath, newBundle, keys);
  return { previousKeyfile, keyfile, oldBundle, newBundle, keys };
}

/** Keeps only the new active key after every remote blob has been verified. */
export async function finishSessionRotation(vaultPath: string, raw: RawFileAccess, keepKeyId: string): Promise<Keyfile> {
  const current = await readLocalKeyfile(raw);
  if (!current) throw new Error("no keyfile present for this vault");
  const next = dropKey(current, keepKeyId);
  const active = (await loadCachedMasterKeys(vaultPath)).get(keepKeyId);
  if (!active) throw new Error("rotation key is not unlocked");
  await raw.writeTextFile(KEYFILE_SYNC_PATH, JSON.stringify(next, null, 2));
  await cacheMasterKey(vaultPath, active);
  return next;
}

/** Restores a pre-rotation keyfile when publishing the rotation manifest fails. */
export async function restoreSessionKeyfile(vaultPath: string, raw: RawFileAccess, keyfile: Keyfile, active: MasterKeyBundle): Promise<void> {
  await raw.writeTextFile(KEYFILE_SYNC_PATH, JSON.stringify(keyfile, null, 2));
  await cacheMasterKey(vaultPath, active);
}
