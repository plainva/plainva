/**
 * PVE1 sealed-blob format for the settings-sync + encryption feature (P0). A
 * self-describing container used for `secrets.enc` and, in P3, for E2E-encrypted
 * vault file contents:
 *
 *   'P' 'V' 'E' '1' | version(u8) | keyIdLen(u8) | keyId | nonce(24) | ciphertext
 *
 * The AAD binds the format version, the `purpose` (a per-use constant) and the
 * keyId — but deliberately NOT the file path: renames are metadata-only sync ops
 * that never re-encrypt content, so a path-bound tag would make every renamed
 * file undecodable. keyId is stored in the clear so a decoder can detect a blob
 * from a DIFFERENT master key (the enable-race guard) before even trying.
 */
import { aeadDecrypt, aeadEncrypt, AEAD_NONCE_LENGTH } from "./aead.js";
import { bytesEqual, concatBytes, fromHex, toHex, utf8Encode } from "./cryptoPrimitives.js";
import type { MasterKeyBundle } from "./keyfile.js";

const MAGIC = utf8Encode("PVE1");
const BLOB_VERSION = 1;
const AAD_PREFIX = "plainva-blob-v1";

/** Thrown when the bytes are not a PVE1 blob (e.g. plaintext during migration). */
export class NotSealedError extends Error {
  constructor() {
    super("not a PVE1 sealed blob");
    this.name = "NotSealedError";
  }
}

/** Thrown when a blob was sealed under a DIFFERENT master key (enable-race guard). */
export class ForeignKeyError extends Error {
  constructor(
    readonly blobKeyId: string,
    readonly ourKeyId: string
  ) {
    super(`blob sealed under a different key (${blobKeyId} != ${ourKeyId})`);
    this.name = "ForeignKeyError";
  }
}

function aadFor(purpose: string, keyId: string): Uint8Array {
  return utf8Encode(`${AAD_PREFIX}|${purpose}|${keyId}`);
}

/** True when `bytes` start with the PVE1 magic (cheap, key-free detection). */
export function isSealedBlob(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length && bytesEqual(bytes.subarray(0, MAGIC.length), MAGIC);
}

/** Reads the keyId from a blob header without the master key, or null if not a blob. */
export function readBlobKeyId(bytes: Uint8Array): string | null {
  if (!isSealedBlob(bytes) || bytes.length < 6) return null;
  const keyIdLen = bytes[5];
  if (bytes.length < 6 + keyIdLen) return null;
  return toHex(bytes.subarray(6, 6 + keyIdLen));
}

/** Encrypts `plaintext` into a PVE1 blob bound to `purpose` and the bundle's key. */
export function sealBlob(bundle: MasterKeyBundle, plaintext: Uint8Array, purpose: string): Uint8Array {
  const keyIdBytes = fromHex(bundle.keyId);
  const { nonce, ciphertext } = aeadEncrypt(bundle.masterKey, plaintext, aadFor(purpose, bundle.keyId));
  const header = new Uint8Array([...MAGIC, BLOB_VERSION, keyIdBytes.length]);
  return concatBytes(header, keyIdBytes, nonce, ciphertext);
}

/**
 * Decrypts a PVE1 blob. Throws NotSealedError for non-blobs, ForeignKeyError for
 * a blob under a different key, and a generic auth error for a tampered/mismatched
 * ciphertext.
 */
export function openBlob(bundle: MasterKeyBundle, bytes: Uint8Array, purpose: string): Uint8Array {
  if (!isSealedBlob(bytes)) throw new NotSealedError();
  if (bytes.length < 6) throw new Error("truncated PVE1 blob");
  const version = bytes[4];
  if (version !== BLOB_VERSION) throw new Error(`unsupported PVE1 version ${version}`);
  const keyIdLen = bytes[5];
  const headerEnd = 6 + keyIdLen;
  if (bytes.length < headerEnd + AEAD_NONCE_LENGTH) throw new Error("truncated PVE1 blob");
  const blobKeyId = toHex(bytes.subarray(6, headerEnd));
  if (blobKeyId !== bundle.keyId) throw new ForeignKeyError(blobKeyId, bundle.keyId);
  const nonce = bytes.subarray(headerEnd, headerEnd + AEAD_NONCE_LENGTH);
  const ciphertext = bytes.subarray(headerEnd + AEAD_NONCE_LENGTH);
  return aeadDecrypt(bundle.masterKey, nonce, ciphertext, aadFor(purpose, bundle.keyId));
}
