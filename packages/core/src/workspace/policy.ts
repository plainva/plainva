import {
  signWorkspaceDocument,
  verifyWorkspaceDocumentSignatures,
  workspaceDocumentHash,
  type WorkspaceDocumentSigner,
  type WorkspacePolicyPayload,
  type WorkspaceSignedDocument,
} from "./documents.js";
import { evaluateWorkspaceAccess, WORKSPACE_ROLE_CAPABILITIES, type WorkspaceRole } from "./authorization.js";
import { createWorkspaceMemberId } from "./identity.js";
import { decodeBase64Exact } from "./encoding.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";

export interface WorkspacePolicySignerInput {
  signer: WorkspaceDocumentSigner;
  privateKey: Uint8Array;
}

export interface WorkspacePolicyChainResult {
  current: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;
  ordered: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>[];
  ignoredHashes: string[];
}

export class WorkspacePolicyConflictError extends WorkspaceProtocolError {
  readonly policyHashes: string[];
  constructor(hashes: string[]) {
    super("conflict", "workspace policy has concurrent valid successors");
    this.policyHashes = [...hashes].sort();
  }
}

function clonePolicy(payload: WorkspacePolicyPayload): WorkspacePolicyPayload {
  return structuredClone(payload);
}

export function normalizeWorkspacePolicy(payload: WorkspacePolicyPayload): WorkspacePolicyPayload {
  const normalized = clonePolicy(payload);
  normalized.members.sort((a, b) => a.memberId.localeCompare(b.memberId));
  normalized.devices.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  normalized.groups = normalized.groups.map((group) => ({ ...group, memberIds: [...new Set(group.memberIds ?? [])].sort() }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId));
  normalized.assignments = normalized.assignments.map((assignment) => ({
    ...assignment,
    capabilities: [...new Set(assignment.capabilities)].sort(),
  })).sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
  normalized.slices = normalized.slices.map((slice) => ({
    ...slice,
    materializedObjectIds: [...new Set(slice.materializedObjectIds)].sort(),
  })).sort((a, b) => a.sliceId.localeCompare(b.sliceId));
  normalized.objectOverrides = normalized.objectOverrides.map((override) => ({
    ...override,
    capabilities: [...new Set(override.capabilities)].sort(),
  })).sort((a, b) => `${a.objectId}:${a.subjectKind}:${a.subjectId}`.localeCompare(`${b.objectId}:${b.subjectKind}:${b.subjectId}`));
  normalized.revocations.sort((a, b) => `${a.subjectKind}:${a.subjectId}`.localeCompare(`${b.subjectKind}:${b.subjectId}`));
  return normalized;
}

export function assertWorkspacePolicyReferences(payload: WorkspacePolicyPayload): void {
  const members = new Set(payload.members.map((entry) => entry.memberId));
  const devices = new Set(payload.devices.map((entry) => entry.deviceId));
  const groups = new Set(payload.groups.map((entry) => entry.groupId));
  const slices = new Set(payload.slices.map((entry) => entry.sliceId));
  for (const device of payload.devices) protocolAssert(members.has(device.memberId), "integrity", "policy device references an unknown member");
  for (const group of payload.groups) {
    for (const memberId of group.memberIds ?? []) protocolAssert(members.has(memberId), "integrity", "policy group references an unknown member");
  }
  for (const assignment of payload.assignments) {
    protocolAssert(assignment.subjectKind === "member" ? members.has(assignment.subjectId) : groups.has(assignment.subjectId), "integrity", "policy assignment references an unknown subject");
    if (assignment.scopeKind === "slice") protocolAssert(!!assignment.scopeId && slices.has(assignment.scopeId), "integrity", "policy assignment references an unknown slice");
  }
  for (const revocation of payload.revocations) {
    protocolAssert(revocation.subjectKind === "member" ? members.has(revocation.subjectId) : devices.has(revocation.subjectId), "integrity", "policy revocation references an unknown subject");
  }
}

function policySignerAuthorized(
  previous: WorkspacePolicyPayload,
  signer: WorkspaceDocumentSigner,
  recoveryPublicKeys: ReadonlyMap<string, Uint8Array>,
): Uint8Array | null {
  if (signer.signerKind === "recovery") return recoveryPublicKeys.get(signer.signerId) ?? null;
  const device = previous.devices.find((entry) => entry.deviceId === signer.signerId && entry.state === "active");
  if (!device) return null;
  const permitted = evaluateWorkspaceAccess(previous, {
    memberId: device.memberId,
    deviceId: device.deviceId,
    capability: "workspace.manage",
  }).allowed;
  return permitted ? decodeBase64Exact(device.signingPublicKey, 32, "policy signing key") : null;
}

