import { canonicalJson } from "../settingsSync/canonicalJson.js";
import { concatBytes } from "../crypto/cryptoPrimitives.js";
import {
  DOCUMENT_MAX_BYTES,
  HPKE_ENCAPSULATED_KEY_BYTES,
  HPKE_WRAPPED_KEY_BYTES,
  MAX_CATALOG_BODY_BYTES,
  WORKSPACE_ALGORITHM_SUITE,
  WORKSPACE_PROTOCOL_VERSION,
  WORKSPACE_SIGNATURE_BYTES,
  WorkspaceDocumentKind,
} from "./constants.js";
import {
  asArray,
  asRecord,
  assertExactKeys,
  assertSafeInteger,
  assertWorkspaceHash,
  assertWorkspaceId,
  decodeBase64Exact,
  hasControlCharacters,
  hasUnpairedSurrogate,
  sha256Hex,
  toBase64,
  utf8DecodeFatal,
  utf8Encode,
} from "./encoding.js";
import { signWorkspaceBytes, verifyWorkspaceSignature } from "./crypto.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";

export type WorkspaceSignerKind = "device" | "recovery";

export interface WorkspaceDocumentSigner {
  algorithm: "Ed25519";
  signerId: string;
  signerKind: WorkspaceSignerKind;
}

export interface WorkspaceDocumentSignature extends WorkspaceDocumentSigner {
  value: string;
}

export interface WorkspaceUnsignedDocument<K extends WorkspaceDocumentKind = WorkspaceDocumentKind, P = unknown> {
  kind: K;
  protocolVersion: typeof WORKSPACE_PROTOCOL_VERSION;
  workspaceId: string;
  payload: P;
}

export interface WorkspaceSignedDocument<K extends WorkspaceDocumentKind = WorkspaceDocumentKind, P = unknown>
  extends WorkspaceUnsignedDocument<K, P> {
  signatures: WorkspaceDocumentSignature[];
}

export interface WorkspaceGenesisPayload {
  createdAt: string;
  minimumClientVersion: string;
  algorithmSuites: number[];
  initialOwnerMember: { memberId: string; displayName: string };
  initialOwnerDevice: {
    deviceId: string;
    memberId: string;
    displayName: string;
    platform: "desktop" | "android" | "ios";
    signingPublicKey: string;
    hpkePublicKey: string;
  };
  recovery: { recoveryId: string; signingPublicKey: string };
  initialPolicyHash: string;
}

export interface WorkspaceRecoveryAnchorPayload {
  anchorVersion: number;
  previousAnchorHash: string | null;
  previousRecoveryId: string;
  recovery: { recoveryId: string; signingPublicKey: string };
  createdAt: string;
}

export type WorkspaceCapability =
  | "workspace.manage"
  | "members.invite"
  | "members.revoke"
  | "devices.approve"
  | "groups.manage"
  | "slices.manage"
  | "content.read"
  | "content.create"
  | "content.write"
  | "content.rename"
  | "content.delete"
  | "comment.read"
  | "comment.create"
  | "history.read"
  | "keys.rotate"
  | "recovery.manage";

export interface WorkspacePolicyMember {
  memberId: string;
  displayName: string;
  state: "active" | "revoked";
}

export interface WorkspacePolicyDevice {
  deviceId: string;
  memberId: string;
  displayName: string;
  platform: "desktop" | "android" | "ios";
  signingPublicKey: string;
  hpkePublicKey: string;
  state: "active" | "revoked";
  addedAt: string;
  revokedAt: string | null;
}

export interface WorkspacePolicyGroup {
  groupId: string;
  name: string;
  /** Explicit group roster (required for newly emitted policies). */
  memberIds?: string[];
  keyEpoch: number;
  hpkePublicKey: string;
}

export interface WorkspacePolicyAssignment {
  assignmentId: string;
  subjectKind: "member" | "group";
  subjectId: string;
  role: string;
  capabilities: WorkspaceCapability[];
  scopeKind: "workspace" | "slice" | "object";
  scopeId: string | null;
}

export interface WorkspacePolicySlice {
  sliceId: string;
  name: string;
  kind: "folder" | "selection" | "dynamic";
  definition: string;
  materializedObjectIds: string[];
}

export interface WorkspacePolicyObjectOverride {
  objectId: string;
  subjectKind: "member" | "group";
  subjectId: string;
  capabilities: WorkspaceCapability[];
}

export interface WorkspacePolicyRevocation {
  subjectKind: "member" | "device";
  subjectId: string;
  revokedAt: string;
  reason: string;
}

