import {
  acceptWorkspacePairing,
  createWorkspacePairingRequest,
  deserializePersonalWorkspaceRuntime,
  loadWorkspacePairingApproval,
  parseWorkspacePairingRequest,
  publishWorkspacePairingRequest,
  publishWorkspaceGovernanceUpdate,
  publishWorkspaceRecoveryRotation,
  restoreWorkspaceFromRecoveryPackage,
  rotateWorkspaceRecoveryPackage,
  serializePersonalWorkspaceRuntime,
  toBase64,
  fromBase64,
  type CreatedWorkspacePairingRequest,
  type PersonalWorkspaceRuntime,
  type WorkspaceObjectStore,
} from "@plainva/core";
import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";
import { secureCredentialStore } from "../platform/secureStore";

export interface MobileWorkspaceStatus {
  version: 1;
  workspaceId: string;
  fingerprint: string;
  deviceName: string;
  phase: "pairing" | "active" | "locked" | "error";
  lastError: string | null;
}

interface StoredPendingPairing {
  token: string;
  shortCode: string;
  fingerprint: string;
  signingPrivateKey: string;
  signingPublicKey: string;
  hpkePrivateKey: string;
  hpkePublicKey: string;
}

const runtimeKey = (vaultId: string) => `workspace_runtime_mobile_${vaultId}`;
const pendingKey = (vaultId: string) => `workspace_pairing_mobile_${vaultId}`;
const statusKey = (vaultId: string) => `workspace_status_mobile_${vaultId}`;
const cache = new Map<string, PersonalWorkspaceRuntime>();
const locked = new Set<string>();

export async function getMobileWorkspaceStatus(vaultId: string): Promise<MobileWorkspaceStatus | null> {
  const value = await Preferences.get({ key: statusKey(vaultId) });
  return value.value ? JSON.parse(value.value) as MobileWorkspaceStatus : null;
}

async function saveStatus(vaultId: string, status: MobileWorkspaceStatus): Promise<void> {
  await Preferences.set({ key: statusKey(vaultId), value: JSON.stringify(status) });
  window.dispatchEvent(new CustomEvent("m-workspace-security-changed"));
}

export async function loadMobileWorkspaceRuntime(vaultId: string): Promise<PersonalWorkspaceRuntime | null> {
  if (locked.has(vaultId)) return null;
  const remembered = cache.get(vaultId); if (remembered) return remembered;
  const stored = await secureCredentialStore.readSecret<ReturnType<typeof serializePersonalWorkspaceRuntime>>(runtimeKey(vaultId));
  if (!stored) return null;
  const runtime = deserializePersonalWorkspaceRuntime(stored); cache.set(vaultId, runtime); return runtime;
}

export async function persistMobileWorkspaceRuntime(vaultId: string, runtime: PersonalWorkspaceRuntime): Promise<void> {
  await secureCredentialStore.writeSecret(runtimeKey(vaultId), serializePersonalWorkspaceRuntime(runtime));
  cache.set(vaultId, runtime); locked.delete(vaultId);
  await saveStatus(vaultId, { version: 1, workspaceId: runtime.workspaceId, fingerprint: runtime.genesis ? (await import("@plainva/core")).workspaceDocumentHash(runtime.genesis) : "", deviceName: runtime.device.publicIdentity.displayName, phase: "active", lastError: null });
}

export async function beginMobileWorkspacePairing(input: { vaultId: string; store: WorkspaceObjectStore; workspaceId: string; fingerprint: string; memberId: string; deviceName: string }): Promise<{ token: string; shortCode: string; fingerprint: string }> {
  const created = await createWorkspacePairingRequest({ workspaceId: input.workspaceId, workspaceFingerprint: input.fingerprint, memberId: input.memberId, deviceDisplayName: input.deviceName, platform: Capacitor.getPlatform() === "ios" ? "ios" : "android" });
  await publishWorkspacePairingRequest(input.store, created);
  await secureCredentialStore.writeSecret<StoredPendingPairing>(pendingKey(input.vaultId), {
    token: created.token, shortCode: created.shortCode, fingerprint: created.fingerprint,
    signingPrivateKey: toBase64(created.device.secrets.signing.privateKey), signingPublicKey: toBase64(created.device.secrets.signing.publicKey),
    hpkePrivateKey: toBase64(created.device.secrets.hpke.privateKey), hpkePublicKey: toBase64(created.device.secrets.hpke.publicKey),
  });
  await saveStatus(input.vaultId, { version: 1, workspaceId: input.workspaceId, fingerprint: input.fingerprint, deviceName: input.deviceName, phase: "pairing", lastError: null });
  return { token: created.token, shortCode: created.shortCode, fingerprint: created.fingerprint };
}

