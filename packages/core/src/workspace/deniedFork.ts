import type { IVaultAdapter } from "../vault/IVaultAdapter.js";
import { WORKSPACE_FORKS_FOLDER } from "../vault/backupNaming.js";
import type { WorkspaceMutationAuthorizationRequest } from "./authorization.js";
import { createWorkspaceObjectId } from "./identity.js";
import type { WorkspaceStateStore } from "./state.js";

/**
 * What a change the workspace refuses leaves behind when it came from outside
 * the app (`PermissionedVaultAdapter.authorizeExternalChange`): a copy of the
 * file under `.plainva/workspace/forks`, recorded as the member's local fork.
 * Written below the permission check — the copy is the member's own and goes
 * nowhere. The worker keeps a mutation it refuses before signing the same way
 * (`EncryptedWorkspaceWorker`, release 0.9.0).
 */
export function workspaceDeniedFork(versions: IVaultAdapter, state: WorkspaceStateStore) {
  return (request: WorkspaceMutationAuthorizationRequest): Promise<void> => recordWorkspaceDeniedChange(versions, state, request.path);
}

/**
 * The record of one refused change at `path`, with a copy of the file there
 * when there is one and `copy` is not false. A refused deletion keeps no copy:
 * what it would have removed is the workspace's own, not the member's.
 * `kept-local`: no refusal — a file another device deleted, kept here by a
 * member who may not put it back for the others.
 */
export async function recordWorkspaceDeniedChange(versions: IVaultAdapter, state: WorkspaceStateStore, path: string, copy = true, reason: "permission-denied" | "kept-local" = "permission-denied"): Promise<void> {
  const forkId = createWorkspaceObjectId();
  const safeName = path.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "_") || "external-change";
  const forkPath = `${WORKSPACE_FORKS_FOLDER}/${forkId}-${safeName}`;
  // A folder has no bytes to keep: its refusal is the record alone.
  if (copy && await versions.exists(path) && !(await versions.getFileInfo(path)).isDirectory) {
    await versions.createDir(WORKSPACE_FORKS_FOLDER);
    await versions.writeBinaryFile(forkPath, await versions.readBinaryFile(path));
  }
  await state.saveLocalFork({ forkId, originalPath: path, forkPath, reason, createdAt: new Date().toISOString() });
}

/**
 * A workspace state from before the refusal notice carries no mark of what
 * was said (`refusalsReportedThrough`), and its first cycle named every fork
 * ever kept. Those are no news of this session: the mark is set to the newest
 * of them, unsaid. Asked at the start-up reconcile and at every cycle; once
 * set, it does nothing.
 */
export async function baselineRefusalReports(state: WorkspaceStateStore): Promise<void> {
  const meta = await state.loadMeta();
  if (!meta || meta.refusalsReportedThrough !== undefined) return;
  const kept = (await state.listLocalForks()).filter((fork) => fork.reason === "permission-denied").map((fork) => fork.createdAt).sort();
  meta.refusalsReportedThrough = kept[kept.length - 1] ?? "";
  await state.saveMeta(meta);
}