export function validateWorkspacePolicySuccessor(input: {
  previous: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;
  successor: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;
  recoveryPublicKeys?: ReadonlyMap<string, Uint8Array>;
}): void {
  const { previous, successor } = input;
  protocolAssert(previous.workspaceId === successor.workspaceId, "integrity", "policy successor belongs to another workspace");
  protocolAssert(successor.payload.policyVersion === previous.payload.policyVersion + 1, "rollback", "policy version is not the immediate successor");
  protocolAssert(successor.payload.previousPolicyHash === workspaceDocumentHash(previous), "integrity", "policy predecessor hash mismatch");
  assertWorkspacePolicyReferences(successor.payload);
  const recoveryKeys = input.recoveryPublicKeys ?? new Map<string, Uint8Array>();
  protocolAssert(verifyWorkspaceDocumentSignatures(successor, (signer) => policySignerAuthorized(previous.payload, signer, recoveryKeys)), "authorization", "policy successor has no authorized signature");

  for (const member of previous.payload.members.filter((entry) => entry.state === "revoked")) {
    protocolAssert(successor.payload.members.find((entry) => entry.memberId === member.memberId)?.state === "revoked", "authorization", "policy revived a revoked member");
  }
  for (const device of previous.payload.devices.filter((entry) => entry.state === "revoked")) {
    protocolAssert(successor.payload.devices.find((entry) => entry.deviceId === device.deviceId)?.state === "revoked", "authorization", "policy revived a revoked device");
  }
}

export function createWorkspacePolicySuccessor(input: {
  current: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;
  mutate: (draft: WorkspacePolicyPayload) => void;
  signer: WorkspacePolicySignerInput;
  recoveryPublicKeys?: ReadonlyMap<string, Uint8Array>;
}): WorkspaceSignedDocument<"policy", WorkspacePolicyPayload> {
  const draft = clonePolicy(input.current.payload);
  input.mutate(draft);
  draft.policyVersion = input.current.payload.policyVersion + 1;
  draft.previousPolicyHash = workspaceDocumentHash(input.current);
  const payload = normalizeWorkspacePolicy(draft);
  assertWorkspacePolicyReferences(payload);
  const document = signWorkspaceDocument(
    { kind: "policy", protocolVersion: 1, workspaceId: input.current.workspaceId, payload },
    input.signer.signer,
    input.signer.privateKey,
  );
  validateWorkspacePolicySuccessor({ previous: input.current, successor: document, recoveryPublicKeys: input.recoveryPublicKeys });
  return document;
}

export function resolveWorkspacePolicyChain(input: {
  initial: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;
  candidates: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>[];
  recoveryPublicKeys?: ReadonlyMap<string, Uint8Array>;
}): WorkspacePolicyChainResult {
  const ordered = [input.initial];
  const used = new Set([workspaceDocumentHash(input.initial)]);
  let current = input.initial;
  while (true) {
    const successors = input.candidates.filter((candidate) =>
      !used.has(workspaceDocumentHash(candidate)) && candidate.payload.previousPolicyHash === workspaceDocumentHash(current)
    );
    const valid: typeof successors = [];
    for (const successor of successors) {
      try {
        validateWorkspacePolicySuccessor({ previous: current, successor, recoveryPublicKeys: input.recoveryPublicKeys });
        valid.push(successor);
      } catch {
        // Invalid branches are returned as ignored and can be quarantined by the worker.
      }
    }
    if (valid.length > 1) throw new WorkspacePolicyConflictError(valid.map(workspaceDocumentHash));
    if (valid.length === 0) break;
    current = valid[0];
    used.add(workspaceDocumentHash(current));
    ordered.push(current);
  }
  return {
    current,
    ordered,
    ignoredHashes: input.candidates.map(workspaceDocumentHash).filter((hash) => !used.has(hash)).sort(),
  };
}

export function addWorkspaceMemberToPolicy(draft: WorkspacePolicyPayload, input: {
  displayName: string;
  role: WorkspaceRole;
  memberId?: string;
  scopeKind?: "workspace" | "slice" | "object";
  scopeId?: string | null;
}): string {
  const memberId = input.memberId ?? createWorkspaceMemberId();
  draft.members.push({ memberId, displayName: input.displayName, state: "active" });
  draft.assignments.push({
    assignmentId: createWorkspaceMemberId(),
    subjectKind: "member",
    subjectId: memberId,
    role: input.role,
    capabilities: [...WORKSPACE_ROLE_CAPABILITIES[input.role]],
    scopeKind: input.scopeKind ?? "workspace",
    scopeId: input.scopeKind && input.scopeKind !== "workspace" ? input.scopeId ?? null : null,
  });
  return memberId;
}

export function revokeWorkspaceDeviceInPolicy(draft: WorkspacePolicyPayload, deviceId: string, reason: string, now: string): void {
  const device = draft.devices.find((entry) => entry.deviceId === deviceId);
  protocolAssert(!!device && device.state === "active", "conflict", "device is not active");
  device.state = "revoked";
  device.revokedAt = now;
  if (!draft.revocations.some((entry) => entry.subjectKind === "device" && entry.subjectId === deviceId)) {
    draft.revocations.push({ subjectKind: "device", subjectId: deviceId, revokedAt: now, reason });
  }
}
