import { canonicalJson } from "../settingsSync/canonicalJson.js";
import type { WorkspacePolicyPayload, WorkspacePolicySlice } from "./documents.js";
import { assertCanonicalVaultPath } from "./path.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";

export interface WorkspaceSliceObject {
  objectId: string;
  path: string;
  tags?: readonly string[];
  properties?: Readonly<Record<string, string | number | boolean | null>>;
  mime?: string;
  contentKind?: "text" | "binary" | "directory";
}

export interface WorkspaceDynamicSliceDefinition {
  all?: Array<
    | { field: "path" | "mime" | "contentKind"; operator: "equals" | "startsWith" | "endsWith" | "contains"; value: string }
    | { field: "tag"; operator: "equals"; value: string }
    | { field: `property.${string}`; operator: "equals"; value: string | number | boolean | null }
  >;
}

export interface WorkspaceSlicePreview {
  sliceId: string;
  matchedObjectIds: string[];
  matchedPaths: string[];
  addedObjectIds: string[];
  removedObjectIds: string[];
}

function dynamicDefinition(value: string): WorkspaceDynamicSliceDefinition {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch (cause) { throw new WorkspaceProtocolError("format", "dynamic slice definition is not JSON", { cause }); }
  protocolAssert(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed), "format", "dynamic slice definition must be an object");
  protocolAssert(Object.keys(parsed).every((key) => key === "all"), "format", "dynamic slice definition has unknown fields");
  const definition = parsed as WorkspaceDynamicSliceDefinition;
  protocolAssert(Array.isArray(definition.all) && definition.all.length >= 1 && definition.all.length <= 32, "bounds", "dynamic slice must contain 1 to 32 rules");
  return definition;
}

function matchesDynamic(object: WorkspaceSliceObject, definition: WorkspaceDynamicSliceDefinition): boolean {
  return definition.all!.every((rule) => {
    protocolAssert(rule !== null && typeof rule === "object" && typeof rule.field === "string" && typeof rule.operator === "string", "format", "dynamic slice rule is invalid");
    if (rule.field === "tag") return rule.operator === "equals" && object.tags?.includes(String(rule.value)) === true;
    if (rule.field.startsWith("property.")) {
      return rule.operator === "equals" && object.properties?.[rule.field.slice("property.".length)] === rule.value;
    }
    const candidate = rule.field === "path" ? object.path : rule.field === "mime" ? object.mime ?? "" : object.contentKind ?? "";
    const value = String(rule.value);
    switch (rule.operator) {
      case "equals": return candidate === value;
      case "startsWith": return candidate.startsWith(value);
      case "endsWith": return candidate.endsWith(value);
      case "contains": return candidate.includes(value);
      default: throw new WorkspaceProtocolError("format", "dynamic slice operator is invalid");
    }
  });
}

export function createWorkspaceSliceDefinition(input:
  | { kind: "folder"; folder: string }
  | { kind: "selection"; objectIds: readonly string[] }
  | { kind: "dynamic"; definition: WorkspaceDynamicSliceDefinition }
): string {
  if (input.kind === "folder") return assertCanonicalVaultPath(input.folder).replace(/\/$/, "");
  if (input.kind === "selection") return canonicalJson([...new Set(input.objectIds)].sort());
  return canonicalJson(input.definition);
}

export function workspaceSliceMatches(slice: WorkspacePolicySlice, object: WorkspaceSliceObject): boolean {
  if (slice.kind === "folder") {
    const folder = slice.definition ? assertCanonicalVaultPath(slice.definition).replace(/\/$/, "") : "";
    return folder === "" || object.path === folder || object.path.startsWith(`${folder}/`);
  }
  if (slice.kind === "selection") {
    let ids: unknown;
    try { ids = JSON.parse(slice.definition); } catch { ids = slice.materializedObjectIds; }
    return Array.isArray(ids) && ids.includes(object.objectId);
  }
  return matchesDynamic(object, dynamicDefinition(slice.definition));
}

