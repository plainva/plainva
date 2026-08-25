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

/** Why a slice definition cannot be read. Named, because "0 objects" is not an explanation. */
export type WorkspaceSliceDefinitionError =
  | "folder-not-a-path"
  | "selection-not-json"
  | "rules-unreadable";

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

/**
 * Can this slice definition be read at all? `null` means yes.
 *
 * Every caller below asks this first, because a definition nobody can check must not decide
 * who may read a note (finding 2026-08-25, B3).
 */
export function workspaceSliceDefinitionError(slice: WorkspacePolicySlice): WorkspaceSliceDefinitionError | null {
  try {
    if (slice.kind === "folder") {
      if (slice.definition) assertCanonicalVaultPath(slice.definition);
      return null;
    }
    if (slice.kind === "selection") {
      const ids: unknown = JSON.parse(slice.definition);
      return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? null : "selection-not-json";
    }
    dynamicDefinition(slice.definition);
    return null;
  } catch {
    return slice.kind === "folder" ? "folder-not-a-path" : slice.kind === "selection" ? "selection-not-json" : "rules-unreadable";
  }
}

/** The slices whose definition cannot be read — they grant nothing, and a surface can say so. */
export function listBrokenWorkspaceSlices(
  policy: WorkspacePolicyPayload
): Array<{ sliceId: string; name: string; reason: WorkspaceSliceDefinitionError }> {
  const broken: Array<{ sliceId: string; name: string; reason: WorkspaceSliceDefinitionError }> = [];
  for (const slice of policy.slices) {
    const reason = workspaceSliceDefinitionError(slice);
    if (reason) broken.push({ sliceId: slice.sliceId, name: slice.name, reason });
  }
  return broken;
}

/**
 * Does the slice RULE describe this object? Fail-closed: an unreadable definition matches
 * nothing rather than throwing at the caller or falling back to the materialized list.
 */
export function workspaceSliceMatches(slice: WorkspacePolicySlice, object: WorkspaceSliceObject): boolean {
  if (workspaceSliceDefinitionError(slice)) return false;
  if (slice.kind === "folder") {
    const folder = slice.definition ? assertCanonicalVaultPath(slice.definition).replace(/\/$/, "") : "";
    return folder === "" || object.path === folder || object.path.startsWith(`${folder}/`);
  }
  if (slice.kind === "selection") {
    const ids: unknown = JSON.parse(slice.definition);
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

/**
 * Does this slice cover this object? The single answer, used by authorization AND by the
 * recipient set that decides who gets the key.
 *
 * A slice covers an object when its rule matches OR the object is in the materialized list —
 * the list keeps a selection slice working for objects a rule could never describe. But a
 * slice whose definition cannot be read covers NOTHING, materialized list included: otherwise
 * a stale list would keep granting access on behalf of a definition nobody can check.
 *
 * The two used to disagree (finding 2026-08-25, B5): the recipient set accepted a rule match,
 * authorization demanded a materialized id. The key reached the right people while the
 * permission check said no.
 */
export function workspaceSliceCoversObject(slice: WorkspacePolicySlice, object: WorkspaceSliceObject): boolean {
  if (workspaceSliceDefinitionError(slice)) return false;
  return slice.materializedObjectIds.includes(object.objectId) || workspaceSliceMatches(slice, object);
}

export function workspaceSliceIdsForObject(policy: WorkspacePolicyPayload, object: WorkspaceSliceObject): string[] {
  return policy.slices.filter((slice) => workspaceSliceCoversObject(slice, object)).map((slice) => slice.sliceId).sort();
}

/**
 * Group names for a set of ids, for a surface that has to tell someone what a move costs.
 * An id we cannot resolve is returned as-is — better evidence than a silently shorter list.
 */
export function workspaceGroupNames(policy: WorkspacePolicyPayload, groupIds: readonly string[]): string[] {
  return groupIds.map((groupId) => policy.groups.find((group) => group.groupId === groupId)?.name ?? groupId);
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
