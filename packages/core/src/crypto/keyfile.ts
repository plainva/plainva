/**
 * Keyfile format for the settings-sync + encryption feature (v3 §3.2). The
 * keyfile wraps one or more random 32-byte MASTER KEYS (MK) under a
 * passphrase-derived KEK (scrypt → XChaCha20-Poly1305). Everything a device
 * needs to unlock is the keyfile (public, travels with the vault) plus the
 * passphrase (secret, entered once per device).
 *
 * Design (v3):
 *  - The MK — not the passphrase — is the root; HKDF derives per-purpose keys.
 *    A passphrase change only re-wraps the MKs (no data re-encryption).
 *  - `keys[]` holds exactly one MK normally, and old+new during a key rotation.
 *  - A dedicated `verifier` lets a wrong passphrase be detected cleanly, without
 *    unwrapping an MK.
 *  - The recovery code (versioned Base32 with a checksum) encodes keyId+MK, so a
 *    lost passphrase is not data loss.
 *
 * `createdAt`/`updatedAt` are injectable (no hidden clock) for deterministic tests.
 */
import { aeadDecrypt, aeadEncrypt, aeadNonce } from "./aead.js";
import {
  fromBase32Groups,
  fromBase64,
  randomBytes,
  toBase32Groups,
  toBase64,
  toHex,
  utf8Encode,
} from "./cryptoPrimitives.js";
import { DEFAULT_KDF_PARAMS, deriveKek, type KdfParams } from "./kdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** A wrapped master key inside the keyfile. */
export interface WrappedKey {
  keyId: string;
  wrapped: { nonce: string; ct: string };
  createdAt: string;
}

/** On-disk keyfile (`.plainva/sync/keyfile.json`), stored as JSON. */
export interface Keyfile {
  format: "plainva-keyfile";
  version: 1;
  /** keyId whose MK new writes use. */
  activeKeyId: string;
  kdf: { params: KdfParams; salt: string };
  /** Wrapped MKs: one normally, old+new during rotation. */
  keys: WrappedKey[];
  /** AEAD of a fixed marker under the KEK — proves the passphrase without an MK. */
  verifier: { nonce: string; ct: string };
  createdAt: string;
  updatedAt: string;
}

const KEYFILE_WRAP_AAD = utf8Encode("plainva-keyfile-wrap-v1");
const VERIFIER_AAD = utf8Encode("plainva-keyfile-verifier-v1");
const VERIFIER_PLAINTEXT = utf8Encode("plainva-keyfile-ok");
const KEY_ID_BYTES = 8;
const MASTER_KEY_BYTES = 32;
const SALT_BYTES = 16;
const RECOVERY_VERSION = 1;

/** A cryptographic identity (never serialized in the clear). */
export interface MasterKeyBundle {
  keyId: string;
  masterKey: Uint8Array;
}

/** Thrown when a passphrase (or recovery code) fails to unlock a keyfile. */
export class WrongPassphraseError extends Error {
  constructor() {
    super("wrong passphrase");
    this.name = "WrongPassphraseError";
  }
}

function keyIdToBytes(keyId: string): Uint8Array {
  return new Uint8Array(keyId.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)));
}

function wrapKey(kek: Uint8Array, bundle: MasterKeyBundle, createdAt: string): WrappedKey {
  const nonce = aeadNonce();
  const ct = aeadEncrypt(kek, nonce, bundle.masterKey, KEYFILE_WRAP_AAD);
  return { keyId: bundle.keyId, wrapped: { nonce: toBase64(nonce), ct: toBase64(ct) }, createdAt };
}

function makeVerifier(kek: Uint8Array): { nonce: string; ct: string } {
  const nonce = aeadNonce();
  return { nonce: toBase64(nonce), ct: toBase64(aeadEncrypt(kek, nonce, VERIFIER_PLAINTEXT, VERIFIER_AAD)) };
}

function now(iso?: string): string {
  return iso ?? new Date().toISOString();
}

