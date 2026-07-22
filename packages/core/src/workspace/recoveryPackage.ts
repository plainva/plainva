import { aeadDecrypt, aeadEncrypt, aeadNonce } from "../crypto/aead.js";
import {
  concatBytes,
  fromBase32Groups,
  randomBytes,
  toBase32Groups,
} from "../crypto/cryptoPrimitives.js";
import { canonicalJson } from "../settingsSync/canonicalJson.js";
import { PersonalWorkspaceBootstrap } from "./personal.js";
import {
  decodeBase64Exact,
  fromBase64,
  sha256Bytes,
  toBase64,
  utf8DecodeFatal,
  utf8Encode,
} from "./encoding.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";

const RECOVERY_CODE_VERSION = 1;
const RECOVERY_CODE_KEY_BYTES = 32;
const RECOVERY_CODE_CHECKSUM_BYTES = 4;
const RECOVERY_AAD_PREFIX = "plainva/workspace/recovery-package/v1/";

export interface WorkspaceRecoveryPackageFile {
  format: "PWR1";
  version: 1;
  workspaceId: string;
  nonce: string;
  ciphertext: string;
}

export interface WorkspaceRecoveryPackagePayload {
  workspaceId: string;
  ownerMemberId: string;
  recoveryId: string;
  recoverySigningPublicKey: string;
  recoverySigningPrivateKey: string;
  recoveryRootKey: string;
  groupId: string;
  keyEpoch: number;
  groupHpkePublicKey: string;
  groupHpkePrivateKey: string;
  catalogKey: string;
  genesis: string;
  policy: string;
  createdAt: string;
}

export interface CreatedWorkspaceRecoveryPackage {
  bytes: Uint8Array;
  recoveryCode: string;
  payload: WorkspaceRecoveryPackagePayload;
}

function recoveryCodeBytes(key: Uint8Array): Uint8Array {
  const body = concatBytes(new Uint8Array([RECOVERY_CODE_VERSION]), key);
  return concatBytes(body, sha256Bytes(body).subarray(0, RECOVERY_CODE_CHECKSUM_BYTES));
}

function encodeRecoveryCode(key: Uint8Array): string {
  return `PVR1-${toBase32Groups(recoveryCodeBytes(key))}`;
}

function decodeRecoveryCode(code: string): Uint8Array {
  const normalized = code.trim();
  protocolAssert(/^PVR1-/i.test(normalized), "format", "recovery code has an unknown version");
  const bytes = fromBase32Groups(normalized.slice(5));
  protocolAssert(
    bytes.length === 1 + RECOVERY_CODE_KEY_BYTES + RECOVERY_CODE_CHECKSUM_BYTES,
    "format",
    "recovery code has the wrong length"
  );
  protocolAssert(bytes[0] === RECOVERY_CODE_VERSION, "unsupported", "unsupported recovery code version");
  const body = bytes.subarray(0, 1 + RECOVERY_CODE_KEY_BYTES);
  const checksum = sha256Bytes(body).subarray(0, RECOVERY_CODE_CHECKSUM_BYTES);
  for (let index = 0; index < checksum.length; index += 1) {
    protocolAssert(checksum[index] === bytes[body.length + index], "integrity", "recovery code checksum mismatch");
  }
  return new Uint8Array(body.subarray(1));
}

function packageAad(workspaceId: string): Uint8Array {
  return utf8Encode(`${RECOVERY_AAD_PREFIX}${workspaceId}`);
}

/**
 * Creates a two-piece recovery artifact. The `.pvrecovery` file contains only
 * authenticated ciphertext; the high-entropy PVR1 code is stored separately.
 * Losing either part does not expose recovery or group private keys.
 */
