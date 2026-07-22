import type { WorkspaceObjectStore } from "./objectStore.js";
import { encodeWorkspaceDocument, workspaceDocumentHash, type WorkspacePolicyPayload, type WorkspaceSignedDocument } from "./documents.js";
import { createWorkspaceGrant, type WorkspaceGrantPayload } from "./grant.js";
import { createWorkspaceGroupKeyEpoch, createWorkspaceMemberId, type WorkspaceGroupKeyEpoch } from "./identity.js";
import { addWorkspaceMemberToPolicy, createWorkspacePolicySuccessor, revokeWorkspaceDeviceInPolicy } from "./policy.js";
import { WORKSPACE_ROLE_CAPABILITIES, type WorkspaceRole } from "./authorization.js";
import { decodeBase64Exact, sha256Hex, toBase64 } from "./encoding.js";
import { protocolAssert } from "./errors.js";
import type { PersonalWorkspaceRuntime } from "./personal.js";
import { createWorkspaceSliceDefinition, type WorkspaceDynamicSliceDefinition } from "./slices.js";

export interface WorkspaceGovernanceUpdate {
  policy: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;
  grants: WorkspaceSignedDocument<"grant", WorkspaceGrantPayload>[];
  groupKeys: WorkspaceGroupKeyEpoch[];
}

function runtimeSigner(runtime: PersonalWorkspaceRuntime) {
  return { signer: { algorithm: "Ed25519" as const, signerId: runtime.device.publicIdentity.deviceId, signerKind: "device" as const }, privateKey: runtime.device.secrets.signing.privateKey };
}

export async function inviteWorkspaceMember(input: {
  runtime: PersonalWorkspaceRuntime;
  displayName: string;
  role: WorkspaceRole;
  scopeKind?: "workspace" | "slice" | "object";
  scopeId?: string | null;
}): Promise<WorkspaceGovernanceUpdate & { memberId: string }> {
  const memberId = createWorkspaceMemberId();
  const groupKey = await createWorkspaceGroupKeyEpoch({ groupId: createWorkspaceMemberId(), keyEpoch: 1 });
  const policy = createWorkspacePolicySuccessor({ current: input.runtime.policy, signer: runtimeSigner(input.runtime), mutate: (draft) => {
    addWorkspaceMemberToPolicy(draft, { memberId, displayName: input.displayName, role: input.role, scopeKind: input.scopeKind, scopeId: input.scopeId });
    const assignment = draft.assignments.find((entry) => entry.subjectKind === "member" && entry.subjectId === memberId)!;
    assignment.subjectKind = "group";
    assignment.subjectId = groupKey.groupId;
    draft.groups.push({ groupId: groupKey.groupId, name: `${input.displayName} personal`, memberIds: [memberId], keyEpoch: groupKey.keyEpoch, hpkePublicKey: toBase64(groupKey.hpke.publicKey) });
  } });
  return { memberId, policy, grants: [], groupKeys: [...input.runtime.groupKeys, groupKey] };
}

export async function createWorkspaceGroup(input: {
  runtime: PersonalWorkspaceRuntime;
  name: string;
  memberIds: string[];
  role?: WorkspaceRole;
  scopeKind?: "workspace" | "slice" | "object";
  scopeId?: string | null;
}): Promise<WorkspaceGovernanceUpdate & { groupId: string }> {
  const groupId = createWorkspaceMemberId();
  const groupKey = await createWorkspaceGroupKeyEpoch({ groupId, keyEpoch: 1 });
  const assignmentId = createWorkspaceMemberId();
  const role = input.role ?? "Reader";
  const policy = createWorkspacePolicySuccessor({ current: input.runtime.policy, signer: runtimeSigner(input.runtime), mutate: (draft) => {
    for (const memberId of input.memberIds) protocolAssert(draft.members.some((member) => member.memberId === memberId && member.state === "active"), "integrity", "group references an inactive member");
    draft.groups.push({ groupId, name: input.name, memberIds: [...new Set(input.memberIds)].sort(), keyEpoch: 1, hpkePublicKey: toBase64(groupKey.hpke.publicKey) });
    draft.assignments.push({ assignmentId, subjectKind: "group", subjectId: groupId, role, capabilities: [...WORKSPACE_ROLE_CAPABILITIES[role]], scopeKind: input.scopeKind ?? "workspace", scopeId: input.scopeKind && input.scopeKind !== "workspace" ? input.scopeId ?? null : null });
  } });
  const grants = await grantsForGroup(input.runtime, policy, groupKey);
  return { groupId, policy, grants, groupKeys: [...input.runtime.groupKeys.filter((key) => key.groupId !== groupId), groupKey] };
}

