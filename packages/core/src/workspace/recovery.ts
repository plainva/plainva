import { canonicalJson } from "../settingsSync/canonicalJson.js";
import {
  appendWorkspaceDocumentSignature,
  encodeWorkspaceDocument,
  parseWorkspaceDocument,
  signWorkspaceDocument,
  verifyWorkspaceDocumentSignatures,
  workspaceDocumentHash,
  type WorkspaceGenesisPayload,
  type WorkspacePolicyPayload,
  type WorkspaceRecoveryAnchorPayload,
  type WorkspaceSignedDocument,
} from "./documents.js";
import { createWorkspaceDeviceIdentity, createWorkspaceRecoveryIdentity, type WorkspaceDevicePlatform, type WorkspaceRecoveryIdentity } from "./identity.js";
import { createWorkspaceGrant } from "./grant.js";
import type { WorkspaceGrantPayload } from "./grant.js";
import { createWorkspacePolicySuccessor, resolveWorkspacePolicyChain } from "./policy.js";
import { decodeBase64Exact, fromBase64, sha256Hex, toBase64, utf8Encode } from "./encoding.js";
import { protocolAssert } from "./errors.js";
import type { PersonalWorkspaceRuntime } from "./personal.js";
import type { WorkspaceObjectStore } from "./objectStore.js";
import { createWorkspaceRecoveryPackage, openWorkspaceRecoveryPackage, type CreatedWorkspaceRecoveryPackage } from "./recoveryPackage.js";
import { evaluateWorkspaceAccess } from "./authorization.js";

function packagedRecoveryAnchors(payload: ReturnType<typeof openWorkspaceRecoveryPackage>): WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload>[] {
  return (payload.anchors ?? []).map((encoded) => {
    const parsed = parseWorkspaceDocument(fromBase64(encoded));
    protocolAssert(parsed.kind === "recovery" && parsed.workspaceId === payload.workspaceId, "integrity", "recovery anchor package binding is invalid");
    return parsed as WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload>;
  });
}

async function remoteRecoveryAnchors(store: WorkspaceObjectStore | undefined, workspaceId: string): Promise<WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload>[]> {
  if (!store) return [];
  const anchors: WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload>[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list(".pvws/recovery/", cursor, { pageSize: 500 });
    for (const info of page.items) {
      const bytes = await store.get(info.key);
      if (!bytes) continue;
      try {
        const parsed = parseWorkspaceDocument(bytes);
        if (parsed.kind === "recovery" && parsed.workspaceId === workspaceId && info.key.endsWith(`-${workspaceDocumentHash(parsed)}.pvrec`)) anchors.push(parsed as WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload>);
      } catch {
        // The normal worker exposes malformed anchors through quarantine.
      }
    }
    cursor = page.cursor;
  } while (cursor);
  return anchors;
}

function recoveryKeyMap(input: { genesis: WorkspaceSignedDocument<"genesis", WorkspaceGenesisPayload>; anchors: WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload>[] }): Map<string, Uint8Array> {
  const genesisRecovery = input.genesis.payload.recovery;
  const initialKey = decodeBase64Exact(genesisRecovery.signingPublicKey, 32, "genesis recovery key");
  validateWorkspaceRecoveryAnchorChain({ genesisRecoveryId: genesisRecovery.recoveryId, genesisRecoveryPublicKey: initialKey, anchors: input.anchors });
  const keys = new Map<string, Uint8Array>([[genesisRecovery.recoveryId, initialKey]]);
  for (const anchor of input.anchors) keys.set(anchor.payload.recovery.recoveryId, decodeBase64Exact(anchor.payload.recovery.signingPublicKey, 32, "recovery anchor key"));
  return keys;
}

function parsePackagedDocument<K extends "genesis" | "policy">(encoded: string, kind: K): WorkspaceSignedDocument<K, K extends "policy" ? WorkspacePolicyPayload : unknown> {
  const bytes = fromBase64(encoded);
  const parsed = parseWorkspaceDocument(bytes);
  protocolAssert(parsed.kind === kind, "integrity", `recovery package ${kind} is invalid`);
  return parsed as WorkspaceSignedDocument<K, K extends "policy" ? WorkspacePolicyPayload : unknown>;
}