export function previewWorkspaceSlice(slice: WorkspacePolicySlice, objects: readonly WorkspaceSliceObject[]): WorkspaceSlicePreview {
  const matched = objects.filter((object) => workspaceSliceMatches(slice, object)).sort((a, b) => a.path.localeCompare(b.path));
  const current = new Set(slice.materializedObjectIds);
  const next = new Set(matched.map((entry) => entry.objectId));
  return {
    sliceId: slice.sliceId,
    matchedObjectIds: [...next].sort(),
    matchedPaths: matched.map((entry) => entry.path),
    addedObjectIds: [...next].filter((id) => !current.has(id)).sort(),
    removedObjectIds: [...current].filter((id) => !next.has(id)).sort(),
  };
}

export function materializeWorkspaceSlices(policy: WorkspacePolicyPayload, objects: readonly WorkspaceSliceObject[]): WorkspacePolicyPayload {
  const next = structuredClone(policy);
  next.slices = next.slices.map((slice) => ({ ...slice, materializedObjectIds: previewWorkspaceSlice(slice, objects).matchedObjectIds }));
  return next;
}

export function workspaceSliceIdsForObject(policy: WorkspacePolicyPayload, object: WorkspaceSliceObject): string[] {
  return policy.slices.filter((slice) => slice.materializedObjectIds.includes(object.objectId) || workspaceSliceMatches(slice, object)).map((slice) => slice.sliceId).sort();
}

/** Groups whose members can read the object. This is the authoritative PVO1 recipient set. */
export function workspaceRecipientGroupIds(policy: WorkspacePolicyPayload, object: WorkspaceSliceObject): string[] {
  const sliceIds = workspaceSliceIdsForObject(policy, object);
  const groupIds = new Set<string>();
  for (const assignment of policy.assignments) {
    if (!assignment.capabilities.includes("content.read")) continue;
    const scopeMatches = assignment.scopeKind === "workspace"
      || (assignment.scopeKind === "object" && assignment.scopeId === object.objectId)
      || (assignment.scopeKind === "slice" && !!assignment.scopeId && sliceIds.includes(assignment.scopeId));
    if (!scopeMatches) continue;
    if (assignment.subjectKind === "group") groupIds.add(assignment.subjectId);
    else for (const group of policy.groups) if (group.memberIds?.includes(assignment.subjectId)) groupIds.add(group.groupId);
  }
  for (const override of policy.objectOverrides) {
    if (override.objectId !== object.objectId || !override.capabilities.includes("content.read")) continue;
    if (override.subjectKind === "group") groupIds.add(override.subjectId);
    else for (const group of policy.groups) if (group.memberIds?.includes(override.subjectId)) groupIds.add(group.groupId);
  }
  return [...groupIds].filter((groupId) => policy.groups.some((group) => group.groupId === groupId)).sort();
}

export interface WorkspaceMoveAccessImpact {
  beforeGroupIds: string[];
  afterGroupIds: string[];
  addedGroupIds: string[];
  removedGroupIds: string[];
  removesActorAccess: boolean;
}

export function previewWorkspaceMoveAccess(policy: WorkspacePolicyPayload, object: WorkspaceSliceObject, newPath: string, actorMemberId: string): WorkspaceMoveAccessImpact {
  const beforeGroupIds = workspaceRecipientGroupIds(policy, object);
  const afterGroupIds = workspaceRecipientGroupIds(policy, { ...object, path: assertCanonicalVaultPath(newPath) });
  const actorGroups = new Set(policy.groups.filter((group) => group.memberIds?.includes(actorMemberId)).map((group) => group.groupId));
  return {
    beforeGroupIds,
    afterGroupIds,
    addedGroupIds: afterGroupIds.filter((id) => !beforeGroupIds.includes(id)),
    removedGroupIds: beforeGroupIds.filter((id) => !afterGroupIds.includes(id)),
    removesActorAccess: !afterGroupIds.some((id) => actorGroups.has(id)),
  };
}