export interface WorkspacePolicyPayload {
  policyVersion: number;
  previousPolicyHash: string | null;
  minimumClientVersion: string;
  algorithmSuites: number[];
  members: WorkspacePolicyMember[];
  devices: WorkspacePolicyDevice[];
  groups: WorkspacePolicyGroup[];
  assignments: WorkspacePolicyAssignment[];
  slices: WorkspacePolicySlice[];
  objectOverrides: WorkspacePolicyObjectOverride[];
  revocations: WorkspacePolicyRevocation[];
}

export type WorkspaceOperationName = "create" | "write" | "rename" | "delete" | "mkdir" | "comment" | "resolve";

export type WorkspaceOperationCapability = Extract<WorkspaceCapability,
  | "content.create"
  | "content.write"
  | "content.rename"
  | "content.delete"
  | "comment.create">;

export interface WorkspaceOperationPayload {
  operationId: string;
  deviceId: string;
  memberId: string;
  sequence: number;
  previousDeviceOperationHash: string | null;
  policyHash: string;
  capability: WorkspaceOperationCapability;
  operation: WorkspaceOperationName;
  objectId: string;
  revisionId: string | null;
  parentRevisionIds: string[];
  payloadHash: string | null;
  createdAt: string;
}

const SIGNING_PREFIX = utf8Encode("plainva/workspace/document-signature/v1\0");
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CLIENT_VERSION = /^[\x20-\x7e]{1,64}$/;
const CAPABILITIES: ReadonlySet<string> = new Set([
  "workspace.manage",
  "members.invite",
  "members.revoke",
  "devices.approve",
  "groups.manage",
  "slices.manage",
  "content.read",
  "content.create",
  "content.write",
  "content.rename",
  "content.delete",
  "comment.read",
  "comment.create",
  "history.read",
  "keys.rotate",
  "recovery.manage",
]);

function assertTimestamp(value: unknown, label: string, nullable = false): void {
  if (nullable && value === null) return;
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  protocolAssert(typeof value === "string" && TIMESTAMP.test(value) && Number.isFinite(parsed) && new Date(parsed).toISOString() === value, "format", `${label} must be a canonical UTC timestamp`);
}

function assertDisplayName(value: unknown, label: string): void {
  protocolAssert(typeof value === "string" && value === value.normalize("NFC"), "canonical", `${label} must be NFC`);
  const length = utf8Encode(value).length;
  protocolAssert(length >= 1 && length <= 128 && !hasControlCharacters(value), "bounds", `${label} has invalid length or controls`);
}

function assertClientVersion(value: unknown): void {
  protocolAssert(typeof value === "string" && CLIENT_VERSION.test(value), "format", "minimumClientVersion is invalid");
}

function assertAlgorithmSuites(value: unknown): void {
  const suites = asArray(value, 1, "algorithmSuites");
  protocolAssert(suites.length === 1 && suites[0] === WORKSPACE_ALGORITHM_SUITE, "unsupported", "unsupported algorithm suite");
}

function assertString(value: unknown, maxBytes: number, label: string, allowEmpty = false): string {
  protocolAssert(typeof value === "string" && value === value.normalize("NFC"), "canonical", `${label} must be an NFC string`);
  const length = utf8Encode(value).length;
  protocolAssert((allowEmpty || length > 0) && length <= maxBytes, "bounds", `${label} has invalid length`);
  protocolAssert(!hasControlCharacters(value), "format", `${label} contains controls`);
  return value;
}

function assertOptionalHash(value: unknown, label: string): void {
  if (value !== null) {
    protocolAssert(typeof value === "string", "format", `${label} must be a hash or null`);
    assertWorkspaceHash(value, label);
  }
}

function assertSortedUnique<T>(items: T[], key: (item: T) => string, label: string): void {
  let previous: string | undefined;
  for (const item of items) {
    const current = key(item);
    protocolAssert(previous === undefined || previous < current, "canonical", `${label} must be sorted and unique`);
    previous = current;
  }
}

function validateCanonicalValue(value: unknown, depth = 0): void {
  protocolAssert(depth <= 32, "bounds", "JSON nesting is too deep");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    protocolAssert(!hasUnpairedSurrogate(value), "format", "control document contains an unpaired surrogate");
    protocolAssert(value === value.normalize("NFC"), "canonical", "control document string is not NFC");
    return;
  }
  if (typeof value === "number") {
    protocolAssert(Number.isSafeInteger(value), "format", "control documents only allow safe integers");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validateCanonicalValue(item, depth + 1);
    return;
  }
  protocolAssert(typeof value === "object", "format", "unsupported JSON value");
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    protocolAssert(!hasUnpairedSurrogate(key) && key === key.normalize("NFC"), "canonical", "JSON key is not valid NFC");
    validateCanonicalValue(item, depth + 1);
  }
}