export interface RestoredWorkspaceFromRecovery {
  runtime: PersonalWorkspaceRuntime;
  policy: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;
  grants: WorkspaceSignedDocument<"grant", WorkspaceGrantPayload>[];
  previousPolicyHash: string;
}

/** Re-establishes an owner device without touching content objects or revision identifiers. */
export async function restoreWorkspaceFromRecoveryPackage(input: {
  bytes: Uint8Array;
  recoveryCode: string;
  deviceDisplayName: string;
  platform: WorkspaceDevicePlatform;
  now?: string;
  revokeOtherDevices?: boolean;
  /** When present, recovery continues from the latest valid remote policy. */
  store?: WorkspaceObjectStore;
}): Promise<RestoredWorkspaceFromRecovery> {
  const now = input.now ?? new Date().toISOString();
  const payload = openWorkspaceRecoveryPackage(input.bytes, input.recoveryCode);
  const genesis = parsePackagedDocument(payload.genesis, "genesis") as WorkspaceSignedDocument<"genesis", WorkspaceGenesisPayload>;
  const genesisPayload = genesis.payload as WorkspaceGenesisPayload;
  const packagedPolicy = parsePackagedDocument(payload.policy, "policy");
  protocolAssert(genesis.workspaceId === payload.workspaceId && packagedPolicy.workspaceId === payload.workspaceId, "integrity", "recovery package documents belong to another workspace");
  const recoveryPublicKey = decodeBase64Exact(payload.recoverySigningPublicKey, 32, "recovery public key");
  const recoveryPrivateKey = decodeBase64Exact(payload.recoverySigningPrivateKey, 32, "recovery private key");
  const genesisRecoveryKey = decodeBase64Exact(genesisPayload.recovery.signingPublicKey, 32, "genesis recovery key");
  protocolAssert(verifyWorkspaceDocumentSignatures(genesis, (signer) => signer.signerKind === "recovery" && signer.signerId === genesisPayload.recovery.recoveryId ? genesisRecoveryKey : signer.signerKind === "device" && signer.signerId === genesisPayload.initialOwnerDevice.deviceId ? decodeBase64Exact(genesisPayload.initialOwnerDevice.signingPublicKey, 32, "owner key") : null), "crypto", "recovery genesis signature is invalid");
  const packagedAnchors = packagedRecoveryAnchors(payload);
  const remoteAnchors = await remoteRecoveryAnchors(input.store, payload.workspaceId);
  const uniqueAnchors = [...new Map([...packagedAnchors, ...remoteAnchors].map((anchor) => [workspaceDocumentHash(anchor), anchor])).values()].sort((a, b) => a.payload.anchorVersion - b.payload.anchorVersion);
  const recoveryKeys = recoveryKeyMap({ genesis, anchors: uniqueAnchors });
  const activeRecoveryId = uniqueAnchors.length ? uniqueAnchors[uniqueAnchors.length - 1].payload.recovery.recoveryId : genesisPayload.recovery.recoveryId;
  protocolAssert(activeRecoveryId === payload.recoveryId && recoveryKeys.get(payload.recoveryId)?.every((value, index) => value === recoveryPublicKey[index]) === true, "integrity", "recovery package is not the active recovery identity for this workspace");
  protocolAssert(verifyWorkspaceDocumentSignatures(packagedPolicy, (signer) => signer.signerKind === "recovery" ? recoveryKeys.get(signer.signerId) ?? null : packagedPolicy.payload.devices.find((device) => device.deviceId === signer.signerId) ? decodeBase64Exact(packagedPolicy.payload.devices.find((device) => device.deviceId === signer.signerId)!.signingPublicKey, 32, "policy signer key") : null), "crypto", "recovery policy signature is invalid");
  let previousPolicy = packagedPolicy;
  if (input.store) {
    const candidates: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>[] = [];
    let cursor: string | undefined;
    do {
      const page = await input.store.list(".pvws/policies/", cursor, { pageSize: 500 });
      for (const info of page.items) {
        const bytes = await input.store.get(info.key);
        if (!bytes) continue;
        try {
          const parsed = parseWorkspaceDocument(bytes);
          if (parsed.kind === "policy" && parsed.workspaceId === payload.workspaceId) candidates.push(parsed as WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>);
        } catch {
          // Recovery ignores malformed branches; the normal worker quarantines them.
        }
      }
      cursor = page.cursor;
    } while (cursor);
    previousPolicy = resolveWorkspacePolicyChain({ initial: packagedPolicy, candidates, recoveryPublicKeys: recoveryKeys }).current;
  }
  const device = await createWorkspaceDeviceIdentity({ memberId: payload.ownerMemberId, displayName: input.deviceDisplayName, platform: input.platform });
  const policy = createWorkspacePolicySuccessor({
    current: previousPolicy,
    mutate: (draft) => {
      if (input.revokeOtherDevices) {
        for (const entry of draft.devices) if (entry.state === "active") {
          entry.state = "revoked"; entry.revokedAt = now;
          if (!draft.revocations.some((revocation) => revocation.subjectKind === "device" && revocation.subjectId === entry.deviceId)) draft.revocations.push({ subjectKind: "device", subjectId: entry.deviceId, revokedAt: now, reason: "Recovery replaced lost devices" });
        }
      }
      draft.devices.push({ ...device.publicIdentity, state: "active", addedAt: now, revokedAt: null });
    },
    signer: { signer: { algorithm: "Ed25519", signerId: payload.recoveryId, signerKind: "recovery" }, privateKey: recoveryPrivateKey },
    recoveryPublicKeys: new Map([[payload.recoveryId, recoveryPublicKey]]),
  });
  const group = {
    groupId: payload.groupId,
    keyEpoch: payload.keyEpoch,
    hpke: { publicKey: decodeBase64Exact(payload.groupHpkePublicKey, 32, "group public key"), privateKey: decodeBase64Exact(payload.groupHpkePrivateKey, 32, "group private key") },
    catalogKey: decodeBase64Exact(payload.catalogKey, 32, "catalog key"),
  };
  const policyHash = workspaceDocumentHash(policy);
  const grants = await Promise.all((["group-hpke-private-key", "group-catalog-key"] as const).map((purpose) => createWorkspaceGrant({
    workspaceId: payload.workspaceId,
    recipientDeviceId: device.publicIdentity.deviceId,
    recipientPublicKey: device.secrets.hpke.publicKey,
    issuerDeviceId: device.publicIdentity.deviceId,
    issuerPrivateSigningKey: device.secrets.signing.privateKey,
    policyHash,
    purpose,
    groupId: group.groupId,
    keyEpoch: group.keyEpoch,
    key: purpose === "group-hpke-private-key" ? group.hpke.privateKey : group.catalogKey,
    createdAt: now,
  })));
  return {
    previousPolicyHash: workspaceDocumentHash(previousPolicy),
    policy,
    grants,
    runtime: { workspaceId: payload.workspaceId, memberId: payload.ownerMemberId, ownerMemberId: payload.ownerMemberId, ownerGroup: group, groupKeys: [group], device, genesis: genesis as PersonalWorkspaceRuntime["genesis"], policy, grants },
  };
}

