import { fromBase64, toBase64 } from "./encoding.js";

/**
 * Copyable workspace invitation code (Security & Sharing, package C3). The owner
 * shows this on the desktop ("Show invitation"); the invited person pastes it on
 * their new device (desktop OR mobile) to begin joining — so nobody has to find
 * and type a raw member id. The code carries the memberId reserved for them plus
 * the workspaceId + fingerprint, which the join flow verifies against the remote
 * genesis before creating a pairing request. It is not a secret (it grants
 * nothing on its own — an existing device must still approve the pairing), but it
 * should travel over a channel the two people trust.
 */
export interface WorkspaceInvite {
  memberId: string;
  workspaceId: string;
  fingerprint: string;
  role?: string;
}

const INVITE_PREFIX = "PVINVITE1.";

export function encodeWorkspaceInvite(invite: WorkspaceInvite): string {
  return INVITE_PREFIX + toBase64(new TextEncoder().encode(JSON.stringify(invite)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeWorkspaceInvite(code: string): WorkspaceInvite {
  const trimmed = code.trim();
  if (!trimmed.startsWith(INVITE_PREFIX)) throw new Error("invite-code-invalid");
  const b64 = trimmed.slice(INVITE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  let invite: WorkspaceInvite;
  try {
    invite = JSON.parse(new TextDecoder().decode(fromBase64(padded))) as WorkspaceInvite;
  } catch {
    throw new Error("invite-code-invalid");
  }
  if (!invite || !invite.memberId || !invite.workspaceId || !invite.fingerprint) throw new Error("invite-code-invalid");
  return invite;
}