function validateGenesis(payload: unknown): asserts payload is WorkspaceGenesisPayload {
  const value = asRecord(payload, "genesis payload");
  assertExactKeys(value, ["createdAt", "minimumClientVersion", "algorithmSuites", "initialOwnerMember", "initialOwnerDevice", "recovery", "initialPolicyHash"], "genesis payload");
  assertTimestamp(value.createdAt, "createdAt");
  assertClientVersion(value.minimumClientVersion);
  assertAlgorithmSuites(value.algorithmSuites);
  assertWorkspaceHash(value.initialPolicyHash as string, "initialPolicyHash");

  const member = asRecord(value.initialOwnerMember, "initialOwnerMember");
  assertExactKeys(member, ["memberId", "displayName"], "initialOwnerMember");
  assertWorkspaceId(member.memberId as string, "initialOwnerMember.memberId");
  assertDisplayName(member.displayName, "initialOwnerMember.displayName");

  const device = asRecord(value.initialOwnerDevice, "initialOwnerDevice");
  assertExactKeys(device, ["deviceId", "memberId", "displayName", "platform", "signingPublicKey", "hpkePublicKey"], "initialOwnerDevice");
  assertWorkspaceId(device.deviceId as string, "initialOwnerDevice.deviceId");
  assertWorkspaceId(device.memberId as string, "initialOwnerDevice.memberId");
  protocolAssert(device.memberId === member.memberId, "integrity", "initial owner device is bound to another member");
  assertDisplayName(device.displayName, "initialOwnerDevice.displayName");
  protocolAssert(device.platform === "desktop" || device.platform === "android" || device.platform === "ios", "format", "invalid device platform");
  decodeBase64Exact(device.signingPublicKey as string, 32, "initialOwnerDevice.signingPublicKey");
  decodeBase64Exact(device.hpkePublicKey as string, 32, "initialOwnerDevice.hpkePublicKey");

  const recovery = asRecord(value.recovery, "recovery");
  assertExactKeys(recovery, ["recoveryId", "signingPublicKey"], "recovery");
  assertWorkspaceId(recovery.recoveryId as string, "recovery.recoveryId");
  decodeBase64Exact(recovery.signingPublicKey as string, 32, "recovery.signingPublicKey");
}