export function createWorkspaceSlice(input: {
  runtime: PersonalWorkspaceRuntime;
  name: string;
  definition: { kind: "folder"; folder: string } | { kind: "selection"; objectIds: string[] } | { kind: "dynamic"; definition: WorkspaceDynamicSliceDefinition };
  materializedObjectIds: string[];
}): { sliceId: string; policy: WorkspaceGovernanceUpdate["policy"] } {
  const sliceId = createWorkspaceMemberId();
  const policy = createWorkspacePolicySuccessor({ current: input.runtime.policy, signer: runtimeSigner(input.runtime), mutate: (draft) => {
    draft.slices.push({ sliceId, name: input.name, kind: input.definition.kind, definition: createWorkspaceSliceDefinition(input.definition), materializedObjectIds: [...new Set(input.materializedObjectIds)].sort() });
  } });
  return { sliceId, policy };
}

export function assignWorkspaceRole(input: {
  runtime: PersonalWorkspaceRuntime;
  subjectKind: "member" | "group";
  subjectId: string;
  role: WorkspaceRole;
  scopeKind: "workspace" | "slice" | "object";
  scopeId?: string | null;
}): WorkspaceGovernanceUpdate["policy"] {
  return createWorkspacePolicySuccessor({ current: input.runtime.policy, signer: runtimeSigner(input.runtime), mutate: (draft) => {
    draft.assignments.push({ assignmentId: createWorkspaceMemberId(), subjectKind: input.subjectKind, subjectId: input.subjectId, role: input.role, capabilities: [...WORKSPACE_ROLE_CAPABILITIES[input.role]], scopeKind: input.scopeKind, scopeId: input.scopeKind === "workspace" ? null : input.scopeId ?? null });
  } });
}

export function revokeWorkspaceDevice(input: { runtime: PersonalWorkspaceRuntime; deviceId: string; reason: string; now?: string }): WorkspaceGovernanceUpdate["policy"] {
  return createWorkspacePolicySuccessor({ current: input.runtime.policy, signer: runtimeSigner(input.runtime), mutate: (draft) => revokeWorkspaceDeviceInPolicy(draft, input.deviceId, input.reason, input.now ?? new Date().toISOString()) });
}

/** Revokes one endpoint and rotates every group key the endpoint could know. */
export async function revokeWorkspaceDeviceAndRotate(input: { runtime: PersonalWorkspaceRuntime; deviceId: string; reason: string; now?: string }): Promise<WorkspaceGovernanceUpdate> {
  const now = input.now ?? new Date().toISOString();
  const device = input.runtime.policy.payload.devices.find((entry) => entry.deviceId === input.deviceId && entry.state === "active");
  protocolAssert(!!device, "conflict", "device is not active");
  const affected = input.runtime.policy.payload.groups.filter((group) => group.memberIds?.includes(device.memberId));
  const rotations = await Promise.all(affected.map((group) => createWorkspaceGroupKeyEpoch({ groupId: group.groupId, keyEpoch: group.keyEpoch + 1 })));
  const policy = createWorkspacePolicySuccessor({ current: input.runtime.policy, signer: runtimeSigner(input.runtime), mutate: (draft) => {
    revokeWorkspaceDeviceInPolicy(draft, input.deviceId, input.reason, now);
    for (const rotation of rotations) {
      const group = draft.groups.find((entry) => entry.groupId === rotation.groupId)!;
      group.keyEpoch = rotation.keyEpoch;
      group.hpkePublicKey = toBase64(rotation.hpke.publicKey);
    }
  } });
  const grants = (await Promise.all(rotations.map((group) => grantsForGroup(input.runtime, policy, group)))).flat().sort((a, b) => workspaceDocumentHash(a).localeCompare(workspaceDocumentHash(b)));
  const rotatedIds = new Set(rotations.map((group) => group.groupId));
  return { policy, grants, groupKeys: [...input.runtime.groupKeys.filter((key) => !rotatedIds.has(key.groupId)), ...rotations] };
}

