/**
 * Keyfile format for the settings-sync + encryption feature (P0). The keyfile
 * holds a random 32-byte MASTER KEY (MK) wrapped by a passphrase-derived KEK
 * (Argon2id → XChaCha20-Poly1305). Everything a device needs to unlock the vault
 * is: the keyfile (public, travels with the vault) + the passphrase (secret,
 * entered once per device).
 *
 * Design choices:
 *  - The MK — not the passphrase — encrypts data, so a passphrase change only
 *    re-wraps the keyfile (no data re-encryption; other devices with a cached MK
 *    are unaffected).
 *  - A wrong passphrase surfaces as an AEAD auth failure on the MK unwrap
 *    (no separate verifier needed).
 *  - The recovery code encodes keyId + MK, so it alone reconstructs the crypto
 *    identity and can set a new passphrase — a lost passphrase is not data loss.
 *
 * `createdAt` is injectable (no hidden clock) so tests are deterministic.
 */
import { aeadDecrypt, aeadEncrypt } from "./aead.js";
import {
  fromBase32Groups,
  fromBase64,
  randomBytes,
  toBase32Groups,
  toBase64,
  toHex,
  utf8Encode,
} from "./cryptoPrimitives.js";
import { DEFAULT_ARGON2_PARAMS, deriveKek, type Argon2Params } from "./kdf.js";

/** On-disk keyfile (`.plainva/sync/keyfile.json`), stored as JSON. */
export interface Keyfile {
  format: "plainva-keyfile";
  version: 1;
  /** Hex identity of the master key (8 bytes) — also stamped into every blob. */
  keyId: string;
  kdf: Argon2Params & { salt: string };
  /** MK wrapped under the KEK: AEAD(KEK, MK, aad=KEYFILE_WRAP_AAD). */
  wrapped: { nonce: string; ct: string };
  createdAt: string;
}

const KEYFILE_WRAP_AAD = utf8Encode("plainva-keyfile-wrap-v1");
const KEY_ID_BYTES = 8;
const MASTER_KEY_BYTES = 32;
const SALT_BYTES = 16;

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

export interface CreateKeyfileOptions {
  /** Reuse an existing identity (passphrase change / recovery). Default: fresh. */
  identity?: MasterKeyBundle;
  params?: Argon2Params;
  /** ISO timestamp; injectable for tests. Default: now. */
  createdAt?: string;
}

/**
 * Creates a keyfile for a passphrase. Without `identity` a fresh random MK+keyId
 * is generated; with `identity` the existing MK+keyId are re-wrapped (used by
 * passphrase change and recovery-code re-key). Returns the keyfile plus the
 * plaintext bundle the caller caches locally.
 */
export async function createKeyfile(
  passphrase: string,
  options: CreateKeyfileOptions = {}
): Promise<{ keyfile: Keyfile; bundle: MasterKeyBundle }> {
  const params = options.params ?? DEFAULT_ARGON2_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const identity = options.identity ?? {
    keyId: toHex(randomBytes(KEY_ID_BYTES)),
    masterKey: randomBytes(MASTER_KEY_BYTES),
  };
  const kek = await deriveKek(passphrase, salt, params);
  const wrapped = aeadEncrypt(kek, identity.masterKey, KEYFILE_WRAP_AAD);
  const keyfile: Keyfile = {
    format: "plainva-keyfile",
    version: 1,
    keyId: identity.keyId,
    kdf: { ...params, salt: toBase64(salt) },
    wrapped: { nonce: toBase64(wrapped.nonce), ct: toBase64(wrapped.ciphertext) },
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
  return { keyfile, bundle: { keyId: identity.keyId, masterKey: identity.masterKey } };
}

/** Validates the shape of a parsed keyfile object. */
export function isKeyfile(value: unknown): value is Keyfile {
  const kf = value as Keyfile | null;
  return (
    !!kf &&
    kf.format === "plainva-keyfile" &&
    kf.version === 1 &&
    typeof kf.keyId === "string" &&
    !!kf.kdf &&
    kf.kdf.algo === "argon2id" &&
    typeof kf.kdf.salt === "string" &&
    !!kf.wrapped &&
    typeof kf.wrapped.nonce === "string" &&
    typeof kf.wrapped.ct === "string"
  );
}

/** Unlocks a keyfile with a passphrase, returning the master-key bundle. */
export async function unlockKeyfile(keyfile: Keyfile, passphrase: string): Promise<MasterKeyBundle> {
  const kek = await deriveKek(passphrase, fromBase64(keyfile.kdf.salt), keyfile.kdf);
  let masterKey: Uint8Array;
  try {
    masterKey = aeadDecrypt(kek, fromBase64(keyfile.wrapped.nonce), fromBase64(keyfile.wrapped.ct), KEYFILE_WRAP_AAD);
  } catch {
    throw new WrongPassphraseError();
  }
  return { keyId: keyfile.keyId, masterKey };
}

/** Re-wraps a keyfile under a new passphrase (same keyId + MK, fresh salt). */
export function changePassphrase(
  bundle: MasterKeyBundle,
  newPassphrase: string,
  options: Omit<CreateKeyfileOptions, "identity"> = {}
): Promise<{ keyfile: Keyfile; bundle: MasterKeyBundle }> {
  return createKeyfile(newPassphrase, { ...options, identity: bundle });
}

// Recovery code: base32(keyId ‖ MK). Reconstructs the full identity so a lost
// passphrase can be reset (re-key via createKeyfile with the recovered identity).
export function exportRecoveryCode(bundle: MasterKeyBundle): string {
  const keyIdBytes = new Uint8Array(bundle.keyId.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)));
  const combined = new Uint8Array(keyIdBytes.length + bundle.masterKey.length);
  combined.set(keyIdBytes, 0);
  combined.set(bundle.masterKey, keyIdBytes.length);
  return toBase32Groups(combined);
}

/** Parses a recovery code back into a master-key bundle. Throws on malformed input. */
export function parseRecoveryCode(code: string): MasterKeyBundle {
  const bytes = fromBase32Groups(code);
  if (bytes.length !== KEY_ID_BYTES + MASTER_KEY_BYTES) throw new Error("invalid recovery code length");
  return {
    keyId: toHex(bytes.subarray(0, KEY_ID_BYTES)),
    masterKey: bytes.subarray(KEY_ID_BYTES),
  };
}