function validatePolicy(payload: unknown): asserts payload is WorkspacePolicyPayload {
  const value = asRecord(payload, "policy payload");
  assertExactKeys(value, ["policyVersion", "previousPolicyHash", "minimumClientVersion", "algorithmSuites", "members", "devices", "groups", "assignments", "slices", "objectOverrides", "revocations"], "policy payload");
  assertSafeInteger(value.policyVersion, 1, Number.MAX_SAFE_INTEGER, "policyVersion");
  assertOptionalHash(value.previousPolicyHash, "previousPolicyHash");
  assertClientVersion(value.minimumClientVersion);
  assertAlgorithmSuites(value.algorithmSuites);

  const members = asArray(value.members, 10_000, "members").map((entry) => asRecord(entry, "member"));
  for (const member of members) {
    assertExactKeys(member, ["memberId", "displayName", "state"], "member");
    assertWorkspaceId(member.memberId as string, "member.memberId");
    assertDisplayName(member.displayName, "member.displayName");
    protocolAssert(member.state === "active" || member.state === "revoked", "format", "invalid member state");
  }
  assertSortedUnique(members, (member) => member.memberId as string, "members");

  const devices = asArray(value.devices, 50_000, "devices").map((entry) => asRecord(entry, "device"));
  for (const device of devices) {
    assertExactKeys(device, ["deviceId", "memberId", "displayName", "platform", "signingPublicKey", "hpkePublicKey", "state", "addedAt", "revokedAt"], "device");
    assertWorkspaceId(device.deviceId as string, "device.deviceId");
    assertWorkspaceId(device.memberId as string, "device.memberId");
    assertDisplayName(device.displayName, "device.displayName");
    protocolAssert(device.platform === "desktop" || device.platform === "android" || device.platform === "ios", "format", "invalid device platform");
    decodeBase64Exact(device.signingPublicKey as string, 32, "device.signingPublicKey");
    decodeBase64Exact(device.hpkePublicKey as string, 32, "device.hpkePublicKey");
    protocolAssert(device.state === "active" || device.state === "revoked", "format", "invalid device state");
    assertTimestamp(device.addedAt, "device.addedAt");
    assertTimestamp(device.revokedAt, "device.revokedAt", true);
  }
  assertSortedUnique(devices, (device) => device.deviceId as string, "devices");

  const groups = asArray(value.groups, 10_000, "groups").map((entry) => asRecord(entry, "group"));
  for (const group of groups) {
    const groupKeys = Object.keys(group).sort().join(",");
    protocolAssert(groupKeys === "groupId,hpkePublicKey,keyEpoch,memberIds,name" || groupKeys === "groupId,hpkePublicKey,keyEpoch,name", "format", "group has unknown or missing fields");
    assertWorkspaceId(group.groupId as string, "group.groupId");
    assertDisplayName(group.name, "group.name");
    const memberIds = (group.memberIds === undefined ? [] : asArray(group.memberIds, 10_000, "group.memberIds")) as string[];
    for (const memberId of memberIds) assertWorkspaceId(memberId, "group.memberId");
    assertSortedUnique(memberIds, (memberId) => memberId, "group.memberIds");
    assertSafeInteger(group.keyEpoch, 1, 0xffffffff, "group.keyEpoch");
    decodeBase64Exact(group.hpkePublicKey as string, 32, "group.hpkePublicKey");
  }
  assertSortedUnique(groups, (group) => group.groupId as string, "groups");

  const assignments = asArray(value.assignments, 100_000, "assignments").map((entry) => asRecord(entry, "assignment"));
  for (const assignment of assignments) {
    assertExactKeys(assignment, ["assignmentId", "subjectKind", "subjectId", "role", "capabilities", "scopeKind", "scopeId"], "assignment");
    assertWorkspaceId(assignment.assignmentId as string, "assignment.assignmentId");
    protocolAssert(assignment.subjectKind === "member" || assignment.subjectKind === "group", "format", "invalid assignment subject kind");
    assertWorkspaceId(assignment.subjectId as string, "assignment.subjectId");
    assertString(assignment.role, 64, "assignment.role");
    const capabilities = asArray(assignment.capabilities, CAPABILITIES.size, "assignment.capabilities") as string[];
    for (const capability of capabilities) protocolAssert(typeof capability === "string" && CAPABILITIES.has(capability), "format", "unknown capability");
    assertSortedUnique(capabilities, (capability) => capability, "assignment.capabilities");
    protocolAssert(assignment.scopeKind === "workspace" || assignment.scopeKind === "slice" || assignment.scopeKind === "object", "format", "invalid assignment scope kind");
    if (assignment.scopeKind === "workspace") protocolAssert(assignment.scopeId === null, "format", "workspace scopeId must be null");
    else assertWorkspaceId(assignment.scopeId as string, "assignment.scopeId");
  }
  assertSortedUnique(assignments, (assignment) => assignment.assignmentId as string, "assignments");

  const slices = asArray(value.slices, 10_000, "slices").map((entry) => asRecord(entry, "slice"));
  for (const slice of slices) {
    assertExactKeys(slice, ["sliceId", "name", "kind", "definition", "materializedObjectIds"], "slice");
    assertWorkspaceId(slice.sliceId as string, "slice.sliceId");
    assertDisplayName(slice.name, "slice.name");
    protocolAssert(slice.kind === "folder" || slice.kind === "selection" || slice.kind === "dynamic", "format", "invalid slice kind");
    assertString(slice.definition, 4096, "slice.definition", true);
    const objectIds = asArray(slice.materializedObjectIds, 100_000, "slice.materializedObjectIds") as string[];
    for (const objectId of objectIds) assertWorkspaceId(objectId, "slice.objectId");
    assertSortedUnique(objectIds, (objectId) => objectId, "slice.materializedObjectIds");
  }
  assertSortedUnique(slices, (slice) => slice.sliceId as string, "slices");

  const overrides = asArray(value.objectOverrides, 100_000, "objectOverrides").map((entry) => asRecord(entry, "objectOverride"));
  for (const override of overrides) {
    assertExactKeys(override, ["objectId", "subjectKind", "subjectId", "capabilities"], "objectOverride");
    assertWorkspaceId(override.objectId as string, "objectOverride.objectId");
    protocolAssert(override.subjectKind === "member" || override.subjectKind === "group", "format", "invalid override subject kind");
    assertWorkspaceId(override.subjectId as string, "objectOverride.subjectId");
    const capabilities = asArray(override.capabilities, CAPABILITIES.size, "objectOverride.capabilities") as string[];
    for (const capability of capabilities) protocolAssert(typeof capability === "string" && CAPABILITIES.has(capability), "format", "unknown capability");
    assertSortedUnique(capabilities, (capability) => capability, "objectOverride.capabilities");
  }
  assertSortedUnique(overrides, (override) => `${override.objectId}:${override.subjectKind}:${override.subjectId}`, "objectOverrides");

  const revocations = asArray(value.revocations, 100_000, "revocations").map((entry) => asRecord(entry, "revocation"));
  for (const revocation of revocations) {
    assertExactKeys(revocation, ["subjectKind", "subjectId", "revokedAt", "reason"], "revocation");
    protocolAssert(revocation.subjectKind === "member" || revocation.subjectKind === "device", "format", "invalid revocation kind");
    assertWorkspaceId(revocation.subjectId as string, "revocation.subjectId");
    assertTimestamp(revocation.revokedAt, "revocation.revokedAt");
    assertString(revocation.reason, 512, "revocation.reason", true);
  }
  assertSortedUnique(revocations, (revocation) => `${revocation.subjectKind}:${revocation.subjectId}`, "revocations");
}