function restoreCreated(stored: StoredPendingPairing): CreatedWorkspacePairingRequest {
  const request = parseWorkspacePairingRequest(stored.token, { allowExpired: true });
  return { token: stored.token, shortCode: stored.shortCode, fingerprint: stored.fingerprint, request, device: { publicIdentity: request.payload.device, secrets: { signing: { privateKey: fromBase64(stored.signingPrivateKey), publicKey: fromBase64(stored.signingPublicKey) }, hpke: { privateKey: fromBase64(stored.hpkePrivateKey), publicKey: fromBase64(stored.hpkePublicKey) } } } };
}

export async function completeMobileWorkspacePairing(vaultId: string, store: WorkspaceObjectStore): Promise<PersonalWorkspaceRuntime | null> {
  const stored = await secureCredentialStore.readSecret<StoredPendingPairing>(pendingKey(vaultId)); if (!stored) throw new Error("no pending pairing request");
  const created = restoreCreated(stored);
  const bundle = await loadWorkspacePairingApproval(store, created.request.payload.pairingId); if (!bundle) return null;
  const runtime = await acceptWorkspacePairing({ created, genesis: bundle.genesis, previousPolicy: bundle.previousPolicy, approval: bundle.approval });
  await persistMobileWorkspaceRuntime(vaultId, runtime);
  await secureCredentialStore.removeSecret(pendingKey(vaultId));
  return runtime;
}

export async function recoverMobileWorkspace(input: { vaultId: string; store: WorkspaceObjectStore; bytes: Uint8Array; code: string; deviceName: string }): Promise<PersonalWorkspaceRuntime> {
  const restored = await restoreWorkspaceFromRecoveryPackage({ bytes: input.bytes, recoveryCode: input.code, deviceDisplayName: input.deviceName, platform: Capacitor.getPlatform() === "ios" ? "ios" : "android", revokeOtherDevices: true, store: input.store });
  await publishWorkspaceGovernanceUpdate(input.store, restored);
  await persistMobileWorkspaceRuntime(input.vaultId, restored.runtime);
  return restored.runtime;
}

export async function rotateMobileWorkspaceRecovery(input: { store: WorkspaceObjectStore; runtime: PersonalWorkspaceRuntime; bytes: Uint8Array; code: string }) {
  const rotated = await rotateWorkspaceRecoveryPackage({ store: input.store, runtime: input.runtime, bytes: input.bytes, recoveryCode: input.code });
  return { bytes: rotated.bytes, recoveryCode: rotated.recoveryCode, activation: rotated.anchor };
}

export async function activateMobileWorkspaceRecovery(input: { store: WorkspaceObjectStore; runtime: PersonalWorkspaceRuntime; activation: Awaited<ReturnType<typeof rotateMobileWorkspaceRecovery>>["activation"] }): Promise<void> {
  await publishWorkspaceRecoveryRotation({ store: input.store, runtime: input.runtime, anchor: input.activation });
}

export async function lockMobileWorkspace(vaultId: string): Promise<void> {
  cache.delete(vaultId); locked.add(vaultId);
  const status = await getMobileWorkspaceStatus(vaultId); if (status) await saveStatus(vaultId, { ...status, phase: "locked" });
}

export async function unlockMobileWorkspace(vaultId: string): Promise<PersonalWorkspaceRuntime | null> {
  locked.delete(vaultId); const runtime = await loadMobileWorkspaceRuntime(vaultId);
  if (runtime) await saveStatus(vaultId, { version: 1, workspaceId: runtime.workspaceId, fingerprint: (await import("@plainva/core")).workspaceDocumentHash(runtime.genesis), deviceName: runtime.device.publicIdentity.displayName, phase: "active", lastError: null });
  return runtime;
}
