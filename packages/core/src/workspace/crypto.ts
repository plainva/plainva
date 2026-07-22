import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { aeadDecrypt, aeadEncrypt, aeadNonce } from "../crypto/aead.js";
import { concatBytes, randomBytes, utf8Encode } from "../crypto/cryptoPrimitives.js";
import { WORKSPACE_KEY_BYTES } from "./constants.js";
import { bytesEqual, idBytes } from "./encoding.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";

const hpkeSuite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

export interface WorkspaceKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface HpkeCiphertext {
  enc: Uint8Array;
  ciphertext: Uint8Array;
}

export interface HpkeSealTestingOptions {
  /** Fixed RFC-9180 ephemeral key pair. Test vectors only. */
  ephemeralKeyPair?: WorkspaceKeyPair;
}

export function workspaceDomain(
  purpose: string,
  workspaceId: string,
  objectId?: string,
  revisionId?: string,
  index?: number
): string {
  let domain = `plainva/workspace/${purpose}/v1/${workspaceId}`;
  if (objectId !== undefined) domain += `/${objectId}`;
  if (revisionId !== undefined) domain += `/${revisionId}`;
  if (index !== undefined) domain += `/${index}`;
  return domain;
}

export function deriveWorkspaceSubkey(
  dataKey: Uint8Array,
  purpose: string,
  workspaceId: string,
  objectId: string,
  revisionId: string,
  index?: number
): Uint8Array {
  protocolAssert(dataKey.length === WORKSPACE_KEY_BYTES, "format", "workspace data key has wrong length");
  return hkdf(
    sha256,
    dataKey,
    idBytes(workspaceId, "workspaceId"),
    utf8Encode(workspaceDomain(purpose, workspaceId, objectId, revisionId, index)),
    WORKSPACE_KEY_BYTES
  );
}

export function deriveWorkspaceContextKey(
  keyMaterial: Uint8Array,
  purpose: string,
  workspaceId: string,
  ...context: Array<string | number>
): Uint8Array {
  protocolAssert(keyMaterial.length === WORKSPACE_KEY_BYTES, "format", "workspace key material has wrong length");
  const info = `plainva/workspace/${purpose}/v1/${workspaceId}${context.map((part) => `/${part}`).join("")}`;
  return hkdf(sha256, keyMaterial, idBytes(workspaceId, "workspaceId"), utf8Encode(info), WORKSPACE_KEY_BYTES);
}

export function generateSigningKeyPair(seed?: Uint8Array): WorkspaceKeyPair {
  if (seed) protocolAssert(seed.length === WORKSPACE_KEY_BYTES, "format", "Ed25519 seed has wrong length");
  const pair = ed25519.keygen(seed);
  return { privateKey: new Uint8Array(pair.secretKey), publicKey: new Uint8Array(pair.publicKey) };
}

export function signWorkspaceBytes(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  protocolAssert(privateKey.length === WORKSPACE_KEY_BYTES, "format", "Ed25519 private key has wrong length");
  return new Uint8Array(ed25519.sign(message, privateKey));
}

export function verifyWorkspaceSignature(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): boolean {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}

async function serializeHpkePair(pair: CryptoKeyPair): Promise<WorkspaceKeyPair> {
  return {
    publicKey: new Uint8Array(await hpkeSuite.kem.serializePublicKey(pair.publicKey)),
    privateKey: new Uint8Array(await hpkeSuite.kem.serializePrivateKey(pair.privateKey)),
  };
}

async function deserializeHpkePair(pair: WorkspaceKeyPair): Promise<CryptoKeyPair> {
  protocolAssert(pair.publicKey.length === 32 && pair.privateKey.length === 32, "format", "HPKE key has wrong length");
  return {
    publicKey: await hpkeSuite.kem.deserializePublicKey(pair.publicKey),
    privateKey: await hpkeSuite.kem.deserializePrivateKey(pair.privateKey),
  };
}

export async function generateHpkeKeyPair(seed?: Uint8Array): Promise<WorkspaceKeyPair> {
  if (seed) protocolAssert(seed.length === WORKSPACE_KEY_BYTES, "format", "HPKE seed has wrong length");
  const pair = seed ? await hpkeSuite.kem.deriveKeyPair(seed) : await hpkeSuite.kem.generateKeyPair();
  return serializeHpkePair(pair);
}

export async function hpkeSeal(
  recipientPublicKey: Uint8Array,
  plaintext: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  testing?: HpkeSealTestingOptions
): Promise<HpkeCiphertext> {
  protocolAssert(recipientPublicKey.length === 32, "format", "HPKE public key has wrong length");
  try {
    const recipient = await hpkeSuite.kem.deserializePublicKey(recipientPublicKey);
    const result = await hpkeSuite.seal(
      {
        recipientPublicKey: recipient,
        info,
        ...(testing?.ephemeralKeyPair ? { ekm: await deserializeHpkePair(testing.ephemeralKeyPair) } : {}),
      },
      plaintext,
      aad
    );
    return { enc: new Uint8Array(result.enc), ciphertext: new Uint8Array(result.ct) };
  } catch (cause) {
    throw new WorkspaceProtocolError("crypto", "HPKE seal failed", { cause });
  }
}

export async function hpkeOpen(
  recipientPrivateKey: Uint8Array,
  enc: Uint8Array,
  ciphertext: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  protocolAssert(recipientPrivateKey.length === 32, "format", "HPKE private key has wrong length");
  protocolAssert(enc.length === 32, "format", "HPKE encapsulated key has wrong length");
  try {
    const recipient = await hpkeSuite.kem.deserializePrivateKey(recipientPrivateKey);
    const plaintext = await hpkeSuite.open({ recipientKey: recipient, enc, info }, ciphertext, aad);
    return new Uint8Array(plaintext);
  } catch (cause) {
    throw new WorkspaceProtocolError("crypto", "HPKE open failed", { cause });
  }
}

export function randomWorkspaceKey(): Uint8Array {
  return randomBytes(WORKSPACE_KEY_BYTES);
}

export async function probeWorkspaceCryptoRuntime(): Promise<{
  secureRandom: true;
  ed25519: true;
  hpke: true;
  xchacha20poly1305: true;
}> {
  const random = randomBytes(32);
  protocolAssert(random.some((byte) => byte !== 0), "crypto", "secure RNG returned an invalid sample");

  const signing = generateSigningKeyPair();
  const message = utf8Encode("Plainva encrypted workspace runtime probe");
  const signature = signWorkspaceBytes(signing.privateKey, message);
  protocolAssert(verifyWorkspaceSignature(signing.publicKey, message, signature), "crypto", "Ed25519 runtime probe failed");

  const recipient = await generateHpkeKeyPair();
  const sealed = await hpkeSeal(recipient.publicKey, message, utf8Encode("probe-info"), utf8Encode("probe-aad"));
  const opened = await hpkeOpen(recipient.privateKey, sealed.enc, sealed.ciphertext, utf8Encode("probe-info"), utf8Encode("probe-aad"));
  protocolAssert(bytesEqual(opened, message), "crypto", "HPKE runtime probe failed");

  const symmetricKey = randomWorkspaceKey();
  const nonce = aeadNonce();
  const aad = concatBytes(utf8Encode("probe"), random.subarray(0, 8));
  const ciphertext = aeadEncrypt(symmetricKey, nonce, message, aad);
  protocolAssert(bytesEqual(aeadDecrypt(symmetricKey, nonce, ciphertext, aad), message), "crypto", "XChaCha runtime probe failed");

  return { secureRandom: true, ed25519: true, hpke: true, xchacha20poly1305: true };
}