function validateGrant(payload: unknown): void {
  const value = asRecord(payload, "grant payload");
  assertExactKeys(value, ["recipientDeviceId", "issuerDeviceId", "policyHash", "purpose", "groupId", "keyEpoch", "keyHint", "enc", "ciphertext", "createdAt", "expiresAt"], "grant payload");
  assertWorkspaceId(value.recipientDeviceId as string, "recipientDeviceId");
  assertWorkspaceId(value.issuerDeviceId as string, "issuerDeviceId");
  assertWorkspaceHash(value.policyHash as string, "policyHash");
  assertString(value.purpose, 64, "purpose");
  assertWorkspaceId(value.groupId as string, "groupId");
  assertSafeInteger(value.keyEpoch, 1, 0xffffffff, "keyEpoch");
  decodeBase64Exact(value.keyHint as string, 8, "keyHint");
  decodeBase64Exact(value.enc as string, HPKE_ENCAPSULATED_KEY_BYTES, "enc");
  decodeBase64Exact(value.ciphertext as string, HPKE_WRAPPED_KEY_BYTES, "ciphertext");
  assertTimestamp(value.createdAt, "createdAt");
  assertTimestamp(value.expiresAt, "expiresAt", true);
  if (value.expiresAt !== null) protocolAssert(Date.parse(value.expiresAt as string) > Date.parse(value.createdAt as string), "integrity", "grant expiry must be after creation");
}

function validateOperation(payload: unknown): void {
  const value = asRecord(payload, "operation payload");
  assertExactKeys(value, ["operationId", "deviceId", "memberId", "sequence", "previousDeviceOperationHash", "policyHash", "capability", "operation", "objectId", "revisionId", "parentRevisionIds", "payloadHash", "createdAt"], "operation payload");
  assertWorkspaceId(value.operationId as string, "operationId");
  assertWorkspaceId(value.deviceId as string, "deviceId");
  assertWorkspaceId(value.memberId as string, "memberId");
  const sequence = assertSafeInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER, "sequence");
  assertOptionalHash(value.previousDeviceOperationHash, "previousDeviceOperationHash");
  protocolAssert(sequence === 1 ? value.previousDeviceOperationHash === null : value.previousDeviceOperationHash !== null, "integrity", "operation predecessor does not match sequence");
  assertWorkspaceHash(value.policyHash as string, "policyHash");
  protocolAssert(value.operation === "create" || value.operation === "write" || value.operation === "rename" || value.operation === "delete" || value.operation === "mkdir" || value.operation === "comment" || value.operation === "resolve", "format", "invalid operation");
  assertWorkspaceId(value.objectId as string, "objectId");
  if (value.revisionId !== null) assertWorkspaceId(value.revisionId as string, "revisionId");
  const parents = asArray(value.parentRevisionIds, 64, "parentRevisionIds") as string[];
  for (const parent of parents) assertWorkspaceId(parent, "parentRevisionId");
  assertSortedUnique(parents, (parent) => parent, "parentRevisionIds");
  if (value.payloadHash !== null) assertWorkspaceHash(value.payloadHash as string, "payloadHash");
  assertTimestamp(value.createdAt, "createdAt");

  const operation = value.operation as WorkspaceOperationName;
  const expectedCapability: Record<WorkspaceOperationName, WorkspaceOperationCapability> = {
    create: "content.create",
    mkdir: "content.create",
    write: "content.write",
    resolve: "content.write",
    rename: "content.rename",
    delete: "content.delete",
    comment: "comment.create",
  };
  protocolAssert(value.capability === expectedCapability[operation], "integrity", "operation capability does not match operation kind");
  if (operation === "delete") {
    protocolAssert(value.revisionId === null && value.payloadHash === null && parents.length >= 1, "integrity", "delete operation fields are inconsistent");
  } else {
    protocolAssert(value.revisionId !== null && value.payloadHash !== null, "integrity", "content operation requires revision and payload hash");
    if (operation === "create" || operation === "mkdir") protocolAssert(parents.length === 0, "integrity", "create operation must not have revision parents");
    else if (operation === "resolve") protocolAssert(parents.length >= 2, "integrity", "resolve operation requires at least two revision parents");
    else protocolAssert(parents.length >= 1, "integrity", "mutation operation requires a revision parent");
  }
}

