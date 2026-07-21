/**
 * PVE1 sealed-blob binary frame for the settings-sync + encryption feature
 * (v3 §3.2). Self-describing, length-checked container used for `settings.enc`,
 * `secrets.enc` and E2E-encrypted vault contents:
 *
 *   'P''V''E''1' | frameVersion:u8 | algorithm:u8 | purpose:u8 | flags:u8 |
 *   keyIdLen:u8 | nonceLen:u8 | reserved:u16 | plaintextLen:u64 |
 *   ciphertextLen:u64 | keyId(UTF-8) | nonce | ciphertext+tag
 *
 * The AAD is every header byte up to and including the nonce — it binds version,
 * algorithm, PURPOSE, lengths and keyId, but deliberately NOT the path or any
 * device-specific vault id, so renames (metadata-only sync ops) and cross-device
 * re-keying keep working. keyId is in the clear so a decoder can detect a blob
 * from a DIFFERENT master key before trying. Each purpose uses its own
 * HKDF-derived subkey, so a settings blob can never be opened as content.
 */
import { aeadDecrypt, aeadEncrypt, aeadNonce, AEAD_NONCE_LENGTH } from "./aead.js";
import { bytesEqual, concatBytes, readU16BE, readU64BE, toHex, utf8Encode, writeU16BE, writeU64BE } from "./cryptoPrimitives.js";
import { deriveSubkey, type KeyPurpose } from "./hkdf.js";
import type { MasterKeyBundle } from "./keyfile.js";

const MAGIC = utf8Encode("PVE1");
const FRAME_VERSION = 1;
const ALGO_XCHACHA20POLY1305 = 1;
const AEAD_TAG_LENGTH = 16;
const FIXED_HEADER_LEN = 28; // magic(4)+ver+algo+purpose+flags+keyIdLen+nonceLen+reserved(2)+plaintextLen(8)+ciphertextLen(8)
const MAX_KEY_ID_LEN = 64;
const MAX_BLOB_BYTES = 512 * 1024 * 1024;

/** Numeric purpose tags (bound into the AAD). */
const PURPOSE_TAG: Record<Exclude<KeyPurpose, "manifest">, number> = { content: 1, settings: 2, secrets: 3 };
const PURPOSE_BY_TAG: Record<number, Exclude<KeyPurpose, "manifest">> = { 1: "content", 2: "settings", 3: "secrets" };

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

/** Thrown when a blob's frame is malformed, truncated, over-sized or has a wrong purpose. */
export class BlobFormatError extends Error {
  constructor(message: string) {
    super(`invalid PVE1 blob: ${message}`);
    this.name = "BlobFormatError";
  }
}

/** True when `bytes` start with the PVE1 magic (cheap, key-free detection). */
export function isSealedBlob(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length && bytesEqual(bytes.subarray(0, MAGIC.length), MAGIC);
}

interface ParsedHeader {
  purposeTag: number;
  keyId: string;
  nonce: Uint8Array;
  plaintextLen: number;
  ciphertextLen: number;
  aad: Uint8Array;
  ciphertextOffset: number;
}

