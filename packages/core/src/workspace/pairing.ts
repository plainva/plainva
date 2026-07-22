import { canonicalJson } from "../settingsSync/canonicalJson.js";
import { randomBytes } from "../crypto/cryptoPrimitives.js";
import {
  createWorkspaceDocumentSignatureInput,
  signWorkspaceBytes,
  verifyWorkspaceSignature,
} from "./crypto.js";
import {
  verifyWorkspaceDocumentSignatures,
  workspaceDocumentHash,
  type WorkspaceGenesisPayload,
  type WorkspacePolicyPayload,
  type WorkspaceSignedDocument,
} from "./documents.js";
import { createWorkspaceDeviceIdentity, createWorkspaceMemberId, type WorkspaceDeviceIdentity, type WorkspaceDevicePlatform, type WorkspaceGroupKeyEpoch } from "./identity.js";
import { createWorkspaceGrant, openWorkspaceGrant, type WorkspaceGrantPayload } from "./grant.js";
import { createWorkspacePolicySuccessor, validateWorkspacePolicySuccessor } from "./policy.js";
import { asRecord, assertExactKeys, assertWorkspaceHash, assertWorkspaceId, decodeBase64Exact, fromBase64, hasControlCharacters, sha256Hex, toBase64, utf8DecodeFatal, utf8Encode } from "./encoding.js";
import { evaluateWorkspaceAccess } from "./authorization.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";
import type { PersonalWorkspaceRuntime } from "./personal.js";
import type { WorkspaceObjectStore } from "./objectStore.js";

const PAIRING_PREFIX = "PVPAIR1.";
const MAX_PAIRING_TOKEN_BYTES = 16 * 1024;
const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;

export interface WorkspacePairingRequestPayload {
  version: 1;
  workspaceId: string;
  workspaceFingerprint: string;
  pairingId: string;
  memberId: string;
  device: WorkspaceDeviceIdentity["publicIdentity"];
  createdAt: string;
  expiresAt: string;
  nonce: string;
}

export interface WorkspacePairingRequest {
  payload: WorkspacePairingRequestPayload;
  signature: string;
}

export interface CreatedWorkspacePairingRequest {
  token: string;
  shortCode: string;
  fingerprint: string;
  request: WorkspacePairingRequest;
  device: WorkspaceDeviceIdentity;
}

export interface WorkspacePairingApproval {
  request: WorkspacePairingRequest;
  policy: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;
  grants: WorkspaceSignedDocument<"grant", WorkspaceGrantPayload>[];
  approvedAt: string;
}

export interface WorkspacePairingResponseBundle {
  version: 1;
  genesis: WorkspaceSignedDocument<"genesis", WorkspaceGenesisPayload>;
  previousPolicy: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;
  approval: WorkspacePairingApproval;
}

function tokenBytes(request: WorkspacePairingRequest): Uint8Array {
  return utf8Encode(canonicalJson(request));
}

function requestSigningBytes(payload: WorkspacePairingRequestPayload): Uint8Array {
  return createWorkspaceDocumentSignatureInput("pairing-request", payload.workspaceId, canonicalJson(payload));
}