export interface RotatedWorkspaceRecovery extends CreatedWorkspaceRecoveryPackage {
  anchor: WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload>;
}

/** Prepares a replacement recovery identity and its dual-signed trust anchor. */
export async function rotateWorkspaceRecoveryPackage(input: {
  bytes: Uint8Array;
  recoveryCode: string;
  runtime: PersonalWorkspaceRuntime;
  store: WorkspaceObjectStore;
  now?: string;
  replacement?: Pick<PersonalWorkspaceRuntime, "ownerMemberId" | "ownerGroup" | "policy" | "grants">;
}): Promise<RotatedWorkspaceRecovery> {
  const payload = openWorkspaceRecoveryPackage(input.bytes, input.recoveryCode);
  protocolAssert(payload.workspaceId === input.runtime.workspaceId, "integrity", "recovery package belongs to another workspace");
  protocolAssert(evaluateWorkspaceAccess(input.runtime.policy.payload, { memberId: input.runtime.memberId, deviceId: input.runtime.device.publicIdentity.deviceId, capability: "recovery.manage" }).allowed, "authorization", "current device cannot rotate recovery");
  const anchors = [...packagedRecoveryAnchors(payload), ...await remoteRecoveryAnchors(input.store, input.runtime.workspaceId)];
  const uniqueAnchors = [...new Map(anchors.map((anchor) => [workspaceDocumentHash(anchor), anchor])).values()].sort((a, b) => a.payload.anchorVersion - b.payload.anchorVersion);
  const keys = recoveryKeyMap({ genesis: input.runtime.genesis, anchors: uniqueAnchors });
  const previousPublicKey = decodeBase64Exact(payload.recoverySigningPublicKey, 32, "recovery public key");
  const activeRecoveryId = uniqueAnchors.length ? uniqueAnchors[uniqueAnchors.length - 1].payload.recovery.recoveryId : input.runtime.genesis.payload.recovery.recoveryId;
  protocolAssert(activeRecoveryId === payload.recoveryId && keys.get(payload.recoveryId)?.every((value, index) => value === previousPublicKey[index]) === true, "integrity", "recovery package is no longer the active recovery identity");
  const previousRecovery: WorkspaceRecoveryIdentity = {
    publicIdentity: { recoveryId: payload.recoveryId, signingPublicKey: payload.recoverySigningPublicKey },
    signing: { publicKey: previousPublicKey, privateKey: decodeBase64Exact(payload.recoverySigningPrivateKey, 32, "recovery private key") },
    rootKey: decodeBase64Exact(payload.recoveryRootKey, 32, "recovery root key"),
  };
  const rotated = createWorkspaceRecoveryAnchor({ workspaceId: input.runtime.workspaceId, previousRecovery, previousAnchor: uniqueAnchors.length ? uniqueAnchors[uniqueAnchors.length - 1] : null, now: input.now });
  const nextAnchors = [...uniqueAnchors, rotated.anchor];
  const created = createWorkspaceRecoveryPackage({
    workspaceId: input.runtime.workspaceId,
    ownerMemberId: input.replacement?.ownerMemberId ?? input.runtime.ownerMemberId,
    ownerGroup: input.replacement?.ownerGroup ?? input.runtime.ownerGroup,
    device: input.runtime.device,
    recovery: rotated.recovery,
    policy: input.replacement?.policy ?? input.runtime.policy,
    genesis: input.runtime.genesis,
    grants: input.replacement?.grants ?? input.runtime.grants,
  }, { now: input.now, anchors: nextAnchors.map((anchor) => toBase64(encodeWorkspaceDocument(anchor))) });
  return { ...created, anchor: rotated.anchor };
}

