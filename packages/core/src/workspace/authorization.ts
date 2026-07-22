import type { IVaultAdapter, VaultFileInfo, WatchEvent } from "../vault/IVaultAdapter.js";
import { VaultPermissionDeniedError } from "../vault/IVaultAdapter.js";
import type {
  WorkspaceCapability,
  WorkspacePolicyAssignment,
  WorkspacePolicyPayload,
} from "./documents.js";
import { isWorkspaceLocalOnlyPath } from "./queueingVaultAdapter.js";

export type WorkspaceRole = "Owner" | "Admin" | "Editor" | "Commenter" | "Reader" | "Contributor";

export const WORKSPACE_ROLE_CAPABILITIES: Readonly<Record<WorkspaceRole, readonly WorkspaceCapability[]>> = {
  Owner: [
    "comment.create", "comment.read", "content.create", "content.delete", "content.read", "content.rename",
    "content.write", "devices.approve", "groups.manage", "history.read", "keys.rotate", "members.invite",
    "members.revoke", "recovery.manage", "slices.manage", "workspace.manage",
  ],
  Admin: [
    "comment.create", "comment.read", "content.create", "content.delete", "content.read", "content.rename",
    "content.write", "devices.approve", "groups.manage", "history.read", "keys.rotate", "members.invite",
    "members.revoke", "slices.manage", "workspace.manage",
  ],
  Editor: [
    "comment.create", "comment.read", "content.create", "content.delete", "content.read", "content.rename",
    "content.write", "history.read",
  ],
  Commenter: ["comment.create", "comment.read", "content.read", "history.read"],
  Reader: ["comment.read", "content.read", "history.read"],
  Contributor: ["content.create"],
};

export interface WorkspaceAccessContext {
  memberId: string;
  deviceId?: string;
  capability: WorkspaceCapability;
  objectId?: string | null;
  sliceIds?: readonly string[];
}

export interface WorkspaceAccessDecision {
  allowed: boolean;
  capability: WorkspaceCapability;
  roleNames: WorkspaceRole[];
  assignmentIds: string[];
  reason: "allowed" | "member-inactive" | "device-inactive" | "not-granted";
}

function isSubjectMatch(policy: WorkspacePolicyPayload, assignment: WorkspacePolicyAssignment, memberId: string): boolean {
  if (assignment.subjectKind === "member") return assignment.subjectId === memberId;
  return policy.groups.some((group) => group.groupId === assignment.subjectId && group.memberIds?.includes(memberId));
}

function isScopeMatch(policy: WorkspacePolicyPayload, assignment: WorkspacePolicyAssignment, context: WorkspaceAccessContext): boolean {
  if (assignment.scopeKind === "workspace") return true;
  if (assignment.scopeKind === "object") return !!context.objectId && assignment.scopeId === context.objectId;
  if (!assignment.scopeId) return false;
  if (context.sliceIds?.includes(assignment.scopeId)) return true;
  const slice = policy.slices.find((entry) => entry.sliceId === assignment.scopeId);
  return !!context.objectId && !!slice?.materializedObjectIds.includes(context.objectId);
}

/** Default-deny capability evaluation shared by UI, adapters and worker. */
export function evaluateWorkspaceAccess(policy: WorkspacePolicyPayload, context: WorkspaceAccessContext): WorkspaceAccessDecision {
  const member = policy.members.find((entry) => entry.memberId === context.memberId);
  if (!member || member.state !== "active") {
    return { allowed: false, capability: context.capability, roleNames: [], assignmentIds: [], reason: "member-inactive" };
  }
  if (context.deviceId) {
    const device = policy.devices.find((entry) => entry.deviceId === context.deviceId && entry.memberId === context.memberId);
    if (!device || device.state !== "active") {
      return { allowed: false, capability: context.capability, roleNames: [], assignmentIds: [], reason: "device-inactive" };
    }
  }
  const assignments = policy.assignments.filter((assignment) =>
    isSubjectMatch(policy, assignment, context.memberId) &&
    assignment.capabilities.includes(context.capability) &&
    isScopeMatch(policy, assignment, context)
  );
  const override = context.objectId ? policy.objectOverrides.some((entry) =>
    entry.objectId === context.objectId && entry.capabilities.includes(context.capability) &&
    (entry.subjectKind === "member"
      ? entry.subjectId === context.memberId
      : policy.groups.some((group) => group.groupId === entry.subjectId && group.memberIds?.includes(context.memberId)))
  ) : false;
  return {
    allowed: assignments.length > 0 || override,
    capability: context.capability,
    roleNames: [...new Set(assignments.map((entry) => entry.role).filter((role): role is WorkspaceRole => role in WORKSPACE_ROLE_CAPABILITIES))],
    assignmentIds: assignments.map((entry) => entry.assignmentId).sort(),
    reason: assignments.length > 0 || override ? "allowed" : "not-granted",
  };
}