function tokenBase64(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function tokenFromBase64(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return fromBase64(padded);
}

function grouped(value: string, size = 4): string {
  return value.match(new RegExp(`.{1,${size}}`, "g"))?.join("-") ?? value;
}

export function pairingFingerprint(request: WorkspacePairingRequest): string {
  return grouped(sha256Hex(tokenBytes(request)).slice(0, 24).toUpperCase());
}

export async function createWorkspacePairingRequest(input: {
  workspaceId: string;
  workspaceFingerprint: string;
  memberId: string;
  deviceDisplayName: string;
  platform: WorkspaceDevicePlatform;
  now?: string;
  ttlMs?: number;
  device?: WorkspaceDeviceIdentity;
}): Promise<CreatedWorkspacePairingRequest> {
  const createdAt = input.now ?? new Date().toISOString();
  const expiresAt = new Date(Date.parse(createdAt) + (input.ttlMs ?? DEFAULT_PAIRING_TTL_MS)).toISOString();
  const device = input.device ?? await createWorkspaceDeviceIdentity({
    memberId: input.memberId,
    displayName: input.deviceDisplayName,
    platform: input.platform,
  });
  const payload: WorkspacePairingRequestPayload = {
    version: 1,
    workspaceId: input.workspaceId,
    workspaceFingerprint: input.workspaceFingerprint,
    pairingId: createWorkspaceMemberId(),
    memberId: input.memberId,
    device: device.publicIdentity,
    createdAt,
    expiresAt,
    nonce: toBase64(randomBytes(16)),
  };
  const request: WorkspacePairingRequest = {
    payload,
    signature: toBase64(signWorkspaceBytes(device.secrets.signing.privateKey, requestSigningBytes(payload))),
  };
  const token = `${PAIRING_PREFIX}${tokenBase64(tokenBytes(request))}`;
  const shortCode = grouped(`${payload.pairingId.slice(0, 12)}${sha256Hex(tokenBytes(request)).slice(0, 8)}`.toUpperCase());
  return { token, shortCode, fingerprint: pairingFingerprint(request), request, device };
}

export function parseWorkspacePairingRequest(token: string, options: { now?: string; allowExpired?: boolean } = {}): WorkspacePairingRequest {
  protocolAssert(token.startsWith(PAIRING_PREFIX), "format", "pairing token has an unknown version");
  const bytes = tokenFromBase64(token.slice(PAIRING_PREFIX.length));
  protocolAssert(bytes.length > 0 && bytes.length <= MAX_PAIRING_TOKEN_BYTES, "bounds", "pairing token size is invalid");
  let request: WorkspacePairingRequest;
  const text = utf8DecodeFatal(bytes);
  try { request = JSON.parse(text) as WorkspacePairingRequest; }
  catch (cause) { throw new WorkspaceProtocolError("format", "pairing token is not JSON", { cause }); }
  protocolAssert(canonicalJson(request) === text, "canonical", "pairing token is not canonical JSON");
  const requestRecord = asRecord(request, "pairing request");
  assertExactKeys(requestRecord, ["payload", "signature"], "pairing request");
  const payloadRecord = asRecord(requestRecord.payload, "pairing payload");
  assertExactKeys(payloadRecord, ["version", "workspaceId", "workspaceFingerprint", "pairingId", "memberId", "device", "createdAt", "expiresAt", "nonce"], "pairing payload");
  const deviceRecord = asRecord(payloadRecord.device, "pairing device");
  assertExactKeys(deviceRecord, ["deviceId", "memberId", "displayName", "platform", "signingPublicKey", "hpkePublicKey"], "pairing device");
  const payload = request.payload;
  protocolAssert(request && payload?.version === 1 && typeof request.signature === "string", "format", "pairing request shape is invalid");
  assertWorkspaceId(payload.workspaceId, "pairing workspaceId");
  assertWorkspaceHash(payload.workspaceFingerprint, "pairing workspace fingerprint");
  assertWorkspaceId(payload.pairingId, "pairingId");
  assertWorkspaceId(payload.memberId, "pairing memberId");
  assertWorkspaceId(payload.device.deviceId, "pairing deviceId");
  protocolAssert(typeof payload.device.displayName === "string" && payload.device.displayName.length > 0 && utf8Encode(payload.device.displayName).length <= 128 && !hasControlCharacters(payload.device.displayName), "format", "pairing device display name is invalid");
  protocolAssert(["desktop", "android", "ios"].includes(payload.device.platform), "format", "pairing device platform is invalid");
  decodeBase64Exact(payload.device.hpkePublicKey, 32, "pairing HPKE key");
  decodeBase64Exact(payload.nonce, 16, "pairing nonce");
  protocolAssert(payload.device.memberId === payload.memberId, "integrity", "pairing device/member binding mismatch");
  const createdAt = Date.parse(payload.createdAt);
  const expiresAt = Date.parse(payload.expiresAt);
  protocolAssert(Number.isFinite(createdAt) && Number.isFinite(expiresAt) && expiresAt > createdAt && expiresAt - createdAt <= 24 * 60 * 60 * 1000, "integrity", "pairing request expiry is invalid");
  if (!options.allowExpired) protocolAssert(expiresAt > Date.parse(options.now ?? new Date().toISOString()), "authorization", "pairing request has expired");
  const key = decodeBase64Exact(payload.device.signingPublicKey, 32, "pairing signing key");
  protocolAssert(verifyWorkspaceSignature(key, requestSigningBytes(payload), decodeBase64Exact(request.signature, 64, "pairing signature")), "crypto", "pairing request signature is invalid");
  return request;
}

/** In-memory one-time guard; shells persist the consumed id with the policy. */
export class WorkspacePairingSessionRegistry {
  private readonly consumed = new Set<string>();
  consume(pairingId: string): void {
    protocolAssert(!this.consumed.has(pairingId), "conflict", "pairing request was already consumed");
    this.consumed.add(pairingId);
  }
  hasConsumed(pairingId: string): boolean { return this.consumed.has(pairingId); }
}

export async function approveWorkspacePairing(input: {
  token: string;
  runtime: PersonalWorkspaceRuntime;
  consumed?: WorkspacePairingSessionRegistry;
  now?: string;
}): Promise<WorkspacePairingApproval> {
  const now = input.now ?? new Date().toISOString();
  const request = parseWorkspacePairingRequest(input.token, { now });
  protocolAssert(request.payload.workspaceId === input.runtime.workspaceId, "integrity", "pairing request belongs to another workspace");
  protocolAssert(request.payload.workspaceFingerprint === workspaceDocumentHash(input.runtime.genesis), "integrity", "pairing workspace fingerprint mismatch");
  protocolAssert(input.runtime.policy.payload.members.some((member) => member.memberId === request.payload.memberId && member.state === "active"), "authorization", "pairing member is not active");
  protocolAssert(evaluateWorkspaceAccess(input.runtime.policy.payload, {
    memberId: input.runtime.memberId,
    deviceId: input.runtime.device.publicIdentity.deviceId,
    capability: "devices.approve",
  }).allowed, "authorization", "current device cannot approve devices");
  input.consumed?.consume(request.payload.pairingId);

  const policy = createWorkspacePolicySuccessor({
    current: input.runtime.policy,
    mutate: (draft) => {
      protocolAssert(!draft.devices.some((device) => device.deviceId === request.payload.device.deviceId), "conflict", "pairing device already exists");
      draft.devices.push({ ...request.payload.device, state: "active", addedAt: now, revokedAt: null });
    },
    signer: {
      signer: { algorithm: "Ed25519", signerId: input.runtime.device.publicIdentity.deviceId, signerKind: "device" },
      privateKey: input.runtime.device.secrets.signing.privateKey,
    },
  });
  const policyHash = workspaceDocumentHash(policy);
  const grants: WorkspacePairingApproval["grants"] = [];
  for (const group of input.runtime.groupKeys) {
    const policyGroup = policy.payload.groups.find((entry) => entry.groupId === group.groupId && entry.keyEpoch === group.keyEpoch);
    if (!policyGroup || !policyGroup.memberIds?.includes(request.payload.memberId)) continue;
    for (const [purpose, key] of [["group-hpke-private-key", group.hpke.privateKey], ["group-catalog-key", group.catalogKey]] as const) {
      grants.push(await createWorkspaceGrant({
        workspaceId: input.runtime.workspaceId,
        recipientDeviceId: request.payload.device.deviceId,
        recipientPublicKey: decodeBase64Exact(request.payload.device.hpkePublicKey, 32, "pairing HPKE key"),
        issuerDeviceId: input.runtime.device.publicIdentity.deviceId,
        issuerPrivateSigningKey: input.runtime.device.secrets.signing.privateKey,
        policyHash,
        purpose,
        groupId: group.groupId,
        keyEpoch: group.keyEpoch,
        key,
        createdAt: now,
        expiresAt: request.payload.expiresAt,
      }));
    }
  }
  grants.sort((a, b) => workspaceDocumentHash(a).localeCompare(workspaceDocumentHash(b)));
  return { request, policy, grants, approvedAt: now };
}

export async function acceptWorkspacePairing(input: {
  created: CreatedWorkspacePairingRequest;
  genesis: WorkspaceSignedDocument<"genesis", WorkspaceGenesisPayload>;
  previousPolicy: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;
  approval: WorkspacePairingApproval;
  now?: string;
}): Promise<PersonalWorkspaceRuntime> {
  const now = input.now ?? new Date().toISOString();
  protocolAssert(input.approval.request.payload.pairingId === input.created.request.payload.pairingId, "integrity", "pairing approval belongs to another request");
  protocolAssert(input.genesis.workspaceId === input.created.request.payload.workspaceId, "integrity", "pairing genesis binding mismatch");
  protocolAssert(workspaceDocumentHash(input.genesis) === input.created.request.payload.workspaceFingerprint, "integrity", "pairing genesis fingerprint mismatch");
  validateWorkspacePolicySuccessor({ previous: input.previousPolicy, successor: input.approval.policy });
  const device = input.approval.policy.payload.devices.find((entry) => entry.deviceId === input.created.device.publicIdentity.deviceId);
  protocolAssert(!!device && device.state === "active", "authorization", "paired device is not active in the approved policy");
  const policyHash = workspaceDocumentHash(input.approval.policy);
  const opened = new Map<string, { privateKey?: Uint8Array; catalogKey?: Uint8Array }>();
  for (const grant of input.approval.grants) {
    protocolAssert(grant.payload.recipientDeviceId === device.deviceId && grant.payload.policyHash === policyHash, "integrity", "pairing grant binding mismatch");
    protocolAssert(!grant.payload.expiresAt || Date.parse(grant.payload.expiresAt) > Date.parse(now), "authorization", "pairing grant has expired");
    const issuer = input.approval.policy.payload.devices.find((entry) => entry.deviceId === grant.payload.issuerDeviceId && entry.state === "active");
    protocolAssert(!!issuer && verifyWorkspaceDocumentSignatures(grant, (signer) => signer.signerId === issuer.deviceId ? decodeBase64Exact(issuer.signingPublicKey, 32, "grant issuer key") : null), "crypto", "pairing grant signature is invalid");
    const key = await openWorkspaceGrant(grant, input.created.device.secrets.hpke.privateKey);
    const entry = opened.get(`${grant.payload.groupId}:${grant.payload.keyEpoch}`) ?? {};
    if (grant.payload.purpose === "group-hpke-private-key") entry.privateKey = key;
    if (grant.payload.purpose === "group-catalog-key") entry.catalogKey = key;
    opened.set(`${grant.payload.groupId}:${grant.payload.keyEpoch}`, entry);
  }
  const groupKeys: WorkspaceGroupKeyEpoch[] = [];
  for (const policyGroup of input.approval.policy.payload.groups) {
    const entry = opened.get(`${policyGroup.groupId}:${policyGroup.keyEpoch}`);
    if (!entry?.privateKey || !entry.catalogKey) continue;
    groupKeys.push({
      groupId: policyGroup.groupId,
      keyEpoch: policyGroup.keyEpoch,
      hpke: { publicKey: decodeBase64Exact(policyGroup.hpkePublicKey, 32, "group HPKE public key"), privateKey: entry.privateKey },
      catalogKey: entry.catalogKey,
    });
  }
  protocolAssert(groupKeys.length > 0, "authorization", "pairing approval contains no readable group");
  const ownerGroup = groupKeys.find((key) => input.approval.policy.payload.groups.some((group) => group.groupId === key.groupId && group.keyEpoch === key.keyEpoch && group.memberIds?.includes(input.genesis.payload.initialOwnerMember.memberId))) ?? groupKeys[0];
  return {
    workspaceId: input.genesis.workspaceId,
    memberId: device.memberId,
    ownerMemberId: input.genesis.payload.initialOwnerMember.memberId,
    device: input.created.device,
    ownerGroup,
    groupKeys,
    genesis: input.genesis,
    policy: input.approval.policy,
    grants: input.approval.grants,
  };
}

/** Publishes a signed request so the short manual code is usable without a second transport. */
export async function publishWorkspacePairingRequest(store: WorkspaceObjectStore, created: CreatedWorkspacePairingRequest, signal?: AbortSignal): Promise<void> {
  const bytes = utf8Encode(created.token);
  await store.putImmutable(`.pvws/pairing/requests/${created.request.payload.pairingId}-${sha256Hex(bytes)}.pvpair`, bytes, sha256Hex(bytes), { signal });
}

export async function findWorkspacePairingRequest(store: WorkspaceObjectStore, shortCode: string, signal?: AbortSignal): Promise<string | null> {
  const normalized = shortCode.replace(/-/g, "").toLowerCase();
  protocolAssert(/^[0-9a-f]{20}$/.test(normalized), "format", "manual pairing code is invalid");
  const idPrefix = normalized.slice(0, 12);
  let cursor: string | undefined;
  do {
    const page = await store.list(".pvws/pairing/requests/", cursor, { signal, pageSize: 200 });
    for (const info of page.items) {
      const name = info.key.split("/").pop() ?? "";
      if (!name.startsWith(idPrefix)) continue;
      const bytes = await store.get(info.key, { signal });
      if (!bytes) continue;
      const token = utf8DecodeFatal(bytes);
      const request = parseWorkspacePairingRequest(token);
      const expected = `${request.payload.pairingId.slice(0, 12)}${sha256Hex(tokenBytes(request)).slice(0, 8)}`;
      if (expected === normalized) return token;
    }
    cursor = page.cursor;
  } while (cursor);
  return null;
}

export async function publishWorkspacePairingApproval(store: WorkspaceObjectStore, bundle: WorkspacePairingResponseBundle, signal?: AbortSignal): Promise<void> {
  const bytes = utf8Encode(canonicalJson(bundle));
  const pairingId = bundle.approval.request.payload.pairingId;
  await store.putImmutable(`.pvws/pairing/responses/${pairingId}-${sha256Hex(bytes)}.pvpair`, bytes, sha256Hex(bytes), { signal });
}

export async function loadWorkspacePairingApproval(store: WorkspaceObjectStore, pairingId: string, signal?: AbortSignal): Promise<WorkspacePairingResponseBundle | null> {
  assertWorkspaceId(pairingId, "pairingId");
  let cursor: string | undefined;
  do {
    const page = await store.list(".pvws/pairing/responses/", cursor, { signal, pageSize: 100 });
    for (const info of page.items) {
      if (!(info.key.split("/").pop() ?? "").startsWith(`${pairingId}-`)) continue;
      const bytes = await store.get(info.key, { signal });
      if (!bytes) continue;
      const text = utf8DecodeFatal(bytes);
      let bundle: WorkspacePairingResponseBundle;
      try { bundle = JSON.parse(text) as WorkspacePairingResponseBundle; }
      catch (cause) { throw new WorkspaceProtocolError("format", "pairing response is not JSON", { cause }); }
      protocolAssert(canonicalJson(bundle) === text && bundle.version === 1 && bundle.approval.request.payload.pairingId === pairingId, "integrity", "pairing response binding is invalid");
      return bundle;
    }
    cursor = page.cursor;
  } while (cursor);
  return null;
}