/**
 * Activates a prepared recovery rotation after the caller has durably handed the
 * replacement package to the user. Repeating the activation is safe.
 */
export async function publishWorkspaceRecoveryRotation(input: {
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  anchor: WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload>;
}): Promise<void> {
  protocolAssert(evaluateWorkspaceAccess(input.runtime.policy.payload, { memberId: input.runtime.memberId, deviceId: input.runtime.device.publicIdentity.deviceId, capability: "recovery.manage" }).allowed, "authorization", "current device cannot rotate recovery");
  protocolAssert(input.anchor.workspaceId === input.runtime.workspaceId, "integrity", "recovery anchor belongs to another workspace");
  const remote = await remoteRecoveryAnchors(input.store, input.runtime.workspaceId);
  const unique = [...new Map(remote.map((anchor) => [workspaceDocumentHash(anchor), anchor])).values()].sort((a, b) => a.payload.anchorVersion - b.payload.anchorVersion);
  const anchorHash = workspaceDocumentHash(input.anchor);
  if (unique.some((anchor) => workspaceDocumentHash(anchor) === anchorHash)) {
    recoveryKeyMap({ genesis: input.runtime.genesis, anchors: unique });
    return;
  }
  recoveryKeyMap({ genesis: input.runtime.genesis, anchors: [...unique, input.anchor] });
  const anchorBytes = encodeWorkspaceDocument(input.anchor);
  await input.store.putImmutable(`.pvws/recovery/${input.anchor.payload.anchorVersion}-${anchorHash}.pvrec`, anchorBytes, anchorHash);
}

