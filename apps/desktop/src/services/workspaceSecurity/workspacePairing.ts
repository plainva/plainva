import {
  acceptWorkspacePairing,
  createWorkspacePairingRequest,
  loadWorkspacePairingApproval,
  parseWorkspacePairingRequest,
  parseWorkspaceDocument,
  publishWorkspacePairingRequest,
  workspaceDocumentHash,
  toBase64,
  fromBase64,
  type CreatedWorkspacePairingRequest,
  type PersonalWorkspaceRuntime,
  type WorkspaceObjectStore,
} from "@plainva/core";
import { credentialManager } from "../CredentialManager";
import { persistWorkspaceRuntime } from "./workspaceKeychain";

/**
 * Desktop device-join (pairing REQUEST) flow — the counterpart to the existing
 * approve-only surface (plan Security & Sharing, package C1). A second desktop
 * that already syncs the same remote can now join the encrypted workspace it
 * was invited to, instead of only Recovery-restore (which revokes all other
 * devices). Mirrors the proven mobile flow in mobileWorkspaceSecurity.ts and
 * reuses the same core pairing primitives.
 */

interface StoredPendingPairing {
  token: string;
  shortCode: string;
  fingerprint: string;
  signingPrivateKey: string;
  signingPublicKey: string;
  hpkePrivateKey: string;
  hpkePublicKey: string;
}

const pendingKey = (vaultPath: string) => `workspace_join_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

/** Reads and hashes the remote genesis so a join can be verified against the
 * workspace it claims to target. Returns null if the remote has no workspace. */
export async function detectRemoteWorkspace(store: WorkspaceObjectStore): Promise<{ workspaceId: string; fingerprint: string } | null> {
  const bytes = await store.get(".pvws/genesis.pvgen");
  if (!bytes) return null;
  const genesis = parseWorkspaceDocument(bytes);
  if (genesis.kind !== "genesis") return null;
  return { workspaceId: genesis.workspaceId, fingerprint: workspaceDocumentHash(genesis) };
}

/** Parsed shape of the copyable invite code the owner hands to the joiner. */
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
  const invite = JSON.parse(new TextDecoder().decode(fromBase64(padded))) as WorkspaceInvite;
  if (!invite.memberId || !invite.workspaceId || !invite.fingerprint) throw new Error("invite-code-invalid");
  return invite;
}

/** Creates + publishes a pairing request and persists the pending device keys
 * so the poll can resume after a restart. Verifies the invite against the
 * remote genesis first. */
export async function beginWorkspaceJoin(input: {
  vaultPath: string;
  store: WorkspaceObjectStore;
  invite: WorkspaceInvite;
  deviceName: string;
}): Promise<{ shortCode: string; fingerprint: string; token: string }> {
  const remote = await detectRemoteWorkspace(input.store);
  if (!remote) throw new Error("join-no-remote-workspace");
  if (remote.workspaceId !== input.invite.workspaceId || remote.fingerprint !== input.invite.fingerprint) {
    throw new Error("join-invite-mismatch");
  }
  const created = await createWorkspacePairingRequest({
    workspaceId: input.invite.workspaceId,
    workspaceFingerprint: input.invite.fingerprint,
    memberId: input.invite.memberId,
    deviceDisplayName: input.deviceName,
    platform: "desktop",
  });
  await publishWorkspacePairingRequest(input.store, created);
  const pending: StoredPendingPairing = {
    token: created.token,
    shortCode: created.shortCode,
    fingerprint: created.fingerprint,
    signingPrivateKey: toBase64(created.device.secrets.signing.privateKey),
    signingPublicKey: toBase64(created.device.secrets.signing.publicKey),
    hpkePrivateKey: toBase64(created.device.secrets.hpke.privateKey),
    hpkePublicKey: toBase64(created.device.secrets.hpke.publicKey),
  };
  await credentialManager.writeSecret(pendingKey(input.vaultPath), pending);
  return { shortCode: created.shortCode, fingerprint: created.fingerprint, token: created.token };
}

export async function hasPendingWorkspaceJoin(vaultPath: string): Promise<{ shortCode: string; fingerprint: string } | null> {
  const pending = await credentialManager.readSecret<StoredPendingPairing>(pendingKey(vaultPath));
  return pending ? { shortCode: pending.shortCode, fingerprint: pending.fingerprint } : null;
}

export async function cancelWorkspaceJoin(vaultPath: string): Promise<void> {
  await credentialManager.removeSecret(pendingKey(vaultPath));
}

function restoreCreated(stored: StoredPendingPairing): CreatedWorkspacePairingRequest {
  const request = parseWorkspacePairingRequest(stored.token, { allowExpired: true });
  return {
    token: stored.token,
    shortCode: stored.shortCode,
    fingerprint: stored.fingerprint,
    request,
    device: {
      publicIdentity: request.payload.device,
      secrets: {
        signing: { privateKey: fromBase64(stored.signingPrivateKey), publicKey: fromBase64(stored.signingPublicKey) },
        hpke: { privateKey: fromBase64(stored.hpkePrivateKey), publicKey: fromBase64(stored.hpkePublicKey) },
      },
    },
  };
}

/** Polls for the approval bundle; when present, builds the runtime, persists the
 * device key bundle and returns it. Returns null while still waiting. */
export async function completeWorkspaceJoin(input: {
  vaultPath: string;
  store: WorkspaceObjectStore;
  fallbackPassphrase?: string;
}): Promise<PersonalWorkspaceRuntime | null> {
  const stored = await credentialManager.readSecret<StoredPendingPairing>(pendingKey(input.vaultPath));
  if (!stored) throw new Error("join-no-pending-request");
  const created = restoreCreated(stored);
  const bundle = await loadWorkspacePairingApproval(input.store, created.request.payload.pairingId);
  if (!bundle) return null;
  const runtime = await acceptWorkspacePairing({ created, genesis: bundle.genesis, previousPolicy: bundle.previousPolicy, approval: bundle.approval });
  await persistWorkspaceRuntime({
    vaultPath: input.vaultPath,
    runtime,
    fingerprint: workspaceDocumentHash(runtime.genesis),
    recoveryConfirmedAt: new Date().toISOString(),
    fallbackPassphrase: input.fallbackPassphrase,
  });
  await credentialManager.removeSecret(pendingKey(input.vaultPath));
  return runtime;
}
