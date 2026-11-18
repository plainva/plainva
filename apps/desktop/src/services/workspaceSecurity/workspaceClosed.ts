import type { WorkspaceSecurityPublicStatus } from "./workspaceKeychain";

/** What the vault's start writes into the status when this device holds no key for its workspace (`VaultContext`). */
export const WORKSPACE_KEY_BUNDLE_MISSING = "workspace-key-bundle-missing";

/**
 * Whether the encrypted workspace of a vault is not open on this device, and why (wave 2, § 3.2, round 10 of the
 * review): locked, or without a key for it here. Then no app gets anything of the vault (`configureMcp`). A sync
 * error of a workspace that is open here closes nothing, and neither does one being prepared or converted.
 */
export function workspaceClosedHere(status: Pick<WorkspaceSecurityPublicStatus, "phase" | "lastError"> | null | undefined): "locked" | "no-key" | null {
  if (!status) return null;
  if (status.phase === "locked") return "locked";
  if (status.phase === "error" && status.lastError === WORKSPACE_KEY_BUNDLE_MISSING) return "no-key";
  return null;
}
