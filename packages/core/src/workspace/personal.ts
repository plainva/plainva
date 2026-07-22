import {
  appendWorkspaceDocumentSignature,
  signWorkspaceDocument,
  WorkspaceCapability,
  WorkspaceGenesisPayload,
  WorkspacePolicyPayload,
  WorkspaceSignedDocument,
  workspaceDocumentHash,
} from "./documents.js";
import {
  createWorkspaceDeviceIdentity,
  createWorkspaceGroupKeyEpoch,
  createWorkspaceId,
  createWorkspaceMemberId,
  createWorkspaceRecoveryIdentity,
  WorkspaceDeviceIdentity,
  WorkspaceDevicePlatform,
  WorkspaceGroupKeyEpoch,
  WorkspaceRecoveryIdentity,
} from "./identity.js";
import { createWorkspaceGrant } from "./grant.js";
import { decodeBase64Exact, toBase64 } from "./encoding.js";

export const PERSONAL_WORKSPACE_OWNER_CAPABILITIES: readonly WorkspaceCapability[] = [
  "comment.create",
  "comment.read",
  "content.create",
  "content.delete",
  "content.read",
  "content.rename",
  "content.write",
  "devices.approve",
  "groups.manage",
  "history.read",
  "keys.rotate",
  "members.invite",
  "members.revoke",
  "recovery.manage",
  "slices.manage",
  "workspace.manage",
];

export interface PersonalWorkspaceBootstrap {
  workspaceId: string;
  ownerMemberId: string;
  ownerGroup: WorkspaceGroupKeyEpoch;
  device: WorkspaceDeviceIdentity;
  recovery: WorkspaceRecoveryIdentity;
  policy: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;
  genesis: WorkspaceSignedDocument<"genesis", WorkspaceGenesisPayload>;
  grants: WorkspaceSignedDocument<"grant">[];
}

/** Secrets retained by an ordinary device after the recovery package is saved. */
export interface PersonalWorkspaceRuntime {
  workspaceId: string;
  /** Logical member represented by this device. */
  memberId: string;
  /** Active workspace owner member, retained for recovery operations and transferable in P8. */
  ownerMemberId: string;
  ownerGroup: WorkspaceGroupKeyEpoch;
  /** Every group epoch this device can currently decrypt. */
  groupKeys: WorkspaceGroupKeyEpoch[];
  device: WorkspaceDeviceIdentity;
  policy: PersonalWorkspaceBootstrap["policy"];
  genesis: PersonalWorkspaceBootstrap["genesis"];
  grants: PersonalWorkspaceBootstrap["grants"];
}

export interface CreatePersonalWorkspaceOptions {
  ownerDisplayName: string;
  deviceDisplayName: string;
  platform: WorkspaceDevicePlatform;
  minimumClientVersion: string;
  now?: string;
  workspaceId?: string;
  ownerMemberId?: string;
  ownerGroupId?: string;
  assignmentId?: string;
  device?: WorkspaceDeviceIdentity;
  recovery?: WorkspaceRecoveryIdentity;
  ownerGroup?: WorkspaceGroupKeyEpoch;
  /** Provisioning seam used by the P3 multi-device contract tests and P4 pairing. */
  additionalDevices?: WorkspaceDeviceIdentity[];
}

function signer(kind: "device" | "recovery", signerId: string) {
  return { algorithm: "Ed25519" as const, signerId, signerKind: kind };
}

/**
 * Creates the complete immutable bootstrap for a one-member encrypted workspace.
 * The content format is already the team-capable format: P4/P5 only add devices,
 * members and assignments; no content re-encryption format transition is needed.
 */
