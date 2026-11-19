import type { WorkspaceSecurityPublicStatus } from "./workspaceKeychain";
import { onWorkspaceHereChange, workspaceHere } from "./workspaceKeychain";

/** What the vault's start writes into the status when this device holds no key for its workspace (`VaultContext`). */
export const WORKSPACE_KEY_BUNDLE_MISSING = "workspace-key-bundle-missing";

/**
 * Whether the encrypted workspace of a vault is not open on this device, and why (wave 2, § 3.2, rounds 10 and 11 of
 * the review): locked, or without a key for it here. Then no app gets anything of the vault (`configureMcp`,
 * `listenForMcpCalls`). Told by the keys this device holds (`workspaceHere`), never by the status saved before: a vault
 * that is an encrypted workspace (`status`) is open only where its keys are unlocked here — a sync error, a start that
 * failed early, a vault without a sync target or a lock that has begun change nothing about that. A workspace open
 * here with a sync error, being prepared or converted, is open.
 */
export function workspaceClosedHere(vaultPath: string | null | undefined, status: WorkspaceSecurityPublicStatus | null | undefined): "locked" | "no-key" | null {
  if (!vaultPath || !status) return null;
  const here = workspaceHere(vaultPath);
  return here === "open" ? null : here;
}

/** `workspaceClosedHere` may answer differently from now: for a view that shows it, or tells it on. */
export const onWorkspaceClosedChange = onWorkspaceHereChange;