export interface CreateKeyfileOptions {
  /** Reuse an existing identity (recovery / re-key). Default: fresh. */
  identity?: MasterKeyBundle;
  params?: KdfParams;
  createdAt?: string;
}

/**
 * Creates a keyfile for a passphrase. Without `identity` a fresh random MK+keyId
 * is generated; with `identity` the existing MK+keyId are re-wrapped.
 */
export async function createKeyfile(
  passphrase: string,
  options: CreateKeyfileOptions = {}
): Promise<{ keyfile: Keyfile; bundle: MasterKeyBundle }> {
  const params = options.params ?? DEFAULT_KDF_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const bundle = options.identity ?? { keyId: toHex(randomBytes(KEY_ID_BYTES)), masterKey: randomBytes(MASTER_KEY_BYTES) };
  const kek = await deriveKek(passphrase, salt, params);
  const ts = now(options.createdAt);
  const keyfile: Keyfile = {
    format: "plainva-keyfile",
    version: 1,
    activeKeyId: bundle.keyId,
    kdf: { params, salt: toBase64(salt) },
    keys: [wrapKey(kek, bundle, ts)],
    verifier: makeVerifier(kek),
    createdAt: ts,
    updatedAt: ts,
  };
  return { keyfile, bundle };
}

/** Validates the shape of a parsed keyfile object. */
export function isKeyfile(value: unknown): value is Keyfile {
  const kf = value as Keyfile | null;
  return (
    !!kf &&
    kf.format === "plainva-keyfile" &&
    kf.version === 1 &&
    typeof kf.activeKeyId === "string" &&
    !!kf.kdf &&
    typeof kf.kdf.salt === "string" &&
    !!kf.kdf.params &&
    Array.isArray(kf.keys) &&
    kf.keys.length >= 1 &&
    kf.keys.every((k) => typeof k?.keyId === "string" && typeof k?.wrapped?.nonce === "string" && typeof k?.wrapped?.ct === "string") &&
    !!kf.verifier &&
    typeof kf.verifier.nonce === "string" &&
    typeof kf.verifier.ct === "string"
  );
}

async function kekFor(keyfile: Keyfile, passphrase: string): Promise<Uint8Array> {
  return deriveKek(passphrase, fromBase64(keyfile.kdf.salt), keyfile.kdf.params);
}

function unwrap(kek: Uint8Array, key: WrappedKey): MasterKeyBundle {
  const masterKey = aeadDecrypt(kek, fromBase64(key.wrapped.nonce), fromBase64(key.wrapped.ct), KEYFILE_WRAP_AAD);
  return { keyId: key.keyId, masterKey };
}

/** Unlocks the ACTIVE master key with a passphrase. Verifier checked first. */
export async function unlockKeyfile(keyfile: Keyfile, passphrase: string): Promise<MasterKeyBundle> {
  const kek = await kekFor(keyfile, passphrase);
  try {
    aeadDecrypt(kek, fromBase64(keyfile.verifier.nonce), fromBase64(keyfile.verifier.ct), VERIFIER_AAD);
  } catch {
    throw new WrongPassphraseError();
  }
  const active = keyfile.keys.find((k) => k.keyId === keyfile.activeKeyId) ?? keyfile.keys[0];
  return unwrap(kek, active);
}

/** Unlocks ALL master keys (active + rotation), keyed by keyId. */
export async function unlockAllKeys(keyfile: Keyfile, passphrase: string): Promise<Map<string, MasterKeyBundle>> {
  const kek = await kekFor(keyfile, passphrase);
  try {
    aeadDecrypt(kek, fromBase64(keyfile.verifier.nonce), fromBase64(keyfile.verifier.ct), VERIFIER_AAD);
  } catch {
    throw new WrongPassphraseError();
  }
  const out = new Map<string, MasterKeyBundle>();
  for (const key of keyfile.keys) out.set(key.keyId, unwrap(kek, key));
  return out;
}