function validateCatalog(payload: unknown): void {
  const value = asRecord(payload, "catalog payload");
  assertExactKeys(value, ["groupId", "keyEpoch", "catalogVersion", "previousCatalogHash", "bodyHash", "bodySize", "nonce", "ciphertext"], "catalog payload");
  assertWorkspaceId(value.groupId as string, "groupId");
  assertSafeInteger(value.keyEpoch, 1, 0xffffffff, "keyEpoch");
  assertSafeInteger(value.catalogVersion, 1, Number.MAX_SAFE_INTEGER, "catalogVersion");
  assertOptionalHash(value.previousCatalogHash, "previousCatalogHash");
  assertWorkspaceHash(value.bodyHash as string, "bodyHash");
  const bodySize = assertSafeInteger(value.bodySize, 0, MAX_CATALOG_BODY_BYTES, "bodySize");
  decodeBase64Exact(value.nonce as string, 24, "nonce");
  protocolAssert(typeof value.ciphertext === "string" && value.ciphertext.length <= Math.ceil((bodySize + 16) / 3) * 4 + 4, "bounds", "catalog ciphertext is too large");
  decodeBase64Exact(value.ciphertext as string, bodySize + 16, "ciphertext");
}

function validateCheckpoint(payload: unknown): void {
  const value = asRecord(payload, "checkpoint payload");
  assertExactKeys(value, ["checkpointVersion", "policyHash", "operationHeads", "objectRootHash", "createdAt"], "checkpoint payload");
  assertSafeInteger(value.checkpointVersion, 1, Number.MAX_SAFE_INTEGER, "checkpointVersion");
  assertWorkspaceHash(value.policyHash as string, "policyHash");
  assertWorkspaceHash(value.objectRootHash as string, "objectRootHash");
  assertTimestamp(value.createdAt, "createdAt");
  const heads = asArray(value.operationHeads, 50_000, "operationHeads").map((entry) => asRecord(entry, "operationHead"));
  for (const head of heads) {
    assertExactKeys(head, ["deviceId", "sequence", "operationHash"], "operationHead");
    assertWorkspaceId(head.deviceId as string, "operationHead.deviceId");
    assertSafeInteger(head.sequence, 1, Number.MAX_SAFE_INTEGER, "operationHead.sequence");
    assertWorkspaceHash(head.operationHash as string, "operationHead.operationHash");
  }
  assertSortedUnique(heads, (head) => head.deviceId as string, "operationHeads");
}

function validateHead(payload: unknown): void {
  const value = asRecord(payload, "head payload");
  assertExactKeys(value, ["deviceId", "sequence", "operationHash", "checkpointHash"], "head payload");
  assertWorkspaceId(value.deviceId as string, "deviceId");
  assertSafeInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER, "sequence");
  assertWorkspaceHash(value.operationHash as string, "operationHash");
  assertOptionalHash(value.checkpointHash, "checkpointHash");
}

function validateRecoveryAnchor(payload: unknown): void {
  const value = asRecord(payload, "recovery anchor payload");
  assertExactKeys(value, ["anchorVersion", "previousAnchorHash", "previousRecoveryId", "recovery", "createdAt"], "recovery anchor payload");
  assertSafeInteger(value.anchorVersion, 1, Number.MAX_SAFE_INTEGER, "anchorVersion");
  assertOptionalHash(value.previousAnchorHash, "previousAnchorHash");
  protocolAssert(value.anchorVersion === 1 ? value.previousAnchorHash === null : value.previousAnchorHash !== null, "integrity", "recovery anchor predecessor is inconsistent");
  assertWorkspaceId(value.previousRecoveryId as string, "previousRecoveryId");
  const recovery = asRecord(value.recovery, "recovery anchor identity");
  assertExactKeys(recovery, ["recoveryId", "signingPublicKey"], "recovery anchor identity");
  assertWorkspaceId(recovery.recoveryId as string, "recoveryId");
  protocolAssert(recovery.recoveryId !== value.previousRecoveryId, "integrity", "recovery rotation must use a new identity");
  decodeBase64Exact(recovery.signingPublicKey as string, 32, "recovery signing key");
  assertTimestamp(value.createdAt, "createdAt");
}

