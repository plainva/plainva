import { canonicalJson } from "../settingsSync/canonicalJson.js";
import { randomBytes } from "../crypto/cryptoPrimitives.js";
import { hpkeOpen, hpkeSeal, HpkeSealTestingOptions, workspaceDomain } from "./crypto.js";
import {
  signWorkspaceDocument,
  WorkspaceDocumentSigner,
  WorkspaceSignedDocument,
} from "./documents.js";
import {
  assertWorkspaceHash,
  assertWorkspaceId,
  bytesEqual,
  decodeBase64Exact,
  toBase64,
  utf8Encode,
} from "./encoding.js";
import { protocolAssert } from "./errors.js";

export interface WorkspaceGrantPayload {
  recipientDeviceId: string;
  issuerDeviceId: string;
  policyHash: string;
  purpose: string;
  groupId: string;
  keyEpoch: number;
  keyHint: string;
  enc: string;
  ciphertext: string;
  createdAt: string;
  expiresAt: string | null;
}

function grantBinding(payload: Omit<WorkspaceGrantPayload, "enc" | "ciphertext">): Uint8Array {
  return utf8Encode(canonicalJson(payload));
}

export async function createWorkspaceGrant(input: {
  workspaceId: string;
  recipientDeviceId: string;
  recipientPublicKey: Uint8Array;
  issuerDeviceId: string;
  issuerPrivateSigningKey: Uint8Array;
  policyHash: string;
  purpose: string;
  groupId: string;
  keyEpoch: number;
  key: Uint8Array;
  createdAt: string;
  expiresAt?: string | null;
  keyHint?: Uint8Array;
  hpkeTesting?: HpkeSealTestingOptions;
}): Promise<WorkspaceSignedDocument<"grant", WorkspaceGrantPayload>> {
  assertWorkspaceId(input.workspaceId, "workspaceId");
  assertWorkspaceId(input.recipientDeviceId, "recipientDeviceId");
  assertWorkspaceId(input.issuerDeviceId, "issuerDeviceId");
  assertWorkspaceId(input.groupId, "groupId");
  assertWorkspaceHash(input.policyHash, "policyHash");
  protocolAssert(input.key.length === 32, "format", "grant key has wrong length");
  protocolAssert(Number.isInteger(input.keyEpoch) && input.keyEpoch >= 1 && input.keyEpoch <= 0xffffffff, "bounds", "grant epoch is out of range");
  const keyHint = input.keyHint ?? randomBytes(8);
  protocolAssert(keyHint.length === 8, "format", "grant key hint has wrong length");

  const publicFields = {
    recipientDeviceId: input.recipientDeviceId,
    issuerDeviceId: input.issuerDeviceId,
    policyHash: input.policyHash,
    purpose: input.purpose,
    groupId: input.groupId,
    keyEpoch: input.keyEpoch,
    keyHint: toBase64(keyHint),
    createdAt: input.createdAt,
    expiresAt: input.expiresAt ?? null,
  };
  const sealed = await hpkeSeal(
    input.recipientPublicKey,
    input.key,
    utf8Encode(workspaceDomain("grant", input.workspaceId)),
    grantBinding(publicFields),
    input.hpkeTesting
  );
  const payload: WorkspaceGrantPayload = {
    ...publicFields,
    enc: toBase64(sealed.enc),
    ciphertext: toBase64(sealed.ciphertext),
  };
  const signer: WorkspaceDocumentSigner = {
    algorithm: "Ed25519",
    signerId: input.issuerDeviceId,
    signerKind: "device",
  };
  return signWorkspaceDocument(
    { kind: "grant", protocolVersion: 1, workspaceId: input.workspaceId, payload },
    signer,
    input.issuerPrivateSigningKey
  );
}

export async function openWorkspaceGrant(
  document: WorkspaceSignedDocument<"grant", WorkspaceGrantPayload>,
  recipientPrivateKey: Uint8Array
): Promise<Uint8Array> {
  protocolAssert(document.kind === "grant", "format", "document is not a grant");
  const payload = document.payload;
  const publicFields = {
    recipientDeviceId: payload.recipientDeviceId,
    issuerDeviceId: payload.issuerDeviceId,
    policyHash: payload.policyHash,
    purpose: payload.purpose,
    groupId: payload.groupId,
    keyEpoch: payload.keyEpoch,
    keyHint: payload.keyHint,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
  };
  const key = await hpkeOpen(
    recipientPrivateKey,
    decodeBase64Exact(payload.enc, 32, "grant.enc"),
    decodeBase64Exact(payload.ciphertext, 48, "grant.ciphertext"),
    utf8Encode(workspaceDomain("grant", document.workspaceId)),
    grantBinding(publicFields)
  );
  protocolAssert(key.length === 32, "integrity", "grant plaintext has wrong length");
  return key;
}

export function grantContainsKey(
  opened: Uint8Array,
  expected: Uint8Array
): boolean {
  return bytesEqual(opened, expected);
}