/** Re-wraps ALL keys under a new passphrase (fresh salt); no data re-encryption. */
export async function changePassphrase(
  keyfile: Keyfile,
  oldPassphrase: string,
  newPassphrase: string,
  options: { params?: KdfParams; updatedAt?: string } = {}
): Promise<Keyfile> {
  const bundles = await unlockAllKeys(keyfile, oldPassphrase);
  const params = options.params ?? keyfile.kdf.params;
  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveKek(newPassphrase, salt, params);
  const ts = now(options.updatedAt);
  return {
    ...keyfile,
    kdf: { params, salt: toBase64(salt) },
    keys: keyfile.keys.map((k) => wrapKey(kek, bundles.get(k.keyId)!, k.createdAt)),
    verifier: makeVerifier(kek),
    updatedAt: ts,
  };
}

/**
 * Adds a fresh rotation key (real key rotation). Returns the updated keyfile
 * (keys = [existing…, new]) with the new key as `activeKeyId`, plus the new
 * bundle. The old key stays available for the resumable re-encrypt sweep; call
 * `dropKey` once the sweep completed.
 */
export async function addRotationKey(
  keyfile: Keyfile,
  passphrase: string,
  options: { createdAt?: string } = {}
): Promise<{ keyfile: Keyfile; newBundle: MasterKeyBundle }> {
  const kek = await kekFor(keyfile, passphrase);
  // Confirm the passphrase via the verifier before mutating.
  try {
    aeadDecrypt(kek, fromBase64(keyfile.verifier.nonce), fromBase64(keyfile.verifier.ct), VERIFIER_AAD);
  } catch {
    throw new WrongPassphraseError();
  }
  const newBundle: MasterKeyBundle = { keyId: toHex(randomBytes(KEY_ID_BYTES)), masterKey: randomBytes(MASTER_KEY_BYTES) };
  const ts = now(options.createdAt);
  return {
    keyfile: { ...keyfile, activeKeyId: newBundle.keyId, keys: [...keyfile.keys, wrapKey(kek, newBundle, ts)], updatedAt: ts },
    newBundle,
  };
}

/** Removes all keys except `keepKeyId` (finish rotation; keepKeyId becomes sole active). */
export function dropKey(keyfile: Keyfile, keepKeyId: string, updatedAt?: string): Keyfile {
  const kept = keyfile.keys.filter((k) => k.keyId === keepKeyId);
  if (kept.length === 0) throw new Error("keepKeyId not present in keyfile");
  return { ...keyfile, activeKeyId: keepKeyId, keys: kept, updatedAt: now(updatedAt) };
}

// Recovery code: version(1) | keyId(8) | MK(32) | checksum(1), Base32.
function recoveryChecksum(payload: Uint8Array): number {
  return sha256(payload)[0];
}

export function exportRecoveryCode(bundle: MasterKeyBundle): string {
  const kid = keyIdToBytes(bundle.keyId);
  const payload = new Uint8Array(1 + kid.length + bundle.masterKey.length);
  payload[0] = RECOVERY_VERSION;
  payload.set(kid, 1);
  payload.set(bundle.masterKey, 1 + kid.length);
  const withChecksum = new Uint8Array(payload.length + 1);
  withChecksum.set(payload, 0);
  withChecksum[payload.length] = recoveryChecksum(payload);
  return toBase32Groups(withChecksum);
}

/** Parses a recovery code, verifying version + checksum. Throws on malformed input. */
export function parseRecoveryCode(code: string): MasterKeyBundle {
  const bytes = fromBase32Groups(code);
  const expected = 1 + KEY_ID_BYTES + MASTER_KEY_BYTES + 1;
  if (bytes.length !== expected) throw new Error("invalid recovery code length");
  if (bytes[0] !== RECOVERY_VERSION) throw new Error("unsupported recovery code version");
  const payload = bytes.subarray(0, bytes.length - 1);
  if (recoveryChecksum(payload) !== bytes[bytes.length - 1]) throw new Error("recovery code checksum mismatch (typo?)");
  return {
    keyId: toHex(bytes.subarray(1, 1 + KEY_ID_BYTES)),
    masterKey: bytes.subarray(1 + KEY_ID_BYTES, 1 + KEY_ID_BYTES + MASTER_KEY_BYTES),
  };
}