export function validateWorkspaceDocumentPayload(kind: WorkspaceDocumentKind, payload: unknown): void {
  validateCanonicalValue(payload);
  switch (kind) {
    case "genesis": validateGenesis(payload); break;
    case "policy": validatePolicy(payload); break;
    case "grant": validateGrant(payload); break;
    case "operation": validateOperation(payload); break;
    case "catalog": validateCatalog(payload); break;
    case "checkpoint": validateCheckpoint(payload); break;
    case "recovery": validateRecoveryAnchor(payload); break;
    case "head": validateHead(payload); break;
  }
}

function signatureInput(document: WorkspaceUnsignedDocument, signer: WorkspaceDocumentSigner): Uint8Array {
  return concatBytes(SIGNING_PREFIX, utf8Encode(canonicalJson({
    kind: document.kind,
    protocolVersion: document.protocolVersion,
    workspaceId: document.workspaceId,
    payload: document.payload,
    signer: {
      algorithm: signer.algorithm,
      signerId: signer.signerId,
      signerKind: signer.signerKind,
    },
  })));
}

export function signWorkspaceDocument<K extends WorkspaceDocumentKind, P>(
  document: WorkspaceUnsignedDocument<K, P>,
  signer: WorkspaceDocumentSigner,
  privateKey: Uint8Array
): WorkspaceSignedDocument<K, P> {
  validateUnsignedDocument(document);
  validateSigner(signer);
  return {
    ...document,
    signatures: [{ ...signer, value: toBase64(signWorkspaceBytes(privateKey, signatureInput(document, signer))) }],
  };
}

export function appendWorkspaceDocumentSignature<K extends WorkspaceDocumentKind, P>(
  document: WorkspaceSignedDocument<K, P>,
  signer: WorkspaceDocumentSigner,
  privateKey: Uint8Array
): WorkspaceSignedDocument<K, P> {
  validateUnsignedDocument(document);
  validateSigner(signer);
  protocolAssert(!document.signatures.some((entry) => entry.signerId === signer.signerId && entry.signerKind === signer.signerKind), "format", "duplicate document signer");
  const signature = { ...signer, value: toBase64(signWorkspaceBytes(privateKey, signatureInput(document, signer))) };
  return { ...document, signatures: [...document.signatures, signature].sort(compareSignatures) };
}