export function createWorkspaceRecoveryPackage(
  bootstrap: PersonalWorkspaceBootstrap,
  options: { packageKey?: Uint8Array; nonce?: Uint8Array; now?: string } = {}
): CreatedWorkspaceRecoveryPackage {
  const packageKey = options.packageKey ? new Uint8Array(options.packageKey) : randomBytes(RECOVERY_CODE_KEY_BYTES);
  const nonce = options.nonce ? new Uint8Array(options.nonce) : aeadNonce();
  protocolAssert(packageKey.length === RECOVERY_CODE_KEY_BYTES, "format", "recovery package key has the wrong length");
  protocolAssert(nonce.length === 24, "format", "recovery package nonce has the wrong length");
  const payload: WorkspaceRecoveryPackagePayload = {
    workspaceId: bootstrap.workspaceId,
    ownerMemberId: bootstrap.ownerMemberId,
    recoveryId: bootstrap.recovery.publicIdentity.recoveryId,
    recoverySigningPublicKey: toBase64(bootstrap.recovery.signing.publicKey),
    recoverySigningPrivateKey: toBase64(bootstrap.recovery.signing.privateKey),
    recoveryRootKey: toBase64(bootstrap.recovery.rootKey),
    groupId: bootstrap.ownerGroup.groupId,
    keyEpoch: bootstrap.ownerGroup.keyEpoch,
    groupHpkePublicKey: toBase64(bootstrap.ownerGroup.hpke.publicKey),
    groupHpkePrivateKey: toBase64(bootstrap.ownerGroup.hpke.privateKey),
    catalogKey: toBase64(bootstrap.ownerGroup.catalogKey),
    genesis: toBase64(utf8Encode(canonicalJson(bootstrap.genesis))),
    policy: toBase64(utf8Encode(canonicalJson(bootstrap.policy))),
    createdAt: options.now ?? new Date().toISOString(),
  };
  const plaintext = utf8Encode(canonicalJson(payload));
  const file: WorkspaceRecoveryPackageFile = {
    format: "PWR1",
    version: 1,
    workspaceId: bootstrap.workspaceId,
    nonce: toBase64(nonce),
    ciphertext: toBase64(aeadEncrypt(packageKey, nonce, plaintext, packageAad(bootstrap.workspaceId))),
  };
  return {
    bytes: utf8Encode(canonicalJson(file)),
    recoveryCode: encodeRecoveryCode(packageKey),
    payload,
  };
}

export function openWorkspaceRecoveryPackage(
  bytes: Uint8Array,
  recoveryCode: string
): WorkspaceRecoveryPackagePayload {
  protocolAssert(bytes.length > 0 && bytes.length <= 1024 * 1024, "bounds", "recovery package size is invalid");
  let parsed: unknown;
  const text = utf8DecodeFatal(bytes);
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new WorkspaceProtocolError("format", "recovery package is not JSON", { cause });
  }
  protocolAssert(canonicalJson(parsed) === text, "canonical", "recovery package is not canonical JSON");
  const file = parsed as WorkspaceRecoveryPackageFile;
  protocolAssert(
    file && file.format === "PWR1" && file.version === 1 &&
      typeof file.workspaceId === "string" && typeof file.nonce === "string" && typeof file.ciphertext === "string" &&
      Object.keys(file).sort().join(",") === "ciphertext,format,nonce,version,workspaceId",
    "format",
    "recovery package header is invalid"
  );
  const key = decodeRecoveryCode(recoveryCode);
  let plaintext: Uint8Array;
  try {
    plaintext = aeadDecrypt(
      key,
      decodeBase64Exact(file.nonce, 24, "recovery package nonce"),
      fromBase64(file.ciphertext),
      packageAad(file.workspaceId)
    );
  } catch (cause) {
    throw new WorkspaceProtocolError("crypto", "recovery package could not be opened", { cause });
  }
  let payload: WorkspaceRecoveryPackagePayload;
  const payloadText = utf8DecodeFatal(plaintext);
  try {
    payload = JSON.parse(payloadText) as WorkspaceRecoveryPackagePayload;
  } catch (cause) {
    throw new WorkspaceProtocolError("format", "recovery package payload is not JSON", { cause });
  }
  protocolAssert(canonicalJson(payload) === payloadText, "canonical", "recovery package payload is not canonical JSON");
  protocolAssert(payload.workspaceId === file.workspaceId, "integrity", "recovery package workspace binding mismatch");
  decodeBase64Exact(payload.recoverySigningPublicKey, 32, "recovery signing public key");
  decodeBase64Exact(payload.recoverySigningPrivateKey, 32, "recovery signing private key");
  decodeBase64Exact(payload.recoveryRootKey, 32, "recovery root key");
  decodeBase64Exact(payload.groupHpkePublicKey, 32, "group HPKE public key");
  decodeBase64Exact(payload.groupHpkePrivateKey, 32, "group HPKE private key");
  decodeBase64Exact(payload.catalogKey, 32, "catalog key");
  return payload;
}