export function createWorkspaceRecoveryAnchor(input: {
  workspaceId: string;
  previousRecovery: WorkspaceRecoveryIdentity;
  nextRecovery?: WorkspaceRecoveryIdentity;
  previousAnchor?: WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload> | null;
  now?: string;
}): { anchor: WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload>; recovery: WorkspaceRecoveryIdentity } {
  const recovery = input.nextRecovery ?? createWorkspaceRecoveryIdentity();
  const payload: WorkspaceRecoveryAnchorPayload = {
    anchorVersion: (input.previousAnchor?.payload.anchorVersion ?? 0) + 1,
    previousAnchorHash: input.previousAnchor ? workspaceDocumentHash(input.previousAnchor) : null,
    previousRecoveryId: input.previousRecovery.publicIdentity.recoveryId,
    recovery: recovery.publicIdentity,
    createdAt: input.now ?? new Date().toISOString(),
  };
  const first = signWorkspaceDocument({ kind: "recovery", protocolVersion: 1, workspaceId: input.workspaceId, payload }, { algorithm: "Ed25519", signerId: input.previousRecovery.publicIdentity.recoveryId, signerKind: "recovery" }, input.previousRecovery.signing.privateKey);
  const anchor = appendWorkspaceDocumentSignature(first, { algorithm: "Ed25519", signerId: recovery.publicIdentity.recoveryId, signerKind: "recovery" }, recovery.signing.privateKey);
  protocolAssert(verifyWorkspaceDocumentSignatures(anchor, (signer) => signer.signerId === input.previousRecovery.publicIdentity.recoveryId ? input.previousRecovery.signing.publicKey : signer.signerId === recovery.publicIdentity.recoveryId ? recovery.signing.publicKey : null), "crypto", "recovery anchor signature verification failed");
  return { anchor, recovery };
}

export function validateWorkspaceRecoveryAnchorChain(input: {
  genesisRecoveryId: string;
  genesisRecoveryPublicKey: Uint8Array;
  anchors: WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload>[];
}): { recoveryId: string; signingPublicKey: Uint8Array; anchorHash: string | null } {
  let recoveryId = input.genesisRecoveryId;
  let publicKey = input.genesisRecoveryPublicKey;
  let anchorHash: string | null = null;
  const anchors = [...input.anchors].sort((a, b) => a.payload.anchorVersion - b.payload.anchorVersion);
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    protocolAssert(anchor.payload.anchorVersion === index + 1 && anchor.payload.previousAnchorHash === anchorHash && anchor.payload.previousRecoveryId === recoveryId, "integrity", "recovery anchor chain is discontinuous");
    const nextKey = decodeBase64Exact(anchor.payload.recovery.signingPublicKey, 32, "next recovery key");
    protocolAssert(verifyWorkspaceDocumentSignatures(anchor, (signer) => signer.signerId === recoveryId ? publicKey : signer.signerId === anchor.payload.recovery.recoveryId ? nextKey : null), "crypto", "recovery anchor signatures are invalid");
    recoveryId = anchor.payload.recovery.recoveryId; publicKey = nextKey; anchorHash = workspaceDocumentHash(anchor);
  }
  return { recoveryId, signingPublicKey: publicKey, anchorHash };
}

/** Stable hash proving recovery changes did not rewrite encrypted content. */
export function workspaceRecoveryContentInvariant(objectRefs: readonly { objectId: string; revisionId: string; payloadHash: string }[]): string {
  return sha256Hex(utf8Encode(canonicalJson([...objectRefs].sort((a, b) => a.objectId.localeCompare(b.objectId)))));
}