export async function createPersonalWorkspaceBootstrap(
  input: CreatePersonalWorkspaceOptions
): Promise<PersonalWorkspaceBootstrap> {
  const now = input.now ?? new Date().toISOString();
  const workspaceId = input.workspaceId ?? createWorkspaceId();
  const ownerMemberId = input.ownerMemberId ?? createWorkspaceMemberId();
  const device = input.device ?? await createWorkspaceDeviceIdentity({
    memberId: ownerMemberId,
    displayName: input.deviceDisplayName,
    platform: input.platform,
  });
  const recovery = input.recovery ?? createWorkspaceRecoveryIdentity();
  const ownerGroup = input.ownerGroup ?? await createWorkspaceGroupKeyEpoch({
    groupId: input.ownerGroupId ?? createWorkspaceMemberId(),
    keyEpoch: 1,
  });
  const devices = [device, ...(input.additionalDevices ?? [])]
    .map((entry) => entry.publicIdentity)
    .sort((left, right) => left.deviceId.localeCompare(right.deviceId));

  const policyPayload: WorkspacePolicyPayload = {
    policyVersion: 1,
    previousPolicyHash: null,
    minimumClientVersion: input.minimumClientVersion,
    algorithmSuites: [1],
    members: [{ memberId: ownerMemberId, displayName: input.ownerDisplayName, state: "active" }],
    devices: devices.map((entry) => ({
      ...entry,
      state: "active" as const,
      addedAt: now,
      revokedAt: null,
    })),
    groups: [{
      groupId: ownerGroup.groupId,
      name: "Personal workspace",
      memberIds: [ownerMemberId],
      keyEpoch: ownerGroup.keyEpoch,
      hpkePublicKey: toBase64(ownerGroup.hpke.publicKey),
    }],
    assignments: [{
      assignmentId: input.assignmentId ?? createWorkspaceMemberId(),
      subjectKind: "member",
      subjectId: ownerMemberId,
      role: "Owner",
      capabilities: [...PERSONAL_WORKSPACE_OWNER_CAPABILITIES],
      scopeKind: "workspace",
      scopeId: null,
    }],
    slices: [],
    objectOverrides: [],
    revocations: [],
  };
  const policyUnsigned = {
    kind: "policy" as const,
    protocolVersion: 1 as const,
    workspaceId,
    payload: policyPayload,
  };
  const deviceSignedPolicy = signWorkspaceDocument(
    policyUnsigned,
    signer("device", device.publicIdentity.deviceId),
    device.secrets.signing.privateKey
  );
  const policy = appendWorkspaceDocumentSignature(
    deviceSignedPolicy,
    signer("recovery", recovery.publicIdentity.recoveryId),
    recovery.signing.privateKey
  );

  const genesisUnsigned = {
    kind: "genesis" as const,
    protocolVersion: 1 as const,
    workspaceId,
    payload: {
      createdAt: now,
      minimumClientVersion: input.minimumClientVersion,
      algorithmSuites: [1],
      initialOwnerMember: { memberId: ownerMemberId, displayName: input.ownerDisplayName },
      initialOwnerDevice: device.publicIdentity,
      recovery: recovery.publicIdentity,
      initialPolicyHash: workspaceDocumentHash(policy),
    },
  };
  const deviceSignedGenesis = signWorkspaceDocument(
    genesisUnsigned,
    signer("device", device.publicIdentity.deviceId),
    device.secrets.signing.privateKey
  );
  const genesis = appendWorkspaceDocumentSignature(
    deviceSignedGenesis,
    signer("recovery", recovery.publicIdentity.recoveryId),
    recovery.signing.privateKey
  );

  const policyHash = workspaceDocumentHash(policy);
  const grants: WorkspaceSignedDocument<"grant">[] = [];
  for (const recipient of [device, ...(input.additionalDevices ?? [])]) {
    const recipientPublicKey = decodeBase64Exact(recipient.publicIdentity.hpkePublicKey, 32, "device.hpkePublicKey");
    grants.push(await createWorkspaceGrant({
      workspaceId,
      recipientDeviceId: recipient.publicIdentity.deviceId,
      recipientPublicKey,
      issuerDeviceId: device.publicIdentity.deviceId,
      issuerPrivateSigningKey: device.secrets.signing.privateKey,
      policyHash,
      purpose: "group-hpke-private-key",
      groupId: ownerGroup.groupId,
      keyEpoch: ownerGroup.keyEpoch,
      key: ownerGroup.hpke.privateKey,
      createdAt: now,
    }));
    grants.push(await createWorkspaceGrant({
      workspaceId,
      recipientDeviceId: recipient.publicIdentity.deviceId,
      recipientPublicKey,
      issuerDeviceId: device.publicIdentity.deviceId,
      issuerPrivateSigningKey: device.secrets.signing.privateKey,
      policyHash,
      purpose: "group-catalog-key",
      groupId: ownerGroup.groupId,
      keyEpoch: ownerGroup.keyEpoch,
      key: ownerGroup.catalogKey,
      createdAt: now,
    }));
  }
  grants.sort((left, right) => workspaceDocumentHash(left).localeCompare(workspaceDocumentHash(right)));

  return { workspaceId, ownerMemberId, ownerGroup, device, recovery, policy, genesis, grants };
}

export function personalWorkspaceRuntime(bootstrap: PersonalWorkspaceBootstrap): PersonalWorkspaceRuntime {
  return {
    workspaceId: bootstrap.workspaceId,
    memberId: bootstrap.ownerMemberId,
    ownerMemberId: bootstrap.ownerMemberId,
    ownerGroup: bootstrap.ownerGroup,
    groupKeys: [bootstrap.ownerGroup],
    device: bootstrap.device,
    policy: bootstrap.policy,
    genesis: bootstrap.genesis,
    grants: bootstrap.grants,
  };
}