export async function revokeWorkspaceMemberAndRotate(input: { runtime: PersonalWorkspaceRuntime; memberId: string; reason: string; now?: string }): Promise<WorkspaceGovernanceUpdate> {
  const now = input.now ?? new Date().toISOString();
  const affected = input.runtime.policy.payload.groups.filter((group) => group.memberIds?.includes(input.memberId));
  const rotations = await Promise.all(affected.map((group) => createWorkspaceGroupKeyEpoch({ groupId: group.groupId, keyEpoch: group.keyEpoch + 1 })));
  const policy = createWorkspacePolicySuccessor({ current: input.runtime.policy, signer: runtimeSigner(input.runtime), mutate: (draft) => {
    const member = draft.members.find((entry) => entry.memberId === input.memberId);
    protocolAssert(!!member && member.state === "active", "conflict", "member is not active");
    member.state = "revoked";
    if (!draft.revocations.some((entry) => entry.subjectKind === "member" && entry.subjectId === input.memberId)) draft.revocations.push({ subjectKind: "member", subjectId: input.memberId, revokedAt: now, reason: input.reason });
    for (const device of draft.devices.filter((entry) => entry.memberId === input.memberId && entry.state === "active")) revokeWorkspaceDeviceInPolicy(draft, device.deviceId, input.reason, now);
    for (const rotation of rotations) {
      const group = draft.groups.find((entry) => entry.groupId === rotation.groupId)!;
      group.memberIds = (group.memberIds ?? []).filter((memberId) => memberId !== input.memberId);
      group.keyEpoch = rotation.keyEpoch;
      group.hpkePublicKey = toBase64(rotation.hpke.publicKey);
    }
  } });
  const grants = (await Promise.all(rotations.map((group) => grantsForGroup(input.runtime, policy, group)))).flat().sort((a, b) => workspaceDocumentHash(a).localeCompare(workspaceDocumentHash(b)));
  const rotatedIds = new Set(rotations.map((group) => group.groupId));
  return { policy, grants, groupKeys: [...input.runtime.groupKeys.filter((key) => !rotatedIds.has(key.groupId)), ...rotations] };
}

async function grantsForGroup(runtime: PersonalWorkspaceRuntime, policy: WorkspaceGovernanceUpdate["policy"], group: WorkspaceGroupKeyEpoch): Promise<WorkspaceSignedDocument<"grant", WorkspaceGrantPayload>[]> {
  const policyGroup = policy.payload.groups.find((entry) => entry.groupId === group.groupId);
  protocolAssert(!!policyGroup, "integrity", "group is missing from policy");
  const policyHash = workspaceDocumentHash(policy);
  const devices = policy.payload.devices.filter((device) => device.state === "active" && policyGroup.memberIds?.includes(device.memberId));
  const grants: WorkspaceSignedDocument<"grant", WorkspaceGrantPayload>[] = [];
  for (const device of devices) for (const purpose of ["group-hpke-private-key", "group-catalog-key"] as const) grants.push(await createWorkspaceGrant({
    workspaceId: runtime.workspaceId, recipientDeviceId: device.deviceId, recipientPublicKey: decodeBase64Exact(device.hpkePublicKey, 32, "recipient HPKE key"), issuerDeviceId: runtime.device.publicIdentity.deviceId, issuerPrivateSigningKey: runtime.device.secrets.signing.privateKey,
    policyHash, purpose, groupId: group.groupId, keyEpoch: group.keyEpoch, key: purpose === "group-hpke-private-key" ? group.hpke.privateKey : group.catalogKey, createdAt: new Date().toISOString(),
  }));
  return grants.sort((a, b) => workspaceDocumentHash(a).localeCompare(workspaceDocumentHash(b)));
}

export async function publishWorkspaceGovernanceUpdate(store: WorkspaceObjectStore, update: Pick<WorkspaceGovernanceUpdate, "policy" | "grants">, signal?: AbortSignal): Promise<void> {
  const policyBytes = encodeWorkspaceDocument(update.policy); const policyHash = workspaceDocumentHash(update.policy);
  await store.putImmutable(`.pvws/policies/${policyHash}.pvpol`, policyBytes, policyHash, { signal });
  for (const grant of update.grants) {
    const bytes = encodeWorkspaceDocument(grant); const hash = sha256Hex(bytes);
    await store.putImmutable(`.pvws/grants/${grant.payload.recipientDeviceId}/${hash}.pvgrant`, bytes, hash, { signal });
  }
}

export function applyWorkspaceGovernanceUpdate(runtime: PersonalWorkspaceRuntime, update: WorkspaceGovernanceUpdate): void {
  runtime.policy = update.policy;
  runtime.grants = [...runtime.grants, ...update.grants];
  runtime.groupKeys = update.groupKeys;
  runtime.ownerGroup = runtime.groupKeys.find((key) => key.groupId === runtime.ownerGroup.groupId) ?? runtime.groupKeys[0];
}