function compareSignatures(left: WorkspaceDocumentSignature, right: WorkspaceDocumentSignature): number {
  const leftKey = `${left.signerKind}:${left.signerId}`;
  const rightKey = `${right.signerKind}:${right.signerId}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function validateSigner(signer: WorkspaceDocumentSigner): void {
  assertExactKeys(signer as unknown as Record<string, unknown>, ["algorithm", "signerId", "signerKind"], "document signer");
  validateSignerFields(signer);
}

function validateSignerFields(signer: WorkspaceDocumentSigner): void {
  protocolAssert(signer.algorithm === "Ed25519", "unsupported", "unsupported signature algorithm");
  assertWorkspaceId(signer.signerId, "signerId");
  protocolAssert(signer.signerKind === "device" || signer.signerKind === "recovery", "format", "invalid signer kind");
}

function validateUnsignedDocument(document: WorkspaceUnsignedDocument): void {
  protocolAssert(document.kind in DOCUMENT_MAX_BYTES, "format", "unknown document kind");
  protocolAssert(document.protocolVersion === WORKSPACE_PROTOCOL_VERSION, "unsupported", "unsupported workspace protocol version");
  assertWorkspaceId(document.workspaceId, "workspaceId");
  validateWorkspaceDocumentPayload(document.kind, document.payload);
}

export function validateWorkspaceSignedDocument(document: WorkspaceSignedDocument): void {
  validateUnsignedDocument(document);
  protocolAssert(Array.isArray(document.signatures) && document.signatures.length >= 1 && document.signatures.length <= 16, "bounds", "invalid signature count");
  for (const signature of document.signatures) {
    const value = asRecord(signature, "signature");
    assertExactKeys(value, ["algorithm", "signerId", "signerKind", "value"], "signature");
    validateSignerFields(signature);
    decodeBase64Exact(signature.value, WORKSPACE_SIGNATURE_BYTES, "signature.value");
  }
  assertSortedUnique(document.signatures, (signature) => `${signature.signerKind}:${signature.signerId}`, "signatures");
  if (document.kind === "genesis") {
    const payload = document.payload as WorkspaceGenesisPayload;
    protocolAssert(document.signatures.length === 2, "integrity", "genesis requires owner-device and recovery signatures");
    protocolAssert(document.signatures.some((signature) => signature.signerKind === "device" && signature.signerId === payload.initialOwnerDevice.deviceId), "integrity", "genesis owner signature is missing");
    protocolAssert(document.signatures.some((signature) => signature.signerKind === "recovery" && signature.signerId === payload.recovery.recoveryId), "integrity", "genesis recovery signature is missing");
  }
  if (document.kind === "grant") {
    const payload = document.payload as { issuerDeviceId: string };
    protocolAssert(document.signatures.length === 1 && document.signatures[0].signerKind === "device" && document.signatures[0].signerId === payload.issuerDeviceId, "integrity", "grant signature does not match issuer device");
  }
  if (document.kind === "operation") {
    const payload = document.payload as WorkspaceOperationPayload;
    protocolAssert(document.signatures.length === 1 && document.signatures[0].signerKind === "device" && document.signatures[0].signerId === payload.deviceId, "integrity", "operation signature does not match author device");
  }
  if (document.kind === "catalog") {
    protocolAssert(document.signatures.length === 1 && document.signatures[0].signerKind === "device", "integrity", "catalog requires exactly one device signature");
  }
  if (document.kind === "head") {
    const payload = document.payload as { deviceId: string };
    protocolAssert(document.signatures.length === 1 && document.signatures[0].signerKind === "device" && document.signatures[0].signerId === payload.deviceId, "integrity", "head signature does not match device");
  }
  if (document.kind === "checkpoint") {
    protocolAssert(document.signatures.length === 1, "integrity", "checkpoint requires exactly one device or recovery signature");
  }
  if (document.kind === "recovery") {
    const payload = document.payload as WorkspaceRecoveryAnchorPayload;
    protocolAssert(document.signatures.length === 2, "integrity", "recovery anchor requires old and new recovery signatures");
    protocolAssert(document.signatures.some((entry) => entry.signerKind === "recovery" && entry.signerId === payload.previousRecoveryId), "integrity", "previous recovery signature is missing");
    protocolAssert(document.signatures.some((entry) => entry.signerKind === "recovery" && entry.signerId === payload.recovery.recoveryId), "integrity", "new recovery signature is missing");
  }
}

export function encodeWorkspaceDocument(document: WorkspaceSignedDocument): Uint8Array {
  validateWorkspaceSignedDocument(document);
  const bytes = utf8Encode(canonicalJson(document));
  protocolAssert(bytes.length <= DOCUMENT_MAX_BYTES[document.kind], "bounds", `${document.kind} document is too large`);
  return bytes;
}

export function parseWorkspaceDocument(bytes: Uint8Array): WorkspaceSignedDocument {
  protocolAssert(bytes.length > 0 && bytes.length <= Math.max(...Object.values(DOCUMENT_MAX_BYTES)), "bounds", "control document size is invalid");
  const text = utf8DecodeFatal(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new WorkspaceProtocolError("format", "invalid control-document JSON", { cause });
  }
  const value = asRecord(parsed, "control document");
  assertExactKeys(value, ["kind", "protocolVersion", "workspaceId", "payload", "signatures"], "control document");
  protocolAssert(typeof value.kind === "string" && value.kind in DOCUMENT_MAX_BYTES, "format", "unknown document kind");
  const kind = value.kind as WorkspaceDocumentKind;
  protocolAssert(bytes.length <= DOCUMENT_MAX_BYTES[kind], "bounds", `${kind} document is too large`);
  protocolAssert(canonicalJson(parsed) === text, "canonical", "control document is not canonical JSON");
  const document = parsed as WorkspaceSignedDocument;
  validateWorkspaceSignedDocument(document);
  return document;
}

export function workspaceDocumentHash(document: WorkspaceSignedDocument): string {
  return sha256Hex(encodeWorkspaceDocument(document));
}

export function verifyWorkspaceDocumentSignatures(
  document: WorkspaceSignedDocument,
  resolvePublicKey: (signer: WorkspaceDocumentSigner) => Uint8Array | null
): boolean {
  try {
    validateWorkspaceSignedDocument(document);
    const unsigned: WorkspaceUnsignedDocument = {
      kind: document.kind,
      protocolVersion: document.protocolVersion,
      workspaceId: document.workspaceId,
      payload: document.payload,
    };
    return document.signatures.every((signature) => {
      const publicKey = resolvePublicKey(signature);
      if (!publicKey) return false;
      return verifyWorkspaceSignature(
        publicKey,
        signatureInput(unsigned, signature),
        decodeBase64Exact(signature.value, WORKSPACE_SIGNATURE_BYTES, "signature.value")
      );
    });
  } catch {
    return false;
  }
}
