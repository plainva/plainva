import {
  evaluateWorkspaceAccess,
  previewWorkspaceMoveAccess,
  workspaceGroupNames,
  workspaceSliceIdsForObject,
  createWorkspaceObjectId,
  type PersonalWorkspaceRuntime,
  type WorkspaceCapability,
  type WorkspaceMutationAuthorizer,
  type WorkspaceStateStore,
} from "@plainva/core";
import i18n from "../i18n";

/** A question the permission check puts before a move goes through: its texts, ready for the shell's dialog. */
export interface WorkspaceMoveQuestion {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * The permission check of an encrypted workspace's write chain (the
 * `permissions` link of `buildVaultChain`), once for both shells (stability
 * plan R2). Until 2026-11-11 the desktop's vault context and the phone's vault
 * service each held a copy of it, word for word, apart from the dialog.
 *
 * Without the workspace's runtime — a locked workspace — nothing is allowed.
 * A move is checked at both ends, and where it would take the file out of the
 * mover's own reach, or out of groups that read it, the person is asked first
 * (finding 2026-08-25): asking only "do I still see it?" missed the case that
 * costs other people their access while the mover notices nothing.
 */
export function workspaceWriteAuthorizer(
  runtime: PersonalWorkspaceRuntime | null,
  state: Pick<WorkspaceStateStore, "getObjectByPath">,
  confirm: (question: WorkspaceMoveQuestion) => Promise<boolean>,
): WorkspaceMutationAuthorizer {
  return async (request) => {
    if (!runtime) return false;
    const existing = await state.getObjectByPath(request.path);
    const objectId = existing?.objectId ?? createWorkspaceObjectId();
    const policy = runtime.policy.payload;
    const sliceObject = (path: string) => ({ objectId, path, contentKind: existing?.contentKind });
    const access = (path: string, capability: WorkspaceCapability) => evaluateWorkspaceAccess(policy, {
      memberId: runtime.memberId,
      deviceId: runtime.device.publicIdentity.deviceId,
      capability,
      objectId,
      sliceIds: workspaceSliceIdsForObject(policy, sliceObject(path)),
      object: sliceObject(path),
      objectAuthorMemberId: existing?.authorMemberId ?? null,
    });
    const sourceDecision = access(request.path, request.capability);
    if (!request.newPath || !sourceDecision.allowed) return sourceDecision;
    const targetDecision = access(request.newPath, request.capability);
    if (!targetDecision.allowed) return targetDecision;
    const impact = previewWorkspaceMoveAccess(policy, sliceObject(request.path), request.newPath, runtime.memberId);
    const ask = (title: string, message: string) => confirm({
      title,
      message,
      confirmLabel: i18n.t("workspaceSecurity.moveAnyway"),
      cancelLabel: i18n.t("common.cancel"),
    });
    if (impact.removesActorAccess) {
      return ask(i18n.t("workspaceSecurity.moveAccessLossTitle"), i18n.t("workspaceSecurity.moveAccessLossMessage", { path: request.newPath }));
    }
    if (impact.removedGroupIds.length > 0) {
      return ask(
        i18n.t("workspaceSecurity.moveGroupLossTitle"),
        i18n.t("workspaceSecurity.moveGroupLossMessage", {
          groups: workspaceGroupNames(policy, impact.removedGroupIds).join(", "),
          path: request.newPath,
        }),
      );
    }
    return targetDecision;
  };
}