export function effectiveWorkspaceCapabilities(
  policy: WorkspacePolicyPayload,
  context: Omit<WorkspaceAccessContext, "capability">
): WorkspaceCapability[] {
  const capabilities = new Set<WorkspaceCapability>();
  for (const capability of Object.values(WORKSPACE_ROLE_CAPABILITIES).flat()) {
    if (evaluateWorkspaceAccess(policy, { ...context, capability }).allowed) capabilities.add(capability);
  }
  return [...capabilities].sort();
}

export type WorkspaceMutationAction = "create" | "write" | "mkdir" | "rename" | "delete" | "restore" | "external";

export interface WorkspaceMutationAuthorizationRequest {
  action: WorkspaceMutationAction;
  path: string;
  newPath?: string;
  capability: Extract<WorkspaceCapability, "content.create" | "content.write" | "content.rename" | "content.delete">;
}

export type WorkspaceMutationAuthorizer = (
  request: WorkspaceMutationAuthorizationRequest
) => Promise<WorkspaceAccessDecision | boolean>;

function allowed(decision: WorkspaceAccessDecision | boolean): boolean {
  return typeof decision === "boolean" ? decision : decision.allowed;
}

/**
 * The single local write boundary for a protected workspace. Every app write,
 * import, restore, automation and AI action already uses IVaultAdapter, so the
 * check happens before disk mutation and the worker repeats it before signing.
 */
export class PermissionedVaultAdapter implements IVaultAdapter {
  constructor(
    private readonly inner: IVaultAdapter,
    private readonly authorize: WorkspaceMutationAuthorizer,
    private readonly onDeniedExternalFork?: (request: WorkspaceMutationAuthorizationRequest) => Promise<void> | void,
  ) {}

  initialize(): Promise<void> { return this.inner.initialize(); }
  dispose(): Promise<void> { return this.inner.dispose(); }
  acknowledgeExternalUpdate?(path: string): Promise<void> { return this.inner.acknowledgeExternalUpdate?.(path) ?? Promise.resolve(); }
  readTextFile(path: string): Promise<string> { return this.inner.readTextFile(path); }
  readBinaryFile(path: string): Promise<Uint8Array> { return this.inner.readBinaryFile(path); }
  exists(path: string): Promise<boolean> { return this.inner.exists(path); }
  getFileInfo(path: string): Promise<VaultFileInfo> { return this.inner.getFileInfo(path); }
  listDir(path?: string, recursive?: boolean): Promise<VaultFileInfo[]> { return this.inner.listDir(path, recursive); }
  watch?(callback: (events: WatchEvent[]) => void): Promise<() => void> { return this.inner.watch?.(callback) ?? Promise.resolve(() => {}); }

  async writeTextFile(path: string, content: string): Promise<void> {
    await this.checkWrite(path, "write");
    await this.inner.writeTextFile(path, content);
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await this.checkWrite(path, "write");
    await this.inner.writeBinaryFile(path, content);
  }

  async createDir(path: string): Promise<void> {
    if (!isWorkspaceLocalOnlyPath(path)) await this.check({ action: "mkdir", path, capability: "content.create" });
    await this.inner.createDir(path);
  }

  async deleteItem(path: string, recursive?: boolean): Promise<void> {
    if (!isWorkspaceLocalOnlyPath(path)) await this.check({ action: "delete", path, capability: "content.delete" });
    await this.inner.deleteItem(path, recursive);
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    if (!isWorkspaceLocalOnlyPath(oldPath) && !isWorkspaceLocalOnlyPath(newPath)) {
      await this.check({ action: "rename", path: oldPath, newPath, capability: "content.rename" });
    }
    await this.inner.renameItem(oldPath, newPath);
  }

  /** Watchers call this before they enqueue an out-of-process local change. */
  async authorizeExternalChange(path: string, exists: boolean): Promise<boolean> {
    const request: WorkspaceMutationAuthorizationRequest = {
      action: "external",
      path,
      capability: exists ? "content.write" : "content.delete",
    };
    const decision = await this.authorize(request);
    if (allowed(decision)) return true;
    await this.onDeniedExternalFork?.(request);
    return false;
  }

  private async checkWrite(path: string, action: "write" | "restore"): Promise<void> {
    if (isWorkspaceLocalOnlyPath(path)) return;
    const exists = await this.inner.exists(path);
    await this.check({ action: exists ? action : "create", path, capability: exists ? "content.write" : "content.create" });
  }

  private async check(request: WorkspaceMutationAuthorizationRequest): Promise<void> {
    if (!allowed(await this.authorize(request))) throw new VaultPermissionDeniedError(request.path);
  }
}
