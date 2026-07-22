import { randomBytes } from "../crypto/cryptoPrimitives.js";
import { generateHpkeKeyPair, generateSigningKeyPair, WorkspaceKeyPair } from "./crypto.js";
import { assertWorkspaceId, hasControlCharacters, hasUnpairedSurrogate, toBase64, toHex, utf8Encode } from "./encoding.js";
import { protocolAssert } from "./errors.js";

export type WorkspaceDevicePlatform = "desktop" | "android" | "ios";

export interface WorkspaceDevicePublicIdentity {
  deviceId: string;
  memberId: string;
  displayName: string;
  platform: WorkspaceDevicePlatform;
  signingPublicKey: string;
  hpkePublicKey: string;
}

export interface WorkspaceDeviceSecrets {
  signing: WorkspaceKeyPair;
  hpke: WorkspaceKeyPair;
}

export interface WorkspaceDeviceIdentity {
  publicIdentity: WorkspaceDevicePublicIdentity;
  secrets: WorkspaceDeviceSecrets;
}

export interface WorkspaceRecoveryPublicIdentity {
  recoveryId: string;
  signingPublicKey: string;
}

export interface WorkspaceRecoveryIdentity {
  publicIdentity: WorkspaceRecoveryPublicIdentity;
  signing: WorkspaceKeyPair;
  /** Stable owner recovery root; persisted only inside the future recovery package. */
  rootKey: Uint8Array;
}

export interface WorkspaceGroupKeyEpoch {
  groupId: string;
  keyEpoch: number;
  hpke: WorkspaceKeyPair;
  catalogKey: Uint8Array;
}

function assertDisplayName(value: string): string {
  protocolAssert(typeof value === "string" && value === value.normalize("NFC"), "canonical", "display name must be NFC");
  protocolAssert(utf8Encode(value).length >= 1 && utf8Encode(value).length <= 128, "bounds", "display name length is invalid");
  protocolAssert(!hasControlCharacters(value) && !hasUnpairedSurrogate(value), "format", "display name contains controls or an unpaired surrogate");
  return value;
}

export async function createWorkspaceDeviceIdentity(input: {
  memberId: string;
  displayName: string;
  platform: WorkspaceDevicePlatform;
  deviceId?: string;
  signingSeed?: Uint8Array;
  hpkeSeed?: Uint8Array;
}): Promise<WorkspaceDeviceIdentity> {
  const deviceId = input.deviceId ?? toHex(randomBytes(16));
  assertWorkspaceId(deviceId, "deviceId");
  assertWorkspaceId(input.memberId, "memberId");
  const signing = generateSigningKeyPair(input.signingSeed);
  const hpke = await generateHpkeKeyPair(input.hpkeSeed);
  return {
    publicIdentity: {
      deviceId,
      memberId: input.memberId,
      displayName: assertDisplayName(input.displayName),
      platform: input.platform,
      signingPublicKey: toBase64(signing.publicKey),
      hpkePublicKey: toBase64(hpke.publicKey),
    },
    secrets: { signing, hpke },
  };
}

export function createWorkspaceRecoveryIdentity(input: {
  recoveryId?: string;
  signingSeed?: Uint8Array;
  rootKey?: Uint8Array;
} = {}): WorkspaceRecoveryIdentity {
  const recoveryId = input.recoveryId ?? toHex(randomBytes(16));
  assertWorkspaceId(recoveryId, "recoveryId");
  const signing = generateSigningKeyPair(input.signingSeed);
  const rootKey = input.rootKey ? new Uint8Array(input.rootKey) : randomBytes(32);
  protocolAssert(rootKey.length === 32, "format", "recovery root key has wrong length");
  return {
    publicIdentity: { recoveryId, signingPublicKey: toBase64(signing.publicKey) },
    signing,
    rootKey,
  };
}

export async function createWorkspaceGroupKeyEpoch(input: {
  groupId: string;
  keyEpoch: number;
  hpkeSeed?: Uint8Array;
  catalogKey?: Uint8Array;
}): Promise<WorkspaceGroupKeyEpoch> {
  assertWorkspaceId(input.groupId, "groupId");
  protocolAssert(Number.isInteger(input.keyEpoch) && input.keyEpoch >= 1 && input.keyEpoch <= 0xffffffff, "bounds", "group key epoch is out of range");
  const catalogKey = input.catalogKey ? new Uint8Array(input.catalogKey) : randomBytes(32);
  protocolAssert(catalogKey.length === 32, "format", "catalog key has wrong length");
  return {
    groupId: input.groupId,
    keyEpoch: input.keyEpoch,
    hpke: await generateHpkeKeyPair(input.hpkeSeed),
    catalogKey,
  };
}

export function createWorkspaceId(): string {
  return toHex(randomBytes(16));
}

export function createWorkspaceMemberId(): string {
  return toHex(randomBytes(16));
}

export function createWorkspaceObjectId(): string {
  return toHex(randomBytes(16));
}

export function createWorkspaceRevisionId(): string {
  return toHex(randomBytes(16));
}