/** Parses and hard-validates the frame header (before any allocation/AEAD). */
function parseHeader(bytes: Uint8Array): ParsedHeader {
  if (!isSealedBlob(bytes)) throw new NotSealedError();
  if (bytes.length > MAX_BLOB_BYTES) throw new BlobFormatError("blob exceeds size limit");
  if (bytes.length < FIXED_HEADER_LEN) throw new BlobFormatError("truncated header");
  if (bytes[4] !== FRAME_VERSION) throw new BlobFormatError(`unsupported frame version ${bytes[4]}`);
  if (bytes[5] !== ALGO_XCHACHA20POLY1305) throw new BlobFormatError(`unsupported algorithm ${bytes[5]}`);
  const purposeTag = bytes[6];
  if (!PURPOSE_BY_TAG[purposeTag]) throw new BlobFormatError(`unknown purpose ${purposeTag}`);
  if (bytes[7] !== 0) throw new BlobFormatError("unknown flags set");
  const keyIdLen = bytes[8];
  const nonceLen = bytes[9];
  if (keyIdLen === 0 || keyIdLen > MAX_KEY_ID_LEN) throw new BlobFormatError("bad keyId length");
  if (nonceLen !== AEAD_NONCE_LENGTH) throw new BlobFormatError("bad nonce length");
  if (readU16BE(bytes, 10) !== 0) throw new BlobFormatError("reserved bytes not zero");
  const plaintextLen = readU64BE(bytes, 12);
  const ciphertextLen = readU64BE(bytes, 20);
  if (ciphertextLen !== plaintextLen + AEAD_TAG_LENGTH) throw new BlobFormatError("ciphertext length mismatch");
  const keyIdEnd = FIXED_HEADER_LEN + keyIdLen;
  const nonceEnd = keyIdEnd + nonceLen;
  const ciphertextOffset = nonceEnd;
  if (bytes.length !== ciphertextOffset + ciphertextLen) throw new BlobFormatError("declared lengths do not match blob size");
  return {
    purposeTag,
    keyId: toHex(bytes.subarray(FIXED_HEADER_LEN, keyIdEnd)),
    nonce: bytes.subarray(keyIdEnd, nonceEnd),
    plaintextLen,
    ciphertextLen,
    aad: bytes.subarray(0, nonceEnd),
    ciphertextOffset,
  };
}

/** Reads the keyId from a blob header without the master key, or null if not a valid blob. */
export function readBlobKeyId(bytes: Uint8Array): string | null {
  try {
    return parseHeader(bytes).keyId;
  } catch {
    return null;
  }
}

function keyIdBytes(keyId: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(keyId) || keyId.length % 2 !== 0) throw new Error("keyId must be even-length hex");
  const out = new Uint8Array(keyId.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(keyId.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Encrypts `plaintext` into a PVE1 blob for `purpose` under the bundle's derived subkey. */
export function sealBlob(bundle: MasterKeyBundle, plaintext: Uint8Array, purpose: Exclude<KeyPurpose, "manifest">): Uint8Array {
  const kid = keyIdBytes(bundle.keyId);
  const subkey = deriveSubkey(bundle.masterKey, purpose);
  const nonce = aeadNonce();
  const header = concatBytes(
    MAGIC,
    new Uint8Array([FRAME_VERSION, ALGO_XCHACHA20POLY1305, PURPOSE_TAG[purpose], 0, kid.length, AEAD_NONCE_LENGTH]),
    writeU16BE(0),
    writeU64BE(plaintext.length),
    writeU64BE(plaintext.length + AEAD_TAG_LENGTH)
  );
  const aad = concatBytes(header, kid, nonce);
  const ciphertext = aeadEncrypt(subkey, nonce, plaintext, aad);
  return concatBytes(header, kid, nonce, ciphertext);
}

/**
 * Decrypts a PVE1 blob for `purpose`. Throws NotSealedError for non-blobs,
 * BlobFormatError for a malformed/over-sized frame or wrong purpose,
 * ForeignKeyError for a different key, and a generic auth error for a tampered
 * ciphertext.
 */
export function openBlob(bundle: MasterKeyBundle, bytes: Uint8Array, purpose: Exclude<KeyPurpose, "manifest">): Uint8Array {
  const header = parseHeader(bytes);
  if (header.purposeTag !== PURPOSE_TAG[purpose]) throw new BlobFormatError("purpose mismatch");
  if (header.keyId !== bundle.keyId) throw new ForeignKeyError(header.keyId, bundle.keyId);
  const subkey = deriveSubkey(bundle.masterKey, purpose);
  const ciphertext = bytes.subarray(header.ciphertextOffset);
  const plaintext = aeadDecrypt(subkey, header.nonce, ciphertext, header.aad);
  if (plaintext.length !== header.plaintextLen) throw new BlobFormatError("decrypted length mismatch");
  return plaintext;
}
