import type { PersonalWorkspaceRuntime } from "./personal.js";
import type { WorkspaceDeviceIdentity, WorkspaceGroupKeyEpoch } from "./identity.js";
import { encodeWorkspaceDocument, parseWorkspaceDocument } from "./documents.js";
import { fromBase64, toBase64 } from "./encoding.js";
import { protocolAssert } from "./errors.js";

export interface SerializedWorkspaceGroupKey {
  groupId: string;
  keyEpoch: number;
  hpkePublicKey: string;
  hpkePrivateKey: string;
  catalogKey: string;
}

export interface SerializedPersonalWorkspaceRuntime {
  version: 2;
  workspaceId: string;
  memberId: string;
  ownerMemberId: string;
  device: {
    publicIdentity: WorkspaceDeviceIdentity["publicIdentity"];
    signingPublicKey: string;
    signingPrivateKey: string;
    hpkePublicKey: string;
    hpkePrivateKey: string;
  };
  groupKeys: SerializedWorkspaceGroupKey[];
  genesis: string;
  policy: string;
  grants: string[];
}

function serializeGroup(group: WorkspaceGroupKeyEpoch): SerializedWorkspaceGroupKey {
  return {
    groupId: group.groupId,
    keyEpoch: group.keyEpoch,
    hpkePublicKey: toBase64(group.hpke.publicKey),
    hpkePrivateKey: toBase64(group.hpke.privateKey),
    catalogKey: toBase64(group.catalogKey),
  };
}

function deserializeGroup(group: SerializedWorkspaceGroupKey): WorkspaceGroupKeyEpoch {
  return {
    groupId: group.groupId,
    keyEpoch: group.keyEpoch,
    hpke: { publicKey: fromBase64(group.hpkePublicKey), privateKey: fromBase64(group.hpkePrivateKey) },
    catalogKey: fromBase64(group.catalogKey),
  };
}

export function serializePersonalWorkspaceRuntime(runtime: PersonalWorkspaceRuntime): SerializedPersonalWorkspaceRuntime {
  const groupKeys = [...runtime.groupKeys]
    .sort((left, right) => `${left.groupId}:${left.keyEpoch}`.localeCompare(`${right.groupId}:${right.keyEpoch}`));
  return {
    version: 2,
    workspaceId: runtime.workspaceId,
    memberId: runtime.memberId,
    ownerMemberId: runtime.ownerMemberId,
    device: {
      publicIdentity: runtime.device.publicIdentity,
      signingPublicKey: toBase64(runtime.device.secrets.signing.publicKey),
      signingPrivateKey: toBase64(runtime.device.secrets.signing.privateKey),
      hpkePublicKey: toBase64(runtime.device.secrets.hpke.publicKey),
      hpkePrivateKey: toBase64(runtime.device.secrets.hpke.privateKey),
    },
    groupKeys: groupKeys.map(serializeGroup),
    genesis: toBase64(encodeWorkspaceDocument(runtime.genesis)),
    policy: toBase64(encodeWorkspaceDocument(runtime.policy)),
    grants: runtime.grants.map((grant) => toBase64(encodeWorkspaceDocument(grant))),
  };
}

export function deserializePersonalWorkspaceRuntime(value: SerializedPersonalWorkspaceRuntime): PersonalWorkspaceRuntime {
  protocolAssert(value?.version === 2, "unsupported", "unsupported encrypted-workspace key bundle");
  const device: WorkspaceDeviceIdentity = {
    publicIdentity: value.device.publicIdentity,
    secrets: {
      signing: { publicKey: fromBase64(value.device.signingPublicKey), privateKey: fromBase64(value.device.signingPrivateKey) },
      hpke: { publicKey: fromBase64(value.device.hpkePublicKey), privateKey: fromBase64(value.device.hpkePrivateKey) },
    },
  };
  const groupKeys = value.groupKeys.map(deserializeGroup);
  protocolAssert(groupKeys.length >= 1, "integrity", "workspace runtime has no readable group key");
  const genesis = parseWorkspaceDocument(fromBase64(value.genesis));
  const policy = parseWorkspaceDocument(fromBase64(value.policy));
  protocolAssert(genesis.kind === "genesis" && policy.kind === "policy", "integrity", "workspace key bundle has invalid control documents");
  return {
    workspaceId: value.workspaceId,
    memberId: value.memberId,
    ownerMemberId: value.ownerMemberId,
    device,
    ownerGroup: groupKeys[0],
    groupKeys,
    genesis: genesis as PersonalWorkspaceRuntime["genesis"],
    policy: policy as PersonalWorkspaceRuntime["policy"],
    grants: value.grants.map((grant) => {
      const parsed = parseWorkspaceDocument(fromBase64(grant));
      protocolAssert(parsed.kind === "grant", "integrity", "workspace key bundle has an invalid grant");
      return parsed as PersonalWorkspaceRuntime["grants"][number];
    }),
  };
}
